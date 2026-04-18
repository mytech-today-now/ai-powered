/**
 * @file integrations/web-example/shot-list-parsers.js
 *
 * Pure shot-list parsing functions extracted from app.js for testability.
 * No DOM or browser globals are used; safe to import in Node / Vitest.
 *
 * Exports:
 *   parseJsonFile(text)                    – parse JSON / JSONL text into shot items
 *   parseMdFile(text)                      – parse Markdown text into shot items
 *   _buildItem(entry, globalRefs, existing) – pure helper; builds one shot item
 *
 * Each shot item has the shape:
 *   { name, prompt, modality, duration?, fps?, aspectRatio?, resolution?, quality?, width?, height?, images? }
 */

/**
 * Build a single shot item from a raw entry object.
 *
 * This is a pure function: it does NOT mutate `globalRefs` or `entry`.
 *
 * Reference resolution priority cascade for `images`:
 *   1. Array.isArray(entry.references) → key-list lookup against merged
 *      { ...globalRefs, ...entry._inlineRefs }; unresolved keys are dropped.
 *   2. entry.references is a plain object (not null, not array) →
 *      Object.values() in insertion order used as the image list.
 *   3. Array.isArray(entry.images) → passed through unchanged.
 *   4. None of the above → no `images` key on the returned object.
 *
 * @param {Object} entry      - Raw entry object from parsed JSON/JSONL.
 * @param {Object} globalRefs - Global reference map keyed by string URL alias.
 * @param {number} existing   - Count of items already emitted (used for auto-naming).
 * @returns {Object|null} Built shot item, or null if entry has no usable prompt.
 */
export function _buildItem(entry, globalRefs, existing) {
  const prompt = String(entry.prompt || entry.description || entry.text || "").trim();
  if (!prompt) return null;

  const item = {
    name: String(
      entry.name || entry.shot || entry.title || ("Shot " + (existing + 1))
    ).trim(),
    prompt,
    modality: String(entry.modality || "video"),
    // spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2, §8
    ...(entry.duration !== undefined ? (() => {
      const raw = typeof entry.duration === "object" && entry.duration !== null
        ? (entry.duration.seconds ?? entry.duration)
        : entry.duration;
      const coerced = typeof raw === "number"
        ? (Number.isInteger(raw) ? raw : Math.round(raw))
        : raw;
      if (typeof raw === "number" && !Number.isInteger(raw)) {
        console.warn(
          `[batch-ingest] duration ${raw} is not an integer; ` +
          `rounded to ${coerced}. See filmbuff/docs/specs/batch-shot-list-spec.md §2`,
        );
      }
      return { duration: coerced };
    })() : {}),
    ...(entry.fps         !== undefined ? { fps:         entry.fps         } : {}),
    ...(entry.aspectRatio !== undefined ? { aspectRatio: entry.aspectRatio } : {}),
    ...(entry.resolution  !== undefined ? { resolution:  entry.resolution  } : {}),
    ...(entry.quality     !== undefined ? { quality:     entry.quality     } : {}),
    ...(entry.width       !== undefined ? { width:       entry.width       } : {}),
    ...(entry.height      !== undefined ? { height:      entry.height      } : {}),
  };

  // Reference resolution priority cascade
  if (Array.isArray(entry.references)) {
    // Priority 1: key-list lookup against merged globalRefs + _inlineRefs
    const mergedRefs = { ...globalRefs, ...(entry._inlineRefs || {}) };
    const resolved = entry.references
      .map((key) => mergedRefs[key])
      .filter((url) => url !== undefined && url !== null);
    if (resolved.length > 0) item.images = resolved;
  } else if (
    entry.references !== null &&
    entry.references !== undefined &&
    typeof entry.references === "object"
  ) {
    // Priority 2: plain object → Object.values() in insertion order
    const vals = Object.values(entry.references);
    if (vals.length > 0) item.images = vals;
  } else if (Array.isArray(entry.images)) {
    // Priority 3: images array passed through unchanged; empty array emits no key (P-REF-10)
    if (entry.images.length > 0) item.images = entry.images;
  }
  // Priority 4: none of the above → no images key

  return item;
}

/**
 * Parse a JSON/JSONL file into an array of shot items.
 *
 * Supports:
 *   1. JSON array of objects with at least a `prompt` field
 *   2. JSON object with a `shots` or `items` array
 *   3. Bare JSON object — wrapped in a single-element array
 *   4. NDJSON fallback — one JSON object per line
 *
 * Items missing `modality` default to "video".
 * Items missing `name` are auto-named "Shot N" (1-based).
 *
 * @param {string} text - Raw file contents
 * @returns {{ name: string, prompt: string, modality: string,
 *             duration?: number, fps?: number, aspectRatio?: string,
 *             resolution?: string, quality?: string, width?: number,
 *             height?: number, images?: string[] }[]}
 */
export function parseJsonFile(text) {
  const items = [];
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);

      if (!Array.isArray(parsed)) {
        // (A) JSON object path: read parsed.references (non-array object) as globalRefs
        const globalRefs = (
          parsed.references !== null &&
          parsed.references !== undefined &&
          !Array.isArray(parsed.references) &&
          typeof parsed.references === "object"
        ) ? parsed.references : {};

        // Support shots, items, or bare-object fallback (preserves existing behaviour)
        const arr = parsed.shots || parsed.items || [parsed];
        for (const entry of arr) {
          const item = _buildItem(entry, globalRefs, items.length);
          if (item) items.push(item);
        }
      } else {
        // (B) JSON array path: consume _type:"references" sentinel into globalRefs
        const globalRefs = {};
        for (const entry of parsed) {
          if (
            entry !== null &&
            typeof entry === "object" &&
            entry._type === "references"
          ) {
            // Destructure sentinel: spread all fields except _type into globalRefs
            const { _type, ...rest } = entry; // eslint-disable-line no-unused-vars
            Object.assign(globalRefs, rest);
            continue; // do NOT emit as a shot
          }
          const item = _buildItem(entry, globalRefs, items.length);
          if (item) items.push(item);
        }
      }

      return items;
    } catch (_) { /* fall through to NDJSON */ }
  }

  // NDJSON: one JSON object per line — also handle _type:"references" sentinels
  const globalRefs = {};
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const entry = JSON.parse(l);
      if (
        entry !== null &&
        typeof entry === "object" &&
        entry._type === "references"
      ) {
        const { _type, ...rest } = entry; // eslint-disable-line no-unused-vars
        Object.assign(globalRefs, rest);
        continue; // do NOT emit as a shot
      }
      const item = _buildItem(entry, globalRefs, items.length);
      if (item) items.push(item);
    } catch (_) { /* skip invalid lines */ }
  }
  return items;
}

/** Matches an optional modality tag at the end of a Markdown heading line. */
const MODALITY_TAG_RE = /[\[(](video|image|text|audio)[\])]\s*$/i;

/**
 * Extract the modality from a raw heading string.
 * Returns the matched tag value (lower-cased) or "video" if absent.
 * @param {string} heading
 * @returns {string}
 */
function parseHeadingModality(heading) {
  const m = MODALITY_TAG_RE.exec(heading);
  return m ? m[1].toLowerCase() : "video";
}

/**
 * Parse a Markdown shot-list file into an array of shot items.
 *
 * Convention:
 *   - ATX headings (#, ##, ###, ####) become the `name` of the following shot.
 *     An optional modality tag at the end of the heading line ([video], [image],
 *     [text], [audio] — or using parentheses) sets the shot's `modality`; the tag
 *     is stripped from the stored name.  Untagged headings default to "video".
 *   - Non-heading, non-empty paragraphs become the `prompt` for the current shot.
 *   - Text appearing before the first heading is auto-named "Shot N".
 *
 * Horizontal rules (---) and bold-key metadata lines (**Key:** …) are skipped.
 * Shots with no accumulated prompt text are not emitted.
 *
 * @param {string} text - Raw file contents
 * @returns {{ name: string, prompt: string, modality: string }[]}
 */
export function parseMdFile(text) {
  // NOTE: parseMdFile() does not parse structured metadata from Markdown prose.
  // Per-shot constraint fields (duration, fps, aspectRatio, etc.) are intentionally
  // not supported for Markdown shot lists. Use JSON or JSONL for per-shot constraints.
  const items = [];
  const lines = text.split("\n");
  let currentName     = null;
  let currentModality = "video";
  let promptLines     = [];

  // --- Reference-resolution state (TASK-05) ---
  let inReferencesSection = false; // true while parsing a ## References block
  const globalRefs        = {};    // document-level key → URL map
  let currentRefs         = [];    // per-shot key list from **References:** line

  function flush() {
    if (currentName === null) return;
    const prompt = promptLines.join(" ").replace(/\s+/g, " ").trim();
    if (prompt) {
      const shot = { name: currentName, prompt, modality: currentModality };
      // Resolve currentRefs against globalRefs → images[]; silently drop unknown keys
      if (currentRefs.length) {
        const resolved = currentRefs.map((k) => globalRefs[k]).filter(Boolean);
        if (resolved.length) shot.images = resolved;
      }
      items.push(shot);
    }
    currentModality = "video";
    promptLines     = [];
    currentRefs     = []; // always reset per-shot refs after flush
  }

  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = line.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      const rawHeading  = headingMatch[1].trim();
      const headingText = rawHeading.replace(MODALITY_TAG_RE, "").trim();

      if (headingText.toLowerCase() === "references") {
        // Flush any pending shot, then enter the References section
        flush();
        inReferencesSection = true;
        currentName = null; // Do NOT create a shot for this heading
      } else {
        inReferencesSection = false;
        flush();
        currentModality = parseHeadingModality(rawHeading);
        currentName     = headingText;
      }
    } else if (line) {
      // --- Inside ## References section: collect key → URL bullets ---
      if (inReferencesSection) {
        const m = line.match(/^[-*]\s+([^:]+):\s*(https?:\/\/\S+)/);
        if (m) globalRefs[m[1].trim()] = m[2].trim();
        continue; // never emit reference bullets as prompt text
      }

      // --- Bold **References:** Key1, Key2 metadata on a shot line ---
      const refMatch = line.match(/\*\*References:\*\*\s*(.+)/i);
      if (refMatch) {
        currentRefs = refMatch[1].split(",").map((k) => k.trim());
        continue; // consumed; not added to promptLines
      }

      // Skip horizontal rules and other bold-key metadata lines
      if (/^---+$/.test(line) || /^\*\*[^*]+\*\*:/.test(line)) continue;

      // Auto-assign name for text appearing before the first heading
      if (currentName === null) {
        currentName = "Shot " + (items.length + 1);
      }
      promptLines.push(line);
    }
  }
  flush();

  return items;
}

// ---------------------------------------------------------------------------
// Testable pure helpers (exported so unit tests can import without a DOM)
// ---------------------------------------------------------------------------

/**
 * Last-line-of-defense guard: return a new array of shot items with every
 * `duration` field coerced to an integer via Math.round().
 *
 * Does NOT mutate the source array or its items (spec: xai-submit-guard §2,
 * design.md D7).
 *
 * @param {Object[]} items - Parsed shot items (output of parseJsonFile / parseMdFile).
 * @returns {Object[]} New array; items without a duration key pass through unchanged.
 */
export function toSafeItems(items) {
  return items.map((item) => ({
    ...item,
    ...(item.duration !== undefined
      ? { duration: Math.round(item.duration) } // spec: batch-shot-list-spec.md v1.0.0 §2
      : {}),
  }));
}

/** @type {RegExp} Accepts positive integers only (no floats, no leading zeros, no zero) */
const DURATION_PATTERN = /^[1-9][0-9]*$/;

/**
 * Validate a Duration (s) input string.
 *
 * Rules (spec: duration-ui-validation/spec.md):
 *   - Must match DURATION_PATTERN (positive integer; rejects floats, negatives, zero, empty).
 *   - Must be in the range [3, 60] (spec: batch-shot-list-spec.md v1.0.0 §2).
 *
 * @param {string} value - Raw input string from the batch-duration <input>.
 * @returns {string|null} Error message if invalid; null if valid.
 */
export function validateDuration(value) {
  const trimmed = (value || "").trim();
  if (!DURATION_PATTERN.test(trimmed)) {
    return "Duration must be a whole number (e.g., 5)";
  }
  const n = parseInt(trimmed, 10);
  if (n < 3 || n > 60) {
    return "Duration must be between 3 and 60 seconds";
  }
  return null; // valid
}
