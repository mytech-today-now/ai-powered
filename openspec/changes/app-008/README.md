# App-008 — WebAiClient Resilience: Circuit Breaker + Exponential Backoff

Add production-grade resilience to the browser-side `WebAiClient` by
introducing Full Jitter exponential backoff retry and a three-state circuit
breaker — matching the fault tolerance already present in the Node `AiClient`.

---

## Why This Change

`WebAiClient` makes raw `fetch()` calls with no retry logic. A transient
`429` or `503` from a provider or proxy surfaces as an immediate failure,
unnecessarily degrading user experience. The Node client has had `withRetry`
and `CircuitBreaker` since an earlier change; this change closes the gap for
browser consumers.

---

## Capabilities

| ID | Type | File |
|---|---|---|
| `shared-resilience` | New | `src/ai-powered/shared/resilience.ts` |
| `web-client-resilience` | Modified | `src/ai-powered/web/fetch-client.ts` |
| `node-resilience-reexport` | Modified | `src/ai-powered/resilience.ts` |

---

## Artifact Map

| Artifact | Path |
|---|---|
| Proposal | `proposal.md` |
| Code Deltas | `deltas.md` |
| Design Notes | `design.md` |
| Implementation Guide | `implementation.md` |
| Task Checklist | `tasks.md` |
| Spec — shared-resilience | `specs/shared-resilience/spec.md` |
| Spec — web-client-resilience | `specs/web-client-resilience/spec.md` |
| Spec — node-resilience-reexport | `specs/node-resilience-reexport/spec.md` |
| Example (runnable) | `examples/circuit-breaker-retry.js` |
| Tests (Vitest) | `tests/app-008.test.ts` |
| Summary | `summary.md` |
| Machine metadata | `upload.json` |

---

## Quick Start

```bash
# Run tests
npx vitest run openspec/changes/app-008/tests/app-008.test.ts

# Run example
node openspec/changes/app-008/examples/circuit-breaker-retry.js

# See implementation steps
cat openspec/changes/app-008/implementation.md
```

---

## Key Design Decisions

- **Shared module** (`src/ai-powered/shared/resilience.ts`): browser-safe
  (no `node:` imports), importable by both bundle targets.
- **Instance-scoped circuit breaker**: each `WebAiClient` has its own breaker;
  no cross-client state pollution.
- **AbortSignal threads through**: cancelling a request immediately stops
  in-flight fetches AND inter-retry delays.
- **Zero breaking changes**: all new `WebClientOptions` fields are optional;
  existing call sites work unchanged.

---

## Source Prompt

`ai-prompts/App-008.md`

