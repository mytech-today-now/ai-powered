## Why

The `ai-powered` baseline (`resilience-and-cost/spec.md`) mandates that every result object
includes `cost` (USD rounded to 6 decimal places) and that cumulative session cost be tracked.
It does not, however, specify **where** pricing data lives, how it is structured, how callers
can inspect it, or how the proxy server exposes it over HTTP.

Without a concrete pricing layer, every provider would need its own ad-hoc rate constants,
and consumers would have no reliable way to retrieve pricing data at runtime. Adding new models
would require touching multiple files and re-deriving rates from scratch.

This change specifies the single authoritative pricing table and the four utility functions
that expose it, plus the HTTP endpoint and web client fields that complete the end-to-end
cost-visibility story from provider → server → browser.

## What Changes

- **Add** `MODEL_PRICING: Record<string, ModelPricing>` in `src/ai-powered/utils.ts` as the
  canonical, centrally-maintained pricing table for all supported models across all providers.
- **Add** `ModelPricing` interface defining the optional rate fields (`promptPer1kUsd`,
  `completionPer1kUsd`, `perImageUsd`, `perMinuteUsd`, `perVideoUsd`).
- **Add** `PricingEntry` interface extending `ModelPricing` with `model`, `modality`, and
  `primaryUsd` convenience fields for iteration.
- **Add** `listPricing(filter?)` — returns the full pricing table as `PricingEntry[]`, sorted
  alphabetically, with optional `modality` and `model` substring filters.
- **Add** `lookupModelPricing(model)` — returns `ModelPricing` for a single model via exact
  match, then longest-prefix match, then `FALLBACK_PRICING`.
- **Add** `calculateCost(model, usage, durationSeconds?)` — computes actual cost from
  provider-reported `TokenUsage`, always rounding to 6 decimal places.
- **Add** `estimateCost(model, promptText)` — estimates cost before a call using a
  character-count heuristic (~4 chars/token); always returns `isEstimate: true`.
- **Add** `GET /pricing` route on the proxy server delegating to `listPricing()`.
- **Add** `WebCostBreakdown`, `cost?: WebCostBreakdown` to `WebTextResult` and
  `WebStructuredResult` in `src/ai-powered/web/fetch-client.ts`.
- **Export** `listPricing`, `lookupModelPricing`, `PricingEntry`, `ModelPricing` from the
  library's public surface (`src/ai-powered/index.ts`).

## Capabilities

### New Capabilities

- **`pricing-api`**: A complete runtime pricing surface — programmatic TypeScript API
  (`listPricing`, `lookupModelPricing`, `calculateCost`, `estimateCost`) and HTTP endpoint
  (`GET /pricing`) — exposing all known model rates without requiring consumers to hard-code
  or maintain a separate pricing spreadsheet.

### Modified Capabilities

- **`resilience-and-cost`** (`specs/resilience-and-cost/spec.md`): The existing "Token
  estimation and cost tracking" requirement is now backed by concrete implementations
  (`calculateCost`, `estimateCost`). No existing requirements change; this change adds the
  pricing layer beneath them.
- **`proxy-server`** (`specs/proxy-server/spec.md`): `GET /pricing` is added to the route
  list; all other routes and behaviors are unchanged.
- **`web-module`** (`specs/web-module/spec.md`): `WebTextResult` and `WebStructuredResult`
  gain an optional `cost` field so the browser client can display session cost to users.

## Impact

- **No new files**: all changes live in existing source files.
- **No new npm dependencies**: pricing logic uses only built-in arithmetic.
- **No breaking changes**: `listPricing`, `lookupModelPricing`, `calculateCost`, and
  `estimateCost` are additive exports. Existing `calculateCost` / `estimateCost` call sites
  are unchanged because the function signatures are backward-compatible.
- **CI**: All existing tests continue to pass. New unit tests cover `listPricing`,
  `lookupModelPricing`, `calculateCost`, and `estimateCost`; integration tests verify that
  `POST /text` responses include non-zero `cost` when mock mode uses plausible fixture usage.
- **Adding new models**: Edit `MODEL_PRICING` in `utils.ts`. The change is automatically
  reflected in `listPricing()`, `GET /pricing`, `calculateCost`, and `estimateCost` with no
  further modifications required.
