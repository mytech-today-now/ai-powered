/**
 * @file src/ai-powered/render-queue/assembler.ts
 *
 * Render Queue Assembler — mandatory pre-render validation gate (TASK-08, TASK-09).
 *
 * `validateRenderJob()` MUST be called before any shot clip is passed to the render
 * provider. No clip may be rendered if validation has not been successfully passed.
 * If validation fails, the ENTIRE job is rejected (zero clips rendered).
 *
 * Validation checks (spec: render-queue-validator/spec.md):
 *   1. Every shot has a positive integer frame count ≥ 1.
 *   2. Every explicit-duration shot's frame count is within ±1 of durationToFrames().
 *   3. No shot has a frame count of 0.
 *   4. If totalDuration specified: sum ± 1 matches Math.round(totalDuration × fps).
 *   5. AI-assigned duration shots (durationSource:"ai") skip the ±1 user-duration check.
 *
 * `enqueueJob()` wraps validateRenderJob() — the single authorised submission path.
 */

import { durationToFrames } from "../utils/durationToFrames.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A resolved shot ready for render-queue validation. */
export interface ShotForValidation {
  /** Client-assigned or parser-assigned shot identifier. */
  id: string;
  /** Resolved integer frame count (≥ 1). */
  frameCount: number;
  /**
   * User-supplied duration in seconds. Required only for explicit-source shots;
   * omit for AI-assigned shots.
   */
  durationSeconds?: number;
  /** How the duration was resolved — explicit shots undergo ±1 frame check. */
  durationSource: "explicit" | "ai";
}

/** A complete render job submitted to the queue. */
export interface RenderJob {
  /** Unique job identifier (used in error reports). */
  id: string;
  /** Project frame rate in frames per second. */
  frameRate: number;
  /** All shots in this job. */
  shots: ShotForValidation[];
  /**
   * Optional total project/batch duration in seconds. When provided, the sum of
   * all shot frame counts must equal Math.round(totalDuration × frameRate) ± 1.
   */
  totalDuration?: number;
}

/** A single validation failure record. */
interface ValidationFailure {
  shotId: string;
  expected: number;
  computed: number;
  delta: number;
}

// ---------------------------------------------------------------------------
// Validation gate (TASK-08)
// ---------------------------------------------------------------------------

/**
 * Validates a render job before it enters the render queue.
 *
 * Collects ALL failing shots before emitting a single [ERROR] report (exhaustive).
 * Throws if any check fails — callers receive exactly one error for the whole job.
 *
 * @param job - The complete render job to validate
 * @throws Error when validation fails; error message lists all failing shots
 */
export function validateRenderJob(job: RenderJob): void {
  const failures: ValidationFailure[] = [];

  for (const shot of job.shots) {
    // Check 1: frame count must be a positive integer ≥ 1.
    if (!Number.isInteger(shot.frameCount) || shot.frameCount < 1) {
      failures.push({
        shotId: shot.id,
        expected: -1,
        computed: shot.frameCount,
        delta: 0,
      });
      continue;
    }

    // Check 2: explicit-duration shots must match durationToFrames() within ±1 frame.
    // AI-assigned shots (durationSource:"ai") are exempt from this check.
    if (shot.durationSource === "explicit" && shot.durationSeconds !== undefined) {
      const expected = durationToFrames(shot.durationSeconds, job.frameRate);
      const delta = shot.frameCount - expected;
      if (Math.abs(delta) > 1) {
        failures.push({ shotId: shot.id, expected, computed: shot.frameCount, delta });
      }
    }
  }

  // Check 3: optional total-duration constraint.
  if (job.totalDuration !== undefined) {
    const expectedTotal = Math.round(job.totalDuration * job.frameRate);
    const actualTotal = job.shots.reduce((sum, sh) => sum + sh.frameCount, 0);
    if (Math.abs(actualTotal - expectedTotal) > 1) {
      failures.push({
        shotId: "__total__",
        expected: expectedTotal,
        computed: actualTotal,
        delta: actualTotal - expectedTotal,
      });
    }
  }

  if (failures.length > 0) {
    const lines = failures.map((f) => {
      if (f.shotId === "__total__") {
        return (
          `  - total duration: expected ${f.expected} frames, ` +
          `computed ${f.computed} frames. Delta: ${f.delta > 0 ? "+" : ""}${f.delta} frames.`
        );
      }
      if (f.expected === -1) {
        return (
          `  - shot "${f.shotId}": frame count is ${f.computed} ` +
          `(must be a positive integer ≥ 1).`
        );
      }
      return (
        `  - shot "${f.shotId}": expected ${f.expected} frames, ` +
        `computed ${f.computed} frames. Delta: ${f.delta > 0 ? "+" : ""}${f.delta} frames.`
      );
    });
    throw new Error(
      `[ERROR] Pre-render validation failed for job ${job.id}:\n${lines.join("\n")}\n` +
        `Job rejected. Fix the pipeline configuration and resubmit.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Job submission path (TASK-09)
// ---------------------------------------------------------------------------

/**
 * The single authorised entry point for submitting a render job.
 *
 * Calls `validateRenderJob()` before enqueuing. If validation fails, the
 * job is rejected entirely and the error propagates to the caller.
 * No clips are passed to the render provider unless validation succeeds.
 *
 * @param job        - The complete render job to submit
 * @param renderFn   - Async function that renders the validated job
 * @returns          Result of the render function
 */
export async function enqueueJob<T>(
  job: RenderJob,
  renderFn: (job: RenderJob) => Promise<T>,
): Promise<T> {
  // Gate: validate BEFORE any clip reaches the provider.
  validateRenderJob(job);

  // Validation passed — proceed to render.
  return renderFn(job);
}
