/**
 * @file tests/unit/transcribe-mime.test.ts
 *
 * Unit tests for the MIME-type-to-filename extension derivation in
 * OpenAiProvider.transcribeAudio() — bd-0fw1 / T-VT-01..T-VT-05.
 *
 * The `openai` module is fully mocked via vi.hoisted + vi.mock so that:
 *   - `toFile` is replaced with a spy that records call arguments.
 *   - The OpenAI client constructor never touches the network.
 *   - No real API key is required.
 *
 * Logic under test (src/ai-powered/providers/openai.ts):
 *   const mimeType = options?.mimeType || "audio/webm";
 *   const ext = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
 *   const file = await toFile(buffer, `media.${ext}`, { type: mimeType });
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { OpenAiProvider } from "../../src/ai-powered/providers/openai.js";

// ---------------------------------------------------------------------------
// Spy refs hoisted so they are accessible inside the vi.mock() factory.
// vi.hoisted() runs before any imports are evaluated — this is the correct
// vitest pattern for module-level mocks that need external spy references.
// ---------------------------------------------------------------------------

const { mockCreate, mockToFile } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({
    text: "[mock transcription]",
    language: "en",
    duration: 1.5,
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
    audio = { transcriptions: { create: mockCreate } };
  },
  toFile: mockToFile,
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A real config with a dummy API key — the key is never sent (client is mocked). */
const FAKE_CONFIG = AiConfigSchema.parse({ provider: "openai", apiKey: "sk-test-unit" });
const BUF = Buffer.from("fake-media-bytes");

// ---------------------------------------------------------------------------
// T-VT-01..T-VT-05 — MIME-type-to-filename derivation
// ---------------------------------------------------------------------------

describe("OpenAiProvider.transcribeAudio — MIME-type derivation (bd-0fw1)", () => {
  beforeEach(() => {
    mockToFile.mockClear();
    mockCreate.mockClear();
  });

  it("T-VT-01: mimeType='video/mp4' → toFile called with filename 'media.mp4' and type 'video/mp4'", async () => {
    const provider = new OpenAiProvider(FAKE_CONFIG);
    await provider.transcribeAudio(BUF, { mimeType: "video/mp4" });
    expect(mockToFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "media.mp4",
      expect.objectContaining({ type: "video/mp4" }),
    );
  });

  it("T-VT-02: mimeType='video/x-matroska' → toFile called with filename 'media.x-matroska'", async () => {
    const provider = new OpenAiProvider(FAKE_CONFIG);
    await provider.transcribeAudio(BUF, { mimeType: "video/x-matroska" });
    expect(mockToFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "media.x-matroska",
      expect.objectContaining({ type: "video/x-matroska" }),
    );
  });

  it("T-VT-03: no options → toFile called with 'media.webm' and type 'audio/webm' (regression guard)", async () => {
    const provider = new OpenAiProvider(FAKE_CONFIG);
    await provider.transcribeAudio(BUF); // no options — fallback must apply
    expect(mockToFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "media.webm",
      expect.objectContaining({ type: "audio/webm" }),
    );
  });

  it("T-VT-04: mimeType='audio/webm;codecs=opus' → semicolon stripped → filename 'media.webm'", async () => {
    const provider = new OpenAiProvider(FAKE_CONFIG);
    await provider.transcribeAudio(BUF, { mimeType: "audio/webm;codecs=opus" });
    expect(mockToFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "media.webm",
      // Full codec-annotated MIME preserved as the type argument (Whisper accepts it)
      expect.objectContaining({ type: "audio/webm;codecs=opus" }),
    );
  });

  it("T-VT-05: mimeType='' (empty string) → falsy → fallback to 'audio/webm'", async () => {
    const provider = new OpenAiProvider(FAKE_CONFIG);
    await provider.transcribeAudio(BUF, { mimeType: "" }); // empty string is falsy
    expect(mockToFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "media.webm",
      expect.objectContaining({ type: "audio/webm" }),
    );
  });
});
