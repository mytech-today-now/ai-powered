/**
 * Hosted proxy caller-authentication boundary.
 *
 * The server is forced to auth.required=true so this suite never depends on
 * the legacy mock-fixture bypass used by unrelated route tests.
 */

import * as http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { createServer } from "../../src/ai-powered/server/index.js";
import { _clearKeyCache } from "../../src/ai-powered/auth.js";
import { proxyAuthDecision } from "../../src/ai-powered/server/auth.js";

const SERVICE_KEY = "ap_sk_proxy_service_test";
const AGENT_KEY = "fb_sk_agent_proxy_test";
const REVOKED_KEY = "fb_sk_revoked_proxy_test";
const WRONG_SCOPE_KEY = "fb_sk_wrong_scope_proxy_test";
const EMPTY_SCOPE_KEY = "fb_sk_empty_scope_proxy_test";
const MALFORMED_SCOPE_KEY = "fb_sk_malformed_scope_proxy_test";

const { privateKey: jwtPrivateKey, publicKey: jwtPublicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const JWT_PUBLIC_KEY = jwtPublicKey.export({ type: "spki", format: "pem" }).toString();
const READ_ONLY_JWT = jwt.sign({ sub: "jwt-read-only", scopes: ["read"] }, jwtPrivateKey, {
  algorithm: "RS256",
});
const EMPTY_SCOPES_JWT = jwt.sign({ sub: "jwt-empty", scopes: [] }, jwtPrivateKey, {
  algorithm: "RS256",
});
const MALFORMED_SCOPES_JWT = jwt.sign(
  { sub: "jwt-malformed", scopes: ["generate", 7] },
  jwtPrivateKey,
  { algorithm: "RS256" },
);
const GENERATE_JWT = jwt.sign({ sub: "jwt-generator", scopes: ["generate"] }, jwtPrivateKey, {
  algorithm: "RS256",
});

let server: http.Server;
let port: number;
let savedApiKey: string | undefined;
let savedAuthEndpoint: string | undefined;
let savedJwtPublicKey: string | undefined;

function readJson(res: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      body += chunk;
    });
    res.on("end", () => {
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    res.on("error", reject);
  });
}

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(body === undefined ? {} : { "Content-Length": Buffer.byteLength(payload) }),
          ...headers,
        },
      },
      resolve,
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function multipartUpload(
  path: string,
  headers: Record<string, string>,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const boundary = "----ai-powered-auth-test";
    const payload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="auth-test.txt"',
        "Content-Type: text/plain",
        "",
        "authenticated file",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    );
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": payload.length,
          ...headers,
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      savedApiKey = process.env["AIPOWERED_API_KEY"];
      savedAuthEndpoint = process.env["AIPOWERED_AUTH_ENDPOINT"];
      savedJwtPublicKey = process.env["AIPOWERED_JWT_PUBLIC_KEY"];
      process.env["AIPOWERED_API_KEY"] = SERVICE_KEY;
      process.env["AIPOWERED_AUTH_ENDPOINT"] = "https://auth.example.test";
      process.env["AIPOWERED_JWT_PUBLIC_KEY"] = JWT_PUBLIC_KEY;
      const app = createServer({ mock: true, auth: { required: true } });
      server = app.listen(0, "127.0.0.1", () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    }),
  15_000,
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      _clearKeyCache();
      if (savedApiKey === undefined) delete process.env["AIPOWERED_API_KEY"];
      else process.env["AIPOWERED_API_KEY"] = savedApiKey;
      if (savedAuthEndpoint === undefined) delete process.env["AIPOWERED_AUTH_ENDPOINT"];
      else process.env["AIPOWERED_AUTH_ENDPOINT"] = savedAuthEndpoint;
      if (savedJwtPublicKey === undefined) delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
      else process.env["AIPOWERED_JWT_PUBLIC_KEY"] = savedJwtPublicKey;
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

beforeEach(() => {
  _clearKeyCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy caller authentication", () => {
  it.each([
    ["catalog reads", "GET", "/providers", "read"],
    ["generation", "POST", "/text", "generate"],
    ["file upload", "POST", "/upload", "files:write"],
    ["file download", "GET", "/files/ref", "files:read"],
    ["file delete", "DELETE", "/files/ref", "files:write"],
  ] as const)("maps %s to the %s scope", (_label, method, path, expectedScope) => {
    expect(proxyAuthDecision({ method, path })).toEqual({
      public: false,
      scope: expectedScope,
    });
  });

  it("rejects a direct non-browser request before provider work", async () => {
    const res = await request("POST", "/text", { prompt: "should not run" });
    const body = await readJson(res);

    expect(res.statusCode).toBe(401);
    expect(body).toEqual({ error: "Authentication required.", code: "AUTH_MISSING" });
  });

  it("does not treat a CORS-allowed origin as authorization", async () => {
    const res = await request(
      "POST",
      "/text",
      { prompt: "cors is not auth" },
      { Origin: "http://localhost:5173" },
    );
    const body = await readJson(res);

    expect(res.statusCode).toBe(401);
    expect(body.code).toBe("AUTH_MISSING");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("rejects malformed credentials with a stable non-secret envelope", async () => {
    const raw = "not-a-bearer-token-secret";
    const res = await request(
      "POST",
      "/text",
      { prompt: "malformed" },
      { Authorization: `Basic ${raw}` },
    );
    const body = await readJson(res);

    expect(res.statusCode).toBe(401);
    expect(body).toEqual({ error: "Authentication required.", code: "AUTH_INVALID_TOKEN" });
    expect(JSON.stringify(body)).not.toContain(raw);
  });

  it("rejects ambiguous caller credentials instead of choosing one", async () => {
    const first = "first-caller-secret";
    const second = "second-caller-secret";
    const res = await request("GET", "/providers", undefined, {
      "X-AI-Agent-Key": first,
      "X-AI-API-Key": second,
    });
    const body = await readJson(res);

    expect(res.statusCode).toBe(401);
    expect(body.code).toBe("AUTH_INVALID_TOKEN");
    expect(JSON.stringify(body)).not.toContain(first);
    expect(JSON.stringify(body)).not.toContain(second);
  });

  it("accepts the existing global service credential and reaches mock routes", async () => {
    const res = await request(
      "POST",
      "/text",
      { prompt: "authenticated mock request" },
      { "X-AI-API-Key": SERVICE_KEY },
    );
    const body = await readJson(res);

    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("content");
  });

  it("accepts one caller credential across catalog, upload, generation, and owner file retrieval", async () => {
    const providerOnlyFetch = vi.fn();
    vi.stubGlobal("fetch", providerOnlyFetch);

    const providerOnly = await request(
      "POST",
      "/text",
      { prompt: "provider-only must fail" },
      {
        "X-AI-Provider-Credentials": Buffer.from(
          JSON.stringify({ apiKey: "provider-only" }),
        ).toString("base64"),
      },
    );
    expect(providerOnly.statusCode).toBe(401);
    expect((await readJson(providerOnly)).code).toBe("AUTH_MISSING");
    expect(providerOnlyFetch).not.toHaveBeenCalled();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          agentId: "browser-agent",
          scopes: ["read", "generate", "files:read", "files:write"],
        }),
      }),
    );
    const callerHeaders = {
      "X-AI-Agent-Key": AGENT_KEY,
      "X-AI-Provider-Credentials": Buffer.from(
        JSON.stringify({ apiKey: "provider-only" }),
      ).toString("base64"),
    };

    const catalog = await request("GET", "/providers", undefined, callerHeaders);
    expect(catalog.statusCode).toBe(200);
    expect(Array.isArray(await readJson(catalog))).toBe(true);

    const generated = await request(
      "POST",
      "/text",
      { prompt: "authenticated browser generation" },
      callerHeaders,
    );
    expect(generated.statusCode).toBe(200);
    expect((await readJson(generated)).content).toBeTypeOf("string");

    const uploaded = await multipartUpload("/upload", callerHeaders);
    expect(uploaded.statusCode).toBe(201);
    const uploadBody = await readJson(uploaded);
    const fileRef = uploadBody.fileRef;
    expect(fileRef).toBeTypeOf("string");

    const file = await request("GET", `/files/${fileRef as string}`, undefined, callerHeaders);
    expect(file.statusCode).toBe(200);
    expect(file.headers["cache-control"]).toBe("private, no-store");
    expect(
      await new Promise<string>((resolve, reject) => {
        let body = "";
        file.setEncoding("utf8");
        file.on("data", (chunk) => (body += chunk));
        file.on("end", () => resolve(body));
        file.on("error", reject);
      }),
    ).toBe("authenticated file");
  });

  it("rejects a revoked agent key without echoing it", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(
      "POST",
      "/text",
      { prompt: "revoked" },
      { "X-AI-Agent-Key": REVOKED_KEY },
    );
    const body = await readJson(res);

    expect(res.statusCode).toBe(401);
    expect(body).toEqual({ error: "Authentication required.", code: "AUTH_INVALID_KEY" });
    expect(JSON.stringify(body)).not.toContain(REVOKED_KEY);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("rejects an authenticated agent that lacks the generate scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ agentId: "agent-read-only", scopes: ["read"] }),
      }),
    );

    const res = await request(
      "POST",
      "/text",
      { prompt: "wrong scope" },
      { "X-AI-Agent-Key": WRONG_SCOPE_KEY },
    );
    const body = await readJson(res);

    expect(res.statusCode).toBe(403);
    expect(body).toEqual({
      error: "Authenticated caller lacks the required scope.",
      code: "AUTH_INSUFFICIENT_SCOPE",
    });
  });

  it.each([
    {
      label: "verified API key with empty scopes",
      headers: { "X-AI-Agent-Key": EMPTY_SCOPE_KEY },
      response: { agentId: "empty-scope-agent", scopes: [] },
      authCalls: 1,
    },
    {
      label: "verified API key without scopes",
      headers: { "X-AI-Agent-Key": "fb_sk_absent_scope_proxy_test" },
      response: { agentId: "absent-scope-agent" },
      authCalls: 1,
    },
    {
      label: "verified API key with malformed scopes",
      headers: { "X-AI-Agent-Key": MALFORMED_SCOPE_KEY },
      response: { agentId: "malformed-scope-agent", scopes: ["generate", 7] },
      authCalls: 1,
    },
    {
      label: "signed read-only JWT",
      headers: { Authorization: "Bearer " + READ_ONLY_JWT },
      response: undefined,
      authCalls: 0,
    },
    {
      label: "signed JWT with empty scopes",
      headers: { Authorization: "Bearer " + EMPTY_SCOPES_JWT },
      response: undefined,
      authCalls: 0,
    },
    {
      label: "signed JWT with malformed scopes",
      headers: { Authorization: "Bearer " + MALFORMED_SCOPES_JWT },
      response: undefined,
      authCalls: 0,
    },
  ])(
    "denies $label for generation and upload before provider or file work",
    async ({ headers, response, authCalls }) => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      });
      vi.stubGlobal("fetch", fetchSpy);

      const generated = await request("POST", "/text", { prompt: "must be denied" }, headers);
      expect(generated.statusCode).toBe(403);
      expect(await readJson(generated)).toEqual({
        error: "Authenticated caller lacks the required scope.",
        code: "AUTH_INSUFFICIENT_SCOPE",
      });

      const uploaded = await multipartUpload("/upload", headers);
      expect(uploaded.statusCode).toBe(403);
      expect(await readJson(uploaded)).toEqual({
        error: "Authenticated caller lacks the required scope.",
        code: "AUTH_INSUFFICIENT_SCOPE",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(authCalls);
    },
  );

  it("enforces the signed JWT generate scope while preserving the service principal", async () => {
    const restricted = await request(
      "POST",
      "/text",
      { prompt: "read-only JWT must fail" },
      { Authorization: "Bearer " + READ_ONLY_JWT },
    );
    expect(restricted.statusCode).toBe(403);

    const generated = await request(
      "POST",
      "/text",
      { prompt: "generate JWT may run" },
      { Authorization: "Bearer " + GENERATE_JWT },
    );
    expect(generated.statusCode).toBe(200);
    expect((await readJson(generated)).content).toBeTypeOf("string");

    const service = await request(
      "POST",
      "/text",
      { prompt: "service remains unrestricted" },
      { "X-AI-API-Key": SERVICE_KEY },
    );
    expect(service.statusCode).toBe(200);
  });

  it("accepts a valid verified agent key with the generate scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ agentId: "agent-generator", scopes: ["generate"] }),
      }),
    );

    const res = await request(
      "POST",
      "/text",
      { prompt: "valid agent" },
      { "X-AI-Agent-Key": AGENT_KEY },
    );
    const body = await readJson(res);

    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("content");
  });

  it("keeps health and static shell intentionally public", async () => {
    const health = await request("GET", "/health");
    const shell = await request("GET", "/");

    expect(health.statusCode).toBe(200);
    expect(shell.statusCode).toBe(200);
  });

  it("does not expose provider credentials in route errors", async () => {
    const rawProviderCredential = "provider-secret-never-echo";
    const encoded = Buffer.from(JSON.stringify({ apiKey: rawProviderCredential })).toString(
      "base64",
    );
    const res = await request(
      "POST",
      "/music",
      { prompt: "safe error" },
      {
        "X-AI-API-Key": SERVICE_KEY,
        "X-AI-Provider-Credentials": encoded,
      },
    );
    const body = await readJson(res);

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(body)).not.toContain(rawProviderCredential);
  });
});
