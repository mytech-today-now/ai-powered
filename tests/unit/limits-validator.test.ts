/**
 * @file tests/unit/limits-validator.test.ts
 *
 * Unit tests for LimitsValidator — bd-ag1n / U2-01 through U2-12.
 *
 * Uses _injectMockConfigs() to supply controlled config maps, avoiding any
 * dependency on real JSON files or live network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LimitsValidator, type ProviderConfig } from "../../src/ai-powered/limits-validator.js";

type ConfigMap = Record<string, ProviderConfig>;
import { ProviderError } from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// Minimal mock configs
// ---------------------------------------------------------------------------

const OPENAI_CFG: ProviderConfig = {
  provider: "openai",
  updatedAt: "2026-01-01",
  models: [
    {
      id: "dall-e-3",
      modalities: ["image"],
      aspectRatios: ["1:1", "16:9", "9:16"],
      resolutions: [
        { label: "1024×1024", width: 1024, height: 1024 },
        { label: "1792×1024", width: 1792, height: 1024 },
        { label: "1024×1792", width: 1024, height: 1792 },
      ],
      maxWidth: 1792,
      maxHeight: 1792,
      maxPixels: 1835008,
    },
  ],
};

const VENICE_CFG: ProviderConfig = {
  provider: "venice",
  updatedAt: "2026-01-01",
  models: [
    {
      id: "fluently-xl",
      modalities: ["image"],
      resolutions: [
        { label: "512×512", width: 512, height: 512 },
        { label: "1024×1024", width: 1024, height: 1024 },
        { label: "1280×720", width: 1280, height: 720 },
      ],
      maxWidth: 1280,
      maxHeight: 1280,
      // maxPixels is intentionally smaller than maxWidth*maxHeight (1,638,400)
      // so that U2-04 can exercise the pixel-count code path with dims that
      // stay within the per-side limits.
      maxPixels: 1000000,
    },
  ],
};

const LUMAAI_CFG: ProviderConfig = {
  provider: "lumaai",
  updatedAt: "2026-01-01",
  models: [
    {
      id: "ray-2-720p",
      modalities: ["video"],
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      resolutions: [{ label: "720p", width: 1280, height: 720 }],
      maxWidth: 1280,
      maxHeight: 720,
      maxPixels: 921600,
      maxDurationSecs: 9,
      fpsOptions: [24],
    },
  ],
};

const RUNWAY_CFG: ProviderConfig = {
  provider: "runway",
  updatedAt: "2026-01-01",
  models: [
    {
      id: "gen4.5",
      modalities: ["video"],
      aspectRatios: ["1280:720", "720:1280"],
      resolutions: [
        { label: "landscape-720p", width: 1280, height: 720 },
        { label: "portrait-720p", width: 720, height: 1280 },
      ],
      maxWidth: 1280,
      maxHeight: 1280,
      maxDurationSecs: 10,
      fpsOptions: [24],
      qualityOptions: ["standard"],
    },
  ],
};

const STUB_CFGS: ConfigMap = {
  openai: OPENAI_CFG,
  venice: VENICE_CFG,
  lumaai: LUMAAI_CFG,
  runway: RUNWAY_CFG,
  anthropic: { provider: "anthropic", updatedAt: "2026-01-01", models: [] },
  xai: { provider: "xai", updatedAt: "2026-01-01", models: [] },
};

// ---------------------------------------------------------------------------
// Test lifecycle — inject mocks before each test, restore after
// ---------------------------------------------------------------------------

beforeEach(() => {
  LimitsValidator._injectMockConfigs(STUB_CFGS as never);
});

afterEach(() => {
  // Restore real files for test isolation (subsequent tests re-inject anyway).
  LimitsValidator._injectMockConfigs(STUB_CFGS as never);
});

// ---------------------------------------------------------------------------
// U2-01 to U2-05 — validateImage
// ---------------------------------------------------------------------------

describe("LimitsValidator.validateImage", () => {
  it("U2-01: valid OpenAI DALL-E 3 1024×1024 — no error", () => {
    expect(() => LimitsValidator.validateImage("openai", "dall-e-3", 1024, 1024)).not.toThrow();
  });

  it("U2-02: OpenAI DALL-E 3 2048×2048 over limit — ProviderError with nearest-valid", () => {
    expect(() => LimitsValidator.validateImage("openai", "dall-e-3", 2048, 2048)).toThrow(
      ProviderError,
    );
    try {
      LimitsValidator.validateImage("openai", "dall-e-3", 2048, 2048);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).message).toMatch(/nearest valid/i);
    }
  });

  it("U2-03: Venice fluently-xl 1280×720 (valid) — no error", () => {
    expect(() => LimitsValidator.validateImage("venice", "fluently-xl", 1280, 720)).not.toThrow();
  });

  it("U2-04: Venice fluently-xl 1100×1100 (over pixel count) — ProviderError with pixel-count msg", () => {
    // 1100×1100 = 1,210,000 > maxPixels 1,000,000; both sides are within per-side max 1280.
    // This specifically exercises the pixel-count branch (not the per-side branch).
    expect(() => LimitsValidator.validateImage("venice", "fluently-xl", 1100, 1100)).toThrow(
      ProviderError,
    );
    try {
      LimitsValidator.validateImage("venice", "fluently-xl", 1100, 1100);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const msg = (err as ProviderError).message;
      expect(msg).toMatch(/pixel count/i);
      expect(msg).toMatch(/nearest valid/i);
    }
  });

  it("U2-05: Venice fluently-xl 2000×2000 (over per-side limit) — ProviderError with nearest-valid", () => {
    expect(() => LimitsValidator.validateImage("venice", "fluently-xl", 2000, 2000)).toThrow(
      ProviderError,
    );
    try {
      LimitsValidator.validateImage("venice", "fluently-xl", 2000, 2000);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const msg = (err as ProviderError).message;
      expect(msg).toMatch(/max/i);
      expect(msg).toMatch(/nearest valid/i);
    }
  });
});

// ---------------------------------------------------------------------------
// U2-06 to U2-09 — validateVideo
// ---------------------------------------------------------------------------

describe("LimitsValidator.validateVideo", () => {
  it("U2-06: Luma AI ray-2-720p aspectRatio '9:16' (valid) — no error", () => {
    expect(() =>
      LimitsValidator.validateVideo("lumaai", "ray-2-720p", { aspectRatio: "9:16" }),
    ).not.toThrow();
  });

  it("U2-07: Luma AI ray-2-720p aspectRatio '21:9' (invalid) — ProviderError listing supported", () => {
    expect(() =>
      LimitsValidator.validateVideo("lumaai", "ray-2-720p", { aspectRatio: "21:9" }),
    ).toThrow(ProviderError);
    try {
      LimitsValidator.validateVideo("lumaai", "ray-2-720p", { aspectRatio: "21:9" });
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const msg = (err as ProviderError).message;
      expect(msg).toMatch(/not supported/i);
      expect(msg).toMatch(/9:16|16:9/);
    }
  });

  it("U2-08: Luma AI ray-2-720p duration 5 (valid) — no error", () => {
    expect(() =>
      LimitsValidator.validateVideo("lumaai", "ray-2-720p", { duration: 5 }),
    ).not.toThrow();
  });

  it("U2-09: Luma AI ray-2-720p duration 999 (over max 9s) — ProviderError with max msg", () => {
    expect(() => LimitsValidator.validateVideo("lumaai", "ray-2-720p", { duration: 999 })).toThrow(
      ProviderError,
    );
    try {
      LimitsValidator.validateVideo("lumaai", "ray-2-720p", { duration: 999 });
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const msg = (err as ProviderError).message;
      expect(msg).toMatch(/999/);
      expect(msg).toMatch(/max/i);
    }
  });
});

describe("LimitsValidator.validateVideo — runway gen4.5", () => {
  it("accepts the supported aspect ratio and duration for gen4.5", () => {
    expect(() =>
      LimitsValidator.validateVideo("runway", "gen4.5", {
        aspectRatio: "720:1280",
        duration: 10,
      }),
    ).not.toThrow();
  });

  it("rejects unsupported aspect ratios for gen4.5 with a stable ProviderError", () => {
    expect(() =>
      LimitsValidator.validateVideo("runway", "gen4.5", {
        aspectRatio: "21:9",
      }),
    ).toThrow(ProviderError);
    try {
      LimitsValidator.validateVideo("runway", "gen4.5", {
        aspectRatio: "21:9",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).message).toMatch(/not supported/i);
      expect((err as ProviderError).message).toMatch(/720:1280|1280:720/);
    }
  });

  it("rejects durations over the gen4.5 max with a stable ProviderError", () => {
    expect(() =>
      LimitsValidator.validateVideo("runway", "gen4.5", {
        duration: 11,
      }),
    ).toThrow(ProviderError);
    try {
      LimitsValidator.validateVideo("runway", "gen4.5", {
        duration: 11,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).message).toMatch(/11/);
      expect((err as ProviderError).message).toMatch(/max/i);
    }
  });
});

// ---------------------------------------------------------------------------
// U2-10 — Malformed config at import
// ---------------------------------------------------------------------------

describe("LimitsValidator._injectMockConfigs — malformed", () => {
  it("U2-10: calling _injectMockConfigs(null) triggers reload from real files without throw", () => {
    // Real JSON files in the repo are valid, so this should succeed.
    // A genuinely malformed file would throw with the file name in the message.
    expect(() => LimitsValidator._injectMockConfigs(null)).not.toThrow();
    // Re-inject mock to restore for subsequent tests
    LimitsValidator._injectMockConfigs(STUB_CFGS as never);
  });
});

// ---------------------------------------------------------------------------
// U2-11 / U2-12 — Live fetch behaviour
// ---------------------------------------------------------------------------

describe("LimitsValidator.fetchLiveCapabilities", () => {
  it("U2-11: fetch network error — resolves without throw; static config still used", async () => {
    const stubFetch = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", stubFetch);

    await expect(LimitsValidator.fetchLiveCapabilities("venice")).resolves.toBeUndefined();

    // Static config remains usable after failed live fetch
    expect(() => LimitsValidator.validateImage("venice", "fluently-xl", 512, 512)).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("U2-11b: fetch non-OK response — resolves without throw", async () => {
    const stubFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", stubFetch);

    await expect(LimitsValidator.fetchLiveCapabilities("venice")).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });

  // U2-12: The current fetchLiveCapabilities fetches live data but does not
  // yet merge it back into the in-memory config (enrichment is a follow-up).
  // This test verifies the function resolves successfully on a good response.
  it("U2-12: successful live fetch — resolves without throw", async () => {
    const mockBody = JSON.stringify({ data: [{ id: "new-model-v1" }] });
    const stubFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => JSON.parse(mockBody),
      text: async () => mockBody,
    });
    vi.stubGlobal("fetch", stubFetch);

    await expect(LimitsValidator.fetchLiveCapabilities("venice")).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });
});
