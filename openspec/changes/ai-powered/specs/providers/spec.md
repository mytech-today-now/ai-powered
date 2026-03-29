## ADDED Requirements

### Requirement: BaseProvider abstract class
The system SHALL define a `BaseProvider` abstract class in `src/ai-powered/providers/base.ts`
that every provider MUST extend. It SHALL declare abstract methods for each modality
(`generateText`, `generateImage`, `transcribeAudio`, `synthesizeSpeech`, `generateVideo`,
`streamText`, `listModels`) and a `readonly name: string` property. Adding a new provider
SHALL require only implementing this class and registering it in `providers/index.ts`.

#### Scenario: New provider registration
- **WHEN** a developer creates a class extending `BaseProvider` and adds it to `providers/index.ts`
- **THEN** the core factory can instantiate it via `getAiClient({ provider: '<name>' })` without
  any other code changes

---

### Requirement: OpenAI provider
The system SHALL implement an OpenAI provider using the official `openai` npm SDK supporting:
GPT-4o and o1 series for text; DALL·E 3 for image; Whisper for transcription; TTS for synthesis.
API key SHALL be read from `OPENAI_API_KEY` env var or config. Keys SHALL be masked as `sk-****`
in all logs and outputs.

#### Scenario: OpenAI text generation with streaming
- **WHEN** `generateText` is called with `stream: true` on the OpenAI provider
- **THEN** the system uses the OpenAI streaming API and emits deltas via `AsyncIterable<string>`

---

### Requirement: Anthropic provider
The system SHALL implement an Anthropic provider using `@anthropic-ai/sdk` supporting Claude
models for text generation and streaming. API key SHALL be read from `ANTHROPIC_API_KEY` and
masked as `sk-ant-****`. Unsupported modalities SHALL throw `ProviderCapabilityError`.

#### Scenario: Anthropic text generation
- **WHEN** `generateText` is called on the Anthropic provider with a valid prompt
- **THEN** the system returns a `TextResult` with content from a Claude model

#### Scenario: Anthropic image generation attempted
- **WHEN** `generateImage` is called on the Anthropic provider
- **THEN** the system throws `ProviderCapabilityError` with provider name and modality

---

### Requirement: xAI/Grok provider
The system SHALL implement an xAI/Grok provider using the latest official xAI SDK supporting
text generation and streaming. API key SHALL be read from `XAI_API_KEY` and masked as
`xai-****`. Unsupported modalities SHALL throw `ProviderCapabilityError`.

#### Scenario: Grok text generation
- **WHEN** `generateText` is called on the Grok provider with a valid prompt
- **THEN** the system returns a `TextResult` with content from a Grok model

---

### Requirement: Venice.ai provider
The system SHALL implement a Venice.ai provider as a first-class named provider using the
`openai` npm SDK with `baseURL: 'https://api.venice.ai/api/v1'` and `VENICE_API_KEY`. It SHALL
support: text generation via `/chat/completions` (streaming, temperature, max_tokens, system
prompt, structured JSON); image generation via Venice image endpoint (prompt, model, width,
height, steps). Audio, speech, and video SHALL gracefully throw `ProviderCapabilityError` if
not yet available. Dynamic model discovery SHALL call `GET /models` and filter by capability.

#### Scenario: Venice text generation
- **WHEN** `generateText` is called on the Venice provider with model `llama-3.3-70b`
- **THEN** the system calls `/chat/completions` and returns a valid `TextResult`

#### Scenario: Venice image generation
- **WHEN** `generateImage` is called with prompt and `model: 'fluently-xl'`
- **THEN** the system calls the Venice image endpoint and returns an `ImageResult` with
  base64-encoded image data or a URL per the API response

#### Scenario: Venice unsupported modality
- **WHEN** `synthesizeSpeech` is called on the Venice provider and the endpoint is unavailable
- **THEN** the system throws `ProviderCapabilityError` (not an unhandled exception)

#### Scenario: Venice model discovery
- **WHEN** `listModels('venice', 'image')` is called
- **THEN** the system calls `GET /models`, filters by image capability, and returns results
  without requiring code changes when Venice adds new models

---

### Requirement: Custom and local provider
The system SHALL support a built-in `custom` provider type accepting `baseURL`, `apiKey`,
`headers`, and `type` (`openai-compatible` | `ollama` | `other`). For Ollama endpoints
(default `http://localhost:11434`), the system SHALL auto-detect and query available models.
Custom providers SHALL be persisted in `~/.ai-powered/config.json`.

#### Scenario: Ollama local model usage
- **WHEN** the provider is configured as `custom` with `type: 'ollama'` and a local base URL
- **THEN** `listModels` queries the Ollama `/api/tags` endpoint and returns local model names

---

### Requirement: Mock provider
The system SHALL implement a mock provider in `src/ai-powered/providers/mock.ts` that returns
deterministic, provider-shaped fixtures for every modality without making HTTP calls.
Mock responses SHALL include plausible `usage` (token counts) and `cost` fields.

#### Scenario: Mock provider selected automatically
- **WHEN** `AI_MOCK=true` is set
- **THEN** the factory selects `MockProvider` regardless of the configured real provider

