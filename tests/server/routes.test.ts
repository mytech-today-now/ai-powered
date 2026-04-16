/**
 * @file tests/server/routes.test.ts
 *
 * Unit/integration tests for provider-aware audio routes.
 *
 * Tests run against a real Express server started in mock mode.
 * All 10 tests exercise provider-routing behaviour for /audio/* endpoints.
 *
 * Tests:
 *   R1  – POST /audio/transcribe without provider defaults to mock provider in mock mode
 *   R2  – POST /audio/transcribe with provider=mock uses mock provider
 *   R3  – POST /audio/speak without provider defaults to mock provider in mock mode
 *   R4  – POST /audio/speak with provider=mock uses mock provider
 *   R5  – GET /providers includes vibevoice entry with modalities=["audio"]
 *   R6  – POST /audio/transcribe with provider=vibevoice accepted; returns 200 {text}
 *   R7  – POST /audio/transcribe without provider falls back to AI_PROVIDER default; returns 200
 *   R8  – POST /audio/transcribe missing audioBase64 → 400 {error:"audioBase64 is required."}
 *   R9  – POST /audio/speak with provider=vibevoice accepted; returns 200 {audio, mimeType}
 *   R10 – POST /audio/speak missing text → 400 {error:"text is required."}
 */

import * as http from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../../src/ai-powered/server/index.js";

// ---------------------------------------------------------------------------
// Shared server (mock mode)
// ---------------------------------------------------------------------------

let server: http.Server;
let port: number;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = createServer({ mock: true });
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
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readJson(res: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    res.setEncoding("utf-8");
    res.on("data", (c: string) => {
      buf += c;
    });
    res.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
    res.on("error", reject);
  });
}

function postJson(path: string, body: unknown): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function getJson(path: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, resolve);
    req.on("error", reject);
    req.end();
  });
}

const SILENCE_B64 = Buffer.alloc(128).toString("base64");

// ---------------------------------------------------------------------------
// R1 – POST /audio/transcribe without provider defaults to mock
// ---------------------------------------------------------------------------
describe("R1 – POST /audio/transcribe without provider uses mock in mock mode", () => {
  it("returns 200 with text field", async () => {
    const res = await postJson("/audio/transcribe", { audioBase64: SILENCE_B64 });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("text");
  });
});

// ---------------------------------------------------------------------------
// R2 – POST /audio/transcribe with provider=mock explicitly
// ---------------------------------------------------------------------------
describe("R2 – POST /audio/transcribe with provider=mock explicitly", () => {
  it("returns 200 with text field when provider is given", async () => {
    const res = await postJson("/audio/transcribe", {
      audioBase64: SILENCE_B64,
      provider: "mock",
    });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("text");
    expect(typeof body.text).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// R3 – POST /audio/speak without provider defaults to mock
// ---------------------------------------------------------------------------
describe("R3 – POST /audio/speak without provider uses mock in mock mode", () => {
  it("returns 200 with audio field", async () => {
    const res = await postJson("/audio/speak", { text: "hello world" });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("audio");
  });
});

// ---------------------------------------------------------------------------
// R4 – POST /audio/speak with provider=mock explicitly
// ---------------------------------------------------------------------------
describe("R4 – POST /audio/speak with provider=mock explicitly", () => {
  it("returns 200 with audio string field", async () => {
    const res = await postJson("/audio/speak", {
      text: "hello world",
      provider: "mock",
    });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(200);
    expect(typeof body.audio).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// R5 – GET /providers includes vibevoice with modalities=["audio"]
// ---------------------------------------------------------------------------
describe("R5 – GET /providers includes vibevoice entry", () => {
  it("has vibevoice provider with modalities=[audio]", async () => {
    const res = await getJson("/providers");
    const body = (await readJson(res)) as Array<{ id: string; modalities: string[] }>;
    expect(res.statusCode).toBe(200);
    const vibe = body.find((p) => p.id === "vibevoice");
    expect(vibe).toBeDefined();
    expect(vibe!.modalities).toContain("audio");
  });
});

// ---------------------------------------------------------------------------
// R6 – POST /audio/transcribe with provider=vibevoice
// In mock mode the route accepts the provider field and routes to MockProvider.
// ---------------------------------------------------------------------------
describe("R6 – POST /audio/transcribe with provider=vibevoice", () => {
  it("returns 200 with text field when provider is vibevoice", async () => {
    const res = await postJson("/audio/transcribe", {
      audioBase64: SILENCE_B64,
      provider: "vibevoice",
    });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("text");
    expect(typeof body.text).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// R7 – POST /audio/transcribe without provider (AI_PROVIDER env fallback)
// When no provider field is sent, the route falls back to AI_PROVIDER / default.
// ---------------------------------------------------------------------------
describe("R7 – POST /audio/transcribe without provider (AI_PROVIDER fallback)", () => {
  it("returns 200 with text field when provider field is omitted", async () => {
    const res = await postJson("/audio/transcribe", { audioBase64: SILENCE_B64 });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("text");
  });
});

// ---------------------------------------------------------------------------
// R8 – POST /audio/transcribe missing audioBase64 → 400
// ---------------------------------------------------------------------------
describe("R8 – POST /audio/transcribe missing audioBase64", () => {
  it("returns 400 with required error when audioBase64 is absent", async () => {
    const res = await postJson("/audio/transcribe", { provider: "vibevoice" });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(400);
    expect(body.error).toBe("audioBase64 is required.");
  });
});

// ---------------------------------------------------------------------------
// R9 – POST /audio/speak with provider=vibevoice
// In mock mode the route accepts the provider field and routes to MockProvider.
// Verifies the route returns audio and mimeType fields (values are mock-mode values).
// ---------------------------------------------------------------------------
describe("R9 – POST /audio/speak with provider=vibevoice", () => {
  it("returns 200 with audio and mimeType fields when provider is vibevoice", async () => {
    const res = await postJson("/audio/speak", {
      text: "hello vibevoice",
      provider: "vibevoice",
    });
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(200);
    expect(body).toHaveProperty("audio");
    expect(body).toHaveProperty("mimeType");
    expect(typeof body.audio).toBe("string");
    expect(typeof body.mimeType).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// R10 – POST /audio/speak missing text → 400
// ---------------------------------------------------------------------------
describe("R10 – POST /audio/speak missing text", () => {
  it("returns 400 with required error when text is absent", async () => {
    const res = await postJson("/audio/speak", {});
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(res.statusCode).toBe(400);
    expect(body.error).toBe("text is required.");
  });
});
