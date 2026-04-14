/**
 * @file tests/integration/transcribe-video.test.ts
 *
 * Integration tests for MIME-type forwarding through transcription routes —
 * bd-0fw1 / T-VT-06..T-VT-09.
 *
 * Routes under test:
 *   POST /audio/transcribe          native proxy route (JSON body, base64 audio)
 *   POST /v1/audio/transcriptions   OpenAI-compat route (multipart/form-data)
 *
 * All tests run in mock mode (no API keys, no network calls).
 * Spies on MockProvider.prototype.transcribeAudio verify mimeType forwarding.
 */

import * as http from "node:http";
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import { createServer } from "../../src/ai-powered/server/index.js";

// ---------------------------------------------------------------------------
// Shared mock server
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

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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
          "Content-Length": body.length,
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// T-VT-06..T-VT-07 — POST /audio/transcribe (native route)
// ---------------------------------------------------------------------------

const VIDEO_B64 = Buffer.from("fake-video-bytes").toString("base64");
const AUDIO_B64 = Buffer.from("fake-audio-bytes").toString("base64");
const BOUNDARY = "----TranscribeVideoBoundary";

describe("POST /audio/transcribe — MIME forwarding (bd-0fw1)", () => {
  it("T-VT-06: mimeType='video/mp4' → 200 and mimeType forwarded to transcribeAudio", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "transcribeAudio");
    const res = await postJson("/audio/transcribe", {
      audioBase64: VIDEO_B64,
      mimeType: "video/mp4",
    });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ mimeType: "video/mp4" }),
    );
    await readBody(res);
  });

  it("T-VT-07: no mimeType → 200 backward compat (transcribeAudio called without mimeType key)", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "transcribeAudio");
    const res = await postJson("/audio/transcribe", { audioBase64: AUDIO_B64 });
    expect(res.statusCode).toBe(200);
    // Route omits mimeType from options when not provided — spy sees an empty options object.
    expect(spy).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.not.objectContaining({ mimeType: expect.anything() }),
    );
    await readBody(res);
  });
});

// ---------------------------------------------------------------------------
// T-VT-08..T-VT-09 — POST /v1/audio/transcriptions (OpenAI-compat route)
// ---------------------------------------------------------------------------

describe("POST /v1/audio/transcriptions — MIME forwarding (bd-0fw1)", () => {
  it("T-VT-08: multipart MP4 upload → 200 and mimeType='video/mp4' forwarded to transcribeAudio", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "transcribeAudio");
    const formBody = buildMultipart(
      BOUNDARY,
      { model: "whisper-1" },
      {
        fieldName: "file",
        filename: "clip.mp4",
        mimeType: "video/mp4",
        buffer: Buffer.from("fake-mp4"),
      },
    );
    const res = await postMultipart("/v1/audio/transcriptions", formBody, BOUNDARY);
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ mimeType: "video/mp4" }),
    );
    await readBody(res);
  });

  it("T-VT-09: missing file field → 400 with 'No audio or video file provided' in error message", async () => {
    const formBody = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
        `--${BOUNDARY}--\r\n`,
    );
    const res = await postMultipart("/v1/audio/transcriptions", formBody, BOUNDARY);
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain("No audio or video file provided");
  });
});
