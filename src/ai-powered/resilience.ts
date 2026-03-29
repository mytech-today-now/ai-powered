/**
 * @file src/ai-powered/resilience.ts
 *
 * Exponential-backoff retry wrapper (bd-6sd0).
 *
 * `withRetry` wraps any async function and re-invokes it when it throws a
 * retryable error, using a full-jitter exponential backoff schedule:
 *
 *   delay = random(0, min(cap, base × 2^attempt))
 *
 * This is the "Full Jitter" algorithm from the AWS blog post
 * "Exponential Backoff and Jitter" (2015) which minimises thundering-herd
 * collisions under load.
 *
 * A `ProviderError` with `retryable === true` is always retried.
 * Any other error is NOT retried (re-thrown immediately).
 *
 * The caller may also supply a custom `isRetryable` predicate to handle
 * non-ProviderError cases (e.g. network errors from fetch).
 *
 * Usage:
 *   const result = await withRetry(() => provider.generateText(prompt), {
 *     maxAttempts: 4,
 *     baseDelayMs:  250,
 *     capDelayMs:   8_000,
 *     signal,
 *   });
 */

import { ProviderError, CircuitOpenError } from "./types.js";
import { getLogger } from "./utils.js";

// ---------------------------------------------------------------------------
// RetryOptions
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /**
   * Maximum number of attempts (including the first try).
   * Default: 3.
   */
  maxAttempts?: number;

  /**
   * Base delay in ms before the first retry.
   * Default: 500 ms.
   */
  baseDelayMs?: number;

  /**
   * Maximum delay cap in ms (prevents unbounded back-off).
   * Default: 16 000 ms (16 s).
   */
  capDelayMs?: number;

  /**
   * Optional AbortSignal.  When aborted, the next delay is skipped and the
   * last error is re-thrown immediately.
   */
  signal?: AbortSignal;

  /**
   * Optional custom predicate for errors that are not `ProviderError`.
   * Return `true` to retry, `false` to re-throw immediately.
   * Defaults to `false` (unknown errors are not retried).
   */
  isRetryable?: (err: unknown) => boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Full-jitter exponential back-off delay (ms). */
function jitteredDelay(attempt: number, baseMs: number, capMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped      = Math.min(capMs, exponential);
  return Math.floor(Math.random() * capped);
}

/** Resolves after `ms` milliseconds, or rejects if the signal fires first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    }, { once: true });
  });
}

/** Returns true if the error should trigger a retry. */
function shouldRetry(err: unknown, isRetryable?: (e: unknown) => boolean): boolean {
  if (err instanceof ProviderError) return err.retryable === true;
  if (isRetryable) return isRetryable(err);
  return false;
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

/** Possible states of a circuit breaker. */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Per-provider circuit breaker implementing the classic three-state machine:
 *
 *   CLOSED   — normal operation; failures are counted.
 *   OPEN     — fast-failing; all calls throw `CircuitOpenError`.
 *   HALF_OPEN — one probe request allowed; closes on success, re-opens on failure.
 *
 * After `threshold` consecutive failures the circuit opens.  After `resetMs`
 * milliseconds it transitions to HALF_OPEN and allows a single probe.
 */
export class CircuitBreaker {
  private _state: CircuitState = "CLOSED";
  private _failures = 0;
  private _openedAt: number | null = null;

  constructor(
    private readonly _providerName: string,
    private readonly _threshold: number = 5,
    private readonly _resetMs: number = 60_000,
  ) {}

  /** Current circuit state. */
  get state(): CircuitState { return this._state; }

  /** Consecutive failure count (resets on success or circuit close). */
  get failures(): number { return this._failures; }

  /**
   * Executes `fn` through the circuit breaker.
   *
   * - When OPEN: checks if the reset interval has elapsed; if so, transitions
   *   to HALF_OPEN before attempting the call.  If still within the interval,
   *   throws `CircuitOpenError` immediately.
   * - When HALF_OPEN: allows one probe; closes on success, re-opens on failure.
   * - When CLOSED: counts consecutive failures; opens after `threshold` failures.
   *
   * @throws CircuitOpenError  when the circuit is open and the reset interval has not elapsed.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    const log = getLogger();

    if (this._state === "OPEN") {
      const elapsed = Date.now() - (this._openedAt ?? 0);
      if (elapsed >= this._resetMs) {
        this._state = "HALF_OPEN";
        log.info({ provider: this._providerName }, "CircuitBreaker: transitioning to HALF_OPEN for probe");
      } else {
        const recoveryMs = this._resetMs - elapsed;
        throw new CircuitOpenError(this._providerName, new Date(Date.now() + recoveryMs));
      }
    }

    try {
      const result = await fn();
      // Success path.
      if (this._state === "HALF_OPEN") {
        this._state = "CLOSED";
        this._failures = 0;
        this._openedAt = null;
        log.info({ provider: this._providerName }, "CircuitBreaker: CLOSED after successful probe");
      } else {
        // Reset consecutive failure counter on any success while closed.
        this._failures = 0;
      }
      return result;
    } catch (err) {
      this._failures++;
      if (this._state === "HALF_OPEN" || this._failures >= this._threshold) {
        this._state = "OPEN";
        this._openedAt = Date.now();
        log.warn(
          { provider: this._providerName, failures: this._failures, threshold: this._threshold },
          "CircuitBreaker: OPEN after consecutive failures",
        );
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

/**
 * Executes `fn` up to `maxAttempts` times, retrying on retryable errors with
 * full-jitter exponential back-off.
 *
 * @param fn           Async function to execute (called with the current attempt number, 0-based).
 * @param options      Retry configuration.
 * @returns            Resolves with the result of the first successful call.
 * @throws             The last error if all attempts are exhausted, or immediately
 *                     if a non-retryable error is thrown.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts  = 3,
    baseDelayMs  = 500,
    capDelayMs   = 16_000,
    signal,
    isRetryable,
  } = options;

  const logger = getLogger();
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;

      const retryable = shouldRetry(err, isRetryable);
      const hasMoreAttempts = attempt + 1 < maxAttempts;

      if (!retryable || !hasMoreAttempts) {
        throw err;
      }

      const delayMs = jitteredDelay(attempt, baseDelayMs, capDelayMs);
      logger.warn(
        {
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        },
        "withRetry: retryable error — backing off",
      );

      await sleep(delayMs, signal);
    }
  }

  // Unreachable, but satisfies TypeScript's control-flow analysis.
  throw lastErr;
}

