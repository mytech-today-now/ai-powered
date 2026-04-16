/**
 * @file src/ai-powered/batch-parser/index.ts
 *
 * Batch File Parser — strict-mode duration validation and multi-format parsing.
 *
 * BREAKING CHANGE: Batch files with missing/blank duration fields previously
 * rendered silently with project defaults. They now produce a hard error + zero
 * clips rendered unless `allowAutoduration: true` is set at the batch level.
 *
 * Accepted duration notations (REQ-BFP-02):
 *   - Decimal seconds:      "3.5"  or  3.5
 *   - HH:MM:SS.mmm:         "00:00:03.500"
 *   - Frame notation:       "96f@24"  (frames ÷ declared fps)
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/specs/batch-file-parser/spec.md
 */

import { durationToFrames } from "../utils/durationToFrames.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A raw shot record from a batch file (before duration resolution). */
export interface RawShot {
  id: string;
  prompt?: string;
  duration?: string | number | null;
  [key: string]: unknown;
}

/** A shot after duration has been parsed and frame count resolved. */
export interface ParsedShot {
  id: string;
  prompt?: string;
  /** Parsed duration in seconds. null for AI-routed shots. */
  durationSeconds: number | null;
  /** Resolved frame count. null for AI-routed shots. */
  frameCount: number | null;
  /** How the duration was resolved. */
  durationSource: "explicit" | "ai";
  /** Original raw input record. */
  raw: RawShot;
}

/** Options controlling parse behaviour. */
export interface ParseBatchOptions {
  /** Project frame rate (required to derive frame counts). */
  frameRate: number;
  /**
   * When true, shots with missing/null duration are routed to the AI pacing
   * engine (frameCount/durationSeconds will be null in the output).
   * When false (default), missing durations cause a hard error.
   */
  allowAutoduration?: boolean;
}

// ---------------------------------------------------------------------------
// Duration notation parser (REQ-BFP-02a, 02b, 02c)
// ---------------------------------------------------------------------------

/**
 * Parses all supported duration notations to seconds.
 * Throws for unrecognised formats (REQ-BFP: no silent fallback).
 *
 * @param raw - Raw duration field value from the batch file
 * @returns   Duration in seconds
 */
export function parseDurationToSeconds(raw: string | number): number {
  if (typeof raw === "number") return raw;

  // Decimal string: "3.5" or "10" or "0.25"
  if (/^[0-9]+(\.[0-9]+)?$/.test(raw)) return parseFloat(raw);

  // HH:MM:SS.mmm timecode: "00:00:03.500"
  const tcMatch = raw.match(/^([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?$/);
  if (tcMatch) {
    const [, hh, mm, ss, ms = ".0"] = tcMatch;
    return parseInt(hh!, 10) * 3600 + parseInt(mm!, 10) * 60 + parseFloat((ss ?? "0") + ms);
  }

  // Frame notation: Nf@fps (e.g. "96f@24", "300f@60")
  const frameMatch = raw.match(/^([0-9]+)f@([0-9]+(?:\.[0-9]+)?)$/);
  if (frameMatch) {
    return parseInt(frameMatch[1]!, 10) / parseFloat(frameMatch[2]!);
  }

  throw new Error(
    `[ERROR] Unrecognised duration format: "${raw}". ` +
      `Accepted: decimal seconds (e.g. "3.5"), HH:MM:SS.mmm, or Nf@fps (e.g. "96f@24").`,
  );
}

// ---------------------------------------------------------------------------
// Batch validation (REQ-BFP-01: hard error on missing duration)
// ---------------------------------------------------------------------------

/** Returns true when a duration field is considered missing/blank. */
function isMissingDuration(d: unknown): boolean {
  return d === null || d === undefined || d === "";
}

/**
 * Validates that all shots have explicit durations when allowAutoduration is false.
 * Throws a hard error listing ALL missing shot IDs (all-or-nothing rejection).
 */
function validateBatchDurations(shots: RawShot[], allowAutoduration: boolean): void {
  if (allowAutoduration) return; // opt-in: missing durations routed to AI engine

  const missing = shots.filter((s) => isMissingDuration(s.duration)).map((s) => s.id);

  if (missing.length > 0) {
    const ids = missing.map((id) => `"${id}"`).join(", ");
    throw new Error(
      `[ERROR] Batch parse failed: shot(s) ${ids} have no explicit duration and ` +
        `allowAutoduration is false. Set duration_seconds for each shot, ` +
        `or add allowAutoduration: true at the batch level to permit ` +
        `AI-assigned durations for shots with missing durations.\n` +
        `Batch rejected. 0 shots rendered.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a batch of raw shots, resolving duration fields and computing frame counts.
 *
 * - Missing/blank duration + allowAutoduration=false → hard error, zero clips.
 * - Missing/blank duration + allowAutoduration=true → durationSource="ai", frameCount=null.
 * - Explicit duration (any supported format) → parsed to seconds, frameCount computed.
 *
 * @param shots - Array of raw shot records from the batch file
 * @param opts  - Parse options (frameRate required; allowAutoduration optional)
 * @returns     Array of resolved ParsedShot records
 */
export function parseBatch(shots: RawShot[], opts: ParseBatchOptions): ParsedShot[] {
  const { frameRate, allowAutoduration = false } = opts;

  // Phase 1: Validate — collect all missing durations before doing any work.
  validateBatchDurations(shots, allowAutoduration);

  // Phase 2: Parse each shot's duration and compute frame count.
  const results: ParsedShot[] = [];

  for (const raw of shots) {
    if (isMissingDuration(raw.duration)) {
      // allowAutoduration=true path — route to AI engine (no frame count yet).
      const aiShot: ParsedShot = {
        id: raw.id,
        durationSeconds: null,
        frameCount: null,
        durationSource: "ai",
        raw,
      };
      if (raw.prompt !== undefined) aiShot.prompt = raw.prompt;
      results.push(aiShot);
    } else {
      // Explicit duration — parse and compute frame count.
      const durationSeconds = parseDurationToSeconds(raw.duration as string | number);
      const frameCount = durationToFrames(durationSeconds, frameRate);
      const explicitShot: ParsedShot = {
        id: raw.id,
        durationSeconds,
        frameCount,
        durationSource: "explicit",
        raw,
      };
      if (raw.prompt !== undefined) explicitShot.prompt = raw.prompt;
      results.push(explicitShot);
    }
  }

  return results;
}
