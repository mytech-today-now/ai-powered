# Spec — node-resilience-reexport

## Capability ID
`node-resilience-reexport`

## Owner
`src/ai-powered/resilience.ts`

## Goal
Keep `src/ai-powered/resilience.ts` as the single import point for resilience
primitives in Node.js consumer code by re-exporting the new shared primitives
(`jitterDelay`, `sleep`, `withRetryFetch`, `CircuitBreaker`) from
`./shared/resilience.js`. No existing exports may be removed, renamed, or
have their signatures changed.

---

## Requirements

### R-001 — Re-export shared primitives
`src/ai-powered/resilience.ts` MUST add the following re-exports at the
bottom of the file (after all existing code):
```ts
export { jitterDelay, sleep, withRetryFetch, RetryOptions as WebRetryOptions }
  from "./shared/resilience.js";
export { CircuitBreaker as SharedCircuitBreaker } from "./shared/resilience.js";
```

### R-002 — No duplicate identifier conflicts
The existing `CircuitBreaker` class defined in `resilience.ts` MUST NOT be
renamed or removed. The shared `CircuitBreaker` MUST be re-exported under
the alias `SharedCircuitBreaker` to avoid a name conflict.

### R-003 — Existing public API unchanged
The following exports MUST continue to exist with identical signatures:
- `RetryOptions` (interface)
- `CircuitState` (type)
- `CircuitBreaker` (class — Node variant with `getLogger()` integration)
- `withRetry` (function)

### R-004 — No new Node-only code added
This delta is re-export only. No new logic, no new Node-only imports, and no
modifications to existing function bodies are permitted in this delta.

### R-005 — Path must use `.js` extension
The import path MUST be `"./shared/resilience.js"` (not `.ts`) for
TypeScript ESM module resolution compatibility.

---

## Scenarios

#### Scenario: Node consumer imports from resilience.ts
- **GIVEN** a Node.js consumer importing `withRetry` from `resilience.ts`
- **WHEN** no changes are made to the consumer code post-App-008
- **THEN** the import resolves successfully with identical runtime behaviour

#### Scenario: Node consumer imports shared CircuitBreaker
- **GIVEN** a Node.js consumer wanting the browser-safe CircuitBreaker
- **WHEN** they import `SharedCircuitBreaker` from `resilience.ts`
- **THEN** they receive the `CircuitBreaker` from `shared/resilience.ts`
  without needing to know the sub-path

#### Scenario: No duplicate export errors
- **GIVEN** `resilience.ts` re-exports `CircuitBreaker as SharedCircuitBreaker`
- **WHEN** TypeScript compiles the file with `strict: true`
- **THEN** zero duplicate identifier or type errors

---

## Acceptance Criteria

| ID | Condition | Expected |
|---|---|---|
| AC-1 | `import { withRetry } from "resilience.js"` (Node) | Resolves; behaviour unchanged |
| AC-2 | `import { CircuitBreaker } from "resilience.js"` (Node) | Still the Node variant |
| AC-3 | `import { SharedCircuitBreaker } from "resilience.js"` | Returns shared variant |
| AC-4 | `import { jitterDelay, sleep } from "resilience.js"` | Re-exported from shared module |
| AC-5 | `tsc --strict` on the file | Zero errors |
| AC-6 | Existing Node tests for withRetry, CircuitBreaker | All tests continue to pass |

---

## Out of Scope
- Moving the Node-specific `getLogger()` integration out of `resilience.ts`.
- Deprecating any existing exports.
- Changing the `withRetry` function's `isRetryable` parameter handling.

