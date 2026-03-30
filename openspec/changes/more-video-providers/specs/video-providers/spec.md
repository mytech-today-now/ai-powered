## MODIFIED Requirements

> **Scope note:** This spec extends `openspec/changes/ai-powered/specs/providers/spec.md`.
> All existing requirements in that spec remain unchanged. This document adds one new
> requirement (the selected video provider) and one new scenario to the `proxy-server` spec.

---

### Requirement: Video provider — text-to-video

The system SHALL implement a production video provider in
`src/ai-powered/providers/<name>.ts` that extends `BaseProvider` and overrides
`generateVideo(prompt, options?)`. The provider SHALL:

1. Call the chosen provider's text-to-video REST API or SDK method with the given prompt.
2. Handle asynchronous job creation internally: poll the provider's status/job endpoint at a
   configurable interval (`pollIntervalMs`, default 3 000 ms) until the job reaches a terminal
   state (`completed` or `failed`), or until `pollTimeoutMs` (default 300 000 ms) is exceeded.
3. Respect `ProviderCallOptions.signal` — if the `AbortSignal` fires during polling, stop
   immediately and throw `DOMException` with `name: "AbortError"`.
4. Convert the provider's response (URL or binary) to a base64 data URI
   (`data:video/mp4;base64,…`) before constructing `VideoResult`. If the provider returns a
   signed download URL, the provider class SHALL fetch the binary server-side and encode it.
5. Return a fully populated `VideoResult` with non-empty `data`, correct `mimeType`, and
   populated `cost` and `latencyMs` fields.
6. Set `readonly name` to the chosen `ProviderName` value and `readonly supportedModalities`
   to include `"video"` at minimum.
7. Include JSDoc on every public method explaining parameters, return value, and thrown errors.

#### Scenario: Successful text-to-video generation

- **GIVEN** a valid API key is set for the new provider
- **WHEN** `generateVideo("A mountain lake at sunrise, 4K, photorealistic")` is called
- **THEN** the system creates an async job, polls until completion, and returns a `VideoResult`
  where `data` matches `/^data:video\/[a-z0-9]+;base64,[A-Za-z0-9+/]+=*$/` and
  `mimeType` is a valid video MIME type (e.g. `"video/mp4"`)

#### Scenario: Polling respects AbortSignal

- **WHEN** `generateVideo(prompt, { signal: abortedSignal })` is called with an already-aborted signal
- **THEN** the provider throws `DOMException` with `name: "AbortError"` before making any HTTP call

#### Scenario: Job failure propagates as ProviderError

- **WHEN** the provider's status API returns a terminal `failed` state
- **THEN** the system throws `ProviderError` with a message containing the provider name and
  the failure reason from the API response

#### Scenario: Poll timeout exceeded

- **WHEN** the job has not completed after `pollTimeoutMs` milliseconds
- **THEN** the system throws `ProviderError` with a message indicating timeout

---

### Requirement: Video provider — image-to-video (conditional)

IF the chosen provider supports image-to-video, the system SHALL override
`generateVideoFromImage(imageUrl, prompt, options?)` on the provider class.
IF the chosen provider does NOT support image-to-video, the method SHALL throw
`ProviderCapabilityError` with modality `"video"` and a descriptive message.

#### Scenario: Image-to-video supported

- **WHEN** `generateVideoFromImage("https://example.com/frame.jpg", "Zoom out slowly")` is called
  on a provider that supports image-to-video
- **THEN** the system returns a valid `VideoResult` using the supplied image as the first frame

#### Scenario: Image-to-video not supported

- **WHEN** `generateVideoFromImage(…)` is called on a provider that does not support it
- **THEN** the system throws `ProviderCapabilityError` (not an unhandled exception)

---

### Requirement: Video provider — model discovery

The provider SHALL implement `listModels(modality?)` returning at least one `ModelDescriptor`
with `capabilities` containing `"video"`. If `modality` is supplied and is not `"video"`, the
method SHALL return an empty array (or only non-video models if the provider supports them).

#### Scenario: listModels filtered to video

- **WHEN** `provider.listModels("video")` is called
- **THEN** the result contains at least one descriptor with `capabilities` including `"video"`

#### Scenario: listModels filtered to unsupported modality

- **WHEN** `provider.listModels("audio")` is called on a video-only provider
- **THEN** the result is an empty array

---

### Requirement: Video provider — registration and discoverability

The system SHALL register the new provider in `src/ai-powered/providers/index.ts` and add a
corresponding entry to `PROVIDER_META` in `src/ai-powered/server/routes.ts` with at minimum
`modalities: ["video"]`. The `GET /providers` endpoint SHALL return the provider with
`active: true` when its API key environment variable is set.

#### Scenario: Provider appears in /providers with active: true

- **GIVEN** the new provider's API key environment variable is set to a non-empty string
- **WHEN** `GET /providers` is called
- **THEN** the response contains an entry for the new provider with `active: true` and
  `"video"` in its `modalities` array

#### Scenario: Provider absent from /providers when key not set

- **GIVEN** the new provider's API key environment variable is unset or empty
- **WHEN** `GET /providers` is called
- **THEN** the response contains an entry for the new provider with `active: false`

---

### Requirement: Video provider — API key masking

All log output, error messages, and debug traces involving the new provider's API key SHALL
pass through `maskApiKey()` before being written to any stream. The raw key SHALL never appear
in stdout, stderr, or `ai-powered.jsonl`.

#### Scenario: API key masked in debug log

- **WHEN** the provider is instantiated with a valid API key and `debug: true` is enabled
- **THEN** no log line contains the raw key; the key appears as `<prefix>****` where `<prefix>`
  matches the provider's known key prefix pattern

---

### Requirement: Video provider — mock mode isolation

When `AI_MOCK=true` or `config.mock` is `true`, the `createProvider()` factory SHALL return
`MockProvider` and the new provider class SHALL NOT be instantiated.

#### Scenario: Mock mode bypasses new provider

- **GIVEN** `AI_MOCK=true` is set and the new provider is the configured provider
- **WHEN** `getAiClient()` is called
- **THEN** the returned client uses `MockProvider`; no HTTP call is made to the real API

---

### Requirement: Video provider — environment and wizard integration

The new provider's API key variable (e.g. `RUNWAY_API_KEY`) SHALL be added to `.env.example`
with a descriptive comment. The interactive wizard (`src/ai-powered/cli/wizard.ts`) SHALL
prompt for the key when the user selects the new provider, validate it via a `listModels("video")`
call, and save it to `.env` and the global config on success.

#### Scenario: Wizard validates API key

- **WHEN** the user runs `ai-powered wizard`, selects the new provider, and enters a valid key
- **THEN** the wizard calls `listModels("video")`, receives at least one model, and saves the key

#### Scenario: Wizard rejects invalid API key

- **WHEN** the user enters an invalid key during wizard setup
- **THEN** the wizard displays an error and re-prompts rather than saving the bad key
