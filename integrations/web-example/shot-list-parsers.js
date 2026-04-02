/**
 * @file integrations/web-example/shot-list-parsers.js
 *
 * Pure shot-list parsing functions extracted from app.js for testability.
 * No DOM or browser globals are used; safe to import in Node / Vitest.
 *
 * Exports:
 *   parseJsonFile(text) – parse JSON / JSONL text into shot items
 *   parseMdFile(text)   – parse Markdown text into shot items
 *
 * Each shot item has the shape:
 *   { name, prompt, modality, duration?, fps?, aspectRatio?, resolution?, quality?, width?, height? }
 */

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
 *             resolution?: string, quality?: string, width?: number, height?: number }[]}
 */
export function parseJsonFile(text) {
  const items = [];
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed.shots || parsed.items || [parsed]);
      for (const entry of arr) {
        const prompt = String(entry.prompt || entry.description || entry.text || "").trim();
        if (prompt) {
          items.push({
            name: String(
              entry.name || entry.shot || entry.title || ("Shot " + (items.length + 1))
            ).trim(),
            prompt,
            modality: String(entry.modality || "video"),
            ...(entry.duration    !== undefined ? { duration:    entry.duration    } : {}),
            ...(entry.fps         !== undefined ? { fps:         entry.fps         } : {}),
            ...(entry.aspectRatio !== undefined ? { aspectRatio: entry.aspectRatio } : {}),
            ...(entry.resolution  !== undefined ? { resolution:  entry.resolution  } : {}),
            ...(entry.quality     !== undefined ? { quality:     entry.quality     } : {}),
            ...(entry.width       !== undefined ? { width:       entry.width       } : {}),
            ...(entry.height      !== undefined ? { height:      entry.height      } : {}),
          });
        }
      }
      return items;
    } catch (_) { /* fall through to NDJSON */ }
  }

  // NDJSON: one JSON object per line
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const entry = JSON.parse(l);
      const prompt = String(entry.prompt || entry.description || entry.text || "").trim();
      if (prompt) {
        items.push({
          name: String(entry.name || entry.shot || ("Shot " + (items.length + 1))).trim(),
          prompt,
          modality: String(entry.modality || "video"),
          ...(entry.duration    !== undefined ? { duration:    entry.duration    } : {}),
          ...(entry.fps         !== undefined ? { fps:         entry.fps         } : {}),
          ...(entry.aspectRatio !== undefined ? { aspectRatio: entry.aspectRatio } : {}),
          ...(entry.resolution  !== undefined ? { resolution:  entry.resolution  } : {}),
          ...(entry.quality     !== undefined ? { quality:     entry.quality     } : {}),
          ...(entry.width       !== undefined ? { width:       entry.width       } : {}),
          ...(entry.height      !== undefined ? { height:      entry.height      } : {}),
        });
      }
    } catch (_) { /* skip invalid lines */ }
  }
  return items;
}

/**
 * Parse a Markdown shot-list file into an array of shot items.
 *
 * Convention:
 *   - ATX headings (#, ##, ###, ####) become the `name` of the following shot.
 *   - Non-heading, non-empty paragraphs become the `prompt` for the current shot.
 *   - Text appearing before the first heading is auto-named "Shot N".
 *   - `modality` defaults to "video" for all Markdown items.
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
  let currentName = null;
  let promptLines = [];

  function flush() {
    if (currentName === null) return;
    const prompt = promptLines.join(" ").replace(/\s+/g, " ").trim();
    if (prompt) items.push({ name: currentName, prompt, modality: "video" });
    promptLines = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = line.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      flush();
      currentName = headingMatch[1].trim();
    } else if (line) {
      // Skip horizontal rules and bold-key metadata lines
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

