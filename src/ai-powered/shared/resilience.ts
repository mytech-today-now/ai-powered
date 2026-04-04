/**
 * @file src/ai-powered/shared/resilience.ts
 *
 * Browser-safe resilience primitives: Full Jitter exponential backoff,
 * HTTP-status-aware retry wrapper for fetch, and a three-state circuit breaker.
 *
 * NO node: imports — safe for both Node bundles and the browser UMD bundle.
 * Uses only Web Standard APIs: setTimeout, clearTimeout, Promise, Math.
 */

// ---------------------------------------------------------------------------
// RetryOptions
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the first try). Default: 3. */
  maxRetries?: number;
  /** Base delay in ms for Full Jitter backoff. Default: 500. */
  backoffBase?: number;
  /** Maximum delay cap in ms for Full Jitter backoff. Default: 8000. */
  backoffCap?: number;
  /**
   * Predicate that returns true when a response status should trigger a retry.
   * Default: `(s) => s === 429 || s === 503`.
   */
  retryOn?: (status: number) => boolean;
}

// ---------------------------------------------------------------------------
// jitterDelay
// ---------------------------------------------------------------------------

/**
 * Full Jitter exponential backoff (AWS recommendation).
 *   delay = random(0, min(cap, base × 2^attempt))
 *
 * @param attempt  0-based attempt number.
 * @param base     Base delay in ms. Default: 500.
 * @param cap      Maximum delay cap in ms. Default: 8000.
 * @returns        Non-negative number ≤ cap.
 */
export function jitterDelay(attempt: number, base = 500, cap = 8000): number {
  return Math.random() * Math.min(cap, base * Math.pow(2, attempt));
}

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

/**
 * Resolves after `ms` milliseconds. Browser-safe (setTimeout only).
 * Does NOT accept an AbortSignal — use the internal helper in withRetryFetch
 * for cancellable delays.
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// withRetryFetch
// ---------------------------------------------------------------------------

/**
 * Wraps a fetch-returning thunk with Full Jitter retry logic.
 *
 * Retries on 429 / 503 (or custom `retryOn` predicate) up to `maxRetries`
 * additional times. Propagates AbortSignal — aborting immediately stops
 * all retry attempts without scheduling the next delay.
 *
 * @param fn      Thunk that returns a `Promise<Response>`.
 * @param opts    Retry configuration.
 * @param signal  Optional AbortSignal to cancel retries immediately.
 * @returns       The first non-retryable Response, or the last Response when
 *                retries are exhausted.
 * @throws        The last network error if all attempts throw, or AbortError
 *                if the signal fires before or during a delay.
 */
export async function withRetryFetch(
  fn: () => Promise<Response>,
  opts: RetryOptions = {},
  signal?: AbortSignal,
): Promise<Response> {
  const {
    maxRetries = 3,
    backoffBase = 500,
    backoffCap = 8000,
    retryOn = (s) => s === 429 || s === 503,
  } = opts;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Bail immediately if caller already aborted.
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

    try {
      const res = await fn();
      // If the status is not retryable, or this is the last attempt, return as-is.
      if (!retryOn(res.status) || attempt === maxRetries) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) throw err;
      // Re-throw abort errors immediately without retry.
      if (signal?.aborted) throw signal.reason ?? err;
    }

    // Cancellable jitter delay before next attempt.
    const delay = jitterDelay(attempt, backoffBase, backoffCap);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(signal.reason ?? new Error("Aborted"));
        },
        { once: true },
      );
    });
  }

  throw lastErr;
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

/** Possible states of a circuit breaker. */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Three-state circuit breaker (Closed → Open → Half-Open → Closed).
 *
 * - **CLOSED** — normal operation; consecutive failures are counted.
 * - **OPEN**   — fast-fail; all calls throw immediately without invoking `fn`.
 * - **HALF_OPEN** — one probe request is allowed after resetTimeoutMs elapses;
 *   closes on success, re-opens on failure.
 *
 * Instance-scoped — each WebAiClient creates its own breaker.
 */
export class CircuitBreaker {
  private _state: CircuitState = "CLOSED";
  private _failures = 0;
  private _openedAt: number | null = null;
  private readonly _threshold: number;
  private readonly _resetMs: number;

  constructor(opts?: { failureThreshold?: number; resetTimeoutMs?: number }) {
    this._threshold = opts?.failureThreshold ?? 5;
    this._resetMs = opts?.resetTimeoutMs ?? 60_000;
  }

  /** Current circuit state. */
  get state(): CircuitState {
    return this._state;
  }

  /** Consecutive failure count (resets on success or HALF_OPEN → CLOSED transition). */
  get failures(): number {
    return this._failures;
  }

  /**
   * Executes `fn` through the circuit breaker.
   *
   * @throws Error  When the circuit is OPEN and the reset timeout has not elapsed.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this._state === "OPEN") {
      const elapsed = Date.now() - (this._openedAt ?? 0);
      if (elapsed >= this._resetMs) {
        this._state = "HALF_OPEN";
      } else {
        const remaining = Math.ceil((this._resetMs - elapsed) / 1000);
        throw new Error(
          `CircuitBreaker: circuit is OPEN — resets in ~${remaining}s`,
        );
      }
    }

    try {
      const result = await fn();
      if (this._state === "HALF_OPEN") {
        this._state = "CLOSED";
        this._failures = 0;
        this._openedAt = null;
      } else {
        // Reset consecutive failure counter on any success while CLOSED.
        this._failures = 0;
      }
      return result;
    } catch (err) {
      this._failures++;
      if (this._state === "HALF_OPEN" || this._failures >= this._threshold) {
        this._state = "OPEN";
        this._openedAt = Date.now();
      }
      throw err;
    }
  }
}

