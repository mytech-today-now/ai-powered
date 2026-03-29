## Why

No shared AI infrastructure exists in this repository. Every future CLI tool (blog generator,
JIRA ticket generator, code reviewer, etc.) would have to re-implement provider selection, API
key management, multi-modal client instantiation, resilience, cost tracking, and security
masking independently — at high token cost and with guaranteed drift. `ai-powered` eliminates
this duplication permanently by providing a zero-dependency, publishable npm package that owns
all AI concerns and exposes them through four first-class invocation modes: CLI, library,
agent tool-calling, and browser.

## What Changes

- **Create** the `ai-powered` npm package at the repository root with the full project
  structure defined in the JIRA (src/, integrations/, tests/, dist/, dist-web/, etc.).
- **Implement** a unified `AiClient` interface covering text, image, audio, and video
  modalities with streaming support across OpenAI, Anthropic, xAI/Grok, and Venice.ai.
- **Build** a single `ai-powered` CLI using Commander.js exposing all commands: `text`,
  `image`, `audio transcribe`, `audio speak`, `video`, `structured`, `wizard`, `list-models`,
  `list-templates`, `config`, `health-check`, `batch`, `serve`, `session list/clear`.
- **Implement** a layered config system with global, project-local, named profiles,
  environment variables, and CLI flag overrides; includes setup wizard and migration.
- **Ship** a plugin API, prompt template system, batch processor, multi-turn conversation
  sessions, and structured-output schema validation.
- **Publish** a browser-safe web module (`ai-powered/web`) and an Express.js proxy server
  (`ai-powered serve`) enabling browser applications to use AI without exposing API keys.
- **Add** all security safeguards: consistent API key masking, `.gitignore` management,
  pre-commit secret scanning via Husky, and browser bundle secret scanning via Vite plugin.
- **Generate** comprehensive mock-based tests, GitHub Actions CI, and full documentation
  (README, CHANGELOG, CONTRIBUTING, SECURITY, integration examples in 11+ languages).

## Capabilities

### New Capabilities

- `ai-core`: Unified `AiClient` interface and `AiConfig` Zod schema; `getAiClient()` factory;
  multi-modal request dispatch (text/image/audio/video); streaming; token/cost tracking.
- `providers`: `BaseProvider` abstract class; provider implementations for OpenAI, Anthropic,
  xAI/Grok, Venice.ai, custom/local (Ollama-compatible), and mock; dynamic model discovery.
- `config-system`: Layered config loading (global → project-local → profile → env → flags);
  named profiles; config sub-commands (`get`, `set`, `list`, `delete`, `reset`, `path`,
  `validate`); config migration and backup; setup wizard.
- `cli-commands`: All `ai-powered` CLI commands and global flags; stdin/stdout/stderr
  interoperability; `--output` for binary modalities; `--dry-run`; `--quiet`/`--no-color`;
  `--install`/`--init`/`--update`/`--uninstall` lifecycle flags; `health-check`.
- `resilience-and-cost`: Exponential-backoff retries; circuit breaker; ordered provider
  fallback/failover; token estimation; per-call and cumulative cost tracking; budget ceilings
  (`--budget-session`, `--warn-budget`) with `BudgetExceededError`.
- `plugin-system`: `AiPlugin` interface with `onRequest`/`onResponse`/`onError` hooks;
  dynamic plugin loading; built-in plugins: `audit-log`, `rate-limiter`, `prompt-shield`.
- `template-system`: Named prompt templates (JSON/YAML) with mustache-style placeholders;
  built-in template library; user-defined template dirs; `list-templates` command.
- `batch-and-sessions`: JSONL batch processing with per-row overrides, concurrency, progress
  bar, and per-row error capture; multi-turn conversation sessions with file-system persistence.
- `structured-output`: `--schema` flag accepting JSON Schema file or inline JSON; Zod
  compilation; provider structured-output/function-calling integration; retry on failure.
- `web-module`: Browser-safe `createWebClient()` (zero Node.js APIs); proxy mode and direct
  mode; `WebAiClient` methods returning `Promise<Blob>` / `ReadableStream<string>`; SSE
  streaming; sessionStorage-based conversation sessions; Vite ESM+UMD dual bundle.
- `proxy-server`: Express.js `ai-powered serve` gateway; all `/api/ai-powered/*` routes; SSE
  `/stream` endpoint; CORS, rate limiting, helmet headers; budget/plugin/template integration.
- `security`: `maskApiKey()` utility enforced everywhere; `.gitignore` auto-management;
  Husky pre-commit secret-scanning hook; Vite build-time API key scanner for browser bundles.

### Modified Capabilities

_(none — `openspec/specs/` is currently empty; all capabilities are new)_

## Impact

- **New package root**: entire `ai-powered/` directory tree created from scratch.
- **No existing files modified**: this is a greenfield package; no upstream code affected.
- **External dependencies introduced**: openai, @anthropic-ai/sdk, xAI SDK, commander,
  inquirer, dotenv, zod, pino, fs-extra, ora, chalk, cli-progress, lru-cache, express, cors,
  helmet, express-rate-limit, vite, typescript, eslint, prettier, husky, lint-staged.
- **CI/CD**: `.github/workflows/ci.yml` added; runs build, lint, test, and npm publish on
  release using AI_MOCK=true (no real credentials required in CI).
- **Browser consumers**: any static site can embed `dist-web/ai-powered.umd.js` or import
  the ESM bundle; must use proxy mode in production (see security requirements).

