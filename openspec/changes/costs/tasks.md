# Tasks: costs

> **Status:** All tasks below are COMPLETE as of 2026-03-30. This checklist serves as the
> audit trail for the implementation.

## 1 — Pricing table and interfaces (`src/ai-powered/utils.ts`)

- [x] Define `ModelPricing` interface with optional rate fields:
      `promptPer1kUsd`, `completionPer1kUsd`, `perImageUsd`, `perMinuteUsd`, `perVideoUsd`
- [x] Define `MODEL_PRICING: Record<string, ModelPricing>` (not exported) covering all
      providers: OpenAI text, OpenAI image/audio, Anthropic, xAI/Grok, Venice, Luma AI
- [x] Define `FALLBACK_PRICING: ModelPricing` used when no match exists
- [x] Confirm every model exposed by every provider's `listModels()` has a non-fallback entry

## 2 — `listPricing(filter?)` (`src/ai-powered/utils.ts`)

- [x] Define `PricingEntry` interface extending `ModelPricing` with `model`, `modality`,
      and `primaryUsd`
- [x] Implement `listPricing(filter?)`: - Derive `modality` from pricing shape (video → image → audio → text precedence) - Compute `primaryUsd` from the relevant rate field - Apply optional `filter.modality` and `filter.model` (substring, case-insensitive) - Sort result alphabetically by model id
- [x] Export `listPricing` and `PricingEntry` from `utils.ts`

## 3 — `lookupModelPricing(model)` (`src/ai-powered/utils.ts`)

- [x] Implement exact match lookup
- [x] Implement longest-prefix fallback (iterate all keys; pick the longest prefix match)
- [x] Return `FALLBACK_PRICING` when no match found; emit DEBUG log with model id
- [x] Export `lookupModelPricing` and `ModelPricing` from `utils.ts`

## 4 — `calculateCost` and `estimateCost` (`src/ai-powered/utils.ts`)

- [x] Update `calculateCost` to call `lookupModelPricing(model)` for rate lookup
- [x] Handle all four modality cost shapes (text, image, audio, video)
- [x] Round `totalUsd` to 6 decimal places: `Math.round(raw * 1e6) / 1e6`
- [x] Return `{ totalUsd, isEstimate: false }` from `calculateCost`
- [x] Update `estimateCost` to call `lookupModelPricing(model)` for rate lookup
- [x] Use `~4 chars/token` heuristic for prompt token estimation
- [x] Always return `{ totalUsd, isEstimate: true }` from `estimateCost`

## 5 — Public exports (`src/ai-powered/index.ts`)

- [x] Re-export `listPricing` from `utils.ts`
- [x] Re-export `lookupModelPricing` from `utils.ts`
- [x] Re-export `PricingEntry` type from `utils.ts`
- [x] Re-export `ModelPricing` type from `utils.ts`

## 6 — `GET /pricing` route (`src/ai-powered/server/routes.ts`)

- [x] Import `listPricing` from the library index
- [x] Register `GET /pricing` route: - Parse `?modality=` and `?model=` query parameters - Validate `modality` against allowed enum; return `400` for invalid values - Call `listPricing({ modality, model })` and return result as JSON array
- [x] Add route to the JSDoc comment block at the top of `routes.ts`

## 7 — Web module cost propagation (`src/ai-powered/web/fetch-client.ts`)

- [x] Define `WebCostBreakdown` interface: `{ totalUsd: number; isEstimate: boolean }`
- [x] Add `cost?: WebCostBreakdown` to `WebTextResult`
- [x] Add `cost?: WebCostBreakdown` to `WebStructuredResult`
- [x] In `generateText` proxy branch: extract `cost` from parsed JSON response
- [x] In `generateStructured` proxy branch: extract `cost` from parsed JSON response

## 8 — Tests

- [x] Unit test: `listPricing()` returns array sorted alphabetically
- [x] Unit test: `listPricing({ modality: 'video' })` returns only video entries
- [x] Unit test: `listPricing({ model: 'gpt-4' })` returns only entries with `"gpt-4"` in id
- [x] Unit test: `lookupModelPricing('gpt-4o')` returns exact match
- [x] Unit test: `lookupModelPricing('gpt-4o-mini-2024-07-18')` resolves via prefix to `gpt-4o-mini`
- [x] Unit test: `lookupModelPricing('unknown-xyz')` returns `FALLBACK_PRICING` without throwing
- [x] Unit test: `calculateCost('gpt-4o', { promptTokens: 500, completionTokens: 200, totalTokens: 700 })` → `{ totalUsd: 0.0055, isEstimate: false }`
- [x] Unit test: `calculateCost('ray-flash-2', zeroed usage)` → `{ totalUsd: 0.04, isEstimate: false }`
- [x] Unit test: `estimateCost` always returns `isEstimate: true`
- [x] Integration test: `POST /text` response includes `cost.totalUsd > 0` in mock mode

## 9 — Provider coverage audit

- [x] Cross-reference every model in every provider's `listModels()` against `MODEL_PRICING`
- [x] Add missing entries: `o1`, `o1-mini`, `grok-2-latest`, `grok-2-mini`, `grok-vision-beta`,
      `qwen-2.5-vl`, `ray-2-720p`, `ray-flash-2-720p`

## 10 — Build and verification

- [x] `npm run build` — zero TypeScript errors in Node build
- [x] `npm run build:web` — zero errors in browser bundle
- [x] `npm test` — all 119 tests pass, no regressions
- [x] `GET http://localhost:3001/pricing` → 200 with ≥ 30 entries
- [x] `GET http://localhost:3001/pricing?modality=video` → only video entries returned
- [x] `GET http://localhost:3001/pricing?modality=invalid` → 400
