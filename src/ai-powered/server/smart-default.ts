/**
 * @file src/ai-powered/server/smart-default.ts
 *
 * Pure-function module for image-to-video provider smart-default routing.
 *
 * Selects the most capable available provider for a given image count,
 * routing to the best alternative when the requested provider cannot handle
 * the number of supplied images.
 *
 * Design decision D4: This module MUST remain free of server imports, pino,
 * and env reads so that an identical ESM-compatible copy can be published as
 * integrations/web-example/smart-default.js for client-side pre-flight use.
 *
 * AC-10, AC-11, AC-12 — spec: specs/smart-default-routing/spec.md REQ-SD-01 through REQ-SD-04
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result returned by `selectI2VProvider()` describing the routing decision.
 * REQ-SD-01
 */
export interface SmartDefaultResult {
  /** Chosen provider name (may differ from `requestedProvider` after routing). */
  provider: string;
  /** Number of images that will actually be used in the generation request. */
  effectiveImageCount: number;
  /** True when images were reduced from the requested count. */
  truncated: boolean;
  /** Human-readable warning when routing or truncation occurred. */
  warning?: string;
  /** Other providers in `liveProviders` that could also handle this image count. */
  alternativeProviders?: string[];
}

// ---------------------------------------------------------------------------
// Provider capability table — REQ-SD-04 (fixed priority order)
// ---------------------------------------------------------------------------

/** Static priority-ordered capability table.  Hard-coded per design D4. */
const PRIORITY: ReadonlyArray<{ readonly id: string; readonly max: number }> = [
  { id: "lumaai", max: 2 },
  { id: "xai", max: 1 },
  { id: "venice", max: 1 },
];

// ---------------------------------------------------------------------------
// selectI2VProvider — REQ-SD-02, REQ-SD-03
// ---------------------------------------------------------------------------

/**
 * Selects the best I2V provider for the given image count.
 *
 * Pure function: no side effects, no mutation of arguments, no network calls.
 * Decision logic follows REQ-SD-03 exactly.
 *
 * @param requestedProvider  Provider ID originally requested by the caller.
 * @param imageCount         Number of images in the batch shot.
 * @param liveProviders      Provider IDs currently registered and active.
 * @returns SmartDefaultResult describing the routing decision.
 */
export function selectI2VProvider(
  requestedProvider: string,
  imageCount: number,
  liveProviders: string[],
): SmartDefaultResult {
  // N=0 → no change (REQ-SD-03 row 1)
  if (imageCount === 0) {
    return { provider: requestedProvider, effectiveImageCount: 0, truncated: false };
  }

  // Requested provider can handle the image count without routing
  const requested = PRIORITY.find((p) => p.id === requestedProvider);
  if (requested && requested.max >= imageCount && imageCount <= 2) {
    return { provider: requestedProvider, effectiveImageCount: imageCount, truncated: false };
  }

  // Cap at 2 (Luma max); find the best live candidate at that capacity
  const effective = Math.min(imageCount, 2);
  const candidates = PRIORITY.filter((p) => liveProviders.includes(p.id) && p.max >= effective);
  const chosen = candidates[0];

  // No live provider can handle even 1 image at required count
  if (!chosen) {
    return {
      provider: requestedProvider,
      effectiveImageCount: 1,
      truncated: true,
      warning: `No live provider supports ${imageCount} images; using 1 frame with ${requestedProvider}`,
    };
  }

  const alts = candidates.slice(1).map((p) => p.id);
  const routed = chosen.id !== requestedProvider;
  const truncated_ = imageCount > effective;

  let warning: string | undefined;
  if (routed) {
    warning = `Routed from ${requestedProvider} to ${chosen.id}: image count ${imageCount} exceeds provider max`;
  } else if (truncated_) {
    warning = `Images truncated from ${imageCount} to ${effective}`;
  }

  return {
    provider: chosen.id,
    effectiveImageCount: effective,
    truncated: truncated_,
    ...(warning !== undefined ? { warning } : {}),
    ...(alts.length > 0 ? { alternativeProviders: alts } : {}),
  };
}
