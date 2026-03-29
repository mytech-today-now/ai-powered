/**
 * @file src/ai-powered/plugins/rate-limiter.ts
 *
 * Built-in rate-limiter plugin — client-side token-bucket algorithm.
 *
 * Smooths burst traffic so the provider never receives more than
 * `maxRequestsPerMinute` calls per 60-second window.  When the bucket is
 * empty the plugin *pauses* the request (via a Promise delay) until a token
 * refills; it NEVER rejects requests.
 *
 * Activate via config:  plugins: ['rate-limiter']
 * Default limit:        60 requests / minute
 */

import type { AiPlugin, RequestContext, ResponseContext } from "../types.js";
import { getLogger } from "../utils.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  /** Maximum requests per minute (token-bucket capacity). Default: 60. */
  maxRequestsPerMinute?: number;
}

// ---------------------------------------------------------------------------
// Token-bucket helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * Used to pause a request until the next token is available.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a rate-limiter plugin instance.
 *
 * Token-bucket mechanics:
 *  - Capacity = maxRequestsPerMinute tokens.
 *  - Tokens refill at a rate of (capacity / 60_000) tokens per millisecond.
 *  - Each `onRequest` consumes exactly 1 token.
 *  - When the bucket is empty the hook waits until one token is available.
 *
 * @param opts  Optional configuration overrides.
 */
export function createRateLimiterPlugin(opts: RateLimiterOptions = {}): AiPlugin {
  const capacity = opts.maxRequestsPerMinute ?? 60;
  if (capacity <= 0) throw new RangeError("maxRequestsPerMinute must be a positive number.");

  // Refill interval: ms per token.
  const msPerToken = 60_000 / capacity;

  // Token-bucket state (shared across all calls via closure).
  let tokens = capacity;
  let lastRefill = Date.now();

  /** Refills tokens based on elapsed time since the last call. */
  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefill;
    const newTokens = elapsed / msPerToken;
    tokens = Math.min(capacity, tokens + newTokens);
    lastRefill = now;
  }

  return {
    name: "rate-limiter",
    version: "1.0.0",
    description: `Client-side token-bucket rate limiter (max ${capacity} req/min).`,

    async onRequest(ctx: RequestContext): Promise<RequestContext> {
      refill();

      if (tokens >= 1) {
        tokens -= 1;
        return ctx;
      }

      // Bucket empty — calculate wait time and pause.
      const waitMs = Math.ceil((1 - tokens) * msPerToken);
      getLogger().debug(
        { plugin: "rate-limiter", waitMs, remainingTokens: tokens.toFixed(3) },
        "Rate limit reached; delaying request",
      );
      await delay(waitMs);

      // Refill after the wait and consume one token.
      refill();
      tokens = Math.max(0, tokens - 1);

      return ctx;
    },

    async onResponse(ctx: ResponseContext): Promise<ResponseContext> {
      // No-op: rate limiting is only applied on the request side.
      return ctx;
    },
  };
}

