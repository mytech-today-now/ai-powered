# Design Notes — App-008

## Problem Statement

`WebAiClient` makes raw `fetch()` calls with no retry or circuit protection.
Provider APIs and proxy servers routinely return `429 Too Many Requests` or
`503 Service Unavailable` under load — both conditions that self-resolve within
seconds and are trivially handled by a short backoff loop.

The Node `AiClient` already has `withRetry` + `CircuitBreaker` from the
existing `src/ai-powered/resilience.ts`. That file cannot be bundled for the
browser because it imports `getLogger()`, which in turn pulls in `pino` — a
Node.js-only logging library.

---

## Decision: Shared Module vs. Duplication

**Option A** — Duplicate the logic into `fetch-client.ts` directly.
**Option B** — Extract browser-safe primitives into `src/ai-powered/shared/resilience.ts`
  and import from both the Node and browser bundles.

**Chosen: Option B.** Duplication guarantees divergence. A shared module means
one set of tests, one place to fix bugs. The only cost is a thin new file and
re-exports in `resilience.ts`.

---

## Full Jitter vs. Decorrelated Jitter

Both eliminate thundering-herd problems. Full Jitter (`Math.random() * min(cap,
base * 2^n)`) was chosen because:
- It matches the existing Node `withRetry` implementation (consistency).
- It is simpler to verify in tests using a fixed Math.random mock.
- The AWS "Exponential Backoff and Jitter" paper shows both are equivalent in
  practice for typical RPC retry workloads.

---

## Circuit Breaker Scope: Instance vs. Global

**Instance-scoped** was chosen over a global/per-provider registry because:
- Browser tabs are short-lived; a global registry would outlive the page
  navigation that caused the original failures.
- `WebAiClient` is typically created once per page session, so an instance-
  scoped breaker effectively acts as a per-client breaker.
- A global breaker in the browser risks one failing video call blocking all
  text calls made by a different component using a second `WebAiClient` instance.

The Node `CircuitBreaker` (in `resilience.ts`) is per-provider-name, which is
appropriate for the long-running server process. This spec does not change that.

---

## AbortSignal Propagation

The `AbortSignal` is threaded through `withRetryFetch` down to the inter-retry
`setTimeout`. This ensures:
1. In-flight `fetch()` calls are cancelled by the native `fetch` abort support.
2. Retry delays (which can be up to 8 s) are cancelled without waiting.

The `CircuitBreaker.call` method does not receive the signal because it is
synchronous in the OPEN path (throws immediately) and delegates to
`withRetryFetch` in all other paths.

---

## Default Parameters

| Parameter | Default | Rationale |
|---|---|---|
| `maxRetries` | 3 | 1 original + 3 retries = 4 total attempts; balances user wait time vs. resilience |
| `backoffBase` | 500 ms | Matches Node `withRetry`; reasonable for API rate limits |
| `backoffCap` | 8000 ms | Max ~8 s delay; avoids unbounded waits for interactive browser users |
| `failureThreshold` | 5 | 5 consecutive failures indicates a real outage, not transient |
| `resetTimeoutMs` | 60 000 ms | 1-minute recovery window matches typical API downtime notification lag |

---

## Bundle Size

Expected gzipped delta after minification: **≈ 1–2 KB**.

If measured delta exceeds 5 KB gzipped:
- Consider lazy-loading `shared/resilience.ts` via dynamic `import()` inside
  `WebAiClient` methods, initialising the breaker on first call.
- This trades startup performance for initial bundle size.

---

## Backward Compatibility

All three new fields on `WebClientOptions` are optional. Existing call sites
```ts
new WebAiClient({ mode: "proxy", proxyUrl: "http://localhost:3001" })
```
continue to compile and run identically. Retry and circuit breaker activate
transparently with defaults.

---

## What This Design Does NOT Address

- **Retry-After header**: Parsing `Retry-After` from 429 responses to use the
  server's requested delay. Scoped out; adds complexity and parsing logic.
- **Per-provider circuit breakers**: `WebAiClient` uses a single breaker for
  all requests. Multi-provider fan-out is not in scope for this change.
- **Logging in the browser**: `shared/resilience.ts` has no logging. Browser
  DevTools console logging would require a separate design decision.
- **Metrics / telemetry**: Circuit state is private. Exposing it via events or
  callbacks is a separate feature request.

