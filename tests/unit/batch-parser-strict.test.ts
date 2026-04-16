/**
 * @file tests/unit/batch-parser-strict.test.ts
 *
 * Unit tests for the batch-parser strict mode and multi-format duration parsing.
 * Tests: T-BFP-01 through T-BFP-07
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/specs/batch-file-parser/spec.md
 * Tasks.md: TASK-13 (correct-batch-programmatic-video)
 *
 * All warnings are suppressed via logger mock to keep test output clean.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseBatch,
  parseDurationToSeconds,
  type RawShot,
} from "../../src/ai-powered/batch-parser/index.js";
import * as utils from "../../src/ai-powered/utils.js";

const mockLogger = { warn: vi.fn() };

beforeEach(() => {
  vi.spyOn(utils, "getLogger").mockReturnValue(mockLogger as ReturnType<typeof utils.getLogger>);
  mockLogger.warn.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T-BFP-01: Valid CSV — all explicit 30fps (Example B-1)
// ---------------------------------------------------------------------------

describe("T-BFP-01: B-1 valid batch — all explicit 30fps", () => {
  const shots: RawShot[] = [
    { id: "scene-01", duration: "5.0" },
    { id: "scene-02", duration: "3.25" },
    { id: "scene-03", duration: "2.0" },
    { id: "scene-04", duration: "8.5" },
  ];

  it("returns 4 shots with correct frame counts", () => {
    const result = parseBatch(shots, { frameRate: 30, allowAutoduration: false });
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      id: "scene-01",
      frameCount: 150,
      durationSource: "explicit",
    });
    expect(result[1]).toMatchObject({ id: "scene-02", frameCount: 98, durationSource: "explicit" });
    expect(result[2]).toMatchObject({ id: "scene-03", frameCount: 60, durationSource: "explicit" });
    expect(result[3]).toMatchObject({
      id: "scene-04",
      frameCount: 255,
      durationSource: "explicit",
    });
  });

  it("emits warning only for scene-02 (3.25s → 97.5 → drift > 0.001)", () => {
    parseBatch(shots, { frameRate: 30 });
    // scene-02: 3.25 × 30 = 97.5 → round = 98 → drift = 0.5 > 0.001
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]![0] as string).toContain("3.25");
  });
});

// ---------------------------------------------------------------------------
// T-BFP-02: JSON mixed formats — 24fps (Example B-2)
// ---------------------------------------------------------------------------

describe("T-BFP-02: B-2 JSON mixed duration formats 24fps", () => {
  const shots: RawShot[] = [
    { id: "promo-01", duration: "4.0" },
    { id: "promo-02", duration: "00:00:07.500" },
    { id: "promo-03", duration: "96f@24" },
    { id: "promo-04", duration: 2.5 },
  ];

  it("resolves all 4 shots; promo-01 and promo-03 both equal 96 frames", () => {
    const result = parseBatch(shots, { frameRate: 24 });
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ id: "promo-01", frameCount: 96, durationSource: "explicit" });
    expect(result[1]).toMatchObject({
      id: "promo-02",
      frameCount: 180,
      durationSource: "explicit",
    });
    expect(result[2]).toMatchObject({ id: "promo-03", frameCount: 96, durationSource: "explicit" });
    expect(result[3]).toMatchObject({ id: "promo-04", frameCount: 60, durationSource: "explicit" });
  });

  it("no warnings emitted (all durations are exact at 24fps)", () => {
    parseBatch(shots, { frameRate: 24 });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-BFP-03: Missing duration — hard error, zero clips (Example B-3)
// ---------------------------------------------------------------------------

describe("T-BFP-03: B-3 missing duration → hard error + zero clips", () => {
  const shots: RawShot[] = [
    { id: "clip-01", duration: "3.0" },
    { id: "clip-02", duration: "" },
    { id: "clip-03", duration: "4.5" },
  ];

  it("throws a hard error when duration is blank and allowAutoduration is false", () => {
    expect(() => parseBatch(shots, { frameRate: 30, allowAutoduration: false })).toThrow(
      /\[ERROR\].*clip-02.*allowAutoduration/s,
    );
  });

  it("error message includes shot ID and guidance", () => {
    let caught: Error | null = null;
    try {
      parseBatch(shots, { frameRate: 30 });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("clip-02");
    expect(caught!.message).toContain("allowAutoduration");
    expect(caught!.message).toContain("0 shots rendered");
  });

  it("zero clips returned (function throws, no partial array)", () => {
    let result: unknown = undefined;
    try {
      result = parseBatch(shots, { frameRate: 30 });
    } catch {
      /* expected */
    }
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T-BFP-04: YAML frame-notation 60fps (Example B-4)
// ---------------------------------------------------------------------------

describe("T-BFP-04: B-4 YAML frame notation 60fps", () => {
  const shots: RawShot[] = [
    { id: "frame-shot-01", duration: "300f@60" },
    { id: "frame-shot-02", duration: "18f@60" },
    { id: "frame-shot-03", duration: "120f@60" },
  ];

  it("resolves correct frame counts; total = 438", () => {
    const result = parseBatch(shots, { frameRate: 60 });
    expect(result[0]).toMatchObject({ id: "frame-shot-01", frameCount: 300 });
    expect(result[1]).toMatchObject({ id: "frame-shot-02", frameCount: 18 });
    expect(result[2]).toMatchObject({ id: "frame-shot-03", frameCount: 120 });
    const total = result.reduce((s, r) => s + (r.frameCount ?? 0), 0);
    expect(total).toBe(438);
  });
});

// ---------------------------------------------------------------------------
// T-BFP-05: Timecode string round-trip
// ---------------------------------------------------------------------------

describe("T-BFP-05: timecode string '00:00:03.500' at 30fps", () => {
  it("parseDurationToSeconds('00:00:03.500') === 3.5", () => {
    expect(parseDurationToSeconds("00:00:03.500")).toBe(3.5);
  });

  it("parseBatch timecode → 105 frames at 30fps, no warning", () => {
    const shots: RawShot[] = [{ id: "tc-shot", duration: "00:00:03.500" }];
    const result = parseBatch(shots, { frameRate: 30 });
    expect(result[0]).toMatchObject({ id: "tc-shot", frameCount: 105, durationSeconds: 3.5 });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-BFP-06: TOML mixed explicit + auto (Example B-5)
// ---------------------------------------------------------------------------

describe("T-BFP-06: B-5 TOML mixed explicit + allowAutoduration:true", () => {
  const shots: RawShot[] = [
    { id: "reel-01", duration: 6.0 },
    { id: "reel-02", duration: null },
    { id: "reel-03", duration: "3.5" },
  ];

  it("reel-01 and reel-03 are explicit; reel-02 is AI-routed", () => {
    const result = parseBatch(shots, { frameRate: 30, allowAutoduration: true });
    expect(result[0]).toMatchObject({ id: "reel-01", frameCount: 180, durationSource: "explicit" });
    expect(result[1]).toMatchObject({ id: "reel-02", frameCount: null, durationSource: "ai" });
    expect(result[2]).toMatchObject({ id: "reel-03", frameCount: 105, durationSource: "explicit" });
  });
});

// ---------------------------------------------------------------------------
// T-BFP-07: Unrecognised format → hard error
// ---------------------------------------------------------------------------

describe("T-BFP-07: unrecognised duration format → hard error", () => {
  it('duration "3s" throws with unrecognised format message', () => {
    expect(() => parseDurationToSeconds("3s")).toThrow(
      /\[ERROR\].*Unrecognised duration format.*3s/s,
    );
  });

  it('parseBatch with "3s" rejects the batch', () => {
    const shots: RawShot[] = [{ id: "bad-shot", duration: "3s" }];
    expect(() => parseBatch(shots, { frameRate: 30 })).toThrow(/Unrecognised duration format/);
  });
});
