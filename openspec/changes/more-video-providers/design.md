## Context

The `ai-powered` library already has a complete video modality pipeline:
`BaseProvider.generateVideo()` → `AiClient.generateVideo()` → `POST /video` route →
`WebAiClient.generateVideo()` → web demo Video tab. The entire stack is plumbed; only the
concrete provider implementation is missing. The `MockProvider` fills the slot in CI (returning
an empty `data` field) but is not suitable for end-users.

The `ProviderNameSchema` Zod enum in `core.ts` must be extended to include the new provider
name (e.g. `"runway"` or `"lumaai"`). The `PROVIDER_META` constant in `server/routes.ts` must
also be updated so the web UI's `/providers` endpoint advertises the new provider for the video
tab filter. All other plumbing already exists.

## Goals / Non-Goals

**Goals:**

- One production-quality video provider that satisfies all acceptance criteria in AI-002 §6
- Async polling hidden from callers — `generateVideo()` blocks until the job is complete
- Data URI normalization — provider URLs/binaries are fetched and returned as `data:video/mp4;base64,…`
- AbortSignal support — long-running poll loops respect `ProviderCallOptions.signal`
- Mock-mode isolation — the new provider is never instantiated when `AI_MOCK=true`
- Zero regressions — all existing tests pass; no existing provider is modified

**Non-Goals:**

- Adding multiple video providers in this change (one is sufficient; others follow the pattern)
- Streaming video (chunked delivery) — full job completion is the contract in v0.1
- Client-side polling via the web module — polling runs server-side in the provider class

## Decisions

### D1 — Provider selection requires a mandatory research step

**Decision**: The implementing engineer (or agent) MUST complete the comparison in AI-002 §5
(Runway vs. Luma AI vs. HailuoAI) and receive explicit approval before writing code.
**Rationale**: API key acquisition, SDK maturity, pricing, and async polling mechanisms differ
significantly. Selecting the wrong provider mid-implementation is expensive to reverse.
**Implication**: `<name>` is a placeholder throughout this spec. The spec is otherwise complete.

### D2 — Polling encapsulated inside the provider class

**Decision**: `generateVideo()` polls the provider's job/status endpoint in a loop with
configurable `pollIntervalMs` (default 3 000 ms) and `pollTimeoutMs` (default 300 000 ms = 5 min).
**Rationale**: Callers use `await client.generateVideo(...)` — the same pattern as
`generateImage()`. Exposing a polling handle or requiring the caller to manage state would break
the `BaseProvider` contract and complicate the proxy route.
**Risk**: A 5-minute blocking HTTP request on the Express route. Mitigation: The Express timeout
is raised for the `/video` route; the `AbortSignal` allows early cancellation.

### D3 — Data URI normalization in the provider

**Decision**: If the provider returns a URL, the provider class fetches the binary and converts
it to `data:video/mp4;base64,…` before returning `VideoResult`. If it returns raw binary, the
provider base64-encodes it directly.
**Rationale**: The web module (`WebAiClient.generateVideo`) and web demo already expect a
data URI in `result.data`. Normalizing at the provider level keeps the rest of the stack clean.

### D4 — Official npm SDK preferred; native fetch as fallback

**Decision**: Use the provider's official npm SDK if one exists (e.g. `lumaai`, `@runwayml/sdk`).
Fall back to native `fetch` for providers with REST-only APIs.
**Rationale**: SDKs handle auth headers, error parsing, TypeScript types, and retry hints.
No axios or node-fetch — per project convention.

### D5 — ProviderNameSchema extended via z.enum update

**Decision**: Add the new provider name to the `z.enum([…])` in `core.ts`.
**Rationale**: This is the single source of truth for valid provider names; Zod validates CLI
flags and config files automatically. No parallel type definition is needed.

### D6 — Wizard validation via listModels()

**Decision**: The wizard validates the new API key by calling `listModels("video")` on the
provider. If it returns at least one model, the key is valid.
**Rationale**: Consistent with the existing wizard pattern; a lightweight, real API call that
doesn't consume credits.

## Risks / Trade-offs

- **Async job duration variability** → Video jobs can take 30 s – 5 min. The default 5-min
  timeout covers current provider SLAs; configurable via `pollTimeoutMs` option.
- **Provider API instability** → New providers change their APIs frequently. Mitigation: pin
  the SDK version; wrap SDK calls in the provider class so breakage is isolated.
- **Binary size of fetched videos** → A 10-second 720p video can be 20–50 MB. Passing this as
  a base64 string through the Express route and browser is expensive. Mitigation: document the
  limitation; a streaming/URL-passthrough mode is a v0.2 item.
- **Image-to-video support variability** → Not all candidates support image-to-video. If the
  chosen provider does not, `generateVideoFromImage()` MUST throw `ProviderCapabilityError`.

## Migration Plan

1. Research phase: compare Runway, Luma AI, HailuoAI per AI-002 §5. Get approval.
2. Install the chosen SDK: `npm install <sdk-package>`.
3. Extend `ProviderNameSchema` in `core.ts` with the new provider name.
4. Implement `src/ai-powered/providers/<name>.ts` per the spec below.
5. Register in `providers/index.ts` and update `PROVIDER_META` in `server/routes.ts`.
6. Add API key to `.env.example` and wizard prompt to `cli/wizard.ts`.
7. Write unit tests (fixture-based, `AI_MOCK=true` compatible).
8. Run `npm run build && npm run build:web` — zero TypeScript errors.
9. Run `npm test` — all existing + new tests pass.
10. Smoke-test end-to-end via the web demo Video tab with a real API key.

**Rollback**: Remove the new provider file, revert the four modified files, uninstall the SDK.
No database migrations or config-file format changes are involved.

## Open Questions

- **Q1**: Which provider is selected? (Blocked on mandatory research step — AI-002 §5.)
- **Q2**: Should `pollTimeoutMs` be configurable via `AiConfig` or only via `ProviderCallOptions`?
  → `ProviderCallOptions` is sufficient for v0.1; `AiConfig` is a v0.2 consideration.
- **Q3**: Should the provider also support text generation (if the chosen API provides it)?
  → Only implement modalities the provider genuinely supports; avoid ProviderCapabilityError
  for modalities that exist in the API but are not needed by this ticket.
