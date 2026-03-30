# Deltas: costs

This document summarises all capability specification changes introduced by the `costs` change
relative to the baseline established by the `ai-powered` change.

---

## Summary of Spec Changes

| Capability | Status | Spec Path |
|---|---|---|
| `pricing-api` | ✅ ADDED | `specs/pricing-api/spec.md` |
| `resilience-and-cost` | ✏️ MODIFIED | `openspec/changes/ai-powered/specs/resilience-and-cost/spec.md` |
| `proxy-server` | ✏️ MODIFIED | `openspec/changes/ai-powered/specs/proxy-server/spec.md` |
| `web-module` | ✏️ MODIFIED | `openspec/changes/ai-powered/specs/web-module/spec.md` |

No existing requirements were removed.

---

## ADDED: pricing-api

New capability spec at `specs/pricing-api/spec.md`.

Covers:
- **`MODEL_PRICING` table** — central pricing constant in `utils.ts`; not exported directly.
  Covers OpenAI (text, image, audio), Anthropic, xAI/Grok, Venice, and Luma AI models.
- **`FALLBACK_PRICING`** — safe default returned when no exact or prefix match exists;
  `lookupModelPricing` never throws; DEBUG log emitted on fallback.
- **`listPricing(filter?)`** — exported function returning all model rates as `PricingEntry[]`,
  sorted alphabetically, with optional `modality` and `model` substring filters.
- **`lookupModelPricing(model)`** — exported function returning `ModelPricing` via exact match,
  longest-prefix match, or `FALLBACK_PRICING`.
- **`calculateCost(model, usage, durationSeconds?)`** — computes actual post-call cost;
  returns `{ totalUsd, isEstimate: false }` rounded to 6 d.p.
- **`estimateCost(model, promptText)`** — estimates pre-call cost from char-count heuristic;
  always returns `{ totalUsd, isEstimate: true }`.
- **`GET /pricing`** — HTTP endpoint on the proxy server; delegates to `listPricing()`;
  supports `?modality=` (validated, 400 on invalid) and `?model=` query parameters.
- **Web module cost propagation** — `WebCostBreakdown` type; `cost?: WebCostBreakdown` added
  to `WebTextResult` and `WebStructuredResult`; `fetch-client.ts` extracts `cost` from proxy
  responses.

---

## MODIFIED: resilience-and-cost

**File:** `openspec/changes/ai-powered/specs/resilience-and-cost/spec.md`

**Change:** The existing "Token estimation and cost tracking" requirement is now backed by the
concrete `calculateCost` and `estimateCost` implementations defined in `pricing-api/spec.md`.
Add a cross-reference note: _"Pricing rates used by `calculateCost` and `estimateCost` are
defined in `openspec/changes/costs/specs/pricing-api/spec.md`."_

All existing requirements (exponential-backoff retries, circuit breaker, provider fallback,
token estimation, cost tracking, budget limits) are **unchanged**.

---

## MODIFIED: proxy-server

**File:** `openspec/changes/ai-powered/specs/proxy-server/spec.md`

**Change:** Add `GET /pricing` to the route inventory at the top of the spec:

```
GET  /pricing   – full MODEL_PRICING table (optional ?modality= ?model=)
```

No other route logic changes. The existing `/text`, `/image`, `/video`, `/stream`,
`/structured`, `/health`, `/config`, `/models`, and `/providers` route specs are **unchanged**.

---

## MODIFIED: web-module

**File:** `openspec/changes/ai-powered/specs/web-module/spec.md`

**Change:** Add the following to the `WebTextResult` and `WebStructuredResult` type
descriptions:

- `cost?: WebCostBreakdown` — optional cost breakdown extracted from the proxy response.
  `WebCostBreakdown` is `{ totalUsd: number; isEstimate: boolean }`.

Add a note: _"When the proxy server returns a `cost` field, `fetch-client.ts` extracts it and
includes it in the result. When `cost` is absent from the proxy response, `result.cost` is
`undefined`."_

All existing `WebAiClient` method signatures and `WebTextResult` / `WebImageResult` /
`WebVideoResult` fields are **unchanged**.

---

## Known Deviations from `ai-prompts/costs.md`

| # | Prompt Requirement | Deviation | Rationale |
|---|---|---|---|
| D1 | Pricing table shown as of 2026-03-30 | Table may grow as providers add models | `MODEL_PRICING` is the live source; prompt table is a snapshot |
| D2 | `grok-2-latest` listed implicitly | Added via prefix match to `grok-2` | Avoids redundant explicit entry; prefix lookup resolves correctly |
| D3 | `ray-2-720p` / `ray-flash-2-720p` not in prompt table | Added to table and provider list | Provider coverage audit revealed these models in `listModels()` |

