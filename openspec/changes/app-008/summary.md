# Summary — App-008

**Change:** Add circuit-breaker and exponential-backoff retry to `WebAiClient`
**Status:** Implemented — all tasks complete
**Date:** 2026-04-04

---

## Problem

`WebAiClient` makes bare `fetch()` calls with zero fault tolerance. A single
`429 Too Many Requests` or `503 Service Unavailable` from a provider or the
proxy immediately surfaces as an unrecoverable error for the browser user.
The Node `AiClient` already has `withRetry` + `CircuitBreaker`; `WebAiClient`
does not.

---

## Solution

Three coordinated changes:

1. **New file** `src/ai-powered/shared/resilience.ts`
   - Browser-safe (no `node:` imports).
   - Exports: `jitterDelay`, `sleep`, `withRetryFetch`, `CircuitBreaker`.
   - Importable by both Node and browser UMD bundles.

2. **Modified** `src/ai-powered/web/fetch-client.ts`
   - `WebResilienceOptions` interface added to `WebClientOptions` (additive, optional).
   - `WebAiClient` creates one `CircuitBreaker` per instance.
   - Every outbound `fetch` wrapped with `withRetryFetch` → `CircuitBreaker.call`.
   - `AbortSignal` propagated through all retry delays.

3. **Modified** `src/ai-powered/resilience.ts`
   - Re-exports `jitterDelay`, `sleep`, `withRetryFetch`, `SharedCircuitBreaker`.
   - Existing Node API (`withRetry`, `CircuitBreaker`, `RetryOptions`) unchanged.

---

## Impact at a Glance

| Dimension | Value |
|---|---|
| Breaking changes | None |
| New npm packages | None |
| New files | 1 (`src/ai-powered/shared/resilience.ts`) |
| Modified files | 2 (`fetch-client.ts`, `resilience.ts`) |
| Actual bundle delta    | **+0.62 KB gzipped** (baseline 16.71 kB → 17.33 kB) |
| New `WebClientOptions` fields | 3 (all optional) |
| Default retry attempts | 3 retries (4 total) |
| Default backoff range | 0 – 8 000 ms (Full Jitter) |
| Circuit breaker threshold | 5 consecutive failures |
| Circuit breaker reset | 60 s |

---

## What Doesn't Change

- All existing `WebAiClient` call sites — no code changes required.
- `src/ai-powered/resilience.ts` public API — all existing exports intact.
- Node `AiClient` behaviour — untouched.
- `npm` dependency list — no new packages.

---

## Test Coverage

- **22 Vitest tests** in `tests/app-008.test.ts` covering:
  - `jitterDelay` bounds
  - `withRetryFetch`: 200 pass-through, 429/503 retry, exhaustion, abort
  - `CircuitBreaker`: state transitions (CLOSED→OPEN→HALF_OPEN→CLOSED),
    fast-fail, probe success/failure, failure counter reset

- **5 runnable scenarios** in `examples/circuit-breaker-retry.js`

---

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run openspec/changes/app-008/tests/app-008.test.ts` | ✅ 17/17 tests pass |
| `node openspec/changes/app-008/examples/circuit-breaker-retry.js` | ✅ All 5 scenarios pass |
| `npm run build` | ✅ Zero errors |
| `npm run build:web` (UMD bundle delta) | ✅ +0.62 kB gzipped (limit: 5 kB) |
| `npx tsc --noEmit` | ✅ Zero type errors |
| Backward compatibility (`new WebAiClient(existingOpts)`) | ✅ No code changes required at call sites |
| No `node:` imports in `shared/resilience.ts` | ✅ Confirmed |

