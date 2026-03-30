## ADDED Requirements

> **Scope note:** This spec extends `openspec/changes/ai-powered/specs/resilience-and-cost/spec.md`.
> All existing requirements in that spec (retries, circuit breaker, fallback, token estimation,
> cost tracking, budget limits) remain unchanged. This document adds the concrete pricing layer
> that backs those requirements.

---

### Requirement: MODEL_PRICING — central pricing table

The system SHALL maintain a single `MODEL_PRICING: Record<string, ModelPricing>` constant in
`src/ai-powered/utils.ts` as the authoritative source of model rates. The constant SHALL NOT be
exported; `listPricing()` is the public surface. Each entry SHALL use the `ModelPricing`
interface with the fields applicable to the model's modality:

- **Text / audio TTS**: `promptPer1kUsd` (required), `completionPer1kUsd` (required for text)
- **Image**: `perImageUsd` (required)
- **Audio transcription**: `perMinuteUsd` (required)
- **Video**: `perVideoUsd` (required); `promptPer1kUsd` and `completionPer1kUsd` SHALL both be `0`

The table SHALL include entries for every model exposed by every registered provider's
`listModels()` at the time of the release.

#### Scenario: All provider models have pricing entries

- **GIVEN** the list of models returned by every registered provider's `listModels()` call
- **WHEN** each model id is looked up in `MODEL_PRICING` (exact or prefix)
- **THEN** every model resolves to a non-fallback entry (no model relies solely on `FALLBACK_PRICING`)

---

### Requirement: FALLBACK_PRICING — safe default for unknown models

The system SHALL define a `FALLBACK_PRICING: ModelPricing` constant used when no exact or
prefix match exists in `MODEL_PRICING`. `lookupModelPricing` SHALL never throw; it returns
`FALLBACK_PRICING` as a last resort. A DEBUG-level log warning SHALL be emitted when the
fallback fires, including the unrecognised model id.

#### Scenario: Unknown model resolved without error

- **WHEN** `lookupModelPricing('totally-unknown-model-xyz')` is called
- **THEN** the function returns `FALLBACK_PRICING` without throwing and a DEBUG log is emitted
  containing the model id

---

### Requirement: `listPricing(filter?)` — full pricing table as `PricingEntry[]`

The system SHALL export `listPricing(filter?)` from `src/ai-powered/utils.ts` and re-export it
from `src/ai-powered/index.ts`. The function SHALL:

1. Return all `MODEL_PRICING` entries as `PricingEntry[]`, sorted alphabetically by model id.
2. Compute `modality` for each entry: `"video"` if `perVideoUsd` is defined; `"image"` if
   `perImageUsd` is defined; `"audio"` if `perMinuteUsd` is defined; otherwise `"text"`.
3. Compute `primaryUsd` as the main per-unit rate: `promptPer1kUsd` (text), `perImageUsd`
   (image), `perMinuteUsd` (audio), or `perVideoUsd` (video).
4. Accept an optional `filter` object:
   - `filter.modality` — when provided, return only entries whose derived `modality` matches.
   - `filter.model` — when provided, return only entries whose model id contains the substring
     (case-insensitive).
   - Both filters may be combined; the result is their intersection.

#### Scenario: Returns all models sorted alphabetically

- **WHEN** `listPricing()` is called with no filter
- **THEN** the result is an array where every entry has `model`, `modality`, and `primaryUsd`,
  and entries are ordered so that `result[i].model <= result[i+1].model` for all `i`

#### Scenario: Modality filter — video only

- **WHEN** `listPricing({ modality: 'video' })` is called
- **THEN** every entry in the result has `modality === 'video'` and `perVideoUsd` defined

#### Scenario: Model substring filter

- **WHEN** `listPricing({ model: 'gpt-4' })` is called
- **THEN** every entry in the result has a model id containing the string `"gpt-4"` and no
  entries for models that do not contain `"gpt-4"` appear

#### Scenario: Combined filter returns intersection

- **WHEN** `listPricing({ modality: 'text', model: 'claude' })` is called
- **THEN** every entry has `modality === 'text'` AND a model id containing `"claude"`

#### Scenario: Filter with no matches returns empty array

- **WHEN** `listPricing({ modality: 'audio', model: 'gpt-4' })` is called
- **THEN** the result is an empty array (no audio model ids contain `"gpt-4"`)

---

### Requirement: `lookupModelPricing(model)` — single-model rate lookup

The system SHALL export `lookupModelPricing(model: string)` from `src/ai-powered/utils.ts` and
re-export it from `src/ai-powered/index.ts`. Lookup SHALL proceed in order:

1. Exact key match in `MODEL_PRICING`.
2. Longest key in `MODEL_PRICING` that is a prefix of `model`.
3. `FALLBACK_PRICING` (with DEBUG log).

#### Scenario: Exact match

- **WHEN** `lookupModelPricing('gpt-4o')` is called
- **THEN** the result equals the `MODEL_PRICING['gpt-4o']` entry exactly

#### Scenario: Longest-prefix match

- **WHEN** `lookupModelPricing('gpt-4o-mini-2024-07-18')` is called
- **THEN** the result equals the `MODEL_PRICING['gpt-4o-mini']` entry (prefix match beats
  shorter prefix `'gpt-4o'` because `'gpt-4o-mini'` is longer and also a prefix)

#### Scenario: Fallback for unknown model

- **WHEN** `lookupModelPricing('unknown-model-xyz-9999')` is called
- **THEN** the result equals `FALLBACK_PRICING` and no exception is thrown

---

### Requirement: `calculateCost(model, usage, durationSeconds?)` — actual cost from usage

The system SHALL export `calculateCost` from `src/ai-powered/utils.ts`. The function SHALL:

1. Look up the model's pricing via `lookupModelPricing(model)`.
2. Compute cost based on modality:
   - **Video** (`perVideoUsd` defined): `totalUsd = perVideoUsd` (fixed per clip).
   - **Image** (`perImageUsd` defined): `totalUsd = perImageUsd` (fixed per image).
   - **Audio TTS** (`promptPer1kUsd > 0`, `perMinuteUsd` undefined): `totalUsd = promptPer1kUsd * promptTokens / 1000`.
   - **Audio transcription** (`perMinuteUsd` defined): `totalUsd = perMinuteUsd * durationSeconds / 60`.
   - **Text**: `totalUsd = promptPer1kUsd * promptTokens / 1000 + completionPer1kUsd * completionTokens / 1000`.
3. Round `totalUsd` to 6 decimal places: `Math.round(raw * 1e6) / 1e6`.
4. Return `{ totalUsd, isEstimate: false }`.

#### Scenario: Text model cost calculation

- **WHEN** `calculateCost('gpt-4o', { promptTokens: 500, completionTokens: 200, totalTokens: 700 })` is called
- **THEN** the result is `{ totalUsd: 0.0055, isEstimate: false }`
  (500/1000×0.005 + 200/1000×0.015 = 0.0025 + 0.003 = 0.0055)

#### Scenario: Video model — fixed cost

- **WHEN** `calculateCost('ray-flash-2', { promptTokens: 0, completionTokens: 0, totalTokens: 0 })` is called
- **THEN** the result is `{ totalUsd: 0.04, isEstimate: false }`

#### Scenario: Image model — fixed cost per image

- **WHEN** `calculateCost('dall-e-3', { promptTokens: 0, completionTokens: 0, totalTokens: 0 })` is called
- **THEN** the result is `{ totalUsd: 0.04, isEstimate: false }`

#### Scenario: Rounding to 6 decimal places

- **WHEN** `calculateCost` produces a raw value with more than 6 decimal places
- **THEN** `totalUsd` is rounded to exactly 6 decimal places

---

### Requirement: `estimateCost(model, promptText)` — pre-call cost estimate

The system SHALL export `estimateCost` from `src/ai-powered/utils.ts`. The function SHALL:

1. Estimate prompt tokens as `Math.ceil(promptText.length / 4)`.
2. For text models: estimate completion tokens as 50% of prompt token estimate.
3. For video, image, and audio: treat as fixed cost (token estimate irrelevant).
4. Compute cost using the same modality logic as `calculateCost`.
5. Round to 6 decimal places.
6. Always return `{ totalUsd, isEstimate: true }`.

#### Scenario: Text model — estimate from prompt

- **WHEN** `estimateCost('gpt-4o', 'Hello world')` is called (11 chars → 3 tokens estimated)
- **THEN** the result has `isEstimate: true` and a small positive `totalUsd`

#### Scenario: Video model — fixed cost regardless of prompt

- **WHEN** `estimateCost('ray-2', 'A mountain lake')` is called
- **THEN** the result is `{ totalUsd: 0.14, isEstimate: true }`

---

### Requirement: `GET /pricing` — HTTP pricing endpoint

The proxy server SHALL expose `GET /pricing` that calls `listPricing()` and returns the result
as a JSON array. The endpoint SHALL support:

- `?modality=` query param: one of `text`, `image`, `audio`, `video`; returns `400` if invalid.
- `?model=` query param: substring filter passed to `listPricing({ model })`.
  No authentication is required.

#### Scenario: Full pricing table

- **WHEN** `GET /pricing` is called with no query parameters
- **THEN** the response is `200 OK` with a JSON array sorted alphabetically by `model`,
  each element having `model`, `modality`, `primaryUsd`, and `promptPer1kUsd` fields

#### Scenario: Modality filter via query param

- **WHEN** `GET /pricing?modality=video` is called
- **THEN** the response is `200 OK` with an array where every entry has `modality: "video"`

#### Scenario: Model substring filter via query param

- **WHEN** `GET /pricing?model=claude` is called
- **THEN** the response is `200 OK` with an array where every entry's model id contains `"claude"`

#### Scenario: Invalid modality returns 400

- **WHEN** `GET /pricing?modality=invalid` is called
- **THEN** the response is `400 Bad Request`

---

### Requirement: Web module cost propagation

The system SHALL define `WebCostBreakdown { totalUsd: number; isEstimate: boolean }` in
`src/ai-powered/web/fetch-client.ts` and add an optional `cost?: WebCostBreakdown` field to
both `WebTextResult` and `WebStructuredResult`. When the proxy server returns a `cost` object
in its JSON response, `fetch-client.ts` SHALL extract it and include it in the returned result.

#### Scenario: Cost included in WebTextResult after proxy call

- **WHEN** `generateText(prompt)` is called in proxy mode and the server returns `cost`
- **THEN** the returned `WebTextResult` has `cost.totalUsd > 0` and `cost.isEstimate === false`

#### Scenario: Cost absent when proxy omits it

- **WHEN** the proxy response does not include a `cost` field
- **THEN** `result.cost` is `undefined` and no error is thrown
