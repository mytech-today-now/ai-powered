/**
 * Hosted proxy caller-authentication boundary.
 *
 * The server is forced to auth.required=true so this suite never depends on
 * the legacy mock-fixture bypass used by unrelated route tests.
 */

import * as http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/ai-powered/server/index.js";
import { _clearKeyCache } from "../../src/ai-powered/auth.js";

const SERVICE_KEY = "ap_sk_proxy_service_test";
const AGENT_KEY = "fb_sk_agent_proxy_test";
const REVOKED_KEY = "fb_sk_revoked_proxy_test";
const WRONG_SCOPE_KEY = "fb_sk_wrong_scope_proxy_test";

let server: http.Server;
let port: number;
let savedApiKey: string | undefined;
let savedAuthEndpoint: string | undefined;

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

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      savedApiKey = process.env["AIPOWERED_API_KEY"];
      savedAuthEndpoint = process.env["AIPOWERED_AUTH_ENDPOINT"];
      process.env["AIPOWERED_API_KEY"] = SERVICE_KEY;
      process.env["AIPOWERED_AUTH_ENDPOINT"] = "https://auth.example.test";
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
