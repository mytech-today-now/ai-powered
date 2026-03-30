# Deltas: more-video-providers

This document summarises all capability specification changes introduced by the
`more-video-providers` change relative to the baseline established by the `ai-powered` change.

---

## Summary of Spec Changes

| Capability        | Status      | Spec Path                                                       |
| ----------------- | ----------- | --------------------------------------------------------------- |
| `video-providers` | ✅ ADDED    | `specs/video-providers/spec.md`                                 |
| `providers`       | ✏️ MODIFIED | `openspec/changes/ai-powered/specs/providers/spec.md`           |
| `proxy-server`    | ✏️ MODIFIED | `openspec/changes/ai-powered/specs/proxy-server/spec.md`        |
| `config-system`   | ✏️ MODIFIED | `.env.example`, `cli/wizard.ts` (new API key variable + prompt) |

No existing requirements were removed.

---

## ADDED: video-providers

New capability spec at `specs/video-providers/spec.md`.

Covers:

- **Text-to-video generation** — `generateVideo(prompt, options?)` with internal async polling,
  `AbortSignal` support, job-failure propagation, and poll-timeout propagation.
- **Image-to-video generation** — `generateVideoFromImage(imageUrl, prompt, options?)`;
  conditionally implemented depending on whether the chosen provider supports it; otherwise
  throws `ProviderCapabilityError`.
- **Model discovery** — `listModels(modality?)` returns at least one `ModelDescriptor` with
  `capabilities: ["video"]`.
- **Registration and discoverability** — new entry in `PROVIDER_META`; `GET /providers`
  returns `active: true` when the API key is set.
- **API key masking** — raw key never appears in any log or output stream.
- **Mock-mode isolation** — `AI_MOCK=true` bypasses the new provider entirely.
- **Environment and wizard integration** — `.env.example` entry and wizard prompt with
  validation via `listModels("video")`.

---

## MODIFIED: providers

**File:** `openspec/changes/ai-powered/specs/providers/spec.md`

**Change:** Add one new requirement block for the selected video provider (e.g. "Luma AI provider"
or "Runway provider") following the same structure as the existing OpenAI and Venice requirements.
The new block specifies: provider class name, API key env var, supported modalities, SDK used,
masking prefix, and the `ProviderCapabilityError` contract for unsupported modalities.

All existing requirements (`BaseProvider`, `OpenAI`, `Anthropic`, `xAI/Grok`, `Venice`,
`Custom/local`, `Mock`) are **unchanged**.

---

## MODIFIED: proxy-server

**File:** `openspec/changes/ai-powered/specs/proxy-server/spec.md`

**Change:** The `PROVIDER_META` constant in `server/routes.ts` gains one new entry for the
new provider. The `/providers` endpoint contract is unchanged; the new entry simply appears in
the response when the provider's API key is set. No route logic changes.

---

## MODIFIED: config-system

**Files:** `.env.example`, `src/ai-powered/cli/wizard.ts`

**Change:** One new environment variable (`<NAME>_API_KEY`) with a descriptive comment is
added to `.env.example`. The wizard gains a new branch for the new provider: prompt → validate
via `listModels("video")` → save on success, re-prompt on failure.

---

## Known Deviations from JIRA AI-002

| #   | JIRA Requirement                            | Deviation                              | Rationale                                                                                                           |
| --- | ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| D1  | Provider selected in ticket                 | Provider name is `<name>` placeholder  | Mandatory research + approval step (AI-002 §5) must complete first                                                  |
| D2  | `generateVideoFromImage` always implemented | Conditionally implemented              | Some candidates (e.g. HailuoAI v1) do not support image-to-video; `ProviderCapabilityError` is the correct fallback |
| D3  | Poll interval/timeout fixed                 | Configurable via `ProviderCallOptions` | Gives callers flexibility without adding `AiConfig` fields in v0.1                                                  |
