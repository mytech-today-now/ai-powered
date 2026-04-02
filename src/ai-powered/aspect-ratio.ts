/**
 * @file src/ai-powered/aspect-ratio.ts
 *
 * AspectRatioService — utilities for parsing, validating, and computing
 * image/video dimensions from aspect ratio strings.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RatioPair {
  widthRatio: number;
  heightRatio: number;
  label: string;
}

export interface Dimensions {
  width: number;
  height: number;
}

/** Preset categories → named ratios → canonical width/height pair + label. */
export type AspectRatioPresets = Record<string, Record<string, RatioPair>>;

// ---------------------------------------------------------------------------
// Preset library
// ---------------------------------------------------------------------------

export const ASPECT_RATIO_PRESETS: AspectRatioPresets = {
  mobile: {
    Portrait: { widthRatio: 9, heightRatio: 16, label: "Portrait (9:16)" },
    Square: { widthRatio: 1, heightRatio: 1, label: "Square (1:1)" },
    Stories: { widthRatio: 9, heightRatio: 19.5, label: "Stories (9:19.5)" },
  },
  desktop: {
    Widescreen: { widthRatio: 16, heightRatio: 9, label: "Widescreen (16:9)" },
    Standard: { widthRatio: 4, heightRatio: 3, label: "Standard (4:3)" },
    UltraWide: { widthRatio: 21, heightRatio: 9, label: "Ultra-Wide (21:9)" },
    Square: { widthRatio: 1, heightRatio: 1, label: "Square (1:1)" },
  },
  television: {
    HDTV: { widthRatio: 16, heightRatio: 9, label: "HDTV (16:9)" },
    SD: { widthRatio: 4, heightRatio: 3, label: "SD (4:3)" },
    WideTV: { widthRatio: 14, heightRatio: 9, label: "Wide TV (14:9)" },
  },
  cinema: {
    CinemaScope: { widthRatio: 2.35, heightRatio: 1, label: "CinemaScope (2.35:1)" },
    Academy: { widthRatio: 1.85, heightRatio: 1, label: "Academy Flat (1.85:1)" },
    IMAX: { widthRatio: 1.43, heightRatio: 1, label: "IMAX (1.43:1)" },
    Classic: { widthRatio: 4, heightRatio: 3, label: "Classic (4:3)" },
  },
  photo: {
    Landscape: { widthRatio: 3, heightRatio: 2, label: "Landscape (3:2)" },
    Portrait: { widthRatio: 2, heightRatio: 3, label: "Portrait (2:3)" },
    Square: { widthRatio: 1, heightRatio: 1, label: "Square (1:1)" },
    MediumFormat: { widthRatio: 4, heightRatio: 3, label: "Medium Format (4:3)" },
  },
  square: {
    Square: { widthRatio: 1, heightRatio: 1, label: "Square (1:1)" },
  },
  document: {
    Letter: { widthRatio: 8.5, heightRatio: 11, label: "Letter (8.5:11)" },
    A4: { widthRatio: 1, heightRatio: 1.414, label: "A4 (1:1.414)" },
    Legal: { widthRatio: 8.5, heightRatio: 14, label: "Legal (8.5:14)" },
  },
};

// ---------------------------------------------------------------------------
// AspectRatioService
// ---------------------------------------------------------------------------

export const AspectRatioService = {
  /**
   * Parse a ratio string into `{ widthRatio, heightRatio }`.
   *
   * Accepts colon format (`"16:9"`, `"9:19.5"`) or decimal format (`"1.777"`).
   *
   * @throws {RangeError} for non-numeric, zero, negative, or extreme (>20:1) input.
   */
  parse(input: string): { widthRatio: number; heightRatio: number } {
    let widthRatio: number;
    let heightRatio: number;

    if (input.includes(":")) {
      const parts = input.split(":");
      if (parts.length !== 2) {
        throw new RangeError(`Invalid ratio format: "${input}"`);
      }
      widthRatio = parseFloat(parts[0]!);
      heightRatio = parseFloat(parts[1]!);
      if (isNaN(widthRatio) || isNaN(heightRatio)) {
        throw new RangeError(`Invalid ratio format: "${input}" — values must be numeric`);
      }
    } else {
      const val = parseFloat(input);
      if (isNaN(val)) {
        throw new RangeError(`Invalid ratio format: "${input}" — not a valid number`);
      }
      widthRatio = val;
      heightRatio = 1;
    }

    if (widthRatio === 0 || heightRatio === 0) {
      throw new RangeError(`Invalid ratio: division by zero in "${input}"`);
    }
    if (widthRatio < 0 || heightRatio < 0) {
      throw new RangeError(`Invalid ratio: values must be positive in "${input}"`);
    }
    const ratio = widthRatio / heightRatio;
    if (ratio > 20 || ratio < 1 / 20) {
      throw new RangeError(
        `Invalid ratio: extreme ratio ${ratio.toFixed(2)}:1 in "${input}" — max 20:1`,
      );
    }

    return { widthRatio, heightRatio };
  },

  /**
   * Validate raw pixel dimensions directly.
   *
   * @throws {RangeError} if either dimension is zero/negative or ratio is extreme (>20:1).
   */
  validate(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new RangeError(`Dimensions must be positive — got ${width}×${height}`);
    }
    const ratio = width / height;
    if (ratio > 20 || ratio < 1 / 20) {
      throw new RangeError(`extreme aspect ratio ${ratio.toFixed(2)}:1 — max 20:1`);
    }
  },

  /**
   * Compute `{ width, height }` integers from a parsed ratio and a base width in pixels.
   *
   * The base is applied to the width; height is derived by scaling.
   */
  calculate(ratio: { widthRatio: number; heightRatio: number }, basePx: number): Dimensions {
    const width = basePx;
    const height = Math.round(basePx * (ratio.heightRatio / ratio.widthRatio));
    return { width, height };
  },

  /**
   * Return the `{ width, height }` pair from `validList` with the smallest
   * Euclidean distance to the desired `{ width, height }`.
   *
   * @throws {RangeError} if `validList` is empty.
   */
  nearest(
    width: number,
    height: number,
    validList: Array<{ width: number; height: number }>,
  ): Dimensions {
    if (validList.length === 0) {
      throw new RangeError("validList must not be empty");
    }
    let best = validList[0]!;
    let bestDist = Infinity;
    for (const candidate of validList) {
      const dw = candidate.width - width;
      const dh = candidate.height - height;
      const dist = Math.sqrt(dw * dw + dh * dh);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return { width: best.width, height: best.height };
  },

  /** Return all presets in the given category, or `[]` if unknown. */
  getPresetsByCategory(category: string): RatioPair[] {
    const cat = ASPECT_RATIO_PRESETS[category];
    if (!cat) return [];
    return Object.values(cat);
  },

  /** Look up a single named preset. Returns `undefined` if not found. */
  getPreset(category: string, name: string): RatioPair | undefined {
    return ASPECT_RATIO_PRESETS[category]?.[name];
  },
};
