/**
 * examples/circuit-breaker-retry.js — App-008
 *
 * Demonstrates the shared resilience primitives (jitterDelay, withRetryFetch,
 * CircuitBreaker) that will be added in App-008. Runs in Node.js 18+ with
 * no build step using inline implementations that mirror shared/resilience.ts.
 *
 * Run:
 *   node openspec/changes/app-008/examples/circuit-breaker-retry.js
 */

// ---------------------------------------------------------------------------
// Inline implementation (mirrors src/ai-powered/shared/resilience.ts)
// ---------------------------------------------------------------------------

function jitterDelay(attempt, base = 500, cap = 8000) {
  return Math.random() * Math.min(cap, base * Math.pow(2, attempt));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetryFetch(fn, opts = {}, signal) {
  const {
    maxRetries = 3,
    backoffBase = 500,
    backoffCap  = 8000,
    retryOn = (s) => s === 429 || s === 503,
  } = opts;
  let lastErr;
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
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("Aborted"));
      }, { once: true });
    });
  }
  throw lastErr;
}

class CircuitBreaker {
  constructor({ failureThreshold = 5, resetTimeoutMs = 60_000 } = {}) {
    this._state     = "CLOSED";
    this._failures  = 0;
    this._openedAt  = null;
    this._threshold = failureThreshold;
    this._resetMs   = resetTimeoutMs;
  }
  get state() { return this._state; }
  async call(fn) {
    if (this._state === "OPEN") {
      const elapsed = Date.now() - (this._openedAt ?? 0);
      if (elapsed >= this._resetMs) {
        this._state = "HALF_OPEN";
      } else {
        throw new Error(`CircuitBreaker OPEN — resets in ${this._resetMs - elapsed} ms`);
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
        this._state  = "OPEN";
        this._openedAt = Date.now();
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Fake fetch helpers
// ---------------------------------------------------------------------------

let callCount = 0;
function fakeFetch(responses) {
  return async () => {
    const r = responses[Math.min(callCount++, responses.length - 1)];
    if (r === "error") throw new TypeError("Failed to fetch");
    return { status: r, ok: r >= 200 && r < 300 };
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — withRetryFetch retries on 429 then succeeds
// ---------------------------------------------------------------------------
console.log("=== Scenario 1: withRetryFetch — 429 twice then 200 ===");
callCount = 0;
(async () => {
  const fetch1 = fakeFetch([429, 429, 200]);
  const res = await withRetryFetch(fetch1, { maxRetries: 3, backoffBase: 1, backoffCap: 10 });
  console.log(`  Response status: ${res.status} (expected 200)`);
  console.log(`  Total fetch calls: ${callCount} (expected 3)`);
})().then(() => {

// ---------------------------------------------------------------------------
// Scenario 2 — withRetryFetch exhausts retries
// ---------------------------------------------------------------------------
console.log("\n=== Scenario 2: withRetryFetch — 503 exhausts maxRetries=2 ===");
callCount = 0;
return withRetryFetch(fakeFetch([503, 503, 503]), { maxRetries: 2, backoffBase: 1, backoffCap: 10 })
  .then(res => console.log(`  Final status: ${res.status} (503 returned after retries)`))
  .catch(err => console.log(`  Threw: ${err.message} — total calls: ${callCount}`));
}).then(() => {

// ---------------------------------------------------------------------------
// Scenario 3 — CircuitBreaker opens after threshold failures
// ---------------------------------------------------------------------------
console.log("\n=== Scenario 3: CircuitBreaker — opens after 3 failures ===");
const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
const failFn = () => Promise.reject(new Error("network down"));
return Promise.allSettled([
  breaker.call(failFn), breaker.call(failFn), breaker.call(failFn),
]).then(() => {
  console.log(`  State after 3 failures: ${breaker.state} (expected OPEN)`);
  return breaker.call(() => Promise.resolve("probe"))
    .catch(e => console.log(`  4th call fast-failed: ${e.message}`));
});
}).then(() => {

// ---------------------------------------------------------------------------
// Scenario 4 — CircuitBreaker half-opens and recovers
// ---------------------------------------------------------------------------
console.log("\n=== Scenario 4: CircuitBreaker — HALF_OPEN recovery ===");
const breaker2 = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });
const failFn2  = () => Promise.reject(new Error("err"));
return Promise.allSettled([breaker2.call(failFn2), breaker2.call(failFn2)]).then(() =>
  sleep(60)
).then(() =>
  breaker2.call(() => Promise.resolve("recovered"))
).then(() => {
  console.log(`  State after successful probe: ${breaker2.state} (expected CLOSED)`);
});
}).then(() => {

// ---------------------------------------------------------------------------
// Scenario 5 — AbortSignal cancels during retry delay (fast, 1 ms base)
// ---------------------------------------------------------------------------
console.log("\n=== Scenario 5: AbortSignal cancels retry delay ===");
callCount = 0;
const ac = new AbortController();
const p  = withRetryFetch(fakeFetch([429, 429, 200]), { maxRetries: 3, backoffBase: 200, backoffCap: 400 }, ac.signal);
setTimeout(() => ac.abort(new Error("User cancelled")), 50);
return p.catch(err => {
  console.log(`  Aborted: ${err.message}`);
  console.log(`  Fetch calls before abort: ${callCount} (at most 2)`);
});
}).catch(console.error);

