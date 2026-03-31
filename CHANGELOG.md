# Changelog

All notable changes to `ai-powered` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] – 2026-03-31

### Added

- **Standard API compatibility layer** (`src/ai-powered/server/compat/`): seven `/v1/` routes allow
  existing OpenAI and Anthropic client SDKs to point at the `ai-powered` proxy with no code changes.
  - `POST /v1/chat/completions` — OpenAI Chat Completions (text, streaming, structured output).
  - `POST /v1/messages` — Anthropic Messages API (text, streaming with 6-event SSE sequence).
  - `GET  /v1/models` — static aggregate model list across all active providers.
  - `POST /v1/images/generations` — OpenAI Images API.
  - `POST /v1/audio/transcriptions` — OpenAI Whisper (multipart/form-data).
  - `POST /v1/audio/speech` — OpenAI TTS (binary audio response).
  - `POST /v1/video/generations` — `ai-powered`-native video generation in the `/v1/` namespace.
- **`GET /pricing` endpoint**: returns the full `MODEL_PRICING` table as a JSON array; supports
  `?modality=` and `?model=` query parameters for narrowed lookups.
- **Shot-list parser extraction** (`integrations/web-example/shot-list-parsers.js`): shot-list
  parsing logic extracted from `app.js` into a standalone module for easier testing and reuse.
- **Service-management scripts**: `scripts/cycle-service.ps1`, `scripts/docker-start.ps1`,
  `scripts/docker-stop.ps1` for local Docker-based development workflows.
- **Compat integration tests** (`tests/integration/compat.test.ts`) and unit tests
  (`tests/unit/compat-anthropic.test.ts`, `tests/unit/compat-openai.test.ts`,
  `tests/unit/model-router.test.ts`, `tests/unit/shot-list-parsing.test.ts`).

### Changed

- **Package scoped** to `@mytech-today-now/ai-powered` — all install and import examples in
  `README.md` updated accordingly; npm badge URL corrected.
- **`README.md`** — new _Standard API Compatibility_ section (§7) documents the `/v1/` endpoint
  table, provider × modality support matrix, and quick-start examples for both OpenAI and Anthropic
  SDKs. `GET /pricing` added to the serve command summary line.
- **`POST /batch`** NDJSON stream now includes per-item `cost` data (`totalUsd`, `perVideoUsd`)
  for real-time UI cost tallying without a second request.
- **Mock provider** (`src/ai-powered/providers/mock.ts`) updated to return realistic cost
  metadata in batch responses.
- **Web playground** (`integrations/web-example/app.js`, `styles.css`) — cost badges on shot
  cards, live running-total tally in the progress bar, and improved offline HTML report parity.
- **`.gitignore`** — reorganised into labelled sections; added WIP/internal exclusions
  (`ai-prompts/`, `openspec/`, `.beads/`, `scripts/_*.ps1`) and standard OS/editor noise patterns.

### Fixed

- `GET /models` route now correctly aggregates models from all active providers instead of only
  the default provider.
- Streaming responses on `/v1/messages` now emit the correct 6-event Anthropic SSE sequence
  (`message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` →
  `message_delta` → `message_stop`) so the official Anthropic SDK receives a well-formed stream.

---

## [0.2.0] – 2026-03-28

### Added

- Scoped NPM package name `@mytech-today-now/ai-powered`.
- `POST /batch` endpoint: sequential NDJSON streaming for multi-item AI jobs.
- `POST /structured` endpoint: enforced JSON-schema output via provider structured-output APIs.
- `POST /stream` SSE endpoint: `data: {"delta":"…"}` / `data: [DONE]` protocol.
- `lumaai` video provider integration with `POST /video`.
- Budget tracking: `budgetSession` / `warnBudget` config fields; `BudgetExceededError` on
  overage.
- Circuit-breaker / retry / fallback pipeline in `AiClient`.
- `ConversationSession` and `BrowserConversationSession` for multi-turn context management.
- Web bundle (`dist-web/`) via Vite: `ai-powered/web` entry point, browser-safe ESM + UMD.
- Plugin pipeline: `onRequest` / `onResponse` hooks; built-in `createPromptShieldPlugin`.

---

## [0.1.0] – 2026-03-27

### Added

- `AiConfig` Zod schema with full field set (modality, provider, model, apiKey,
  temperature, maxTokens, systemPrompt, stream, profile, fallbackProviders,
  budgetSession, warnBudget, plugins, templateDirs, mock, logFile, debug).
- Layered config loader: global `~/.ai-powered/config.json` → project-local
  `./.ai-powered/config.json` → named profile → `AI_*` environment variables → CLI flags.
- Config version mismatch detection with automatic backup and migration.
- `package.json`, `tsconfig.json`, `vite.config.ts` scaffolding for dual Node + browser builds.
- `.env.example` documenting all environment variables.
- `.gitignore`, `.eslintrc.json`, `.prettierrc`, `lint-staged` configuration.
- Husky pre-commit hook: lint-staged + secret-scanning.
- GitHub Actions CI workflow: build, lint, test (`AI_MOCK=true`), publish on release.
- `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE` (MIT).

[0.3.0]: https://github.com/mytech-today-now/ai-powered/releases/tag/v0.3.0
[0.2.0]: https://github.com/mytech-today-now/ai-powered/releases/tag/v0.2.0
[0.1.0]: https://github.com/mytech-today-now/ai-powered/releases/tag/v0.1.0

