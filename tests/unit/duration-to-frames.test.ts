/**
 * @file tests/unit/duration-to-frames.test.ts
 *
 * Unit tests for durationToFrames() — the canonical frame-count utility.
 * Tests: T-FCU-01 through T-FCU-12
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/specs/frame-count-utility/spec.md
 * Tasks.md: TASK-12 (correct-batch-programmatic-video)
 *
 * AC-1 table coverage: 9 durations × 2 fps values (24fps + 30fps)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { durationToFrames } from "../../src/ai-powered/utils/durationToFrames.js";
import * as utils from "../../src/ai-powered/utils.js";

// ---------------------------------------------------------------------------
// Test helper — spy on logger.warn
// ---------------------------------------------------------------------------

const mockLogger = { warn: vi.fn() };

beforeEach(() => {
  vi.spyOn(utils, "getLogger").mockReturnValue(mockLogger as ReturnType<typeof utils.getLogger>);
  mockLogger.warn.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T-FCU-01 through T-FCU-09 — AC-1 matrix
// ---------------------------------------------------------------------------

describe("durationToFrames — AC-1 matrix (T-FCU-01 through T-FCU-09)", () => {
  const table = [
    { id: "T-FCU-01", s: 0.5, fps24: 12, fps30: 15, warn24: false, warn30: false },
    { id: "T-FCU-02", s: 1.0, fps24: 24, fps30: 30, warn24: false, warn30: false },
    { id: "T-FCU-03", s: 1.5, fps24: 36, fps30: 45, warn24: false, warn30: false },
    { id: "T-FCU-04", s: 2.0, fps24: 48, fps30: 60, warn24: false, warn30: false },
    { id: "T-FCU-05", s: 2.5, fps24: 60, fps30: 75, warn24: false, warn30: false },
    { id: "T-FCU-06", s: 3.0, fps24: 72, fps30: 90, warn24: false, warn30: false },
    { id: "T-FCU-07", s: 3.333, fps24: 80, fps30: 100, warn24: true, warn30: true },
    { id: "T-FCU-08", s: 4.75, fps24: 114, fps30: 143, warn24: false, warn30: true },
    { id: "T-FCU-09", s: 10.0, fps24: 240, fps30: 300, warn24: false, warn30: false },
  ] as const;

  for (const row of table) {
    it(`${row.id}: ${row.s}s at 24fps → ${row.fps24} frames${row.warn24 ? " (warn)" : ""}`, () => {
      mockLogger.warn.mockClear();
      const result = durationToFrames(row.s, 24);
      expect(result).toBe(row.fps24);
      if (row.warn24) {
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      } else {
        expect(mockLogger.warn).not.toHaveBeenCalled();
      }
    });

    it(`${row.id}: ${row.s}s at 30fps → ${row.fps30} frames${row.warn30 ? " (warn)" : ""}`, () => {
      mockLogger.warn.mockClear();
      const result = durationToFrames(row.s, 30);
      expect(result).toBe(row.fps30);
      if (row.warn30) {
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      } else {
        expect(mockLogger.warn).not.toHaveBeenCalled();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// T-FCU-10 — Warning content is correct
// ---------------------------------------------------------------------------

describe("T-FCU-10: warning content for non-representable duration", () => {
  it("durationToFrames(2.333, 30) warns with correct message contents", () => {
    const result = durationToFrames(2.333, 30);
    expect(result).toBe(70); // Math.round(69.99) = 70

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const msg = mockLogger.warn.mock.calls[0]![0] as string;
    expect(msg).toContain("2.333s");
    expect(msg).toContain("30 fps");
    expect(msg).toContain("70 frames");
    expect(msg).toContain("+0.000333s");
  });
});

// ---------------------------------------------------------------------------
// T-FCU-11 — No warning for exact duration
// ---------------------------------------------------------------------------

describe("T-FCU-11: no warning for exact duration", () => {
  it("durationToFrames(4.5, 30) returns 135 with no warning", () => {
    const result = durationToFrames(4.5, 30);
    expect(result).toBe(135);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-FCU-12 — Minimum 1 frame guard
// ---------------------------------------------------------------------------

describe("T-FCU-12: minimum 1 frame guard (Math.max clamping)", () => {
  it("durationToFrames(0.001, 30) returns 1, not 0", () => {
    // 0.001 × 30 = 0.03 → Math.round(0.03) = 0 → Math.max(1, 0) = 1
    const result = durationToFrames(0.001, 30);
    expect(result).toBe(1);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it("Math.round(0.5) rounds to 1 (half-away-from-zero in Node.js)", () => {
    // durationToFrames(0.5/30, 30) = durationToFrames(0.01667, 30)
    // exact = 0.01667 * 30 = 0.5001 → Math.round = 1
    const result = durationToFrames(0.5 / 30, 30);
    expect(result).toBe(1);
  });
});
