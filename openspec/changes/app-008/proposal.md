## Why

`WebAiClient` in `src/ai-powered/web/fetch-client.ts` makes every outbound
`fetch()` call with no retry, no backoff, and no circuit state. A transient
`429 Too Many Requests` or `503 Service Unavailable` from a provider (or the
proxy) surfaces immediately as an unrecoverable error. Users experience
unnecessary failures during short transient outages — especially costly in
the Video tab where a single failure can abort a multi-step generation job.

The existing `src/ai-powered/resilience.ts` already implements the correct
primitives — a three-state circuit breaker and full-jitter exponential
backoff — but it imports from `node:timers` via `getLogger()` utilities that
rely on Node.js built-ins, making it incompatible with the browser UMD bundle.

The `AiClient` (Node path) wraps every provider call with:
- **Three-state circuit breaker** (Closed → Open → Half-Open) per provider.
- **Full Jitter exponential backoff**: `delay = Math.random() * Math.min(cap, base * 2^n)`.

`WebAiClient` has neither. Aligning the two clients closes a significant
resilience gap for browser consumers.

## What Changes

### Step 1 — Create `src/ai-powered/shared/resilience.ts`

Extract the circuit-breaker and backoff logic into a new file that uses
**only** browser-compatible APIs (no `node:` imports). The module is
importable by both the Node server bundle and the browser UMD bundle.

Key exports:
- `jitterDelay(attempt, base, cap)` — Full Jitter delay computation.
- `sleep(ms)` — browser-safe `setTimeout`-based sleep.
- `withRetryFetch(fn, opts, signal)` — wraps a `() => Promise<Response>`
  with retry logic keyed on HTTP status codes (default: `429 | 503`).
- `CircuitBreaker` — three-state machine (Closed / Open / Half-Open).
- `RetryOptions` interface — documented with JSDoc.

### Step 2 — Wire into `WebAiClient`

Add retry config to `WebAiClientOptions`:
- `maxRetries?: number` (default 3)
- `backoffBase?: number` (default 500 ms)
- `backoffCap?: number` (default 8000 ms)

Create one `CircuitBreaker` instance per `WebAiClient` instance (not global).
Wrap every outbound `fetch` call with `withRetryFetch` → `CircuitBreaker.call`.
`AbortSignal` passed to method calls propagates through retries and the
circuit breaker, aborting all retry attempts immediately.

### Step 3 — Update `src/ai-powered/resilience.ts`

Re-export the shared primitives from `shared/resilience.ts` so existing
Node consumers continue to work without duplication or breaking changes.

## Capabilities

### New Capabilities

- `shared-resilience`: New `src/ai-powered/shared/resilience.ts` module
  with browser-compatible `jitterDelay`, `sleep`, `withRetryFetch`, and
  `CircuitBreaker`. No `node:` imports. Importable in both bundle targets.

- `web-client-resilience`: `WebAiClient` wraps every outbound `fetch` with
  `withRetryFetch` and `CircuitBreaker`. Retry config (`maxRetries`,
  `backoffBase`, `backoffCap`) exposed on `WebAiClientOptions` with JSDoc.
  Circuit state is instance-scoped (not shared between instances). `AbortSignal`
  propagates through all retry attempts and the circuit.

### Modified Capabilities

- `node-resilience-reexport`: `src/ai-powered/resilience.ts` re-exports
  `jitterDelay`, `sleep`, `withRetryFetch`, and `CircuitBreaker` from
  `./shared/resilience.js`; its own `withRetry` and Node-specific logic
  remain intact with no breaking API changes.

## Impact

- **Files changed**: `src/ai-powered/shared/resilience.ts` (new),
  `src/ai-powered/web/fetch-client.ts` (modified),
  `src/ai-powered/resilience.ts` (modified).
- **APIs**: `WebAiClientOptions` gains three optional fields (additive, no
  breaking change). `src/ai-powered/resilience.ts` public API unchanged.
- **Dependencies**: None — uses `setTimeout` (browser-safe) only.
- **Bundle size**: Expected delta < 2 KB gzipped; to be measured after build.
- **Tests**: New Vitest tests for shared resilience module and WebAiClient
  retry/circuit integration.
- **Backward compatibility**: All existing `WebAiClient` call sites continue
  to work unchanged; retry is opt-in by default (3 retries, 500 ms base).

