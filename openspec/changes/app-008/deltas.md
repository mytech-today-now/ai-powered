# Delta Spec — App-008

## Add circuit-breaker and exponential-backoff retry to `WebAiClient`

---

### Delta 1 — Create `src/ai-powered/shared/resilience.ts` (new file)

**File:** `src/ai-powered/shared/resilience.ts` (does not exist yet)

**Before:** File does not exist.

**After:**
```ts
/**
 * @file src/ai-powered/shared/resilience.ts
 *
 * Browser-safe resilience primitives: Full Jitter exponential backoff,
 * HTTP-status-aware retry wrapper for fetch, and a three-state circuit breaker.
 *
 * NO node: imports — safe for both Node bundles and the browser UMD bundle.
 */

export interface RetryOptions {
  maxRetries?: number;   // default 3
  backoffBase?: number;  // ms, default 500
  backoffCap?: number;   // ms, default 8000
  retryOn?: (status: number) => boolean;  // default: 429 | 503
}

/** Full Jitter exponential backoff (AWS recommendation). */
export function jitterDelay(attempt: number, base = 500, cap = 8000): number {
  return Math.random() * Math.min(cap, base * Math.pow(2, attempt));
}

/** Resolves after `ms` milliseconds. Browser-safe (setTimeout only). */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps a fetch-returning thunk with retry logic.
 * Retries on 429 / 503 (or custom retryOn predicate) up to maxRetries times.
 * Propagates AbortSignal — aborting immediately stops all retry attempts.
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
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    try {
      const res = await fn();
      if (!retryOn(res.status) || attempt === maxRetries) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) throw err;
    }
    const delay = jitterDelay(attempt, backoffBase, backoffCap);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("Aborted"));
      }, { once: true });
    });
  }
  throw lastErr;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Three-state circuit breaker (Closed → Open → Half-Open).
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
    this._resetMs   = opts?.resetTimeoutMs  ?? 60_000;
  }

  get state(): CircuitState { return this._state; }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this._state === "OPEN") {
      const elapsed = Date.now() - (this._openedAt ?? 0);
      if (elapsed >= this._resetMs) {
        this._state = "HALF_OPEN";
      } else {
        throw new Error(`CircuitBreaker: circuit is OPEN (resets in ${this._resetMs - elapsed} ms)`);
      }
    }
    try {
      const result = await fn();
      if (this._state === "HALF_OPEN") {
        this._state = "CLOSED";
        this._failures = 0;
        this._openedAt = null;
      } else {
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
```

**Rationale:** Extracted from `src/ai-powered/resilience.ts` with all
`node:` imports removed. Uses only `setTimeout` and `Promise` — universal
browser/Node APIs.

---

### Delta 2 — Update `src/ai-powered/web/fetch-client.ts`

**File:** `src/ai-powered/web/fetch-client.ts`

**Before (WebClientOptions union, no resilience fields):**
```ts
export type WebClientOptions = WebProxyOptions | WebDirectOptions;
```

**After (add resilience sub-options):**
```ts
/** Resilience options applicable to all WebAiClient modes. */
export interface WebResilienceOptions {
  /** Maximum number of retry attempts on 429/503. Default: 3. */
  maxRetries?: number;
  /** Base delay (ms) for Full Jitter backoff. Default: 500. */
  backoffBase?: number;
  /** Maximum delay cap (ms) for Full Jitter backoff. Default: 8000. */
  backoffCap?: number;
}

export type WebClientOptions = (WebProxyOptions | WebDirectOptions) & WebResilienceOptions;
```

**Before (WebAiClient constructor):**
```ts
constructor(opts: WebClientOptions) {
  this.opts = opts;
  if (opts.mode === "direct") { … }
}
```

**After (add circuit breaker instance):**
```ts
private readonly _breaker: CircuitBreaker;

constructor(opts: WebClientOptions) {
  this.opts = opts;
  this._breaker = new CircuitBreaker();
  if (opts.mode === "direct") { … }
}
```

**Before (example raw fetch in generateText proxy branch):**
```ts
const res = await fetch(`${this.proxyBase}/text`, { … });
```

**After (wrapped with retry + circuit breaker):**
```ts
const res = await this._breaker.call(() =>
  withRetryFetch(
    () => fetch(`${this.proxyBase}/text`, { … }),
    { maxRetries: this.opts.maxRetries, backoffBase: this.opts.backoffBase, backoffCap: this.opts.backoffCap },
    options?.signal,
  )
);
```

All outbound `fetch` calls in `generateText`, `streamText`, `generateImage`,
`transcribeAudio`, `synthesizeSpeech`, `generateVideo`, `generateStructured`,
and `listModels` receive the same wrapping treatment.

---

### Delta 3 — Update `src/ai-powered/resilience.ts`

**File:** `src/ai-powered/resilience.ts`

**After (add re-exports at end of file):**
```ts
// Re-export browser-safe shared primitives so Node consumers can import
// from this module without knowing about the shared/ sub-path.
export { jitterDelay, sleep, withRetryFetch, CircuitBreaker as SharedCircuitBreaker }
  from "./shared/resilience.js";
```

**Rationale:** Existing `withRetry`, `CircuitBreaker` (Node variant),
`RetryOptions`, and `CircuitState` exports remain unchanged. The re-exports
add new names without shadowing existing ones. Node consumers continue to
work with zero code changes.

---

## Summary of Changes

| Delta | File | Type | Description |
|---|---|---|---|
| 1 | `src/ai-powered/shared/resilience.ts` | New | Browser-safe jitter, sleep, withRetryFetch, CircuitBreaker |
| 2 | `src/ai-powered/web/fetch-client.ts` | Modification | WebResilienceOptions + per-instance CircuitBreaker + wrapped fetch calls |
| 3 | `src/ai-powered/resilience.ts` | Modification | Re-export shared primitives for Node consumers |

