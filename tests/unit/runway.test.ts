/**
 * @file tests/unit/runway.test.ts
 *
 * Unit tests for RunwayProvider model listing and generation behavior.
 * The provider currently exposes only gen4.5 publicly; turbo IDs are hidden
 * until a real keyframe-backed image-to-video path exists.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCreate, mockRetrieve } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRetrieve: vi.fn(),
}));

vi.mock("@runwayml/sdk", () => {
  class APIError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "APIError";
      this.status = status;
    }
  }

  class MockRunwayML {
    textToVideo = {
      create: mockCreate,
    };

    tasks = {
      retrieve: mockRetrieve,
    };
  }

  (MockRunwayML as unknown as Record<string, unknown>)["APIError"] = APIError;

  return { default: MockRunwayML };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { RunwayProvider } from "../../src/ai-powered/providers/runway.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const config = AiConfigSchema.parse({ provider: "runway", apiKey: "runway-test-key" });
const VIDEO_BYTES = new Uint8Array(Buffer.from("fake-runway-video"));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RunwayProvider", () => {
  let provider: RunwayProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "task-123" });
    mockRetrieve.mockResolvedValue({
      status: "SUCCEEDED",
      output: ["https://cdn.example.com/runway.mp4"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => VIDEO_BYTES.buffer,
      }),
    );
    provider = new RunwayProvider(config);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listModels exposes only gen4.5", async () => {
    const models = await provider.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("gen4.5");

    const videoModels = await provider.listModels("video");
    expect(videoModels).toHaveLength(1);
    expect(videoModels[0]!.id).toBe("gen4.5");
  });

  it("generateVideo defaults to gen4.5 and keeps the current ratio/duration mapping", async () => {
    const result = await provider.generateVideo("a calm ocean at sunset");

    expect(result.provider).toBe("runway");
    expect(result.model).toBe("gen4.5");
    expect(result.modality).toBe("video");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.data).toMatch(/^data:video\/mp4;base64,/);
    expect(result.cost.totalUsd).toBe(0.6);
    expect(result.cost.isEstimate).toBe(false);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(params["model"]).toBe("gen4.5");
    expect(params["ratio"]).toBe("1280:720");
    expect(params["duration"]).toBe(5);
  });

  it("generateVideo keeps gen4.5 ratio and duration validation intact", async () => {
    await provider.generateVideo("storm clouds over a city", {
      aspectRatio: "9:16",
      duration: 10,
    });

    const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(params["model"]).toBe("gen4.5");
    expect(params["ratio"]).toBe("720:1280");
    expect(params["duration"]).toBe(10);
  });

  it("rejects hidden turbo models with a stable ProviderError before any SDK call", async () => {
    for (const model of ["gen4_turbo", "gen3a_turbo"]) {
      await expect(
        provider.generateVideo("a calm ocean at sunset", {
          model,
        }),
      ).rejects.toMatchObject({
        provider: "runway",
        statusCode: 422,
        retryable: false,
        message: expect.stringContaining('Use "gen4.5"'),
      });
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
