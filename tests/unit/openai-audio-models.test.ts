/**
 * @file tests/unit/openai-audio-models.test.ts
 *
 * Regression tests for OpenAiProvider audio model resolution.
 *
 * Covers:
 *   A1 – transcribeAudio() forwards a selected transcription model to the SDK
 *   A2 – transcribeAudio() falls back to whisper-1 when no valid model is supplied
 *   A3 – transcribeAudio() falls back to whisper-1 when an unsupported model is supplied
 *   A4 – synthesizeSpeech() forwards a selected TTS model to the SDK
 *   A5 – synthesizeSpeech() falls back to tts-1 when no valid model is supplied
 *   A6 – synthesizeSpeech() falls back to tts-1 when an unsupported model is supplied
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import type { AiConfig } from "../../src/ai-powered/core.js";
import { OpenAiProvider } from "../../src/ai-powered/providers/openai.js";

const { mockTranscribeCreate, mockSpeechCreate, mockToFile } = vi.hoisted(() => ({
  mockTranscribeCreate: vi.fn().mockResolvedValue({
    text: "[mock transcription]",
    language: "en",
    duration: 1.5,
  }),
  mockSpeechCreate: vi.fn().mockResolvedValue({
    arrayBuffer: async () => new Uint8Array([82, 73, 70, 70]).buffer,
  }),
  mockToFile: vi
    .fn()
    .mockImplementation(async (_buf: unknown, name: string, opts?: { type?: string }) => ({
      name,
      type: opts?.type ?? "audio/webm",
    })),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor() {}

    audio = {
      transcriptions: { create: mockTranscribeCreate },
      speech: { create: mockSpeechCreate },
    };
  },
  toFile: mockToFile,
}));

const AUDIO_BUF = Buffer.from("fake-audio-bytes");

function makeConfig(model?: string): AiConfig {
  return AiConfigSchema.parse({
    provider: "openai",
    apiKey: "sk-test-unit",
    ...(model ? { model } : {}),
  });
}

function getSdkCallArgs(spy: { mock: { calls: Array<unknown[]> } }): Record<string, unknown> {
  const call = spy.mock.calls[0];
  if (!call) {
    throw new Error("Expected the SDK to be called once");
  }
  return call[0] as Record<string, unknown>;
}

describe("OpenAiProvider audio model resolution", () => {
  beforeEach(() => {
    mockTranscribeCreate.mockClear();
    mockSpeechCreate.mockClear();
    mockToFile.mockClear();
  });

  it("passes the configured transcription model through to the SDK", async () => {
    const provider = new OpenAiProvider(makeConfig("whisper-1"));

    const result = await provider.transcribeAudio(AUDIO_BUF, { mimeType: "audio/mpeg" });

    expect(getSdkCallArgs(mockTranscribeCreate).model).toBe("whisper-1");
    expect(result.model).toBe("whisper-1");
  });

  it("falls back to whisper-1 when no transcription model is supplied", async () => {
    const provider = new OpenAiProvider(makeConfig());

    const result = await provider.transcribeAudio(AUDIO_BUF, { mimeType: "audio/mpeg" });

    expect(getSdkCallArgs(mockTranscribeCreate).model).toBe("whisper-1");
    expect(result.model).toBe("whisper-1");
  });

  it("falls back to whisper-1 when an unsupported transcription model is supplied", async () => {
    const provider = new OpenAiProvider(makeConfig("tts-1-hd"));

    const result = await provider.transcribeAudio(AUDIO_BUF, { mimeType: "audio/mpeg" });

    expect(getSdkCallArgs(mockTranscribeCreate).model).toBe("whisper-1");
    expect(result.model).toBe("whisper-1");
  });

  it("passes the configured TTS model through to the SDK", async () => {
    const provider = new OpenAiProvider(makeConfig("tts-1-hd"));

    const result = await provider.synthesizeSpeech("hello");

    expect(getSdkCallArgs(mockSpeechCreate).model).toBe("tts-1-hd");
    expect(result.model).toBe("tts-1-hd");
  });

  it("falls back to tts-1 when no TTS model is supplied", async () => {
    const provider = new OpenAiProvider(makeConfig());

    const result = await provider.synthesizeSpeech("hello");

    expect(getSdkCallArgs(mockSpeechCreate).model).toBe("tts-1");
    expect(result.model).toBe("tts-1");
  });

  it("falls back to tts-1 when an unsupported TTS model is supplied", async () => {
    const provider = new OpenAiProvider(makeConfig("whisper-1"));

    const result = await provider.synthesizeSpeech("hello");

    expect(getSdkCallArgs(mockSpeechCreate).model).toBe("tts-1");
    expect(result.model).toBe("tts-1");
  });
});
