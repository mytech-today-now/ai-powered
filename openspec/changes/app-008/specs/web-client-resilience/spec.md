# Spec — web-client-resilience

## Capability ID
`web-client-resilience`

## Owner
`WebAiClient` in `src/ai-powered/web/fetch-client.ts`

## Goal
Equip `WebAiClient` with the same resilience guarantees as the Node `AiClient`:
every outbound `fetch` call is wrapped with Full Jitter exponential backoff
retry (on 429 / 503) and guarded by a per-instance three-state circuit breaker.
Retry configuration is exposed through `WebAiClientOptions` with sensible defaults
so existing call sites require zero code changes.

---

## Requirements

### R-001 — `WebResilienceOptions` interface
A new `WebResilienceOptions` interface MUST be exported from `fetch-client.ts`
with the following fields (all optional):
```ts
export interface WebResilienceOptions {
  maxRetries?: number;   // default 3
  backoffBase?: number;  // ms, default 500
  backoffCap?: number;   // ms, default 8000
}
```

### R-002 — Merge into `WebClientOptions`
`WebClientOptions` MUST be updated to include `WebResilienceOptions`:
```ts
export type WebClientOptions = (WebProxyOptions | WebDirectOptions) & WebResilienceOptions;
```
Existing `WebProxyOptions` and `WebDirectOptions` fields MUST remain unchanged.

### R-003 — Per-instance `CircuitBreaker`
`WebAiClient` MUST create exactly one `CircuitBreaker` instance (from
`src/ai-powered/shared/resilience.ts`) in its constructor and store it as a
private field (`_breaker`). It MUST NOT be static or globally shared.

### R-004 — All outbound `fetch` calls wrapped
Every `fetch(...)` call inside `WebAiClient` (across all public methods) MUST
be wrapped using the pattern:
```ts
const res = await this._breaker.call(() =>
  withRetryFetch(
    () => fetch(url, init),
    { maxRetries: this.opts.maxRetries, backoffBase: this.opts.backoffBase, backoffCap: this.opts.backoffCap },
    options?.signal,
  )
);
```
Methods that MUST be updated: `generateText`, `streamText`, `generateImage`,
`transcribeAudio`, `synthesizeSpeech`, `generateVideo`, `generateStructured`,
`listModels` (and any other method performing a `fetch` call).

### R-005 — AbortSignal propagation
The `AbortSignal` passed to any `WebAiClient` method (via `options?.signal`)
MUST be forwarded to `withRetryFetch` and respected during inter-retry delays.
Aborting MUST immediately reject the call without additional retry attempts.

### R-006 — Defaults without explicit config
When no resilience options are provided, `WebAiClient` MUST behave as if
`{ maxRetries: 3, backoffBase: 500, backoffCap: 8000 }` was supplied.
The defaults live in `withRetryFetch` so no special handling is needed in
the constructor.

### R-007 — Circuit breaker does not affect non-retryable errors
A non-retryable HTTP status (e.g., 400 Bad Request, 401 Unauthorized, 404)
MUST be returned as-is by `withRetryFetch` without retry, but MUST still
be counted as a failure by `CircuitBreaker` if the caller's own error handling
re-throws.

### R-008 — No new runtime dependencies
The implementation MUST import only from `../shared/resilience.js` (internal).
No new npm packages MAY be introduced.

---

## Scenarios

#### Scenario: Transient 429 is retried transparently
- **GIVEN** a `WebAiClient` in proxy mode with default options
- **WHEN** the proxy returns HTTP 429 on the first attempt and HTTP 200 on
  the second
- **THEN** `generateText` returns the successful response; caller sees no error

#### Scenario: Persistent 503 exhausts retries
- **GIVEN** a `WebAiClient` with `maxRetries: 2`
- **WHEN** the proxy returns HTTP 503 on all 3 attempts (1 + 2 retries)
- **THEN** `generateText` throws (or returns an error response) after 3 total
  attempts

#### Scenario: Circuit opens after repeated failures
- **GIVEN** a `WebAiClient` with default circuit breaker (threshold=5)
- **WHEN** 5 consecutive calls all throw network errors
- **THEN** the 6th call is fast-failed by the circuit breaker without a fetch

#### Scenario: AbortSignal cancels during retry delay
- **GIVEN** a `WebAiClient` mid-retry delay (429 received, waiting for backoff)
- **WHEN** the caller aborts the signal
- **THEN** the pending delay is cancelled and the method rejects immediately

#### Scenario: Existing call site unchanged
- **GIVEN** `new WebAiClient({ mode: "proxy", proxyUrl: "http://localhost:3001" })`
  (no resilience options)
- **WHEN** all calls succeed on first attempt
- **THEN** behaviour is identical to the pre-App-008 implementation

---

## Acceptance Criteria

| ID | Condition | Expected |
|---|---|---|
| AC-1 | `new WebAiClient(existingOpts)` | Compiles; no runtime change for happy path |
| AC-2 | 429 × 1, then 200 | Method resolves; `fetch` called exactly 2× |
| AC-3 | 503 × (maxRetries+1) | Method throws after maxRetries+1 total calls |
| AC-4 | threshold failures then one more call | Throws immediately; `fetch` NOT called |
| AC-5 | AbortSignal fired during retry delay | Method rejects; no further fetch calls |
| AC-6 | `npm run build` (UMD bundle) | Compiles without error; bundle delta < 5 KB gz |
| AC-7 | TypeScript `tsc --strict` | Zero type errors |

---

## Out of Scope
- Circuit breaker state exposed via public API (state is private; telemetry
  is out of scope for this change).
- Configuring the circuit breaker threshold or reset time through
  `WebClientOptions` (locked to defaults in this change).
- Retry on non-network errors (non-2xx responses other than 429/503).

