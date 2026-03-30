## Context

The `resilience-and-cost` baseline spec requires that every `TextResult`, `ImageResult`,
`AudioResult`, and `VideoResult` include a `cost` field of type `CostBreakdown` (`{ totalUsd,
isEstimate }`). It also requires `client.getCumulativeCost()`. Neither the baseline spec nor
the `more-video-providers` change specifies where model rates come from, how they are structured
internally, or how callers inspect them.

Without a central pricing table, providers would have to own their own rates (scattered across
provider files and prone to drift). The `costs` change introduces `MODEL_PRICING` in
`src/ai-powered/utils.ts` as the single source of truth and exposes it via four utility
functions and one HTTP endpoint.

## Goals / Non-Goals

**Goals:**
- One central pricing table (`MODEL_PRICING`) covering all providers and modalities
- `listPricing(filter?)` as the primary consumer-facing API (no internal constant exported)
- `lookupModelPricing(model)` with safe fallback — never throws for unknown models
- `calculateCost` / `estimateCost` backed by `MODEL_PRICING`
- `GET /pricing` HTTP endpoint mirroring `listPricing()` over the wire
- Cost propagation through the web module so browser demos can display session cost
- All pricing values rounded to 6 decimal places
- Zero breaking changes to existing function signatures or route behavior

**Non-Goals:**
- Dynamic pricing refresh from provider APIs at runtime (static table; updated by hand)
- Currency conversion (USD only)
- Per-account or volume-discount pricing (flat published rates only)
- Billing or invoicing integrations

## Decisions

### D1 — Single `MODEL_PRICING` constant in `utils.ts`
**Decision**: All model rates live in one `Record<string, ModelPricing>` constant in `utils.ts`.
**Rationale**: Co-location with `calculateCost` and `estimateCost` eliminates import cycles.
The constant is not exported; `listPricing()` is the public surface.
**Implication**: Adding a new model means editing one file. Consumers never hardcode rates.

### D2 — `listPricing()` is the only public export of the full table
**Decision**: Export `listPricing(filter?)` but keep `MODEL_PRICING` internal.
**Rationale**: Consumers iterating the table should use the stable, typed `PricingEntry` shape,
not the raw internal record. Future internal restructuring will not break call sites.

### D3 — Longest-prefix fallback in `lookupModelPricing`
**Decision**: If no exact match exists, find the longest key in `MODEL_PRICING` that is a
prefix of the requested model string. If no prefix matches, return `FALLBACK_PRICING`.
**Rationale**: Providers version-suffix their models (e.g. `"gpt-4o-mini-2024-07-18"`).
Prefix matching lets callers use versioned ids without adding every variant to the table.
`FALLBACK_PRICING` ensures `calculateCost` never throws.

### D4 — Rounding to 6 decimal places everywhere
**Decision**: All `totalUsd` values produced by `calculateCost` and `estimateCost` are
rounded to exactly 6 decimal places using `Math.round(raw * 1e6) / 1e6`.
**Rationale**: Floating-point arithmetic on small numbers (e.g. $0.000003) produces
representation errors. 6 d.p. is sufficient precision for all current model rates and keeps
values deterministic in tests and logs.

### D5 — `GET /pricing` delegates entirely to `listPricing()`
**Decision**: The route parses the optional `modality` and `model` query parameters and
passes them directly to `listPricing()`. It validates `modality` against the known enum and
returns `400` for invalid values.
**Rationale**: Single implementation — tests for `listPricing()` transitively test the route's
business logic. The route only adds HTTP concerns (parsing, validation, JSON serialisation).

### D6 — Web module propagates `cost` from proxy response
**Decision**: `WebTextResult` and `WebStructuredResult` include `cost?: WebCostBreakdown`
(`{ totalUsd: number; isEstimate: boolean }`). `fetch-client.ts` extracts `cost` from the
proxy JSON and spreads it into the returned result.
**Rationale**: The web demo session-cost footer requires this field. Without it, every call
shows $0.00 regardless of actual cost. The optional type preserves backward compatibility
with callers that don't use the cost field.

## Risks / Trade-offs

- **Stale pricing** → Rates change when providers update their APIs. Mitigation: source
  comments in `MODEL_PRICING` cite the original pricing page URL with a retrieval date.
  Maintainers are expected to audit rates periodically.
- **Unknown model fallback** → `FALLBACK_PRICING` returns a plausible but not accurate rate
  for unknown models. `isEstimate: false` would be misleading; however, `calculateCost`
  uses provider-reported `TokenUsage` (already exact), so only the rate is approximate.
  Mitigation: log an `UNKNOWN_MODEL` warning at DEBUG level when the fallback fires.
- **Floating-point precision** → 6 d.p. rounding may still accumulate over hundreds of calls.
  Acceptable for session-level display; not suitable for billing. Document accordingly.

## Migration Plan

1. Add `ModelPricing` interface and `MODEL_PRICING` constant to `utils.ts`.
2. Add `PricingEntry` interface and `listPricing()` to `utils.ts`.
3. Add `lookupModelPricing()` to `utils.ts`; update `calculateCost` and `estimateCost` to call it.
4. Export `listPricing`, `lookupModelPricing`, `PricingEntry`, `ModelPricing` from `index.ts`.
5. Add `GET /pricing` route to `server/routes.ts`.
6. Add `WebCostBreakdown`, `cost` field to `WebTextResult`/`WebStructuredResult` in `fetch-client.ts`.
7. Rebuild: `npm run build && npm run build:web` — zero TypeScript errors.
8. Run `npm test` — all existing + new tests pass.
9. Smoke-test: `GET http://localhost:3001/pricing` returns populated JSON array.

**Rollback**: Remove the four added exports from `index.ts`, remove the `GET /pricing` route,
revert `fetch-client.ts`. No database migrations or config changes involved.

## Open Questions

- **Q1**: Should `FALLBACK_PRICING` emit a runtime warning (pino WARN) to help maintainers
  discover missing models faster? → Recommended yes; guard behind `debug` flag to avoid noise.
- **Q2**: Should `GET /pricing` be authenticated in future (e.g. require the same API key header
  as other routes)? → Not in v0.1; pricing data is public. Revisit if a multi-tenant deployment
  is considered.

