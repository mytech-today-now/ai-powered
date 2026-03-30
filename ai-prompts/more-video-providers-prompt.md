JIRA Ticket
Issue Key: AI-002
Issue Type: Task (Research + Implementation)
Summary: Add Real Video Generation Provider to ai-powered (Runway, Luma AI, or HailuoAI)
Description

1. Background
The ai-powered framework currently supports video generation via the mock provider only. No production video provider is wired up — calls to any real provider (e.g. openai, anthropic, venice) return a 503 because none of them implement the video modality. The mock provider returns an empty data payload and is only suitable for automated testing.

The goal of this ticket is to research the available video generation providers, select the best fit given the project's existing architecture (BaseProvider, ProviderCallOptions, VideoResult), and implement it as a first-class named provider following the same patterns as openai.ts, anthropic.ts, and venice.ts.

2. Provider Landscape (as of Q1 2026)

The following providers have public REST APIs suitable for server-side integration:

| Provider | Models | API Status | npm SDK | Notes |
|---|---|---|---|---|
| **Runway** | Gen-3 Alpha, Gen-3 Turbo | GA | `@runwayml/sdk` | High quality; async job polling required |
| **Luma AI** | Dream Machine 1.5, Ray 2 | GA | `lumaai` | Clean REST API; async polling |
| **HailuoAI (MiniMax)** | Hailuo Video-01 | GA | REST only | Competitive quality; requires polling |
| **Kling AI** | Kling 1.5, Kling 2.0 | GA (via partners) | REST only | Strong motion; no official SDK |
| **Pika Labs** | Pika 2.1 | Beta | REST only | API in beta; limited availability |
| **Stable Video Diffusion** | SVD, CogVideoX | Open source | Self-hosted | No managed API; infrastructure required |
| **Veo 2** | Veo 2 | GA via Vertex AI | `@google-cloud/vertexai` | Requires GCP credentials |
| **Sora** | Sora | No public API | — | OpenAI — not available via REST yet |
| **Wan** | Wan 2.1 | Open weight | Self-hosted | Alibaba open-weight; no managed API |

Recommended candidates (managed API, no self-hosting required): **Runway**, **Luma AI**, **HailuoAI**.

3. Implementation Requirements

The selected provider must:

Be implemented in src/ai-powered/providers/<name>.ts following the BaseProvider abstract class pattern.
Implement generateVideo(prompt: string, options?: ProviderCallOptions): Promise<VideoResult> supporting text-to-video at minimum.
Implement generateVideoFromImage(imageUrl: string, prompt: string, options?: ProviderCallOptions): Promise<VideoResult> for image-to-video (if the chosen provider supports it).
Implement listModels(modality?: Modality): Promise<ModelDescriptor[]> with correct capabilities: ["video"] on each video model descriptor.
Handle asynchronous job polling internally — the provider's generate call must block (with a configurable timeout/poll interval) until the video is ready and return a completed VideoResult. The caller must not be required to manage polling state.
Return VideoResult with data as a base64 data URI (data:video/mp4;base64,…) matching the existing ImageResult and AudioResult transport convention. If the provider returns a URL, fetch the binary and convert to a data URI server-side.
Include the provider's API key in .env.example and document it in the wizard (src/ai-powered/cli/wizard.ts).
Register the provider in src/ai-powered/providers/index.ts and expose it via the /providers endpoint's modalities array so the web UI filters it correctly.
Mask the API key in all logs using the existing maskApiKey() utility with an appropriate prefix pattern.
Degrade gracefully for unsupported modalities: calling generateText() on a video-only provider must throw ProviderCapabilityError, not an unhandled exception.

4. Constraints and Conventions

Must extend BaseProvider — no standalone HTTP clients outside the provider class.
Use the official npm SDK where one exists (e.g. lumaai, @runwayml/sdk); fall back to native fetch for providers with REST-only APIs.
No new direct dependencies on axios or node-fetch — the project uses the official SDKs or native fetch exclusively.
All polling must respect the existing AbortSignal / ProviderCallOptions.signal pattern so callers can cancel long-running video jobs.
Mock mode (AI_MOCK=true) must be unaffected — the mock provider already handles video in tests; the new provider must not break mock mode.
Provider fallback/failover in the core must continue to work: if the new provider fails, the core should fall through to the next provider in the fallbackProviders list.
The provider file must have JSDoc on every public method.

5. Required Approval Step

Before writing any implementation code:
1. Research the three recommended candidates (Runway, Luma AI, HailuoAI) and produce a short comparison covering: API key acquisition, SDK quality, async polling mechanism, pricing model, and image-to-video support.
2. Present the recommendation and implementation plan to the assignee for approval.
3. Proceed with implementation only after explicit approval.

6. Acceptance Criteria

New provider file src/ai-powered/providers/<name>.ts compiles with zero TypeScript errors under strict mode.
generateVideo() returns a valid VideoResult with a non-empty data URI when called against the live API (integration smoke test).
generateVideoFromImage() returns a valid VideoResult when the provider supports image-to-video; throws ProviderCapabilityError otherwise.
listModels("video") returns at least one ModelDescriptor with capabilities: ["video"].
The provider appears in GET /providers with "video" in its modalities array and active: true when its API key is set.
The web UI Video tab shows the new provider in the provider dropdown when in proxy mode.
AI_MOCK=true continues to route all video calls to MockProvider — the new provider is never instantiated in mock mode.
API key is masked in all Pino log output; raw key never appears in stdout, stderr, or ai-powered.jsonl.
.env.example includes the new provider's API key variable with a descriptive comment.
Wizard prompts for the new API key and validates it with a lightweight listModels call before saving.
All existing tests pass (npm test) — no regressions.
At least one unit test covers the new provider using AI_MOCK=true / fixture data; no real API credentials are required in CI.

Definition of Done

Implementation reviewed and approved by assignee before coding begins.
Code passes lint (npm run lint), type-check (tsc --noEmit), and full test suite (npm test).
Provider smoke-tested end-to-end via the web demo (integrations/web-example/) with the Video tab.
All changes committed; no secrets in git history.

Labels: typescript, video, ai, provider, multi-modal
Priority: Medium
Assignee: Senior TypeScript Engineer (or AI coding agent)
Component: AI Infrastructure / Providers

