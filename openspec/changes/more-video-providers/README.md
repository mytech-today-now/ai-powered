# Change: more-video-providers

**JIRA:** AI-002  
**Type:** Research + Implementation  
**Priority:** Medium  
**Status:** Spec complete — awaiting provider selection approval before implementation

## Summary

Adds the first production-ready video generation provider to `ai-powered`.
The framework already has a full video pipeline (BaseProvider, AiClient, POST /video, web demo
Video tab), but every real provider throws `ProviderCapabilityError` for video. Only the mock
provider handles video. This change wires up a managed REST API (Runway, Luma AI, or HailuoAI —
chosen after mandatory research) so the Video tab works end-to-end against a live API.

## Artifacts

| Artifact                                                         | Description                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`proposal.md`](proposal.md)                                     | Why this change is needed and what it modifies                    |
| [`design.md`](design.md)                                         | Technical decisions, risks, migration plan, open questions        |
| [`specs/video-providers/spec.md`](specs/video-providers/spec.md) | Requirements and scenarios for the new provider                   |
| [`tasks.md`](tasks.md)                                           | Implementation checklist (research → code → tests → smoke test)   |
| [`deltas.md`](deltas.md)                                         | Summary of all spec changes relative to the `ai-powered` baseline |
| [`summary.md`](summary.md)                                       | One-page human-readable summary                                   |

## Scope

### Files to create

- `src/ai-powered/providers/<name>.ts` — new provider class

### Files to modify

- `src/ai-powered/core.ts` — extend `ProviderNameSchema` enum
- `src/ai-powered/providers/index.ts` — import + register new provider
- `src/ai-powered/server/routes.ts` — add entry to `PROVIDER_META`
- `.env.example` — add new API key variable
- `src/ai-powered/cli/wizard.ts` — add wizard prompt for new provider
- `tests/` — add unit tests for the new provider

## Pre-conditions

1. The mandatory research step (AI-002 §5) must be completed and the provider selection must
   be approved before any implementation code is written.
2. The chosen provider's npm SDK (if one exists) must be installed.

## Acceptance Criteria (from AI-002 §6)

- [ ] New provider compiles with zero TypeScript errors under strict mode
- [ ] `generateVideo()` returns a valid `VideoResult` with a non-empty data URI against the live API
- [ ] `generateVideoFromImage()` returns a valid `VideoResult` if supported; throws `ProviderCapabilityError` otherwise
- [ ] `listModels("video")` returns ≥ 1 descriptor with `capabilities: ["video"]`
- [ ] `GET /providers` includes the new provider with `active: true` when API key is set
- [ ] Web demo Video tab shows and uses the new provider in proxy mode
- [ ] `AI_MOCK=true` routes all video calls to `MockProvider` — new provider never instantiated
- [ ] API key is masked in all log output; raw key never in stdout/stderr/`ai-powered.jsonl`
- [ ] `.env.example` includes the new API key variable with a comment
- [ ] Wizard prompts for the key and validates it via `listModels("video")`
- [ ] All existing tests pass (`npm test`) — no regressions
- [ ] At least one unit test covers the new provider using fixture data; no real credentials needed in CI
