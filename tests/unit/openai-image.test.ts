/**
 * @file tests/unit/openai-image.test.ts
 *
 * Regression tests for OpenAiProvider image generation.
 *
 * Covers:
 *   - image model resolution from config and explicit overrides
 *   - size selection for the DALL-E and GPT-Image-1 size lists
 *   - successful URL-to-data-URI conversion
 *   - clear ProviderError on non-2xx image URL fetches
 *   - existing b64_json passthrough
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { OpenAiProvider } from "../../src/ai-powered/providers/openai.js";
import { ProviderError } from "../../src/ai-powered/types.js";

const { mockImagesGenerate, mockImagesEdit, mockToFile } = vi.hoisted(() => ({
  mockImagesGenerate: vi.fn(),
  mockImagesEdit: vi.fn(),
  mockToFile: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    images = {
      generate: mockImagesGenerate,
      edit: mockImagesEdit,
    };

    constructor() {}
  },
  toFile: mockToFile,
}));

function makeConfig(model?: string) {
  return AiConfigSchema.parse({
    provider: "openai",
    apiKey: "sk-test-unit",
    ...(model ? { model } : {}),
  });
}

function makeFetchResponse(opts?: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  bytes?: Uint8Array;
}) {
  const bytes = opts?.bytes ?? Uint8Array.from([1, 2, 3]);
  const arrayBuffer = vi.fn(async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );

  return {
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    statusText: opts?.statusText ?? "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? (opts?.contentType ?? "image/png") : null,
    },
    arrayBuffer,
  };
}

describe("OpenAiProvider.generateImage", () => {
  beforeEach(() => {
    mockImagesGenerate.mockReset();
    mockImagesEdit.mockReset();
    mockToFile.mockReset();
    mockImagesGenerate.mockResolvedValue({ data: [] });
    mockImagesEdit.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the configured GPT-Image-1 model and size list for portrait aspect ratios", async () => {
    mockImagesGenerate.mockResolvedValueOnce({
      data: [{ b64_json: "AQID" }],
    });

    const provider = new OpenAiProvider(makeConfig("gpt-image-1"));
    const result = await provider.generateImage("a neon robot", { aspectRatio: "3:4" });

    expect(mockImagesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-image-1",
        prompt: "a neon robot",
        n: 1,
        size: "1024x1536",
      }),
    );
    expect(result.model).toBe("gpt-image-1");
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1536);
    expect(result.data).toBe("data:image/png;base64,AQID");
  });

  it("honors an explicit image model override and DALL-E size selection for wide images", async () => {
    mockImagesGenerate.mockResolvedValueOnce({
      data: [{ b64_json: "AQID" }],
    });

    const provider = new OpenAiProvider(makeConfig("gpt-4o"));
    const result = await provider.generateImage("wide skyline", {
      model: "dall-e-2",
      width: 1280,
      height: 720,
    });

    expect(mockImagesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "dall-e-2",
        prompt: "wide skyline",
        n: 1,
        size: "1792x1024",
      }),
    );
    expect(result.model).toBe("dall-e-2");
    expect(result.width).toBe(1792);
    expect(result.height).toBe(1024);
  });

  it("converts a successful image URL fetch into a self-contained data URI", async () => {
    mockImagesGenerate.mockResolvedValueOnce({
      data: [{ url: "https://cdn.example.com/image.png" }],
    });

    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse({
        contentType: "image/webp",
        bytes: Uint8Array.from([1, 2, 3]),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiProvider(makeConfig());
    const result = await provider.generateImage("a cat");

    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/image.png");
    expect(result.data).toBe("data:image/webp;base64,AQID");
  });

  it("throws a ProviderError when the image URL fetch returns a non-2xx status", async () => {
    mockImagesGenerate.mockResolvedValueOnce({
      data: [{ url: "https://cdn.example.com/expired.png" }],
    });

    const fetchResponse = makeFetchResponse({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse);
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiProvider(makeConfig());
    const result = provider.generateImage("expired image");

    await expect(result).rejects.toBeInstanceOf(ProviderError);
    await expect(result).rejects.toMatchObject({
      statusCode: 403,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/expired.png");
    expect(fetchResponse.arrayBuffer).not.toHaveBeenCalled();
  });

  it("preserves the b64_json branch without calling fetch", async () => {
    mockImagesGenerate.mockResolvedValueOnce({
      data: [{ b64_json: "AQID" }],
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiProvider(makeConfig());
    const result = await provider.generateImage("encoded image");

    expect(result.data).toBe("data:image/png;base64,AQID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
