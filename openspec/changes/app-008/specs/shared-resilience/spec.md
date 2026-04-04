# Spec — shared-resilience

## Capability ID
`shared-resilience`

## Owner
`src/ai-powered/shared/resilience.ts` (new file)

## Goal
Provide a browser-compatible resilience module that can be imported by both
the Node.js server bundle and the browser UMD bundle. Contains Full Jitter
exponential backoff, an HTTP-status-aware fetch retry wrapper, and a
three-state circuit breaker using only Web Standard APIs.

---

## Requirements

### R-001 — No Node.js built-in imports
The file MUST NOT import from any `node:` prefixed module or from any module
that transitively imports Node built-ins (`process`, `Buffer`, `timers`,
etc.). Only `setTimeout`, `clearTimeout`, `Promise`, and `Math` are allowed.

### R-002 — `jitterDelay(attempt, base, cap)` function
MUST export a `jitterDelay(attempt: number, base?: number, cap?: number): number`
function implementing Full Jitter:
```
delay = Math.random() * Math.min(cap, base * 2^attempt)
```
Defaults: `base = 500`, `cap = 8000`. Return value MUST be a non-negative
number ≤ cap.

### R-003 — `sleep(ms)` function
MUST export an `async function sleep(ms: number): Promise<void>` that resolves
after `ms` milliseconds using `setTimeout`. MUST NOT use `setInterval` or
Node-specific timer utilities.

### R-004 — `RetryOptions` interface
MUST export a `RetryOptions` interface with the following optional fields:
- `maxRetries?: number` — max number of retry attempts (default 3).
- `backoffBase?: number` — base delay in ms (default 500).
- `backoffCap?: number` — cap delay in ms (default 8000).
- `retryOn?: (status: number) => boolean` — predicate returning true when a
  response status should trigger a retry (default: `s === 429 || s === 503`).

### R-005 — `withRetryFetch(fn, opts, signal)` function
MUST export `withRetryFetch` with signature:
```ts
async function withRetryFetch(
  fn: () => Promise<Response>,
  opts?: RetryOptions,
  signal?: AbortSignal,
): Promise<Response>
```
- MUST retry `fn` up to `opts.maxRetries` additional times when `retryOn`
  returns true for the HTTP status code.
- MUST apply `jitterDelay` between retry attempts.
- MUST NOT retry when `signal` is aborted — must reject immediately with
  `signal.reason`.
- MUST throw the last error after all retries are exhausted.
- MUST pass through non-retryable responses (other status codes) without retry.

### R-006 — `CircuitState` type
MUST export `type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN"`.

### R-007 — `CircuitBreaker` class
MUST export a `CircuitBreaker` class implementing:
- Constructor: `new CircuitBreaker(opts?: { failureThreshold?: number; resetTimeoutMs?: number })`
  with defaults `failureThreshold = 5`, `resetTimeoutMs = 60_000`.
- `state` getter returning `CircuitState`.
- `call<T>(fn: () => Promise<T>): Promise<T>` method.
- CLOSED → OPEN transition after `failureThreshold` consecutive failures.
- OPEN → throws immediately with descriptive message (no call to `fn`).
- OPEN → HALF_OPEN after `resetTimeoutMs` has elapsed.
- HALF_OPEN → CLOSED on first success after probe.
- HALF_OPEN → OPEN on any failure during probe.
- Failure counter MUST reset to zero on any success while CLOSED or on
  transition HALF_OPEN → CLOSED.

### R-008 — TypeScript strict mode compatibility
All exported symbols MUST compile cleanly under `strict: true` with no `any`
escapes and no TypeScript errors.

---

## Scenarios

#### Scenario: jitterDelay stays within bounds
- **GIVEN** attempt=3, base=500, cap=8000
- **WHEN** `jitterDelay(3, 500, 8000)` is called
- **THEN** result is in range [0, min(8000, 500*8)] = [0, 4000]

#### Scenario: withRetryFetch retries on 429
- **GIVEN** fn returns HTTP 429 twice then HTTP 200
- **WHEN** `withRetryFetch(fn, { maxRetries: 3 })` is called
- **THEN** fn is invoked 3 times total; final Response with status 200 is returned

#### Scenario: withRetryFetch aborts on signal
- **GIVEN** fn always returns HTTP 429, AbortSignal is fired after first attempt
- **WHEN** `withRetryFetch(fn, { maxRetries: 3 }, signal)` is called
- **THEN** Promise rejects immediately with the abort reason; fn is not called again

#### Scenario: CircuitBreaker opens after threshold failures
- **GIVEN** `new CircuitBreaker({ failureThreshold: 3 })`
- **WHEN** `call(fn)` fails 3 times consecutively
- **THEN** state transitions to "OPEN"; 4th call throws immediately without calling fn

#### Scenario: CircuitBreaker probes after reset timeout
- **GIVEN** circuit is OPEN and resetTimeoutMs has elapsed
- **WHEN** `call(fn)` is invoked
- **THEN** state transitions to "HALF_OPEN" and fn is called (probe)

#### Scenario: Successful probe closes the circuit
- **GIVEN** circuit is HALF_OPEN
- **WHEN** fn resolves successfully
- **THEN** state transitions to "CLOSED" and failure count resets to 0

---

## Acceptance Criteria

| ID | Condition | Expected |
|---|---|---|
| AC-1 | Import in browser bundle build | No bundler errors; no `node:` import warnings |
| AC-2 | `jitterDelay(n, base, cap)` | Returns 0 ≤ result ≤ cap always |
| AC-3 | `withRetryFetch` + 429 × 2 then 200 | Returns 200 response; fn called 3× |
| AC-4 | `withRetryFetch` + abort signal fired | Rejects immediately; fn not retried |
| AC-5 | CircuitBreaker threshold=3, 3 failures | State="OPEN" on 3rd failure |
| AC-6 | CircuitBreaker OPEN + elapsed > resetMs | State="HALF_OPEN"; fn invoked |
| AC-7 | CircuitBreaker HALF_OPEN + success | State="CLOSED"; failures=0 |
| AC-8 | TypeScript `tsc --strict` | Zero errors |

---

## Out of Scope
- Logging / telemetry (no `getLogger()` in shared module; logging lives in
  Node-only `src/ai-powered/resilience.ts`).
- Provider-specific error classification (`ProviderError.retryable`); that
  remains in the Node-only `resilience.ts`.
- Rate-limiting headers (`Retry-After`); not required by the prompt.

