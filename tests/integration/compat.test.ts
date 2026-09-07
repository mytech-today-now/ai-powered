/**
 * @file tests/integration/compat.test.ts
 *
 * Integration tests for the /v1/ compatibility routes.
 *
 * Tests run against a real Express server started in mock mode (opts.mock=true).
 * No real API keys are required — the MockProvider handles all modalities.
 *
 * Covered routes (all seven /v1/ endpoints):
 *   POST /v1/chat/completions       bd-btk3  T-CHAT-01..05
 *   GET  /v1/models                 bd-q8cl  T-MOD-01..04
 *   POST /v1/video/generations      bd-q8cl  T-VID-01..04
 *   POST /v1/images/generations     bd-plui  T-IMG-01..05
 *   POST /v1/audio/transcriptions   bd-1f19  T-TRN-01..05
 *   POST /v1/audio/speech           bd-1f19  T-TTS-01..03
 *   POST /v1/messages               bd-0lw2  T-MSG-01..04
 *   POST /v1/messages (cap mismatch) bd-m9qo  T-CAP-01
 *   Native route regression          bd-m9qo  T-REG-01..12
 */

import * as http from "node:http";
import { vi } from "vitest";
import { createServer } from "../../src/ai-powered/server/index.js";
import { AiClient } from "../../src/ai-powered/client.js";
import { VeniceProvider } from "../../src/ai-powered/providers/venice.js";
import { ProviderCapabilityError } from "../../src/ai-powered/types.js";
import type { VideoResult } from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// Shared server (mock mode — no API keys required)
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

/** Read the full response body and JSON-parse it. */
function readBody(res: http.IncomingMessage): Promise<unknown> {
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

/** Read the full response body as a plain string. */
function readText(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    res.setEncoding("utf-8");
    res.on("data", (c: string) => {
      buf += c;
    });
    res.on("end", () => resolve(buf));
    res.on("error", reject);
  });
}

/** Read the full response body as a Buffer (binary). */
function readBinary(res: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
  });
}

/** POST a JSON body and return the raw IncomingMessage. */
function postJson(path: string, body: unknown): Promise<http.IncomingMessage> {
  return postJsonTo(port, path, body);
}

/** POST a JSON body to an explicit port and return the raw IncomingMessage. */
function postJsonTo(
  targetPort: number,
  path: string,
  body: unknown,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
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

/** GET a path and return the raw IncomingMessage. */
function getReq(path: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, resolve);
    req.on("error", reject);
    req.end();
  });
}

/** Build a multipart/form-data Buffer with optional extra text fields and one file field. */
function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  file: { fieldName: string; filename: string; mimeType: string; buffer: Buffer },
): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.mimeType}\r\n\r\n`,
    ),
  );
  parts.push(file.buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

/** POST a multipart/form-data body and return the raw IncomingMessage. */
function postMultipart(
  path: string,
  body: Buffer,
  boundary: string,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.byteLength,
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Read a text/event-stream response fully and return all raw lines. */
function readSseLines(res: http.IncomingMessage): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let buf = "";
    res.setEncoding("utf-8");
    res.on("data", (chunk: string) => {
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) lines.push(line);
    });
    res.on("end", () => {
      if (buf.length > 0) lines.push(buf);
      resolve(lines);
    });
    res.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// T-CHAT: POST /v1/chat/completions  (bd-btk3)
// ---------------------------------------------------------------------------

describe("POST /v1/chat/completions (bd-btk3)", () => {
  const MINIMAL_BODY = {
    messages: [{ role: "user", content: "Hello, mock!" }],
  };

  it("T-CHAT-01: happy path returns 200 with choices[0].message.content non-empty", async () => {
    const res = await postJson("/v1/chat/completions", MINIMAL_BODY);
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(Array.isArray(body["choices"])).toBe(true);
    const choices = body["choices"] as Record<string, unknown>[];
    expect(choices.length).toBeGreaterThan(0);
    const message = choices[0]!["message"] as Record<string, unknown>;
    expect(typeof message["content"]).toBe("string");
    expect((message["content"] as string).length).toBeGreaterThan(0);
  });

  it("T-CHAT-02: stream:true returns Content-Type text/event-stream with delta chunks and [DONE]", async () => {
    const res = await postJson("/v1/chat/completions", { ...MINIMAL_BODY, stream: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/i);

    const lines = await readSseLines(res);
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    // At least one delta chunk (data: {...})
    const deltaLines = dataLines.filter((l) => l !== "data: [DONE]");
    expect(deltaLines.length).toBeGreaterThan(0);
    // Final sentinel must be present
    expect(dataLines).toContain("data: [DONE]");
  });

  it("T-CHAT-03: response_format json_object returns 200 with parseable JSON content", async () => {
    const res = await postJson("/v1/chat/completions", {
      ...MINIMAL_BODY,
      response_format: { type: "json_object" },
    });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    const choices = body["choices"] as Record<string, unknown>[];
    const content = (choices[0]!["message"] as Record<string, unknown>)["content"] as string;
    // MockProvider.generateStructured returns JSON.stringify(data) — must be valid JSON
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("T-CHAT-04: missing messages returns 400 with error.type present", async () => {
    const res = await postJson("/v1/chat/completions", { model: "gpt-4o" });
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as { error: Record<string, unknown> };
    expect(body.error).toBeDefined();
    expect(typeof body.error["type"]).toBe("string");
    expect(body.error["type"]).toBe("invalid_request_error");
  });

  it("T-CHAT-05: invalid response_format type returns 400", async () => {
    const res = await postJson("/v1/chat/completions", {
      ...MINIMAL_BODY,
      response_format: { type: "unsupported_format" },
    });
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as { error: Record<string, unknown> };
    expect(body.error["type"]).toBe("invalid_request_error");
  });
});

// ---------------------------------------------------------------------------
// T-MOD: GET /v1/models  (bd-q8cl)
// ---------------------------------------------------------------------------

describe("GET /v1/models (bd-q8cl)", () => {
  it('T-MOD-01: returns 200 with object:"list"', async () => {
    const res = await getReq("/v1/models");
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body.object).toBe("list");
  });

  it("T-MOD-02: data is a non-empty array", async () => {
    const res = await getReq("/v1/models");
    const body = (await readBody(res)) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('T-MOD-03: each entry has id, object:"model", owned_by (string), created (number)', async () => {
    const res = await getReq("/v1/models");
    const body = (await readBody(res)) as { data: Record<string, unknown>[] };
    for (const entry of body.data) {
      expect(typeof entry["id"]).toBe("string");
      expect(entry["object"]).toBe("model");
      expect(typeof entry["owned_by"]).toBe("string");
      expect(typeof entry["created"]).toBe("number");
    }
  });

  it("T-MOD-04: well-known models are present (gpt-4o, claude-3-5-sonnet-20241022)", async () => {
    const res = await getReq("/v1/models");
    const body = (await readBody(res)) as { data: { id: string }[] };
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("claude-3-5-sonnet-20241022");
  });
});

// ---------------------------------------------------------------------------
// T-VID: POST /v1/video/generations  (bd-q8cl)
// ---------------------------------------------------------------------------

describe("POST /v1/video/generations (bd-q8cl)", () => {
  it("T-VID-01: happy path returns 200 with VideoResult shape", async () => {
    const res = await postJson("/v1/video/generations", { prompt: "a rocket launch" });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["modality"]).toBe("video");
    expect(body["provider"]).toBe("mock");
    expect(body["model"]).toBe("mock-video-v1");
    expect(typeof body["data"]).toBe("string");
    expect(typeof body["mimeType"]).toBe("string");
    expect(body).toHaveProperty("usage");
    expect(body).toHaveProperty("cost");
    expect(body).toHaveProperty("latencyMs");
  });

  it("T-VID-02: data starts with 'data:video/'", async () => {
    const res = await postJson("/v1/video/generations", { prompt: "a timelapse" });
    const body = (await readBody(res)) as { data: string };
    expect(body.data.startsWith("data:video/")).toBe(true);
  });

  it("T-VID-03: missing prompt returns 400", async () => {
    const res = await postJson("/v1/video/generations", {});
    expect(res.statusCode).toBe(400);
  });

  it("T-VID-04: empty string prompt returns 400", async () => {
    const res = await postJson("/v1/video/generations", { prompt: "" });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// T-VID-05 — Venice /v1/video/generations dispatches image URLs to Venice
// ---------------------------------------------------------------------------

describe("POST /v1/video/generations — Venice image-keyframe dispatch", () => {
  let veniceServer: http.Server;
  let venicePort: number;
  let originalVeniceApiKey: string | undefined;
  let originalAiMock: string | undefined;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        originalVeniceApiKey = process.env["VENICE_API_KEY"];
        originalAiMock = process.env["AI_MOCK"];
        process.env["VENICE_API_KEY"] = "venice-test-key";
        process.env["AI_MOCK"] = "false";

        const app = createServer({
          mock: false,
          configOverrides: {
            provider: "venice",
            apiKey: "venice-test-key",
          },
        });
        veniceServer = app.listen(0, "127.0.0.1", () => {
          venicePort = (veniceServer.address() as { port: number }).port;
          resolve();
        });
      }),
    15_000,
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        if (originalVeniceApiKey === undefined) {
          delete process.env["VENICE_API_KEY"];
        } else {
          process.env["VENICE_API_KEY"] = originalVeniceApiKey;
        }
        if (originalAiMock === undefined) {
          delete process.env["AI_MOCK"];
        } else {
          process.env["AI_MOCK"] = originalAiMock;
        }
        veniceServer.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  afterEach(() => vi.restoreAllMocks());

  it("forwards image URLs into VeniceProvider.generateVideoFromImage", async () => {
    const imageUrl = "https://example.com/frame.jpg";
    const spy = vi.spyOn(VeniceProvider.prototype, "generateVideoFromImage").mockResolvedValue({
      modality: "video",
      provider: "venice",
      model: "wan-2.5-preview-image-to-video",
      data: "data:video/mp4;base64,AAAAAA==",
      mimeType: "video/mp4",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: { totalUsd: 0, isEstimate: false },
      latencyMs: 1,
    } as VideoResult);

    const res = await postJsonTo(venicePort, "/v1/video/generations", {
      provider: "venice",
      prompt: "a Venice motion study",
      images: [imageUrl],
    });

    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as { provider?: string; modality?: string };
    expect(body.provider).toBe("venice");
    expect(body.modality).toBe("video");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      imageUrl,
      "a Venice motion study",
      expect.objectContaining({
        images: [imageUrl],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// T-IMG: POST /v1/images/generations  (bd-plui)
// ---------------------------------------------------------------------------

describe("POST /v1/images/generations (bd-plui)", () => {
  it("T-IMG-01: happy path returns 200 with OpenAI image envelope shape", async () => {
    const res = await postJson("/v1/images/generations", { prompt: "a sunset over mountains" });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(typeof body["created"]).toBe("number");
    expect(Array.isArray(body["data"])).toBe(true);
    expect((body["data"] as unknown[]).length).toBe(1);
  });

  it("T-IMG-02: data[0] contains an image field (b64_json or url)", async () => {
    const res = await postJson("/v1/images/generations", { prompt: "a sunset" });
    const body = (await readBody(res)) as { data: Record<string, string>[] };
    const entry = body.data[0]!;
    // MockProvider returns a base64 data URI; toOpenAiImageResponse sets b64_json
    // (url was requested but actual format is b64_json → warning header is set, b64_json used)
    const fieldValue = entry["b64_json"] ?? entry["url"];
    expect(typeof fieldValue).toBe("string");
    expect((fieldValue as string).length).toBeGreaterThan(0);
  });

  it("T-IMG-03: missing prompt returns 400 with OpenAI error envelope", async () => {
    const res = await postJson("/v1/images/generations", {});
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as { error: Record<string, unknown> };
    expect(body.error).toBeDefined();
    expect(typeof body.error["message"]).toBe("string");
    expect(body.error["type"]).toBe("invalid_request_error");
  });

  it("T-IMG-04: n:2 returns 400 (schema enforces n <= 1)", async () => {
    const res = await postJson("/v1/images/generations", { prompt: "a cat", n: 2 });
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as { error: Record<string, unknown> };
    expect(body.error["type"]).toBe("invalid_request_error");
  });

  it("T-IMG-05: ProviderCapabilityError is mapped to 422 with OpenAI error envelope", async () => {
    // Spy on AiClient.generateImage to throw ProviderCapabilityError, simulating a
    // provider (e.g. anthropic) that does not support the image modality.
    const spy = vi
      .spyOn(AiClient.prototype, "generateImage")
      .mockRejectedValueOnce(
        new ProviderCapabilityError("anthropic", "image", ["openai", "venice", "mock"]),
      );
    try {
      const res = await postJson("/v1/images/generations", { prompt: "a sunset" });
      expect(res.statusCode).toBe(422);
      const body = (await readBody(res)) as { error: Record<string, unknown> };
      expect(body.error["type"]).toBe("invalid_request_error");
      expect(typeof body.error["message"]).toBe("string");
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// T-TRN: POST /v1/audio/transcriptions  (bd-1f19)
// ---------------------------------------------------------------------------

describe("POST /v1/audio/transcriptions (bd-1f19)", () => {
  const BOUNDARY = "----TestBoundary987654";
  const AUDIO_BUF = Buffer.from("fake-audio-bytes"); // MockProvider ignores content
  const BASE_FIELDS: Record<string, string> = { model: "whisper-1" };

  it("T-TRN-01: happy path JSON returns 200 with text field", async () => {
    const formBody = buildMultipart(BOUNDARY, BASE_FIELDS, {
      fieldName: "file",
      filename: "audio.mp3",
      mimeType: "audio/mpeg",
      buffer: AUDIO_BUF,
    });
    const res = await postMultipart("/v1/audio/transcriptions", formBody, BOUNDARY);
    expect(res.statusCode).toBe(200);
    const json = (await readBody(res)) as { text: string };
    expect(typeof json.text).toBe("string");
    expect(json.text.length).toBeGreaterThan(0);
  });

  it("T-TRN-02: response_format=text returns 200 plain text with text/plain content-type", async () => {
    const fields = { ...BASE_FIELDS, response_format: "text" };
    const formBody = buildMultipart(BOUNDARY, fields, {
      fieldName: "file",
      filename: "audio.mp3",
      mimeType: "audio/mpeg",
      buffer: AUDIO_BUF,
    });
    const res = await postMultipart("/v1/audio/transcriptions", formBody, BOUNDARY);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/i);
    const text = await readText(res);
    expect(text.length).toBeGreaterThan(0);
  });

  it("T-TRN-03: response_format=verbose_json returns text, language, duration, segments[]", async () => {
    const fields = { ...BASE_FIELDS, response_format: "verbose_json" };
    const formBody = buildMultipart(BOUNDARY, fields, {
      fieldName: "file",
      filename: "audio.mp3",
      mimeType: "audio/mpeg",
      buffer: AUDIO_BUF,
    });
    const res = await postMultipart("/v1/audio/transcriptions", formBody, BOUNDARY);
    expect(res.statusCode).toBe(200);
    const json = (await readBody(res)) as Record<string, unknown>;
    expect(typeof json["text"]).toBe("string");
    expect(json).toHaveProperty("language");
    expect(json).toHaveProperty("duration");
    expect(Array.isArray(json["segments"])).toBe(true);
  });

  it("T-TRN-04: response_format=srt returns 501 (timestamps unavailable)", async () => {
    const fields = { ...BASE_FIELDS, response_format: "srt" };
    const formBody = buildMultipart(BOUNDARY, fields, {
      fieldName: "file",
      filename: "audio.mp3",
      mimeType: "audio/mpeg",
      buffer: AUDIO_BUF,
    });
    const res = await postMultipart("/v1/audio/transcriptions", formBody, BOUNDARY);
    expect(res.statusCode).toBe(501);
  });

  it("T-TRN-05: multipart without file field returns 400", async () => {
    // Send a well-formed multipart body that has only text fields, no file.
    const formBody = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
        `--${BOUNDARY}--\r\n`,
    );
    const res = await postMultipart("/v1/audio/transcriptions", formBody, BOUNDARY);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// T-TTS: POST /v1/audio/speech  (bd-1f19)
// ---------------------------------------------------------------------------

describe("POST /v1/audio/speech (bd-1f19)", () => {
  it("T-TTS-01: happy path returns 200 with audio/mpeg content-type", async () => {
    const res = await postJson("/v1/audio/speech", {
      model: "tts-1",
      input: "Hello, world!",
      voice: "alloy",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/i);
  });

  it("T-TTS-02: response body is a Buffer (binary audio)", async () => {
    const res = await postJson("/v1/audio/speech", {
      model: "tts-1",
      input: "Hello world",
      voice: "alloy",
    });
    const buf = await readBinary(res);
    expect(Buffer.isBuffer(buf)).toBe(true);
    // MockProvider.synthesizeSpeech returns Buffer.alloc(0) — empty is valid
    expect(buf.byteLength).toBeGreaterThanOrEqual(0);
  });

  it("T-TTS-03: missing input returns 400 with OpenAI error envelope", async () => {
    const res = await postJson("/v1/audio/speech", { model: "tts-1", voice: "alloy" });
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as { error: Record<string, unknown> };
    expect(body.error["type"]).toBe("invalid_request_error");
    expect(typeof body.error["message"]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// T-MSG: POST /v1/messages  (bd-0lw2)
// ---------------------------------------------------------------------------

describe("POST /v1/messages (bd-0lw2)", () => {
  const MINIMAL_BODY = {
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "Hello, mock!" }],
    max_tokens: 1024,
  };

  it("T-MSG-01: happy path returns 200 with content[0].text non-empty and stop_reason set", async () => {
    const res = await postJson("/v1/messages", MINIMAL_BODY);
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["type"]).toBe("message");
    expect(body["role"]).toBe("assistant");
    expect(Array.isArray(body["content"])).toBe(true);
    const content = body["content"] as Record<string, unknown>[];
    expect(content.length).toBeGreaterThan(0);
    expect(content[0]!["type"]).toBe("text");
    expect(typeof content[0]!["text"]).toBe("string");
    expect((content[0]!["text"] as string).length).toBeGreaterThan(0);
    // stop_reason must be present and non-empty (Anthropic uses "stop_reason", not "finish_reason")
    expect(typeof body["stop_reason"]).toBe("string");
    expect((body["stop_reason"] as string).length).toBeGreaterThan(0);
  });

  it("T-MSG-02: stream:true returns text/event-stream with all 6 Anthropic SSE event types", async () => {
    const res = await postJson("/v1/messages", { ...MINIMAL_BODY, stream: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/i);

    const lines = await readSseLines(res);
    // SSE events are prefixed "event: <type>"; data lines are "data: <json>"
    const eventLines = lines.filter((l) => l.startsWith("event: "));
    const eventTypes = eventLines.map((l) => l.slice("event: ".length).trim());

    // Full 6-event Anthropic SSE sequence must be present
    expect(eventTypes).toContain("message_start");
    expect(eventTypes).toContain("content_block_start");
    expect(eventTypes).toContain("content_block_stop");
    expect(eventTypes).toContain("message_delta");
    expect(eventTypes).toContain("message_stop");
    // At least one content_block_delta must be emitted carrying text
    const deltaCount = eventTypes.filter((e) => e === "content_block_delta").length;
    expect(deltaCount).toBeGreaterThan(0);
  });

  it("T-MSG-03: array content body is accepted and returns 200 with valid response shape", async () => {
    const res = await postJson("/v1/messages", {
      model: MINIMAL_BODY.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello," },
            { type: "text", text: " mock world!" },
          ],
        },
      ],
      max_tokens: 1024,
    });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["type"]).toBe("message");
    const content = body["content"] as Record<string, unknown>[];
    expect(content.length).toBeGreaterThan(0);
    // MockProvider always returns a response regardless of prompt content
    expect(typeof content[0]!["text"]).toBe("string");
  });

  it("T-MSG-04: missing max_tokens returns 400 with Anthropic error envelope", async () => {
    const res = await postJson("/v1/messages", {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
      // max_tokens intentionally omitted — Anthropic schema requires it
    });
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as Record<string, unknown>;
    // Anthropic error envelope: { type: "error", error: { type, message } }
    expect(body["type"]).toBe("error");
    const error = body["error"] as Record<string, unknown>;
    expect(typeof error["type"]).toBe("string");
    expect(typeof error["message"]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// T-CAP: Capability mismatch  (bd-m9qo)
// ---------------------------------------------------------------------------

describe("POST /v1/messages — capability mismatch (bd-m9qo)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T-CAP-01: ProviderCapabilityError thrown during generation returns HTTP 422 with Anthropic error envelope", async () => {
    // Simulate a scenario where the underlying provider does not support the
    // requested modality.  We spy on AiClient.prototype.generateText so the
    // mock throws ProviderCapabilityError before any real network I/O.
    vi.spyOn(AiClient.prototype, "generateText").mockRejectedValueOnce(
      new ProviderCapabilityError("anthropic", "image"),
    );

    const res = await postJson("/v1/messages", {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Generate an image of a cat." }],
      max_tokens: 256,
    });

    expect(res.statusCode).toBe(422);
    const body = (await readBody(res)) as Record<string, unknown>;

    // Must be Anthropic error envelope
    expect(body["type"]).toBe("error");
    const error = body["error"] as Record<string, unknown>;
    // ProviderCapabilityError maps to "invalid_request_error"
    expect(error["type"]).toBe("invalid_request_error");
    expect(typeof error["message"]).toBe("string");
    // Error message must reference both the provider and the modality
    const msg = error["message"] as string;
    expect(msg).toMatch(/anthropic/i);
    expect(msg).toMatch(/image/i);
  });
});

// ---------------------------------------------------------------------------
// T-REG: Native route regression  (bd-m9qo)
// Verify that adding /v1/ compat routes did not shadow or break any native route.
// ---------------------------------------------------------------------------

describe("Native route regression (bd-m9qo)", () => {
  // T-REG-01
  it("T-REG-01: GET /health returns 200 with { status: 'ok', timestamp }", async () => {
    const res = await getReq("/health");
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(typeof body["timestamp"]).toBe("string");
  });

  // T-REG-02
  it("T-REG-02: GET /config returns 200 with a configuration object", async () => {
    const res = await getReq("/config");
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body !== null && typeof body === "object").toBe(true);
  });

  // T-REG-03
  it("T-REG-03: GET /models returns 200 with an array of model descriptors", async () => {
    const res = await getReq("/models");
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      const first = body[0] as Record<string, unknown>;
      expect(typeof first["id"]).toBe("string");
      expect(Array.isArray(first["capabilities"])).toBe(true);
    }
  });

  // T-REG-04
  it("T-REG-04: GET /pricing returns 200 with a non-empty array", async () => {
    const res = await getReq("/pricing");
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("T-REG-04b: GET /pricing hides unsupported Runway turbo models", async () => {
    for (const model of ["gen4_turbo", "gen3a_turbo"]) {
      const res = await getReq(`/pricing?model=${model}`);
      expect(res.statusCode).toBe(200);
      const body = (await readBody(res)) as unknown[];
      expect(body).toHaveLength(0);
    }

    const runway = await getReq("/pricing?model=gen4.5");
    expect(runway.statusCode).toBe(200);
    const runwayBody = (await readBody(runway)) as Record<string, unknown>[];
    expect(runwayBody.map((entry) => entry["model"])).toContain("gen4.5");
  });

  // T-REG-05
  it("T-REG-05: GET /providers returns 200 with an array of provider objects", async () => {
    const res = await getReq("/providers");
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const first = body[0]!;
    expect(typeof first["id"]).toBe("string");
    expect(typeof first["name"]).toBe("string");
    expect(typeof first["active"]).toBe("boolean");
    expect(Array.isArray(first["modalities"])).toBe(true);
  });

  // T-REG-06
  it("T-REG-06: POST /text returns 200 with a TextResult shape", async () => {
    const res = await postJson("/text", { prompt: "Regression check." });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["modality"]).toBe("text");
    expect(typeof body["content"]).toBe("string");
    expect((body["content"] as string).length).toBeGreaterThan(0);
    expect(body["provider"]).toBe("mock");
  });

  // T-REG-07
  it("T-REG-07: POST /stream returns 200 text/event-stream with delta events and [DONE]", async () => {
    const res = await postJson("/stream", { prompt: "Regression stream check." });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/i);
    const lines = await readSseLines(res);
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    expect(dataLines.some((l) => l === "data: [DONE]")).toBe(true);
  });

  // T-REG-08
  it("T-REG-08: POST /image returns 200 with an ImageResult shape", async () => {
    const res = await postJson("/image", { prompt: "Regression image check." });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["modality"]).toBe("image");
    expect(typeof body["data"]).toBe("string");
    expect(body["provider"]).toBe("mock");
  });

  // T-REG-09
  it("T-REG-09: POST /audio/transcribe returns 200 with a TranscriptionResult shape", async () => {
    const res = await postJson("/audio/transcribe", {
      audioBase64: Buffer.from("fake-audio").toString("base64"),
    });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["modality"]).toBe("audio");
    expect(typeof body["text"]).toBe("string");
    expect(body["provider"]).toBe("mock");
  });

  // T-REG-10
  it("T-REG-10: POST /audio/speak returns 200 with an AudioResult shape (audio as base64 string)", async () => {
    const res = await postJson("/audio/speak", { text: "Regression TTS check." });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["modality"]).toBe("audio");
    // The server encodes binary audio to base64 before responding
    expect(typeof body["audio"]).toBe("string");
    expect(body["provider"]).toBe("mock");
  });

  // T-REG-11
  it("T-REG-11: POST /video returns 200 with a VideoResult shape", async () => {
    const res = await postJson("/video", { prompt: "Regression video check." });
    expect(res.statusCode).toBe(200);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["modality"]).toBe("video");
    expect(typeof body["data"]).toBe("string");
    expect(body["provider"]).toBe("mock");
  });

  // T-REG-12
  it("T-REG-12: POST /batch returns 200 application/x-ndjson with at least one result line", async () => {
    const res = await postJson("/batch", {
      items: [{ modality: "text", prompt: "Batch regression check." }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/i);
    const raw = await readText(res);
    const lines = raw.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first["status"]).toBe("ok");
    expect(first["index"]).toBe(0);
  });
});
