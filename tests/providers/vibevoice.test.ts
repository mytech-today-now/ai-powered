/**
 * @file tests/providers/vibevoice.test.ts
 *
 * Unit tests for VibevoiceProvider.
 * All tests use vi.stubGlobal("fetch", ...) to avoid hitting a real server.
 *
 * Tests:
 *   V1  – listModels() returns all 3 audio models
 *   V2  – listModels("audio") returns same 3 models
 *   V3  – listModels("text") returns empty array
 *   V4  – transcribeAudio() calls POST /transcribe with base64 payload
 *   V5  – transcribeAudio() returns correct TranscriptionResult shape
 *   V6  – transcribeAudio() throws on non-OK HTTP response
 *   V7  – transcribeAudio() throws when server returns { error }
 *   V8  – synthesizeSpeech() calls POST /synthesize with text+model payload
 *   V9  – synthesizeSpeech() returns AudioResult with WAV mime type
 *   V10 – generateText() throws "does not support text generation"
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { VibevoiceProvider } from "../../src/ai-powered/providers/vibevoice.js";
import type { AiConfig } from "../../src/ai-powered/core.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<AiConfig> = {}): VibevoiceProvider {
  return new VibevoiceProvider({
    provider: "vibevoice",
    model: "vibevoice-asr-7b",
    ...overrides,
  } as AiConfig);
}

function makeTranscribeFetch(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ text }),
  });
}

function makeSynthesisFetch(audioBytes: Uint8Array) {
  return vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => audioBytes.buffer,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// V1 – listModels() – no filter
// ---------------------------------------------------------------------------
describe("V1 – listModels() returns all 3 models", () => {
  it("lists vibevoice-asr-7b, realtime-0.5b, tts-1.5b", async () => {
    const provider = makeProvider();
    const models = await provider.listModels();
    expect(models).toHaveLength(3);
    expect(models.map((m) => m.id)).toEqual(
      expect.arrayContaining(["vibevoice-asr-7b", "vibevoice-realtime-0.5b", "vibevoice-tts-1.5b"]),
    );
  });
});

// ---------------------------------------------------------------------------
// V2 – listModels("audio") – all models have audio capability
// ---------------------------------------------------------------------------
describe("V2 – listModels('audio') returns all 3 models", () => {
  it("all 3 models are returned for audio modality", async () => {
    const provider = makeProvider();
    const models = await provider.listModels("audio");
    expect(models).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// V3 – listModels("text") – none have text capability
// ---------------------------------------------------------------------------
describe("V3 – listModels('text') returns empty array", () => {
  it("returns [] for text modality", async () => {
    const provider = makeProvider();
    const models = await provider.listModels("text");
    expect(models).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// V4 – transcribeAudio() calls POST /transcribe with base64 payload
// ---------------------------------------------------------------------------
describe("V4 – transcribeAudio() sends correct fetch payload", () => {
  it("calls POST /transcribe with audio_base64 and model", async () => {
    const fakeFetch = makeTranscribeFetch("hello world");
    vi.stubGlobal("fetch", fakeFetch);

    const provider = makeProvider({ baseUrl: "http://localhost:8080" } as AiConfig);
    await provider.transcribeAudio(Buffer.from("audio-bytes"));

    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, opts] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/transcribe");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.audio_base64).toBe(Buffer.from("audio-bytes").toString("base64"));
    expect(body.model).toBe("vibevoice-asr-7b");
  });
});

// ---------------------------------------------------------------------------
// V5 – transcribeAudio() returns correct shape
// ---------------------------------------------------------------------------
describe("V5 – transcribeAudio() returns correct TranscriptionResult shape", () => {
  it("result has provider=vibevoice, modality=audio, text field", async () => {
    vi.stubGlobal("fetch", makeTranscribeFetch("test text"));

    const provider = makeProvider({ baseUrl: "http://localhost:8080" } as AiConfig);
    const result = await provider.transcribeAudio(Buffer.from("x"));

    expect(result.provider).toBe("vibevoice");
    expect(result.modality).toBe("audio");
    expect(result.text).toBe("test text");
    expect(typeof result.latencyMs).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// V6 – transcribeAudio() throws on non-OK HTTP response
// ---------------------------------------------------------------------------
describe("V6 – transcribeAudio() throws on non-OK status", () => {
  it("throws when server returns 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    const provider = makeProvider({ baseUrl: "http://localhost:8080" } as AiConfig);
    await expect(provider.transcribeAudio(Buffer.from("x"))).rejects.toThrow("503");
  });
});

// ---------------------------------------------------------------------------
// V7 – transcribeAudio() throws when server body contains { error }
// ---------------------------------------------------------------------------
describe("V7 – transcribeAudio() throws on server-side error field", () => {
  it("throws when server returns { error: 'ASR failure' }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: "ASR failure" }),
      }),
    );
    const provider = makeProvider({ baseUrl: "http://localhost:8080" } as AiConfig);
    await expect(provider.transcribeAudio(Buffer.from("x"))).rejects.toThrow("ASR failure");
  });
});

// ---------------------------------------------------------------------------
// V8 – synthesizeSpeech() sends correct fetch payload
// ---------------------------------------------------------------------------
describe("V8 – synthesizeSpeech() sends correct fetch payload", () => {
  it("calls POST /synthesize with text and model", async () => {
    const audioBytes = new Uint8Array([82, 73, 70, 70]);
    const fakeFetch = makeSynthesisFetch(audioBytes);
    vi.stubGlobal("fetch", fakeFetch);

    const ttsProvider = makeProvider({
      model: "vibevoice-tts-1.5b",
      baseUrl: "http://localhost:8080",
    } as AiConfig);
    await ttsProvider.synthesizeSpeech("hello");

    const [url, opts] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/synthesize");
    const body = JSON.parse(opts.body as string);
    expect(body.text).toBe("hello");
    expect(body.model).toBe("vibevoice-tts-1.5b");
  });
});

// ---------------------------------------------------------------------------
// V9 – synthesizeSpeech() returns AudioResult with WAV mime type
// ---------------------------------------------------------------------------
describe("V9 – synthesizeSpeech() returns AudioResult with WAV mimeType", () => {
  it("result has mimeType audio/wav and audio Buffer", async () => {
    const audioBytes = new Uint8Array([82, 73, 70, 70]);
    vi.stubGlobal("fetch", makeSynthesisFetch(audioBytes));

    const provider = makeProvider({
      model: "vibevoice-tts-1.5b",
      baseUrl: "http://localhost:8080",
    } as AiConfig);
    const result = await provider.synthesizeSpeech("hello");

    expect(result.mimeType).toBe("audio/wav");
    expect(Buffer.isBuffer(result.audio)).toBe(true);
    expect(result.provider).toBe("vibevoice");
    expect(result.modality).toBe("audio");
  });
});

// ---------------------------------------------------------------------------
// V10 – generateText() throws unsupported error
// ---------------------------------------------------------------------------
describe("V10 – generateText() throws 'does not support text generation'", () => {
  it("throws an error mentioning text generation", () => {
    const provider = makeProvider();
    expect(() => provider.generateText("hi")).toThrow("does not support text generation");
  });
});
