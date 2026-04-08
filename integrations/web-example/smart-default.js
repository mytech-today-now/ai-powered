/**
 * @file integrations/web-example/smart-default.js
 *
 * ESM-compatible client-side copy of the smart-default routing logic.
 *
 * This file MUST remain a pure, dependency-free ES module so that it can be
 * imported directly by the browser without a build step.  It mirrors the
 * logic in src/ai-powered/server/smart-default.ts exactly (design D4 / REQ-SD-07).
 *
 * DO NOT add Node.js built-ins, pino, or any server-side imports here.
 * If the server-side logic changes, update this file to match.
 */

// ---------------------------------------------------------------------------
// Provider capability table — fixed priority order (REQ-SD-04)
// ---------------------------------------------------------------------------

/** @type {ReadonlyArray<{id: string, max: number}>} */
const PRIORITY = [
  { id: "lumaai", max: 2 },
  { id: "xai",    max: 1 },
  { id: "venice", max: 1 },
];

// ---------------------------------------------------------------------------
// selectI2VProvider — REQ-SD-02, REQ-SD-03
// ---------------------------------------------------------------------------

/**
 * Selects the best I2V provider for the given image count.
 *
 * Pure function: no side effects, no mutation of arguments, no network calls.
 *
 * @param {string}   requestedProvider  Provider ID originally requested.
 * @param {number}   imageCount         Number of images in the batch shot.
 * @param {string[]} liveProviders      Provider IDs currently registered and active.
 * @returns {{
 *   provider: string,
 *   effectiveImageCount: number,
 *   truncated: boolean,
 *   warning?: string,
 *   alternativeProviders?: string[]
 * }}
 */
export function selectI2VProvider(requestedProvider, imageCount, liveProviders) {
  // N=0 → no change (REQ-SD-03 row 1)
  if (imageCount === 0) {
    return { provider: requestedProvider, effectiveImageCount: 0, truncated: false };
  }

  // Requested provider can handle the image count without routing
  const requested = PRIORITY.find(p => p.id === requestedProvider);
  if (requested && requested.max >= imageCount && imageCount <= 2) {
    return { provider: requestedProvider, effectiveImageCount: imageCount, truncated: false };
  }

  // Cap at 2 (Luma max); find the best live candidate at that capacity
  const effective = Math.min(imageCount, 2);
  const candidates = PRIORITY.filter(
    p => liveProviders.includes(p.id) && p.max >= effective,
  );
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

  const alts = candidates.slice(1).map(p => p.id);
  const routed = chosen.id !== requestedProvider;
  const truncated_ = imageCount > effective;

  let warning;
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

