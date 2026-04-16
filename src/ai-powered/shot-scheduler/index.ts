/**
 * @file src/ai-powered/shot-scheduler/index.ts
 *
 * Shot Scheduler — AI pacing engine opt-in gate and frame-count derivation.
 *
 * All inline frame arithmetic has been replaced with durationToFrames() calls.
 * The AI pacing engine is ONLY activated for shots where the user has explicitly
 * opted in via `duration: "auto"` or by setting `allowAutoduration: true`.
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/specs/shot-scheduler/spec.md
 * REQ-SS-02: Duration classification table — authoritative source.
 */

import { durationToFrames } from "../utils/durationToFrames.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Raw shot input before scheduling. */
export interface ShotInput {
  id: string;
  prompt?: string;
  duration?: number | string | null;
  [key: string]: unknown;
}

/** Shot after the scheduler has resolved frame count and duration source. */
export interface ScheduledShot extends ShotInput {
  durationSeconds: number;
  frameCount: number;
  durationSource: "explicit" | "ai";
}

/** Minimal AI pacing engine interface — injectable for testability. */
export interface AiPacingEngine {
  /** Assigns a duration (in seconds) to a shot that lacks an explicit one. */
  assign(shot: ShotInput): number;
}

/** Options for the shot scheduler. */
export interface ScheduleOptions {
  /** Project frame rate in frames per second (e.g. 24, 30, 60). */
  projectFrameRate: number;
  /**
   * When true, shots with null/undefined duration are routed to the AI pacing
   * engine. When false (default), such shots cause a hard error.
   */
  allowAutoduration?: boolean;
  /**
   * Optional AI pacing engine implementation. If omitted and AI activation is
   * triggered, an error is thrown.
   */
  aiPacingEngine?: AiPacingEngine;
}

// ---------------------------------------------------------------------------
// Duration parsing helpers (three notations — REQ-SS-02)
// ---------------------------------------------------------------------------

/**
 * Returns true when the duration value is an explicit user-supplied duration
 * (numeric, decimal string, HH:MM:SS.mmm timecode, or Nf@fps frame notation).
 * Returns false for null, undefined, or the string "auto".
 *
 * See specs/shot-scheduler/spec.md REQ-SS-02 for the authoritative table.
 *
 * NOTE: Returns plain boolean (not a type predicate) so TypeScript does not
 * incorrectly narrow `duration` to `null | undefined` in the false branch —
 * the string "auto" must remain reachable after a false return.
 */
function isExplicitDuration(value: unknown): boolean {
  if (value === null || value === undefined || value === "auto") return false;
  if (typeof value === "number") return true;
  if (typeof value === "string") {
    // Decimal seconds string: "3.5" or "5" or "10.0"
    if (/^[0-9]+(\.[0-9]+)?$/.test(value)) return true;
    // HH:MM:SS.mmm timecode: "00:00:03.500"
    if (/^[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?$/.test(value)) return true;
    // Frame notation: "105f@30" or "96f@24"
    if (/^[0-9]+f@[0-9]+(\.[0-9]+)?$/.test(value)) return true;
  }
  return false;
}

/**
 * Converts an explicit duration value to seconds.
 * Handles three notations: numeric, HH:MM:SS.mmm, and Nf@fps.
 * Throws for unrecognised string formats.
 */
export function parseDuration(value: number | string): number {
  if (typeof value === "number") return value;

  // Decimal string
  if (/^[0-9]+(\.[0-9]+)?$/.test(value)) return parseFloat(value);

  // HH:MM:SS.mmm timecode
  const tcMatch = value.match(/^([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?$/);
  if (tcMatch) {
    const [, hh, mm, ss, ms = ".0"] = tcMatch;
    return parseInt(hh!, 10) * 3600 + parseInt(mm!, 10) * 60 + parseFloat((ss ?? "0") + ms);
  }

  // Frame notation: Nf@fps
  const frameMatch = value.match(/^([0-9]+)f@([0-9]+(?:\.[0-9]+)?)$/);
  if (frameMatch) {
    return parseInt(frameMatch[1]!, 10) / parseFloat(frameMatch[2]!);
  }

  throw new Error(
    `[ERROR] Unrecognised duration format: "${value}". ` +
      `Accepted formats: decimal seconds (e.g. "3.5"), HH:MM:SS.mmm, or Nf@fps (e.g. "105f@30").`,
  );
}

// ---------------------------------------------------------------------------
// Core scheduling functions
// ---------------------------------------------------------------------------

/**
 * Schedules a single shot, resolving its frame count.
 *
 * - Explicit duration: AI engine skipped; durationToFrames() called directly.
 * - "auto" or null/undefined + allowAutoduration=true: AI engine invoked.
 * - null/undefined + allowAutoduration=false: hard error thrown.
 */
export function scheduleShot(shot: ShotInput, opts: ScheduleOptions): ScheduledShot {
  const { projectFrameRate, allowAutoduration = false, aiPacingEngine } = opts;

  // — Explicit duration path (REQ-SS-02: AI engine is SKIPPED) ———————————————
  if (isExplicitDuration(shot.duration)) {
    const durationSeconds = parseDuration(shot.duration as number | string);
    const frameCount = durationToFrames(durationSeconds, projectFrameRate);
    return { ...shot, durationSeconds, frameCount, durationSource: "explicit" };
  }

  // — AI-engine path: "auto" or null/undefined with opt-in ——————————————————
  if (shot.duration === "auto" || (shot.duration == null && allowAutoduration)) {
    if (!aiPacingEngine) {
      throw new Error(
        `[ERROR] Shot "${shot.id}" requires the AI pacing engine but none was provided. ` +
          `Supply an aiPacingEngine in ScheduleOptions.`,
      );
    }
    const durationSeconds = aiPacingEngine.assign(shot);
    const frameCount = durationToFrames(durationSeconds, projectFrameRate);
    return { ...shot, durationSeconds, frameCount, durationSource: "ai" };
  }

  // — Hard error: missing duration without opt-in ————————————————————————————
  throw new Error(
    `[ERROR] Shot "${shot.id}" has no explicit duration and allowAutoduration is false. ` +
      `Set a duration value, or set allowAutoduration: true to permit AI-assigned durations.`,
  );
}

/**
 * Schedules a batch of shots. Collects all errors before throwing to provide
 * an exhaustive report (all-or-nothing batch rejection).
 */
export function scheduleBatch(shots: ShotInput[], opts: ScheduleOptions): ScheduledShot[] {
  const results: ScheduledShot[] = [];
  const errors: string[] = [];

  for (const shot of shots) {
    try {
      results.push(scheduleShot(shot, opts));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[ERROR] Batch scheduling failed with ${errors.length} error(s):\n${errors.join("\n")}\n` +
        `Batch rejected. 0 shots rendered.`,
    );
  }

  return results;
}
