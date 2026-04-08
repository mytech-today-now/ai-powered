/**
 * @file tests/unit/lumaai-frame1.test.ts
 *
 * Unit tests for LumaAIProvider.generateVideoFromImage() two-keyframe support.
 * LM-01 through LM-04 — bd-08tj / TASK-14.
 *
 * Mocks: lumaai SDK, utils (getLogger/calculateCost), LimitsValidator, fetch.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist shared mock functions so they're available inside vi.mock() factories
// ---------------------------------------------------------------------------
const { mockCreate, mockGet, mockWarn } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock("lumaai", () => {
  // Must use a regular function (not arrow) so `new LumaAI(...)` works as a constructor.
  function MockLumaAI(this: Record<string, unknown>) {
    this["generations"] = { create: mockCreate, get: mockGet };
  }
  // LumaAI.APIError is referenced in _wrapError; provide a minimal stub.
  (MockLumaAI as unknown as Record<string, unknown>)["APIError"] = class extends Error {
    status?: number;
  };
  return { default: MockLumaAI };
});

vi.mock("../../src/ai-powered/utils.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockWarn,
    trace: vi.fn(),
  }),
  maskApiKey: (k: string) => `[masked:${k.slice(0, 4)}]`,
  calculateCost: () => ({ totalUsd: 0, inputUsd: 0, outputUsd: 0, promptUsd: 0, completionUsd: 0 }),
  initLogger: vi.fn(),
  createLogger: vi.fn(),
}));

vi.mock("../../src/ai-powered/limits-validator.js", () => ({
  LimitsValidator: { validateVideo: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { LumaAIProvider } from "../../src/ai-powered/providers/lumaai.js";
import { AiConfigSchema } from "../../src/ai-powered/core.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const config = AiConfigSchema.parse({ provider: "lumaai", apiKey: "test-key", model: "ray-2" });

const COMPLETED_GEN = {
  id: "gen-1",
  state: "completed",
  assets: { video: "https://cdn.luma.ai/video.mp4" },
};

const IMG0 = "https://cdn.example.com/frame0.jpg";
const IMG1 = "https://cdn.example.com/frame1.jpg";
const IMG2 = "https://cdn.example.com/frame2.jpg";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LumaAIProvider — two-keyframe support (LM-01..LM-04)", () => {
  let provider: LumaAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "gen-1" });
    mockGet.mockResolvedValue(COMPLETED_GEN);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from("fake-mp4").buffer),
    }) as typeof fetch;
    provider = new LumaAIProvider(config);
  });

  // LM-01 — frame1Url option → keyframes.frame1 set
  it("LM-01: options.frame1Url adds keyframes.frame1 to the Luma API payload", async () => {
    await provider.generateVideoFromImage(IMG0, "motion test", { frame1Url: IMG1 } as never);

    const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    const kf = params["keyframes"] as Record<string, unknown>;
    expect(kf["frame0"]).toEqual({ type: "image", url: IMG0 });
    expect(kf["frame1"]).toEqual({ type: "image", url: IMG1 });
  });

  // LM-02 — options.images with 2 URLs → frame0 + frame1
  it("LM-02: options.images[2] sets both frame0 and frame1", async () => {
    await provider.generateVideoFromImage(IMG0, "motion test", { images: [IMG0, IMG1] });

    const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    const kf = params["keyframes"] as Record<string, unknown>;
    expect(kf["frame0"]).toEqual({ type: "image", url: IMG0 });
    expect(kf["frame1"]).toEqual({ type: "image", url: IMG1 });
  });

  // LM-03 — options.images with 3 URLs → only first 2 used; warning logged
  it("LM-03: options.images[3] uses only first 2 and emits a warn log", async () => {
    await provider.generateVideoFromImage(IMG0, "motion test", { images: [IMG0, IMG1, IMG2] });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ received: 3, kept: 2, event: "images_truncated" }),
      expect.any(String),
    );
    const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    const kf = params["keyframes"] as Record<string, unknown>;
    expect(kf["frame0"]).toEqual({ type: "image", url: IMG0 });
    expect(kf["frame1"]).toEqual({ type: "image", url: IMG1 });
  });

  // LM-04 — options.images with 1 URL → frame0 only; no frame1
  it("LM-04: options.images[1] sets frame0 only; no frame1 key present", async () => {
    await provider.generateVideoFromImage(IMG0, "motion test", { images: [IMG0] });

    const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    const kf = params["keyframes"] as Record<string, unknown>;
    expect(kf["frame0"]).toEqual({ type: "image", url: IMG0 });
    expect(kf).not.toHaveProperty("frame1");
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
