## Why

The `ai-powered` framework has a fully-wired video modality in its core (`generateVideo`,
`VideoResult`, `POST /video`, the web-demo Video tab) but **no production video provider**.
Every call to `/video` with a real provider name returns HTTP 503 because every built-in
provider (`openai`, `anthropic`, `xai`, `venice`) throws `ProviderCapabilityError` for video.
Only `MockProvider` handles video, and it returns an empty payload suitable only for CI.

This change adds a first-class, production-ready video provider so that the Video tab in the
web demo works end-to-end against a live API — and so future consumers of the `ai-powered`
library have a reference implementation to follow when adding further video providers.

## What Changes

- **Add** one new provider file `src/ai-powered/providers/<name>.ts` implementing
  `generateVideo()` (text-to-video) and `generateVideoFromImage()` (image-to-video, if
  supported) against a managed REST API (Runway, Luma AI, or HailuoAI — selected after the
  mandatory research step defined in AI-002 §5).
- **Extend** `ProviderNameSchema` in `src/ai-powered/core.ts` to include the new provider name.
- **Register** the new provider in `src/ai-powered/providers/index.ts` (import + REGISTRY entry).
- **Add** the new provider to `PROVIDER_META` in `src/ai-powered/server/routes.ts` with
  `modalities: ["video"]` (and `"text"` only if the chosen provider supports it).
- **Add** the new provider's API key variable to `.env.example` with a descriptive comment.
- **Add** the new provider's API key prompt and validation to `src/ai-powered/cli/wizard.ts`.
- **Update** `src/ai-powered/specs/providers/spec.md` (this OpenSpec change's delta).

## Capabilities

### New Capabilities

- **`video-providers`**: A production-ready `generateVideo(prompt, options?)` implementation
  that calls a managed text-to-video API, handles async job polling internally (the caller
  receives a completed `VideoResult` — no polling state is exposed), converts the provider's
  URL/binary response to a base64 `data:video/mp4;base64,…` data URI, and returns a fully
  populated `VideoResult`. If the chosen provider supports image-to-video, a
  `generateVideoFromImage(imageUrl, prompt, options?)` implementation is also included.

### Modified Capabilities

- **`providers`** (`specs/providers/spec.md`): New requirement added for the selected video
  provider; existing requirements unchanged.
- **`proxy-server`** (`specs/proxy-server/spec.md`): `PROVIDER_META` updated to include the
  new provider entry; existing requirements unchanged.
- **`config-system`** (`.env.example`, `wizard.ts`): New API key variable and wizard prompt
  for the new provider.

## Impact

- **New file**: `src/ai-powered/providers/<name>.ts` (one concrete provider class).
- **Modified files**: `core.ts` (ProviderNameSchema), `providers/index.ts` (registry),
  `server/routes.ts` (PROVIDER_META), `.env.example`, `cli/wizard.ts`.
- **New npm dependency**: The official SDK for the chosen provider (e.g. `lumaai`,
  `@runwayml/sdk`). No axios or node-fetch; SDKs or native fetch only.
- **No breaking changes**: Existing providers, modalities, CLI commands, and tests are
  unaffected. `AI_MOCK=true` continues to route all video calls to `MockProvider`.
- **CI**: All tests continue to run under `AI_MOCK=true`; no real API credentials required.
  A new unit test covers the provider with fixture data under mock mode.
