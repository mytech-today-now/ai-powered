/**
 * @file tests/integration/programmatic-frame-accuracy.test.ts
 *
 * Integration tests: Programmatic Frame Accuracy (TASK-15 / bd-7axx)
 * Tests: T-INT-01 through T-INT-07
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/tests/test-plan.md
 * Tasks.md: TASK-15 (correct-batch-programmatic-video)
 *
 * These tests exercise the full pipeline stack:
 *   1. Shot scheduler (AI pacing gate)
 *   2. Batch parser (strict mode, multi-format)
 *   3. Render queue assembler (validateRenderJob + enqueueJob)
 *
 * All tests run with AI_MOCK=true (set globally by vitest.config.ts).
 * No network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scheduleShot, scheduleBatch } from "../../src/ai-powered/shot-scheduler/index.js";
import { parseBatch } from "../../src/ai-powered/batch-parser/index.js";
import { validateRenderJob, enqueueJob } from "../../src/ai-powered/render-queue/assembler.js";
import * as utils from "../../src/ai-powered/utils.js";
import type { RenderJob } from "../../src/ai-powered/render-queue/assembler.js";

const mockLogger = { warn: vi.fn() };

beforeEach(() => {
  vi.spyOn(utils, "getLogger").mockReturnValue(mockLogger as ReturnType<typeof utils.getLogger>);
  mockLogger.warn.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T-INT-01 through T-INT-05: AC-1 API matrix — 24fps and 30fps
// ---------------------------------------------------------------------------

describe("T-INT-01..05: AC-1 programmatic API frame-accuracy matrix", () => {
  const AC1_TABLE = [
    { duration: 0.5, fps24: 12, fps30: 15 },
    { duration: 1.0, fps24: 24, fps30: 30 },
    { duration: 2.0, fps24: 48, fps30: 60 },
    { duration: 3.333, fps24: 80, fps30: 100 },
    { duration: 10.0, fps24: 240, fps30: 300 },
  ] as const;

  for (const [i, row] of AC1_TABLE.entries()) {
    it(`T-INT-0${i + 1}: ${row.duration}s scheduled at 24fps → ${row.fps24} frames`, () => {
      const shot = { id: `int-shot-${i}-24`, duration: row.duration };
      const scheduled = scheduleShot(shot, { projectFrameRate: 24 });
      expect(scheduled.frameCount).toBe(row.fps24);
      expect(scheduled.durationSource).toBe("explicit");

      // Also validate via render queue
      const job: RenderJob = {
        id: `job-${i}-24`,
        frameRate: 24,
        shots: [
          {
            id: scheduled.id,
            frameCount: scheduled.frameCount,
            durationSeconds: scheduled.durationSeconds,
            durationSource: "explicit",
          },
        ],
      };
      expect(() => validateRenderJob(job)).not.toThrow();
    });

    it(`T-INT-0${i + 1}: ${row.duration}s scheduled at 30fps → ${row.fps30} frames`, () => {
      const shot = { id: `int-shot-${i}-30`, duration: row.duration };
      const scheduled = scheduleShot(shot, { projectFrameRate: 30 });
      expect(scheduled.frameCount).toBe(row.fps30);
      expect(scheduled.durationSource).toBe("explicit");

      const job: RenderJob = {
        id: `job-${i}-30`,
        frameRate: 30,
        shots: [
          {
            id: scheduled.id,
            frameCount: scheduled.frameCount,
            durationSeconds: scheduled.durationSeconds,
            durationSource: "explicit",
          },
        ],
      };
      expect(() => validateRenderJob(job)).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// T-INT-06: AC-4 — AI pacing bypass for explicit 0.1s shot
// ---------------------------------------------------------------------------

describe("T-INT-06: AC-4 AI pacing engine bypass for explicit duration 0.1s", () => {
  it("POST {duration:0.1} at 30fps → Math.round(0.1×30)=3 frames; AI pacing engine NOT called", () => {
    const aiPacingEngine = { assign: vi.fn().mockReturnValue(99) }; // will throw if called

    const shot = { id: "short-shot", duration: 0.1 };
    const scheduled = scheduleShot(shot, {
      projectFrameRate: 30,
      allowAutoduration: false,
      aiPacingEngine,
    });

    // Math.round(0.1 × 30) = Math.round(3) = 3
    expect(scheduled.frameCount).toBe(3);
    expect(scheduled.durationSource).toBe("explicit");

    // AC-4: AI pacing engine must NOT have been called
    expect(aiPacingEngine.assign).not.toHaveBeenCalled();
  });

  it("'auto' duration at 30fps triggers AI pacing engine", () => {
    const aiPacingEngine = { assign: vi.fn().mockReturnValue(5.0) }; // 5.0s → 150 frames
    const shot = { id: "auto-shot", duration: "auto" };
    const scheduled = scheduleShot(shot, {
      projectFrameRate: 30,
      allowAutoduration: true,
      aiPacingEngine,
    });

    expect(scheduled.frameCount).toBe(150);
    expect(scheduled.durationSource).toBe("ai");
    expect(aiPacingEngine.assign).toHaveBeenCalledWith(shot);
  });
});

// ---------------------------------------------------------------------------
// T-INT-07: AC-5 — No regressions: verify full pipeline integration
// ---------------------------------------------------------------------------

describe("T-INT-07: AC-5 full pipeline integration regression check", () => {
  it("multi-shot batch pipeline (Example P-2): 3 shots at 24fps, total 174 frames", async () => {
    // Batch-parse → schedule → validate → enqueue
    const rawShots = [
      { id: "shot-A", duration: 2.0 },
      { id: "shot-B", duration: 3.75 },
      { id: "shot-C", duration: 1.5 },
    ];
    const parsed = parseBatch(rawShots, { frameRate: 24 });

    expect(parsed[0]).toMatchObject({ frameCount: 48 });
    expect(parsed[1]).toMatchObject({ frameCount: 90 });
    expect(parsed[2]).toMatchObject({ frameCount: 36 });

    const job: RenderJob = {
      id: "regression-job-p2",
      frameRate: 24,
      shots: parsed.map((p) => ({
        id: p.id,
        frameCount: p.frameCount!,
        durationSeconds: p.durationSeconds!,
        durationSource: "explicit" as const,
      })),
      totalDuration: 7.25,
    };

    const renderFn = vi.fn().mockResolvedValue({ clips: 3 });
    const result = await enqueueJob(job, renderFn);

    expect(renderFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ clips: 3 });
  });

  it("batch with missing duration + allowAutoduration:false throws, not partial render", () => {
    const rawShots = [
      { id: "clip-01", duration: "3.0" },
      { id: "clip-02", duration: null },
      { id: "clip-03", duration: "4.5" },
    ];
    expect(() => parseBatch(rawShots, { frameRate: 30, allowAutoduration: false })).toThrow(
      /0 shots rendered/,
    );
  });

  it("scheduleBatch rejects entire batch when one shot has missing duration", () => {
    const shots = [
      { id: "ok", duration: 3.0 },
      { id: "missing" }, // no duration, no allowAutoduration
    ];
    expect(() => scheduleBatch(shots, { projectFrameRate: 30, allowAutoduration: false })).toThrow(
      /Batch rejected/,
    );
  });

  it("frame-notation at 24fps: '96f@24' → 96 frames via batch pipeline", () => {
    const parsed = parseBatch([{ id: "frame-shot", duration: "96f@24" }], { frameRate: 24 });
    expect(parsed[0]).toMatchObject({ frameCount: 96, durationSeconds: 4.0 });
  });
});
