# Summary: more-video-providers

## One-liner

Add a production text-to-video provider (Runway, Luma AI, or HailuoAI) to `ai-powered`
so the Video tab in the web demo works against a live API.

## Problem

The entire video pipeline exists — `generateVideo()`, `POST /video`, the web demo Video tab —
but every real provider throws `ProviderCapabilityError` for video. Users see HTTP 503.
Only `MockProvider` works, and it returns an empty payload.

## Solution

Implement one new `BaseProvider` subclass for the chosen video API. The provider:

- Calls the API's text-to-video endpoint
- Polls the async job status until completion (internally — callers just `await`)
- Converts the result to a base64 data URI matching the `VideoResult` contract
- Optionally supports image-to-video if the chosen API provides it
- Registers in `providers/index.ts` and `PROVIDER_META` so the web UI sees it

## Scope at a glance

| Category           | Count | Details                                                                              |
| ------------------ | ----- | ------------------------------------------------------------------------------------ |
| New files          | 1     | `src/ai-powered/providers/<name>.ts`                                                 |
| Modified files     | 5     | `core.ts`, `providers/index.ts`, `server/routes.ts`, `.env.example`, `cli/wizard.ts` |
| New npm dependency | 1     | Chosen provider SDK (e.g. `lumaai`, `@runwayml/sdk`)                                 |
| New tests          | ≥ 5   | Provider unit tests + mock-mode isolation test                                       |

## Key constraints

- **Approval gate:** provider must be chosen and approved (AI-002 §5) before coding starts
- **No breaking changes:** existing providers, modalities, CLI, and tests are unaffected
- **Mock-mode safe:** `AI_MOCK=true` always routes to `MockProvider`
- **Data URI contract:** `VideoResult.data` is always a `data:video/*;base64,…` string

## Implementation order

```
0. Research → approval
1. npm install <sdk>
2. Extend ProviderNameSchema in core.ts
3. Implement providers/<name>.ts
4. Register in providers/index.ts + PROVIDER_META
5. Update .env.example + wizard.ts
6. Write tests
7. Build, lint, test, smoke test
```

## Related artifacts

- Source JIRA: `ai-prompts/more-video-providers-prompt.md` (AI-002)
- Full spec: `openspec/changes/more-video-providers/specs/video-providers/spec.md`
- Baseline provider spec: `openspec/changes/ai-powered/specs/providers/spec.md`
- BaseProvider contract: `src/ai-powered/providers/base.ts`
