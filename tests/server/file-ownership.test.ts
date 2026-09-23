/**
 * Real HTTP coverage for owner-bound uploaded files and provider capabilities.
 */

import * as http from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/ai-powered/server/index.js";
import { _clearKeyCache } from "../../src/ai-powered/auth.js";
import {
  createProviderFileCapability,
  deleteFileRef,
  FILE_PROVIDER_CAPABILITY_TTL_MS,
} from "../../src/ai-powered/server/file-handler.js";

const OWNER_KEY = "fb_sk_file_owner_test";
const OTHER_KEY = "fb_sk_file_other_test";
const FILE_BYTES = Buffer.from("owner-bound-file", "utf8");
const nativeFetch = globalThis.fetch.bind(globalThis);

interface RawResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

let server: Server;
let baseUrl = "";
let savedAuthEndpoint: string | undefined;
let savedServiceKey: string | undefined;

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(new URL(baseUrl).port),
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function upload(
  ownerKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const formData = new FormData();
  formData.append("file", new Blob([FILE_BYTES], { type: "image/png" }), "private.png");
  const response = await nativeFetch(`${baseUrl}/upload`, {
    method: "POST",
    body: formData,
    headers: { "X-AI-Agent-Key": ownerKey, ...extraHeaders },
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { fileRef: string };
  return payload.fileRef;
}

beforeAll(async () => {
  savedAuthEndpoint = process.env["AIPOWERED_AUTH_ENDPOINT"];
  savedServiceKey = process.env["AIPOWERED_API_KEY"];
  process.env["AIPOWERED_AUTH_ENDPOINT"] = "https://auth.example.test";
  delete process.env["AIPOWERED_API_KEY"];

  const app = createServer({
    mock: true,
    auth: { required: true },
    corsOrigin: "http://localhost:5173",
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an IPv4 test address.");
  baseUrl = `http://127.0.0.1:${address.port}`;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { key?: string };
      const agentId = body.key === OWNER_KEY ? "file-owner" : "file-other";
      return new Response(
        JSON.stringify({ agentId, scopes: ["files:read", "files:write", "generate"] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );
}, 15_000);

afterAll(async () => {
  _clearKeyCache();
  vi.unstubAllGlobals();
  if (savedAuthEndpoint === undefined) delete process.env["AIPOWERED_AUTH_ENDPOINT"];
  else process.env["AIPOWERED_AUTH_ENDPOINT"] = savedAuthEndpoint;
  if (savedServiceKey === undefined) delete process.env["AIPOWERED_API_KEY"];
  else process.env["AIPOWERED_API_KEY"] = savedServiceKey;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  _clearKeyCache();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("owner-bound uploaded files", () => {
  it("allows the owner and denies another principal with identical safe responses", async () => {
    const fileRef = await upload(OWNER_KEY);

    const ownerResponse = await request("GET", `/files/${fileRef}`, {
      "X-AI-Agent-Key": OWNER_KEY,
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.headers["content-type"]).toBe("image/png");
    expect(ownerResponse.headers["content-length"]).toBe(String(FILE_BYTES.length));
    expect(ownerResponse.headers["cache-control"]).toBe("private, no-store");
    expect(ownerResponse.body.equals(FILE_BYTES)).toBe(true);

    const otherResponse = await request("GET", `/files/${fileRef}`, {
      "X-AI-Agent-Key": OTHER_KEY,
    });
    expect(otherResponse.statusCode).toBe(404);
    expect(otherResponse.body.toString()).toBe(
      JSON.stringify({ error: "File not found or expired" }),
    );
  });

  it("does not treat CORS or a provider capability as ordinary download authorization", async () => {
    const fileRef = await upload(OWNER_KEY);
    const noAuth = await request("GET", `/files/${fileRef}`, {
      Origin: "http://localhost:5173",
    });
    expect(noAuth.statusCode).toBe(401);
    expect(noAuth.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const capability = createProviderFileCapability(fileRef, "venice");
    const providerPath = `/files/provider?capability=${encodeURIComponent(capability)}&provider=venice`;
    const providerResponse = await request("GET", providerPath);
    expect(providerResponse.statusCode).toBe(200);
    expect(providerResponse.headers["content-length"]).toBe(String(FILE_BYTES.length));
    expect(providerResponse.headers["cache-control"]).toBe("no-store");
    expect(providerResponse.body.equals(FILE_BYTES)).toBe(true);

    const wrongProvider = await request(
      "GET",
      `/files/provider?capability=${encodeURIComponent(capability)}&provider=pika`,
    );
    expect(wrongProvider.statusCode).toBe(404);

    const reusedAsDownload = await request("GET", `/files/${capability}`, {
      "X-AI-Agent-Key": OWNER_KEY,
    });
    expect(reusedAsDownload.statusCode).toBe(404);
  });

  it("rejects expired and revoked capabilities", async () => {
    const fileRef = await upload(OWNER_KEY);
    const expired = createProviderFileCapability(
      fileRef,
      "venice",
      Date.now() - FILE_PROVIDER_CAPABILITY_TTL_MS - 1,
    );
    const expiredResponse = await request(
      "GET",
      `/files/provider?capability=${encodeURIComponent(expired)}&provider=venice`,
    );
    expect(expiredResponse.statusCode).toBe(404);

    expect(deleteFileRef(fileRef)).toBe(true);
    const revoked = createProviderFileCapability(fileRef, "venice");
    const revokedResponse = await request(
      "GET",
      `/files/provider?capability=${encodeURIComponent(revoked)}&provider=venice`,
    );
    expect(revokedResponse.statusCode).toBe(404);
  });
});
