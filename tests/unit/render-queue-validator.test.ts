/**
 * @file tests/unit/render-queue-validator.test.ts
 *
 * Unit tests for the render-queue validator's validateRenderJob() function.
 * Tests: T-RQV-01 through T-RQV-05
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/specs/render-queue-validator/spec.md
 * Tasks.md: TASK-14 (correct-batch-programmatic-video)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateRenderJob,
  enqueueJob,
  type RenderJob,
} from "../../src/ai-powered/render-queue/assembler.js";
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
// T-RQV-01: Valid job passes — no error thrown
// ---------------------------------------------------------------------------

describe("T-RQV-01: valid job passes validation", () => {
  it("does not throw when all shots have correct integer frame counts", () => {
    const job: RenderJob = {
      id: "job-001",
      frameRate: 30,
      shots: [
        { id: "shot-A", frameCount: 135, durationSeconds: 4.5, durationSource: "explicit" },
        { id: "shot-B", frameCount: 60, durationSeconds: 2.0, durationSource: "explicit" },
        { id: "shot-C", frameCount: 150, durationSeconds: 5.0, durationSource: "explicit" },
      ],
    };
    expect(() => validateRenderJob(job)).not.toThrow();
  });

  it("accepts AI-assigned duration shots (durationSource:'ai') without ±1 check", () => {
    const job: RenderJob = {
      id: "job-ai",
      frameRate: 24,
      shots: [
        { id: "ai-shot", frameCount: 192, durationSource: "ai" }, // no durationSeconds
      ],
    };
    expect(() => validateRenderJob(job)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-RQV-02: Frame-count mismatch rejects job
// ---------------------------------------------------------------------------

describe("T-RQV-02: frame-count mismatch rejects entire job", () => {
  it("rejects when frameCount differs from durationToFrames by > 1 frame", () => {
    // 3.267s × 30fps = 98.01 → Math.round = 98
    // frameCount = 90 → delta = |90 - 98| = 8 > 1 → rejected
    const job: RenderJob = {
      id: "job-mismatch",
      frameRate: 30,
      shots: [
        { id: "bad-shot", frameCount: 90, durationSeconds: 3.267, durationSource: "explicit" },
      ],
    };
    expect(() => validateRenderJob(job)).toThrow(/\[ERROR\].*Pre-render validation failed/s);
    expect(() => validateRenderJob(job)).toThrow(/bad-shot/);
  });

  it("accepts when frameCount is within ±1 frame", () => {
    // 2.333s × 30fps = 69.99 → round = 70. frameCount = 71 → delta = 1 → accepted
    const job: RenderJob = {
      id: "job-close",
      frameRate: 30,
      shots: [
        { id: "close-shot", frameCount: 71, durationSeconds: 2.333, durationSource: "explicit" },
      ],
    };
    expect(() => validateRenderJob(job)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-RQV-03: Zero-frame shot rejects job
// ---------------------------------------------------------------------------

describe("T-RQV-03: zero-frame shot rejects entire job", () => {
  it("throws when any shot has frameCount = 0", () => {
    const job: RenderJob = {
      id: "job-zero",
      frameRate: 30,
      shots: [
        { id: "ok-shot", frameCount: 90, durationSeconds: 3.0, durationSource: "explicit" },
        { id: "zero-shot", frameCount: 0, durationSource: "explicit" },
      ],
    };
    expect(() => validateRenderJob(job)).toThrow(/\[ERROR\].*Pre-render validation failed/s);
  });
});

// ---------------------------------------------------------------------------
// T-RQV-04: totalDuration mismatch rejects job
// ---------------------------------------------------------------------------

describe("T-RQV-04: totalDuration mismatch rejects job", () => {
  it("rejects when sum of frames ≠ round(totalDuration × fps) ± 1", () => {
    // sum = 174 frames; totalDuration = 8.0s × 24fps = 192 expected; delta = -18 > 1
    const job: RenderJob = {
      id: "job-total",
      frameRate: 24,
      shots: [
        { id: "shot-A", frameCount: 48, durationSeconds: 2.0, durationSource: "explicit" },
        { id: "shot-B", frameCount: 90, durationSeconds: 3.75, durationSource: "explicit" },
        { id: "shot-C", frameCount: 36, durationSeconds: 1.5, durationSource: "explicit" },
      ],
      totalDuration: 8.0, // expects 192 frames; actual = 174
    };
    expect(() => validateRenderJob(job)).toThrow(/\[ERROR\].*Pre-render validation failed/s);
    expect(() => validateRenderJob(job)).toThrow(/total duration/);
  });

  it("passes when sum matches totalDuration exactly", () => {
    // sum = 174 frames; totalDuration = 7.25s × 24fps = round(174) = 174 → OK
    const job: RenderJob = {
      id: "job-total-ok",
      frameRate: 24,
      shots: [
        { id: "shot-A", frameCount: 48, durationSeconds: 2.0, durationSource: "explicit" },
        { id: "shot-B", frameCount: 90, durationSeconds: 3.75, durationSource: "explicit" },
        { id: "shot-C", frameCount: 36, durationSeconds: 1.5, durationSource: "explicit" },
      ],
      totalDuration: 7.25,
    };
    expect(() => validateRenderJob(job)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-RQV-05: Exhaustive error report — all failures listed
// ---------------------------------------------------------------------------

describe("T-RQV-05: exhaustive error report lists all failing shots", () => {
  it("throws once with all three failing shots in a single message", () => {
    const job: RenderJob = {
      id: "job-exhaustive",
      frameRate: 30,
      shots: [
        // Each has a 10+ frame mismatch to exceed ±1 tolerance
        { id: "fail-01", frameCount: 50, durationSeconds: 4.0, durationSource: "explicit" }, // expect 120
        { id: "fail-02", frameCount: 10, durationSeconds: 3.0, durationSource: "explicit" }, // expect 90
        { id: "fail-03", frameCount: 200, durationSeconds: 2.0, durationSource: "explicit" }, // expect 60
      ],
    };

    let error: Error | null = null;
    try {
      validateRenderJob(job);
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain("fail-01");
    expect(error!.message).toContain("fail-02");
    expect(error!.message).toContain("fail-03");
    expect(error!.message).toContain("[ERROR] Pre-render validation failed");
    expect(error!.message).toContain("Job rejected");
  });
});

// ---------------------------------------------------------------------------
// enqueueJob: validates before calling renderFn (TASK-09)
// ---------------------------------------------------------------------------

describe("enqueueJob: validates before rendering", () => {
  it("calls renderFn when validation passes", async () => {
    const job: RenderJob = {
      id: "enqueue-ok",
      frameRate: 30,
      shots: [{ id: "s1", frameCount: 135, durationSeconds: 4.5, durationSource: "explicit" }],
    };
    const renderFn = vi.fn().mockResolvedValue("rendered");
    const result = await enqueueJob(job, renderFn);
    expect(renderFn).toHaveBeenCalledWith(job);
    expect(result).toBe("rendered");
  });

  it("rejects without calling renderFn when validation fails", async () => {
    const job: RenderJob = {
      id: "enqueue-fail",
      frameRate: 30,
      shots: [{ id: "s1", frameCount: 0, durationSource: "explicit" }],
    };
    const renderFn = vi.fn();
    await expect(enqueueJob(job, renderFn)).rejects.toThrow(/Pre-render validation failed/);
    expect(renderFn).not.toHaveBeenCalled();
  });
});
