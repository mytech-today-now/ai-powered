# Implementation Tasks — App-008

Add circuit-breaker and exponential-backoff retry to `WebAiClient`.

---

## Phase 1 — Shared Resilience Module

- [ ] **T-001** Create directory `src/ai-powered/shared/`
- [ ] **T-002** Create `src/ai-powered/shared/resilience.ts`
  - [ ] T-002a Export `RetryOptions` interface
  - [ ] T-002b Export `jitterDelay(attempt, base?, cap?)` function
  - [ ] T-002c Export `sleep(ms)` function
  - [ ] T-002d Export `withRetryFetch(fn, opts?, signal?)` function
  - [ ] T-002e Export `CircuitState` type
  - [ ] T-002f Export `CircuitBreaker` class with `state` getter and `call<T>` method
- [ ] **T-003** Verify no `node:` imports exist in `shared/resilience.ts`
- [ ] **T-004** Run `tsc --strict` on `shared/resilience.ts` — must produce zero errors

## Phase 2 — WebAiClient Integration

- [ ] **T-005** Add `import { withRetryFetch, CircuitBreaker } from "../shared/resilience.js"` to `fetch-client.ts`
- [ ] **T-006** Export `WebResilienceOptions` interface from `fetch-client.ts`
- [ ] **T-007** Update `WebClientOptions` type to intersect with `WebResilienceOptions`
- [ ] **T-008** Add `private readonly _breaker: CircuitBreaker` field to `WebAiClient`
- [ ] **T-009** Instantiate `new CircuitBreaker()` in `WebAiClient` constructor and assign to `_breaker`
- [ ] **T-010** Wrap `fetch` calls in each method:
  - [ ] T-010a `generateText` (proxy branch)
  - [ ] T-010b `streamText` (proxy branch)
  - [ ] T-010c `generateImage` (proxy branch)
  - [ ] T-010d `transcribeAudio` (proxy branch)
  - [ ] T-010e `synthesizeSpeech` (proxy branch)
  - [ ] T-010f `generateVideo` (proxy branch)
  - [ ] T-010g `generateStructured` (proxy branch)
  - [ ] T-010h `listModels`
- [ ] **T-011** Verify `options?.signal` is forwarded to `withRetryFetch` in every wrapped call
- [ ] **T-012** Run `npm run build` — UMD bundle must compile without error
- [ ] **T-013** Measure bundle size delta with `gzip`; must be < 5 KB gzipped increase

## Phase 3 — Node Resilience Re-export

- [ ] **T-014** Add re-exports to bottom of `src/ai-powered/resilience.ts`:
  ```ts
  export { jitterDelay, sleep, withRetryFetch, RetryOptions as WebRetryOptions } from "./shared/resilience.js";
  export { CircuitBreaker as SharedCircuitBreaker } from "./shared/resilience.js";
  ```
- [ ] **T-015** Confirm existing `CircuitBreaker` (Node variant) and `withRetry` exports unchanged
- [ ] **T-016** Run `tsc --strict` on `resilience.ts` — must produce zero errors

## Phase 4 — Tests & Verification

- [ ] **T-017** Run spec tests: `npx vitest run openspec/changes/app-008/tests/app-008.test.ts`
  - All tests must pass
- [ ] **T-018** Run full test suite: `npm test`
  - All pre-existing tests must continue to pass
- [ ] **T-019** Run example: `node openspec/changes/app-008/examples/circuit-breaker-retry.js`
  - All 5 scenarios must print expected output

## Phase 5 — Review & Merge

- [ ] **T-020** Code review: confirm spec AC requirements met for each capability
- [ ] **T-021** Confirm `WebAiClientOptions` change is backward-compatible (all optional fields)
- [ ] **T-022** Update `openspec/changes/app-008/` `summary.md` with final bundle delta metric
- [ ] **T-023** Open PR targeting `main`; link to this change directory in PR description

