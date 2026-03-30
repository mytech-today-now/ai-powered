# Summary: costs

## One-liner

Add a canonical pricing table and four utility functions (`listPricing`, `lookupModelPricing`,
`calculateCost`, `estimateCost`) to `ai-powered`, expose the table at `GET /pricing`, and
propagate cost through the web module so the browser demo can display live session cost.

## Problem

The `resilience-and-cost` baseline spec requires every result object to include a `cost` field.
It does not specify where model rates come from or how they are structured. Without a central
pricing table, every provider would need its own ad-hoc constants, consumers would have no
runtime API to inspect pricing, and adding new models would require scattered edits across
multiple files.

## Solution

Introduce `MODEL_PRICING` in `src/ai-powered/utils.ts` as the single source of truth, backed
by four utility functions:

| Function                          | Purpose                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `listPricing(filter?)`            | Return all model rates as `PricingEntry[]`, filterable by modality or model id substring |
| `lookupModelPricing(model)`       | Return `ModelPricing` for one model; exact → prefix → fallback                           |
| `calculateCost(model, usage)`     | Compute actual post-call cost; `isEstimate: false`                                       |
| `estimateCost(model, promptText)` | Estimate pre-call cost from char count; `isEstimate: true`                               |

The proxy server exposes the same data at `GET /pricing` (with optional `?modality=` and
`?model=` filters). The web module's `WebTextResult` and `WebStructuredResult` include an
optional `cost?: WebCostBreakdown` field so the session-cost footer in the browser demo updates
after every API call.

## Scope at a glance

| Category             | Count | Details                                                              |
| -------------------- | ----- | -------------------------------------------------------------------- |
| New functions        | 4     | `listPricing`, `lookupModelPricing`, `calculateCost`, `estimateCost` |
| New types            | 3     | `ModelPricing`, `PricingEntry`, `WebCostBreakdown`                   |
| New HTTP routes      | 1     | `GET /pricing`                                                       |
| Modified files       | 4     | `utils.ts`, `server/routes.ts`, `web/fetch-client.ts`, `index.ts`    |
| New npm dependencies | 0     | None                                                                 |
| New tests            | ≥ 10  | Unit tests + integration test                                        |

## Key constraints

- **6 d.p. rounding**: all `totalUsd` values are rounded to exactly 6 decimal places
- **Safe fallback**: `lookupModelPricing` never throws — unknown models return `FALLBACK_PRICING`
- **No new files**: all changes live in existing source files
- **No breaking changes**: all new exports are additive; existing call sites unchanged
- **Static table**: rates are hard-coded in `MODEL_PRICING`; no runtime provider price fetch
- **100% provider coverage**: every model exposed by every provider's `listModels()` has a
  pricing entry (verified by cross-reference audit)

## Implementation order

```
1. Add ModelPricing, MODEL_PRICING, FALLBACK_PRICING to utils.ts
2. Add PricingEntry, listPricing(), lookupModelPricing() to utils.ts
3. Update calculateCost / estimateCost to use lookupModelPricing
4. Re-export new symbols from index.ts
5. Add GET /pricing route to server/routes.ts
6. Add WebCostBreakdown + cost field to web/fetch-client.ts
7. Run npm run build && npm run build:web
8. Run npm test — all tests pass
9. Smoke-test GET /pricing and browser session-cost footer
```

## Related artifacts

- Source prompt: `ai-prompts/costs.md`
- Full spec: `openspec/changes/costs/specs/pricing-api/spec.md`
- Baseline cost spec: `openspec/changes/ai-powered/specs/resilience-and-cost/spec.md`
- Implementation: `src/ai-powered/utils.ts`, `src/ai-powered/server/routes.ts`,
  `src/ai-powered/web/fetch-client.ts`
