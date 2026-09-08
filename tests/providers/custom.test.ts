/**
 * @file tests/providers/custom.test.ts
 *
 * Unit tests for CustomProvider baseUrl handling and model discovery.
 * Covers Ollama normalization plus the non-Ollama baseline paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { CustomProvider } from "../../src/ai-powered/providers/custom.js";
import { ProviderError } from "../../src/ai-powered/types.js";
import * as utils from "../../src/ai-powered/utils.js";
import type { AiConfig } from "../../src/ai-powered/core.js";

const mockOpenAiCtor = vi.hoisted(() => vi.fn());
const mockModelsList = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
      super(message);
      this.name = "APIError";
      this.status = status;
    }
  }

  class MockOpenAI {
    models = {
      list: mockModelsList,
    };

    chat = {
      completions: {
        create: vi.fn(),
      },
    };

    constructor(opts: unknown) {
      mockOpenAiCtor(opts);
    }
  }

  (MockOpenAI as unknown as Record<string, unknown>)["APIError"] = APIError;

  return { default: MockOpenAI };
});

const mockLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
};

function makeConfig(overrides: Partial<AiConfig>): AiConfig {
  return AiConfigSchema.parse({
    provider: "custom",
    ...overrides,
  });
}

beforeEach(() => {
  mockOpenAiCtor.mockReset();
  mockModelsList.mockReset();
  mockLogger.debug.mockClear();
  mockLogger.warn.mockClear();
  vi.spyOn(utils, "getLogger").mockReturnValue(mockLogger as ReturnType<typeof utils.getLogger>);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CustomProvider Ollama baseUrl normalization", () => {
  it.each([
    ["http://localhost:11434", "http://localhost:11434/v1"],
    ["http://localhost:11434/v1", "http://localhost:11434/v1"],
    ["http://localhost:11434/v1/", "http://localhost:11434/v1"],
  ])("normalizes %s to %s", (input, expected) => {
    new CustomProvider(
      makeConfig({
        customProviderType: "ollama",
        baseUrl: input,
      }),
    );

    expect(mockOpenAiCtor).toHaveBeenCalledOnce();
    const ctorOpts = mockOpenAiCtor.mock.calls[0]![0] as { baseURL?: string };
    expect(ctorOpts.baseURL).toBe(expected);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe("CustomProvider non-Ollama baseUrl handling", () => {
  it("leaves openai-compatible custom baseUrl unchanged", () => {
    const baseUrl = "https://example.com/custom-api";

    new CustomProvider(
      makeConfig({
        baseUrl,
        apiKey: "custom-key",
      }),
    );

    expect(mockOpenAiCtor).toHaveBeenCalledOnce();
    const ctorOpts = mockOpenAiCtor.mock.calls[0]![0] as { baseURL?: string };
    expect(ctorOpts.baseURL).toBe(baseUrl);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("requires baseUrl for customProviderType=other and uses it verbatim", async () => {
    expect(
      () =>
        new CustomProvider(
          makeConfig({
            customProviderType: "other",
            model: "echo-model",
          }),
        ),
    ).toThrow("config.baseUrl is required for customProviderType 'other'.");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const baseUrl = "https://example.com/echo";
    const provider = new CustomProvider(
      makeConfig({
        customProviderType: "other",
        baseUrl,
        model: "echo-model",
      }),
    );

    const result = await provider.generateText("hello world");
    expect(result.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      baseUrl,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "echo-model",
          prompt: "hello world",
        }),
      }),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe("CustomProvider model discovery", () => {
  it("returns openai-compatible models unchanged on success", async () => {
    mockModelsList.mockResolvedValueOnce({
      data: [
        { id: "llava-1", object: "model" },
        { id: "mistral-7b", object: "model" },
      ],
    });

    const provider = new CustomProvider(
      makeConfig({
        baseUrl: "https://example.com/v1",
        apiKey: "custom-key",
      }),
    );

    const models = await provider.listModels();

    expect(models).toEqual([
      { id: "llava-1", name: "llava-1", capabilities: ["text", "structured"] },
      { id: "mistral-7b", name: "mistral-7b", capabilities: ["text", "structured"] },
    ]);
    expect(mockModelsList).toHaveBeenCalledOnce();
  });

  it("returns an empty array when openai-compatible discovery returns no models", async () => {
    mockModelsList.mockResolvedValueOnce({ data: [] });

    const provider = new CustomProvider(
      makeConfig({
        baseUrl: "https://example.com/v1",
        apiKey: "custom-key",
        model: "stub-model",
      }),
    );

    const models = await provider.listModels();

    expect(models).toEqual([]);
    expect(mockModelsList).toHaveBeenCalledOnce();
  });

  it("throws a structured error when openai-compatible discovery fails", async () => {
    const discoveryError = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockModelsList.mockRejectedValueOnce(discoveryError);

    const provider = new CustomProvider(
      makeConfig({
        baseUrl: "https://example.com/v1",
        apiKey: "custom-key",
      }),
    );

    const discovery = provider.listModels();

    await expect(discovery).rejects.toMatchObject({
      name: "ProviderError",
      provider: "custom",
      statusCode: 401,
      retryable: false,
    });
    await expect(discovery).rejects.toThrow(
      "OpenAI-compatible model discovery failed: Unauthorized",
    );
  });

  it("returns Ollama models unchanged on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        models: [{ name: "llava" }, { name: "mistral" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CustomProvider(
      makeConfig({
        customProviderType: "ollama",
      }),
    );

    const models = await provider.listModels();

    expect(models).toEqual([
      { id: "llava", name: "llava", capabilities: ["text", "structured"] },
      { id: "mistral", name: "mistral", capabilities: ["text", "structured"] },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("returns an empty array when Ollama discovery returns no models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CustomProvider(
      makeConfig({
        customProviderType: "ollama",
        model: "stub-model",
      }),
    );

    const models = await provider.listModels();

    expect(models).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws a structured error when Ollama discovery returns a non-OK response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "service unavailable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CustomProvider(
      makeConfig({
        customProviderType: "ollama",
      }),
    );

    const discovery = provider.listModels();

    await expect(discovery).rejects.toBeInstanceOf(ProviderError);
    await expect(discovery).rejects.toMatchObject({
      name: "ProviderError",
      provider: "custom",
      statusCode: 503,
      retryable: true,
    });
    await expect(discovery).rejects.toThrow("Ollama model discovery failed: HTTP 503");
  });

  it("throws a structured error when Ollama discovery fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CustomProvider(
      makeConfig({
        customProviderType: "ollama",
      }),
    );

    const discovery = provider.listModels();

    await expect(discovery).rejects.toMatchObject({
      name: "ProviderError",
      provider: "custom",
      retryable: true,
    });
    await expect(discovery).rejects.toThrow("Ollama model discovery failed: ECONNRESET");
  });
});
