# Implementation Guide — App-008

Step-by-step developer walkthrough for implementing the circuit-breaker and
exponential-backoff retry in `WebAiClient`.

---

## Prerequisites

- Node.js 18+ installed.
- `npm install` has been run.
- Familiarity with `src/ai-powered/web/fetch-client.ts` and
  `src/ai-powered/resilience.ts`.

---

## Step 1 — Create `src/ai-powered/shared/` directory and resilience module

Create a new file `src/ai-powered/shared/resilience.ts` using the full
implementation shown in `deltas.md` Delta 1.

Key points:
- Do **not** import from `node:` prefixed modules.
- Use only `setTimeout` / `clearTimeout` for async delays.
- `CircuitBreaker` state is private; expose only `state` getter and `call<T>`.
- `withRetryFetch` must handle `signal?.aborted` at the top of each loop
  iteration and wire the signal into the inter-retry delay cleanup.

Run a quick sanity check:
```bash
npx tsc --noEmit --strict src/ai-powered/shared/resilience.ts
```

---

## Step 2 — Update `src/ai-powered/web/fetch-client.ts`

### 2a — Add imports

At the top of the file, add:
```ts
import { withRetryFetch, CircuitBreaker } from "../shared/resilience.js";
```

### 2b — Add `WebResilienceOptions` interface

Before `WebClientOptions`, insert:
```ts
export interface WebResilienceOptions {
  maxRetries?: number;
  backoffBase?: number;
  backoffCap?: number;
}
```

### 2c — Update `WebClientOptions`

Change:
```ts
export type WebClientOptions = WebProxyOptions | WebDirectOptions;
```
To:
```ts
export type WebClientOptions = (WebProxyOptions | WebDirectOptions) & WebResilienceOptions;
```

### 2d — Add `_breaker` field and constructor init

Inside the `WebAiClient` class, add:
```ts
private readonly _breaker: CircuitBreaker;
```
In the constructor body, before any other initialization:
```ts
this._breaker = new CircuitBreaker();
```

### 2e — Wrap every `fetch` call

For each method (`generateText`, `streamText`, `generateImage`, etc.), find
the raw `fetch(url, init)` call and wrap it:
```ts
const res = await this._breaker.call(() =>
  withRetryFetch(
    () => fetch(url, init),
    {
      maxRetries:  this.opts.maxRetries,
      backoffBase: this.opts.backoffBase,
      backoffCap:  this.opts.backoffCap,
    },
    options?.signal,
  )
);
```

> **Note for `streamText`**: If using `ReadableStream` or `EventSource`,
> wrap only the initial connection `fetch`. Streaming body reads happen after
> the circuit check.

### 2f — Verify build

```bash
npm run build
```
The UMD bundle must compile without error. Check the reported bundle size
delta (expected < 2 KB gzip).

---

## Step 3 — Update `src/ai-powered/resilience.ts`

At the bottom of the file, add re-exports:
```ts
// Re-export browser-safe shared primitives (App-008)
export { jitterDelay, sleep, withRetryFetch } from "./shared/resilience.js";
export type { RetryOptions as WebRetryOptions } from "./shared/resilience.js";
export { CircuitBreaker as SharedCircuitBreaker } from "./shared/resilience.js";
```

Run:
```bash
npx tsc --noEmit --strict src/ai-powered/resilience.ts
```
Zero errors expected.

---

## Step 4 — Run Tests

Run the spec tests from the App-008 change directory:
```bash
npx vitest run openspec/changes/app-008/tests/app-008.test.ts
```
All tests must pass.

Run the full suite:
```bash
npm test
```
All pre-existing tests must continue to pass.

---

## Step 5 — Run the Example

```bash
node openspec/changes/app-008/examples/circuit-breaker-retry.js
```

Expected output (exact delay values vary due to jitter):
```
=== Scenario 1: withRetryFetch — 429 twice then 200 ===
  Response status: 200 (expected 200)
  Total fetch calls: 3 (expected 3)

=== Scenario 2: withRetryFetch — 503 exhausts maxRetries=2 ===
  Final status: 503 (503 returned after retries)

=== Scenario 3: CircuitBreaker — opens after 3 failures ===
  State after 3 failures: OPEN (expected OPEN)
  4th call fast-failed: CircuitBreaker OPEN — resets in ...

=== Scenario 4: CircuitBreaker — HALF_OPEN recovery ===
  State after successful probe: CLOSED (expected CLOSED)

=== Scenario 5: AbortSignal cancels retry delay ===
  Aborted: User cancelled
  Fetch calls before abort: 1 (at most 2)
```

---

## Step 6 — Bundle Size Check

After `npm run build`, measure the gzipped bundle delta:
```bash
# Example using PowerShell
(Get-Content dist/ai-powered.umd.js -Raw | [System.Text.Encoding]::UTF8.GetBytes).Count
```
Or compare with the pre-change baseline using a tool like `bundlephobia-cli`.
If delta exceeds 5 KB gzipped, see `design.md` for the lazy-load fallback strategy.

---

## Rollback

If the build fails or tests regress:
1. Revert `src/ai-powered/web/fetch-client.ts` to its pre-App-008 state.
2. Revert the re-exports in `src/ai-powered/resilience.ts`.
3. Delete `src/ai-powered/shared/resilience.ts`.

All three files are independent; partial rollback is safe.

