/**
 * @file src/ai-powered/utils/durationToFrames.ts
 *
 * Canonical frame-count utility for ai-powered.
 *
 * ALL pipeline components that need a frame count MUST call durationToFrames().
 * No component may perform inline `duration * frameRate` arithmetic for this purpose.
 * This is enforced by the `no-inline-frame-arithmetic` ESLint rule in CI.
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/specs/frame-count-utility/spec.md
 * REQ-FCU-01: Math.round() is the ONLY acceptable rounding method.
 * REQ-FCU-02: Warn when duration is not exactly representable at the given fps (drift > 0.001).
 * REQ-FCU-03: Return value is always ≥ 1 (Math.max guard).
 */

import { getLogger } from "../utils.js";

/**
 * Converts a duration in seconds to an integer frame count at the given frame rate.
 *
 * Uses Math.round() — the ONLY acceptable rounding method for frame counts.
 * Emits a [WARN] log entry when the duration is not exactly representable
 * at the target frame rate (i.e. drift > 0.001 frames).
 * Always returns at least 1 frame (Math.max guard prevents 0-frame clips).
 *
 * @param durationSeconds - Shot duration in seconds (should be > 0)
 * @param frameRate       - Project frame rate in frames per second (e.g. 24, 30, 60)
 * @returns               Nearest whole frame count; always ≥ 1
 *
 * @example
 * durationToFrames(4.5, 30)   // → 135 (exact, no warning)
 * durationToFrames(2.333, 30) // → 70  (warns: drift +0.000333s)
 * durationToFrames(0.001, 30) // → 1   (clamped from 0, warns)
 */
export function durationToFrames(durationSeconds: number, frameRate: number): number {
  const exact = durationSeconds * frameRate;
  const rounded = Math.max(1, Math.round(exact));

  if (Math.abs(exact - rounded) > 0.001) {
    const rendered = rounded / frameRate;
    const drift = rendered - durationSeconds;
    getLogger().warn(
      `[WARN] durationToFrames: ${durationSeconds}s is not exactly representable ` +
        `at ${frameRate} fps. Using ${rounded} frames (${rendered.toFixed(6)}s). ` +
        `Drift: ${drift >= 0 ? "+" : ""}${drift.toFixed(6)}s.`,
    );
  }

  return rounded;
}

export default durationToFrames;
