/**
 * @file tests/unit/selective-models-live.test.ts
 *
 * Regression coverage for the selective-models / accepts=image behavior.
 *
 * Verifies:
 *   - Venice live model lists preserve image-capable models via inputCapabilities.
 *   - Custom provider live lists that do not expose image capability remain empty
 *     when accepts=image is requested.
 *   - Both custom-provider discovery paths still populate normally without accepts=image.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { VeniceProvider } from "../../src/ai-powered/providers/venice.js";
import { CustomProvider } from "../../src/ai-powered/providers/custom.js";

const mockOpenAiModelsList = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  class MockOpenAI {
    models = {
      list: mockOpenAiModelsList,
    };

    constructor(_opts: unknown) {}
  }

  return { default: MockOpenAI };
});

function jsonResponse(body: unknown): { ok: boolean; status: number; json(): Promise<unknown> } {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

describe("Venice live model lists", () => {
  beforeEach(() => {
    mockOpenAiModelsList.mockReset();
    vi.unstubAllGlobals();
  });

  it("keeps image-capable live models selectable when accepts=image is requested", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({
        data: [
          { id: "qwen-2.5-vl", type: "image" },
          { id: "llama-3.3-70b", type: "text" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new VeniceProvider(
      AiConfigSchema.parse({ provider: "venice", apiKey: "ven-test-key" }),
    );

    const allModels = await provider.listModels();
    expect(allModels.map((m) => m.id)).toEqual(["qwen-2.5-vl", "llama-3.3-70b"]);
    expect(allModels.find((m) => m.id === "qwen-2.5-vl")?.inputCapabilities).toEqual(["image"]);

    const imageModels = await provider.listModels(undefined, "image" as never);
    expect(imageModels.map((m) => m.id)).toEqual(["qwen-2.5-vl"]);
    expect(imageModels[0]?.inputCapabilities).toEqual(["image"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.venice.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer ven-test-key" },
      }),
    );
  });
});

describe("Custom provider live model lists", () => {
  beforeEach(() => {
    mockOpenAiModelsList.mockReset();
    vi.unstubAllGlobals();
  });

  it("keeps openai-compatible discovery working without image capability metadata", async () => {
    mockOpenAiModelsList.mockResolvedValue({
      data: [
        { id: "llava-1", object: "model" },
        { id: "mistral-7b", object: "model" },
      ],
    });

    const provider = new CustomProvider(
      AiConfigSchema.parse({
        provider: "custom",
        baseUrl: "https://example.com/v1",
        apiKey: "custom-test-key",
      }),
    );

    const allModels = await provider.listModels();
    expect(allModels.map((m) => m.id)).toEqual(["llava-1", "mistral-7b"]);

    const imageModels = await provider.listModels(undefined, "image" as never);
    expect(imageModels).toHaveLength(0);
  });

  it("keeps ollama discovery working without image capability metadata", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({
        models: [{ name: "llava" }, { name: "mistral" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CustomProvider(
      AiConfigSchema.parse({
        provider: "custom",
        customProviderType: "ollama",
      }),
    );

    const allModels = await provider.listModels();
    expect(allModels.map((m) => m.id)).toEqual(["llava", "mistral"]);

    const imageModels = await provider.listModels(undefined, "image" as never);
    expect(imageModels).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ headers: {} }),
    );
  });
});
