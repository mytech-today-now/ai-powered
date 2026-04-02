/**
 * @file tests/unit/aspect-ratio.test.ts
 *
 * Unit tests for AspectRatioService.
 * AI_MOCK=true is set globally by vitest.config.ts — no network calls are made.
 */

import { describe, it, expect } from "vitest";
import { AspectRatioService } from "../../src/ai-powered/aspect-ratio.js";

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

describe("AspectRatioService.parse", () => {
  it("U1-01: parses standard colon format '16:9'", () => {
    expect(AspectRatioService.parse("16:9")).toEqual({ widthRatio: 16, heightRatio: 9 });
  });

  it("U1-02: parses portrait colon format '9:16'", () => {
    expect(AspectRatioService.parse("9:16")).toEqual({ widthRatio: 9, heightRatio: 16 });
  });

  it("U1-03: parses decimal colon '2.35:1'", () => {
    expect(AspectRatioService.parse("2.35:1")).toEqual({ widthRatio: 2.35, heightRatio: 1 });
  });

  it("U1-04: parses non-standard colon ratio '9:19.5'", () => {
    expect(AspectRatioService.parse("9:19.5")).toEqual({ widthRatio: 9, heightRatio: 19.5 });
  });

  it("U1-05: parses decimal string '1.777'", () => {
    expect(AspectRatioService.parse("1.777")).toEqual({ widthRatio: 1.777, heightRatio: 1 });
  });

  it("U1-06: parses document ratio '8.5:11'", () => {
    expect(AspectRatioService.parse("8.5:11")).toEqual({ widthRatio: 8.5, heightRatio: 11 });
  });

  it("U1-07: throws RangeError containing 'division by zero' for '16:0'", () => {
    expect(() => AspectRatioService.parse("16:0")).toThrow(/division by zero/);
  });

  it("U1-08: throws RangeError containing 'must be positive' for '-16:9'", () => {
    expect(() => AspectRatioService.parse("-16:9")).toThrow(/must be positive/);
  });

  it("U1-09: throws RangeError containing 'extreme' for '100:1'", () => {
    expect(() => AspectRatioService.parse("100:1")).toThrow(/extreme/);
  });

  it("U1-10: throws RangeError for non-numeric string 'abc'", () => {
    expect(() => AspectRatioService.parse("abc")).toThrow(RangeError);
  });

  it("parses '2.35' (decimal) as widthRatio 2.35, heightRatio 1", () => {
    expect(AspectRatioService.parse("2.35")).toEqual({ widthRatio: 2.35, heightRatio: 1 });
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("AspectRatioService.validate", () => {
  it("U1-v1: passes for valid positive non-extreme dimensions", () => {
    expect(() => AspectRatioService.validate(1920, 1080)).not.toThrow();
  });

  it("U1-v2: throws for zero width", () => {
    expect(() => AspectRatioService.validate(0, 1080)).toThrow(RangeError);
  });

  it("U1-v3: throws for negative height", () => {
    expect(() => AspectRatioService.validate(1920, -1)).toThrow(RangeError);
  });

  it("U1-v4: throws for extreme ratio >20:1", () => {
    expect(() => AspectRatioService.validate(2100, 100)).toThrow(/extreme/);
  });

  it("U1-v5: passes for boundary ratio exactly 20:1 (2000×100)", () => {
    expect(() => AspectRatioService.validate(2000, 100)).not.toThrow();
  });

  it("throws for ratio <1:20 (100×2100)", () => {
    expect(() => AspectRatioService.validate(100, 2100)).toThrow(/extreme/);
  });
});

// ---------------------------------------------------------------------------
// calculate
// ---------------------------------------------------------------------------

describe("AspectRatioService.calculate", () => {
  it("U1-11: 9:16 + base 1080 → { width: 1080, height: 1920 }", () => {
    const ratio = AspectRatioService.parse("9:16");
    expect(AspectRatioService.calculate(ratio, 1080)).toEqual({ width: 1080, height: 1920 });
  });

  it("U1-12: 16:9 + base 1920 → { width: 1920, height: 1080 }", () => {
    const ratio = AspectRatioService.parse("16:9");
    expect(AspectRatioService.calculate(ratio, 1920)).toEqual({ width: 1920, height: 1080 });
  });

  it("U1-13: 2.35:1 + base 1920 → { width: 1920, height: 817 }", () => {
    const ratio = AspectRatioService.parse("2.35:1");
    expect(AspectRatioService.calculate(ratio, 1920)).toEqual({ width: 1920, height: 817 });
  });

  it("1:1 + base 1024 → { width: 1024, height: 1024 }", () => {
    const ratio = AspectRatioService.parse("1:1");
    expect(AspectRatioService.calculate(ratio, 1024)).toEqual({ width: 1024, height: 1024 });
  });
});

// ---------------------------------------------------------------------------
// nearest
// ---------------------------------------------------------------------------

describe("AspectRatioService.nearest", () => {
  const dalleList = [
    { width: 1024, height: 1024 },
    { width: 1792, height: 1024 },
    { width: 1024, height: 1792 },
  ];

  it("U1-14: snaps 1800×1000 to nearest 1792×1024", () => {
    expect(AspectRatioService.nearest(1800, 1000, dalleList)).toEqual({
      width: 1792,
      height: 1024,
    });
  });

  it("U1-14b: exact match 1024×1024 returned as-is", () => {
    const list = [
      { width: 512, height: 512 },
      { width: 1024, height: 1024 },
    ];
    expect(AspectRatioService.nearest(1024, 1024, list)).toEqual({ width: 1024, height: 1024 });
  });

  it("U1-14c: portrait 900×1600 snaps to 1024×1792", () => {
    expect(AspectRatioService.nearest(900, 1600, dalleList)).toEqual({
      width: 1024,
      height: 1792,
    });
  });

  it("throws RangeError when validList is empty", () => {
    expect(() => AspectRatioService.nearest(1024, 1024, [])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// preset lookup
// ---------------------------------------------------------------------------

describe("AspectRatioService presets", () => {
  it("U1-15: getPreset('cinema','CinemaScope') returns widthRatio 2.35, heightRatio 1", () => {
    const preset = AspectRatioService.getPreset("cinema", "CinemaScope");
    expect(preset).toBeDefined();
    expect(preset?.widthRatio).toBe(2.35);
    expect(preset?.heightRatio).toBe(1);
    expect(preset?.label).toContain("CinemaScope");
  });

  it("U1-16: getPresetsByCategory('unknown') returns empty array without throwing", () => {
    expect(() => AspectRatioService.getPresetsByCategory("unknown")).not.toThrow();
    expect(AspectRatioService.getPresetsByCategory("unknown")).toEqual([]);
  });

  it("getPresetsByCategory('mobile') returns non-empty array", () => {
    expect(AspectRatioService.getPresetsByCategory("mobile").length).toBeGreaterThan(0);
  });

  it("getPreset returns undefined for unknown category or name", () => {
    expect(AspectRatioService.getPreset("unknown", "Portrait")).toBeUndefined();
    expect(AspectRatioService.getPreset("cinema", "NonExistent")).toBeUndefined();
  });
});
