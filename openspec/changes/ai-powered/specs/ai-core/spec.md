## ADDED Requirements

### Requirement: Unified AiClient interface
The system SHALL expose an `AiClient` interface covering all four modalities — text generation,
image generation, audio transcription, audio synthesis, and video generation — plus streaming.
Every method SHALL accept an optional `AbortSignal` for cancellation. The interface SHALL be
exported from `src/ai-powered/index.ts` as the primary library entry point.

#### Scenario: Text generation call
- **WHEN** a caller invokes `client.generateText(prompt, options)`
- **THEN** the system returns a `TextResult` containing `content`, `model`, `usage` (tokens),
  `cost`, and `modality: 'text'`

#### Scenario: Streaming text generation
- **WHEN** a caller invokes `client.streamText(prompt, options)`
- **THEN** the system returns an `AsyncIterable<string>` emitting text deltas as they arrive
  from the provider without buffering the full response

#### Scenario: Image generation call
- **WHEN** a caller invokes `client.generateImage(prompt, options)`
- **THEN** the system returns an `ImageResult` containing the image data (URL or base64),
  `model`, `cost`, and `modality: 'image'`

#### Scenario: Audio transcription call
- **WHEN** a caller invokes `client.transcribeAudio(buffer, options)`
- **THEN** the system returns a `TranscriptionResult` with `text`, `model`, and `cost`

#### Scenario: Audio synthesis call
- **WHEN** a caller invokes `client.synthesizeSpeech(text, options)`
- **THEN** the system returns an `AudioResult` with a `Buffer`, `mimeType`, `model`, and `cost`

#### Scenario: Unsupported modality on provider
- **WHEN** a caller requests a modality the active provider does not support
- **THEN** the system throws a `ProviderCapabilityError` with a message naming the provider
  and modality, and does NOT fall back silently

---

### Requirement: AiConfig Zod schema
The system SHALL define `AiConfig` as a Zod schema covering: `modality`, `provider`, `model`,
`apiKey`, `temperature`, `maxTokens`, `systemPrompt`, `stream`, `profile`, `fallbackProviders`,
`fallback` (bool), `budgetSession`, `warnBudget`, `plugins`, `templateDirs`, `mock`, `logFile`,
`debug`, and per-modality defaults. Runtime validation SHALL run on every config load.

#### Scenario: Valid config accepted
- **WHEN** a config object satisfies the Zod schema
- **THEN** the system loads it without error and returns the typed `AiConfig` object

#### Scenario: Invalid config rejected
- **WHEN** a config object fails Zod validation (e.g., missing required `provider`)
- **THEN** the system throws a `ConfigError` with a human-readable message listing all
  validation failures before making any API call

---

### Requirement: getAiClient factory
The system SHALL export `getAiClient(toolName?, overrides?)` that reads layered config,
resolves the active profile, instantiates the correct provider, attaches the plugin pipeline,
and returns a fully configured `AiClient`. `overrides` SHALL deep-merge with config (CLI
flags take highest precedence).

#### Scenario: Factory with no overrides
- **WHEN** `getAiClient()` is called with no arguments
- **THEN** the system reads config from the default profile, instantiates the configured
  provider, and returns a ready `AiClient`

#### Scenario: Factory with CLI overrides
- **WHEN** `getAiClient('blog-cli', { provider: 'anthropic', model: 'claude-3-5-sonnet' })` is called
- **THEN** the returned client uses the Anthropic provider regardless of config file settings

---

### Requirement: Dynamic model discovery
The system SHALL expose `listAvailableModels(provider, modality)` that queries the provider's
live API and returns an array of `{ id, name, capabilities, contextWindow? }` objects.
Results SHALL be cached with a configurable TTL (default 5 minutes).

#### Scenario: List models for a provider
- **WHEN** `listAvailableModels('openai', 'text')` is called
- **THEN** the system returns a non-empty array of model descriptors without throwing

#### Scenario: Cached model list served on repeat call
- **WHEN** `listAvailableModels` is called twice within the TTL window
- **THEN** the second call returns the cached result and makes no HTTP request

---

### Requirement: Mock mode
The system SHALL support `AI_MOCK=true` environment variable and `--mock` CLI flag. When
active, every provider call SHALL return a deterministic fixture response shaped to match the
real provider API, including plausible `usage` and `cost` fields, without making any HTTP call.

#### Scenario: Mock text generation
- **WHEN** `AI_MOCK=true` is set and `generateText` is called
- **THEN** the system returns a fixture `TextResult` with `content: "[mock response]"`,
  non-zero token counts, and a non-zero cost value — with no outbound network request

#### Scenario: Mock mode in CI
- **WHEN** tests run with `AI_MOCK=true` and no API keys configured
- **THEN** all tests pass because no real credentials are required

