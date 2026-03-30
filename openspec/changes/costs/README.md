# Change: costs

**JIRA:** AI-003  
**Type:** Implementation  
**Priority:** Medium  
**Status:** Implemented — spec formalizes the existing cost & pricing system

## Summary

Formalizes and specifies the `ai-powered` cost tracking and pricing API. The `costs` change
introduces a canonical `MODEL_PRICING` table, four utility functions (`listPricing`,
`lookupModelPricing`, `calculateCost`, `estimateCost`), a `GET /pricing` HTTP endpoint on
the proxy server, and cost propagation through the web module client.

The `ai-powered` baseline (`resilience-and-cost/spec.md`) already specifies token-estimation
and per-call cost tracking at a high level. This change specifies the **concrete pricing layer**:
the pricing table, lookup semantics, programmatic API, HTTP surface, and web client propagation.

## Artifacts

| Artifact | Description |
|---|---|
| [`proposal.md`](proposal.md) | Why this change is needed and what it modifies |
| [`design.md`](design.md) | Technical decisions, risks, migration plan, open questions |
| [`specs/pricing-api/spec.md`](specs/pricing-api/spec.md) | Requirements and scenarios for pricing and cost APIs |
| [`tasks.md`](tasks.md) | Implementation checklist |
| [`deltas.md`](deltas.md) | Summary of all spec changes relative to the `ai-powered` baseline |
| [`summary.md`](summary.md) | One-page human-readable summary |

## Scope

### Files created / modified
- `src/ai-powered/utils.ts` — `MODEL_PRICING`, `ModelPricing`, `PricingEntry`, `listPricing`,
  `lookupModelPricing`, `calculateCost`, `estimateCost`
- `src/ai-powered/server/routes.ts` — `GET /pricing` endpoint
- `src/ai-powered/web/fetch-client.ts` — `WebCostBreakdown`, cost field in `WebTextResult`
  and `WebStructuredResult`
- `src/ai-powered/index.ts` — re-exports `listPricing`, `lookupModelPricing`, `PricingEntry`,
  `ModelPricing`

### No new files required
All functionality lives in existing files. No new npm dependencies are needed.

## Acceptance Criteria

- [ ] `listPricing()` returns all models sorted alphabetically with correct `modality` and `primaryUsd`
- [ ] `listPricing({ modality: 'video' })` returns only video models
- [ ] `listPricing({ model: 'gpt-4' })` returns models whose id contains `"gpt-4"`
- [ ] `lookupModelPricing('gpt-4o')` returns exact match pricing
- [ ] `lookupModelPricing('gpt-4o-mini-2024-07-18')` resolves via longest-prefix to `"gpt-4o-mini"`
- [ ] `lookupModelPricing('totally-unknown-model')` returns `FALLBACK_PRICING` without throwing
- [ ] `calculateCost('gpt-4o', usage)` returns `{ totalUsd, isEstimate: false }` rounded to 6 d.p.
- [ ] `estimateCost('gpt-4o', promptText)` returns `{ totalUsd, isEstimate: true }`
- [ ] `GET /pricing` returns `200` with JSON array sorted by model id
- [ ] `GET /pricing?modality=video` returns only video entries
- [ ] `GET /pricing?modality=invalid` returns `400`
- [ ] `GET /pricing?model=claude` returns only entries whose id contains `"claude"`
- [ ] Web module `WebTextResult` and `WebStructuredResult` include `cost?: WebCostBreakdown`
- [ ] All pricing values are rounded to 6 decimal places
- [ ] All existing tests pass — no regressions

