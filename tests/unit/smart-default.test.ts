/**
 * @file tests/unit/smart-default.test.ts
 *
 * Unit tests for selectI2VProvider() — SM-01 through SM-05.
 * Pure function: no side effects, no server imports required.
 *
 * bd-08tj / TASK-14: smart-default unit tests
 */

import { describe, it, expect } from "vitest";
import { selectI2VProvider } from "../../src/ai-powered/server/smart-default.js";

/** Simulated live provider list (all video-capable providers available). */
const ALL_LIVE = ["lumaai", "xai", "venice", "runway", "mock"];

// ---------------------------------------------------------------------------
// SM-01 — imageCount=0 → no change
// ---------------------------------------------------------------------------

describe("selectI2VProvider — SM-01: imageCount=0", () => {
  it("returns requestedProvider unchanged when imageCount is 0", () => {
    const result = selectI2VProvider("xai", 0, ALL_LIVE);
    expect(result.provider).toBe("xai");
    expect(result.effectiveImageCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SM-02 — imageCount=1, capable provider → no routing change
// ---------------------------------------------------------------------------

describe("selectI2VProvider — SM-02: imageCount=1, capable provider", () => {
  it("returns lumaai unchanged when imageCount=1 (lumaai supports up to 2)", () => {
    const result = selectI2VProvider("lumaai", 1, ALL_LIVE);
    expect(result.provider).toBe("lumaai");
    expect(result.effectiveImageCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it("returns xai unchanged when imageCount=1 (xai supports 1 image)", () => {
    const result = selectI2VProvider("xai", 1, ALL_LIVE);
    expect(result.provider).toBe("xai");
    expect(result.effectiveImageCount).toBe(1);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SM-03 — imageCount=2, requestedProvider=xai → routes to lumaai
// ---------------------------------------------------------------------------

describe("selectI2VProvider — SM-03: imageCount=2, xai→lumaai", () => {
  it("routes xai to lumaai when imageCount=2 (xai max=1)", () => {
    const result = selectI2VProvider("xai", 2, ALL_LIVE);
    expect(result.provider).toBe("lumaai");
    expect(result.effectiveImageCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.warning).toMatch(/lumaai/);
  });
});

// ---------------------------------------------------------------------------
// SM-04 — imageCount=3 → truncates to 2, routes to lumaai
// ---------------------------------------------------------------------------

describe("selectI2VProvider — SM-04: imageCount=3, xai→lumaai+truncation", () => {
  it("routes xai to lumaai and truncates effectiveImageCount to 2 when imageCount=3", () => {
    const result = selectI2VProvider("xai", 3, ALL_LIVE);
    expect(result.provider).toBe("lumaai");
    expect(result.effectiveImageCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.warning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SM-05 — lumaai not in liveProviders → falls back to xai
// ---------------------------------------------------------------------------

describe("selectI2VProvider — SM-05: lumaai not live → fallback", () => {
  it("falls back to requestedProvider with effectiveImageCount=1 when no live provider can handle 2 images", () => {
    // Only xai and venice are live, neither supports 2 images (max=1 each)
    const result = selectI2VProvider("xai", 2, ["xai", "venice"]);
    expect(result.provider).toBe("xai");
    expect(result.effectiveImageCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.warning).toMatch(/No live provider/);
  });
});
