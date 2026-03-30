# Tasks: more-video-providers

## 0 — Research and Approval (REQUIRED BEFORE ANY CODE)

- [ ] Compare Runway, Luma AI, and HailuoAI on the following axes:
      API key acquisition process, SDK quality and TypeScript support, async polling mechanism
      and typical job duration, pricing model (per-second? per-request?), image-to-video support,
      rate limits, and data-format of the response (URL vs. binary)
- [ ] Produce a written comparison (can be a comment in the PR or a short internal doc)
- [ ] Present the recommendation to the assignee and receive explicit written approval
- [ ] Record the chosen provider name (e.g. `"lumaai"`) — use it everywhere `<name>` appears below

## 1 — Dependency

- [ ] Install the chosen SDK: `npm install <chosen-sdk>` (e.g. `npm install lumaai` or
      `npm install @runwayml/sdk`); commit the updated `package.json` and `package-lock.json`

## 2 — Core Type Extension (`src/ai-powered/core.ts`)

- [ ] Add the new provider name string to `ProviderNameSchema` z.enum (e.g. add `"lumaai"`)
      so the new provider is a valid `ProviderName` throughout the type system
- [ ] Confirm `tsc --noEmit` passes with zero errors after the enum change

## 3 — Provider Implementation (`src/ai-powered/providers/<name>.ts`)

- [ ] Create `src/ai-powered/providers/<name>.ts` extending `BaseProvider`
- [ ] Declare `readonly name: ProviderName = "<name>"`
- [ ] Declare `readonly supportedModalities: Modality[] = ["video"]`
      (add `"text"` or `"image"` only if the chosen provider genuinely supports them)
- [ ] Implement `generateVideo(prompt, options?)`: - Initialise the SDK client with the API key (read from env var, masked in all logs) - Submit the text-to-video job via the SDK or REST call - Poll the job status endpoint at `pollIntervalMs` (default 3 000 ms) intervals,
      respecting `options.signal` for cancellation - Throw `ProviderError` if the job fails or `pollTimeoutMs` (default 300 000 ms) is exceeded - Fetch the video binary from the returned URL (if URL-based) and convert to
      `data:video/mp4;base64,…` data URI - Return a fully populated `VideoResult`
- [ ] Implement `generateVideoFromImage(imageUrl, prompt, options?)`: - If the chosen provider supports image-to-video: implement analogously to `generateVideo` - If not: `throw new ProviderCapabilityError(this.name, "video")`
- [ ] Implement `listModels(modality?)`: - Return a static array of `ModelDescriptor[]` with `capabilities: ["video"]` - Filter by `modality` if provided - Optionally: fetch live model list from provider API with static fallback
- [ ] Add JSDoc comment block on every public method
- [ ] Run `tsc --noEmit` — zero errors under strict mode

## 4 — Provider Registration (`src/ai-powered/providers/index.ts`)

- [ ] Import the new provider class
- [ ] Add it to the `REGISTRY` map: `["<name>", <ClassName>]`
- [ ] Re-export the class

## 5 — Server Route Update (`src/ai-powered/server/routes.ts`)

- [ ] Add an entry to `PROVIDER_META`:
      `{ id: "<name>", name: "<Display Name>", envKey: "<NAME>_API_KEY", modalities: ["video"] }`
- [ ] Confirm `GET /providers` returns the new entry with correct `active` status

## 6 — Environment and Wizard (`env.example`, `src/ai-powered/cli/wizard.ts`)

- [ ] Add `# <NAME>_API_KEY=your-key-here   # <Provider display name> video generation API key`
      to `.env.example`
- [ ] Add a wizard prompt for the new API key when `<name>` is the selected provider: - Prompt for the key - Call `listModels("video")` to validate it - Display success or failure message; re-prompt on failure - Save the key to `.env` and the global config on success

## 7 — Tests (`tests/`)

- [ ] Unit test: `<name>Provider.listModels("video")` returns ≥ 1 descriptor with
      `capabilities` including `"video"` (no real API call; use static list or fixture)
- [ ] Unit test: `<name>Provider.generateVideo(prompt)` with a mocked SDK/fetch returns a
      `VideoResult` whose `data` starts with `"data:video/"` and `mimeType` is non-empty
- [ ] Unit test: `<name>Provider.generateVideo(prompt, { signal: aborted })` throws
      `DOMException` with `name: "AbortError"`
- [ ] Unit test: `<name>Provider.generateVideoFromImage(url, prompt)` throws
      `ProviderCapabilityError` if the provider does not support image-to-video (or returns a
      valid `VideoResult` if it does)
- [ ] Unit test: API key is masked in all Pino log output (spy on logger; assert no raw key)
- [ ] Integration test (mock mode): `AI_MOCK=true` → `getAiClient()` instantiates `MockProvider`
      not the new provider, even when the new provider is named in config

## 8 — Build and Smoke Test

- [ ] `npm run build` — zero TypeScript errors in Node build
- [ ] `npm run build:web` — zero errors in browser bundle; no new Node built-ins leaked
- [ ] `npm test` — all tests pass (including existing provider tests; no regressions)
- [ ] `npm run lint` — zero lint errors
- [ ] End-to-end smoke test via web demo: start proxy (`npm run serve`), open Video tab,
      select the new provider, enter a prompt, click Generate Video, verify a video is displayed
- [ ] Confirm raw API key does not appear in any log file or in `ai-powered.jsonl`
- [ ] Confirm `git log --all -p` contains no secrets (no raw API key in any commit)
