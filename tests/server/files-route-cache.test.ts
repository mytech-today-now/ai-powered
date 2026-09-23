import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../src/ai-powered/server/index.js";
import { deleteFileRef } from "../../src/ai-powered/server/file-handler.js";

const FILE_BYTES = Buffer.from("private-cache-fixture", "utf8");
const FILE_MIME_TYPE = "image/png";
const FILE_NAME = "fixture.png";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let server: Server;
let baseUrl = "";

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = createServer({ mock: true });

  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    listener.once("listening", resolve);
    listener.once("error", reject);
  });

  const address = listener.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an IPv4 server address.");
  }

  return {
    server: listener,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(listener: Server | undefined): Promise<void> {
  if (!listener) return;
  await new Promise<void>((resolve, reject) => {
    listener.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function uploadFixture(): Promise<string> {
  const formData = new FormData();
  formData.append("file", new Blob([FILE_BYTES], { type: FILE_MIME_TYPE }), FILE_NAME);

  const response = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    body: formData,
  });

  expect(response.status).toBe(201);
  const payload = (await response.json()) as { fileRef: string };
  expect(payload.fileRef).toMatch(UUID_RE);
  return payload.fileRef;
}

beforeAll(async () => {
  const started = await startServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(async () => {
  await stopServer(server);
});

describe("GET /files/:uuid", () => {
  it("serves uploaded bytes privately without changing the payload", async () => {
    const fileRef = await uploadFixture();
    const response = await fetch(`${baseUrl}/files/${fileRef}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe(FILE_MIME_TYPE);
    expect(response.headers.get("content-length")).toBe(String(FILE_BYTES.byteLength));

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(FILE_BYTES)).toBe(true);
  });

  it("returns the safe not-found response for an unknown UUID", async () => {
    const response = await fetch(`${baseUrl}/files/${randomUUID()}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "File not found or expired",
    });
  });

  it("serves the same payload on repeated fetches of the same UUID", async () => {
    const fileRef = await uploadFixture();
    const first = await fetch(`${baseUrl}/files/${fileRef}`);
    const second = await fetch(`${baseUrl}/files/${fileRef}`);

    const firstBody = Buffer.from(await first.arrayBuffer());
    const secondBody = Buffer.from(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(second.headers.get("cache-control")).toBe("private, no-store");
    expect(firstBody.equals(FILE_BYTES)).toBe(true);
    expect(secondBody.equals(FILE_BYTES)).toBe(true);
    expect(secondBody.equals(firstBody)).toBe(true);
  });

  it("returns 404 after a file ref is invalidated", async () => {
    const fileRef = await uploadFixture();
    expect(deleteFileRef(fileRef)).toBe(true);

    const response = await fetch(`${baseUrl}/files/${fileRef}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "File not found or expired",
    });
  });
});
