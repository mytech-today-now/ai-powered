# Tasks: ai-powered

## 1 — Package Scaffolding

- [ ] Create root `package.json` with: `name: "ai-powered"`, `version: "0.1.0"`, `type: "module"`,
      `bin`, `main`, `types`, `exports` map (`"."` + `"ai-powered/web"`), `scripts`
      (`build`, `build:web`, `dev:web`, `serve`, `test`, `lint`, `format`, `prepare`),
      `repository`, `keywords`, `files` array
- [ ] Create `tsconfig.json` with `strict: true`, `module: NodeNext`, `outDir: "dist"`,
      `declaration: true`, ESM target settings
- [ ] Create `vite.config.ts` with lib mode, entry `src/ai-powered/web/index.ts`,
      dual ESM+UMD output to `dist-web/`
- [ ] Create `.env.example` with all env vars commented: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
      `XAI_API_KEY`, `VENICE_API_KEY` (with base URL note), `AI_PROVIDER`, `AI_MODEL`,
      `AI_PROFILE`, `AI_MOCK`, `NO_COLOR`
- [ ] Create `.gitignore` with: `node_modules/`, `dist/`, `dist-web/`, `.env`, `.env.local`,
      `.ai-powered/config.json`, `ai-powered.jsonl`, `ai-powered-audit.jsonl`, `logs/`
- [ ] Create `.eslintrc.json` and `.prettierrc` for TypeScript + ESM code style
- [ ] Configure `lint-staged` in `package.json` to run ESLint + Prettier on staged files
- [ ] Create `VERSION` file containing `0.1.0`
- [ ] Create `LICENSE` (MIT, current year, author)
- [ ] Create empty `CHANGELOG.md` with initial v0.1.0 entry
- [ ] Create `CONTRIBUTING.md` covering branch naming, commit conventions, PR process,
      plugin authoring guide
- [ ] Create `SECURITY.md` covering key-handling rules, masking standards, vulnerability
      reporting, and browser proxy-mode-only production deployment requirement
- [ ] Set up Husky: `npm run prepare` installs hooks; create `.husky/pre-commit` hook that
      runs `lint-staged` and the secret-scanning script
- [ ] Create `.github/workflows/ci.yml`: build, lint, test (with `AI_MOCK=true`), and
      `npm publish` on release event

## 2 — Core Engine (`src/ai-powered/core.ts`)

- [ ] Define `AiConfig` Zod schema with all fields (modality, provider, model, apiKey,
      temperature, maxTokens, systemPrompt, stream, profile, fallbackProviders, fallback,
      budgetSession, warnBudget, plugins, templateDirs, mock, logFile, debug)
- [ ] Implement layered config loader: merge global → project-local → profile → env → flags
- [ ] Implement `getAiClient(toolName?, overrides?)` factory: resolve config, select provider,
      attach plugin pipeline, return `AiClient`
- [ ] Implement `AiClient` class with: `generateText`, `generateImage`, `transcribeAudio`,
      `synthesizeSpeech`, `generateVideo`, `streamText`, `generateStructured<T>`,
      `listModels`, `getCumulativeCost`, `session(id)`
- [ ] Implement token estimation heuristic (`estimateTokens(text): number`)
- [ ] Implement cost calculator using provider-reported usage; accumulate in `cumulativeCost`
- [ ] Implement budget enforcement: pre-call check against `budgetSession`; throw
      `BudgetExceededError` if exceeded; emit WARNING at `warnBudget` threshold
- [ ] Implement model list cache with configurable TTL (default 5 min) using `lru-cache`

## 3 — Providers (`src/ai-powered/providers/`)

- [ ] Implement `BaseProvider` abstract class with abstract modality methods and
      `listModels(modality)` abstract method
- [ ] Implement `OpenAiProvider`: text (GPT-4o, o1), streaming, image (DALL·E 3),
      transcription (Whisper), synthesis (TTS); read `OPENAI_API_KEY`
- [ ] Implement `AnthropicProvider`: text + streaming (Claude models); `ProviderCapabilityError`
      for image/audio/video; read `ANTHROPIC_API_KEY`
- [ ] Implement `GrokProvider` (xAI): text + streaming; `ProviderCapabilityError` for
      unsupported modalities; read `XAI_API_KEY`
- [ ] Implement `VeniceProvider`: text via `/chat/completions` (streaming, structured),
      image via Venice image endpoint, graceful `ProviderCapabilityError` for unavailable
      modalities, `listModels` via `GET /models` with capability filtering; read `VENICE_API_KEY`
- [ ] Implement `CustomProvider`: accept `baseURL`, `apiKey`, `headers`, `type`
      (`openai-compatible` | `ollama` | `other`); auto-detect Ollama model list
- [ ] Implement `MockProvider` in `providers/mock.ts`: deterministic fixture responses for
      all modalities; plausible `usage` and `cost` fields; no HTTP calls
- [ ] Implement `providers/index.ts` registry: map provider name → class; export
      `createProvider(config)` factory

## 4 — Resilience (`src/ai-powered/core.ts` or `resilience.ts`)

- [ ] Implement exponential-backoff retry wrapper (default 3 retries, jitter, configurable);
      retry on 429, 5xx, network errors; throw immediately on 4xx (except 429)
- [ ] Implement per-provider circuit breaker: open after N failures (default 5),
      fast-fail with `CircuitOpenError`, reset after interval (default 60s)
- [ ] Implement provider fallback loop: iterate `fallbackProviders` on primary failure,
      log switchover at INFO, throw `AllProvidersExhaustedError` if all fail

## 5 — Plugin System (`src/ai-powered/plugins/`)

- [ ] Define and export `AiPlugin`, `RequestContext`, `ResponseContext` interfaces from `index.ts`
- [ ] Implement plugin loader: `import()` each plugin path/package from config array
- [ ] Implement `onRequest` pipeline (in order) and `onResponse` pipeline (in reverse order)
- [ ] Implement `onError` broadcast to all plugins on `AiPowerError`
- [ ] Implement plugin sandboxing: plugins receive frozen copy of config, not original
- [ ] Implement `PluginError` wrapping: catch per-plugin throws, log, bypass plugin for session
- [ ] Implement built-in `audit-log` plugin: append JSONL entry per call, mask keys
- [ ] Implement built-in `rate-limiter` plugin: token-bucket client-side throttle
- [ ] Implement built-in `prompt-shield` plugin: injection-detection heuristics, configurable reject mode

## 6 — Template System (`src/ai-powered/templates/`)

- [ ] Define template Zod schema (name, description, modality, provider?, model?, system?,
      userPrompt, defaults)
- [ ] Implement `renderTemplate(name, vars)` with mustache-style `{{var}}` substitution
- [ ] Implement template resolver: search order built-in → templateDirs → file path
- [ ] Implement `listTemplates()`: return all templates with name, modality, description
- [ ] Create built-in templates: `summarize`, `translate`, `qa` in `templates/defaults/`

## 7 — CLI (`src/ai-powered/cli/`)

- [ ] Implement root Commander.js program with all top-level flags: `--status`, `--init`,
      `--update`, `--uninstall`, `--install`, `--log`, `--debug`
- [ ] Implement `text` command with `--stream`, `--session`, `--template`, `--var`,
      `--schema`, `--output` (ignored for text), all global flags
- [ ] Implement `image` command with `--output` (saves PNG/JPEG to disk), global flags
- [ ] Implement `audio transcribe` command (reads audio file or stdin)
- [ ] Implement `audio speak` command with `--output` (saves MP3/WAV to disk)
- [ ] Implement `video` command with `--output`
- [ ] Implement `structured` command with `--schema <file|json>`, `--max-retries`
- [ ] Implement `wizard` / `setup` command: call `src/ai-powered/cli/wizard.ts`
- [ ] Implement `list-models [modality]` command with `--json`
- [ ] Implement `list-templates` command with `--json`
- [ ] Implement `config` command with sub-commands: `get`, `set`, `list`, `delete`,
      `reset`, `path`, `validate`; mask keys in all output; respect `--profile` and `--json`
- [ ] Implement `health-check` command: 4-step checks, exit code 0/2, `--json` output
- [ ] Implement `batch <mode>` command: JSONL input/output, `--concurrency`, progress bar,
      per-row error capture, `--dry-run`, budget/mock support
- [ ] Implement `serve` command: delegate to `src/ai-powered/server/index.ts`
- [ ] Implement `session list` and `session clear <id>` commands
- [ ] Implement stdin reading when no prompt argument is provided; support `--stdin` flag
- [ ] Implement `--dry-run`: validate, resolve, estimate, print cost report, exit 0
- [ ] Implement `--quiet`: suppress all decorative output; `--no-color`: disable ANSI;
      honor `NO_COLOR=1` env var
- [ ] Implement `--log`: write all log entries to `./logs/ai-powered.jsonl` or repo root
- [ ] Implement wizard (`cli/wizard.ts`): modality → provider → API key (validate) →
      model → defaults → save to .env + global config → print next steps
- [ ] Register `ai-powered` binary in `package.json` bin field

## 8 — Logging (`src/ai-powered/utils.ts` + core)

- [ ] Set up Pino logger: INFO default, TRACE/DEBUG when `--debug`; pretty-print in dev,
      JSONL transport when `--log`
- [ ] Implement `maskApiKey(key): string` with per-provider prefix rules
- [ ] Ensure `maskApiKey` is called on every log statement, error message, and output
      that could contain an API key
- [ ] Emit WARNING when `.env` or config file is git-tracked at startup and in `health-check`

## 9 — Web Module (`src/ai-powered/web/`)

- [ ] Implement `web/index.ts`: export `createWebClient(options)` discriminated union
      (proxy mode / direct mode); emit `console.warn` and inject DOM banner in direct mode
- [ ] Implement `web/fetch-client.ts`: native-fetch adapters for all modalities;
      `streamText` returns `ReadableStream<string>` (SSE parse); binary returns `Blob`
- [ ] Implement browser `ConversationSession` using `sessionStorage`
- [ ] Implement proxy mode request routing to `${proxyUrl}/api/ai-powered/*`
- [ ] Bundle built-in template registry (no fs access) into web module
- [ ] Add Vite plugin / post-build script: scan `dist-web/` for key prefixes; fail build if found
- [ ] Add `package.json` exports map subpath `"ai-powered/web"` pointing to browser entry

## 10 — Proxy Server (`src/ai-powered/server/`)

- [ ] Implement `server/index.ts`: Express app, apply helmet, CORS, rate-limit, body-size limit
- [ ] Implement `server/routes.ts`: all `/api/ai-powered/*` routes with Zod input validation;
      call `getAiClient()` per request
- [ ] Implement `POST /stream` SSE endpoint: `text/event-stream`, `data: {"delta":"..."}`,
      `data: [DONE]`
- [ ] Implement `GET /config`: return current config with all keys masked
- [ ] Implement `GET /health`: return server health status
- [ ] Integrate budget, plugins, templates, mock, and Pino logging into server routes

## 11 — Security

- [ ] Implement `maskApiKey` utility (included in task 8 — ensure it is the single usage point)
- [ ] Implement `--init` `.gitignore` append logic: check for existing entries before adding
- [ ] Implement Husky pre-commit secret-scanning script: grep staged files for `sk-`, `sk-ant-`,
      `xai-`, `ven-` patterns; abort commit if found
- [ ] Implement Vite build-time secret scan: `dist-web/` post-build analysis via
      rollup plugin or custom Vite plugin
- [ ] Ensure `dist-web/` is in `.gitignore`

## 12 — Tests (`tests/`)

- [ ] Unit tests for `AiConfig` Zod validation (valid config, each invalid field)
- [ ] Unit tests for `maskApiKey` (each provider prefix, unknown key)
- [ ] Unit tests for `renderTemplate` (substitution, missing var uses default, missing required var)
- [ ] Unit tests for `ConversationSession` (`append`, `getHistory`, `clear`)
- [ ] Unit tests for retry logic (mock provider throws N times then succeeds)
- [ ] Unit tests for circuit breaker (open after N failures, reset after interval)
- [ ] Unit tests for budget enforcement (`BudgetExceededError` at limit, warning at threshold)
- [ ] Unit tests for plugin pipeline (`onRequest` chain, failed plugin bypassed, `onError` broadcast)
- [ ] Unit tests for config layering (each layer overrides the one below)
- [ ] Integration tests for `MockProvider` (all modalities return shaped fixture responses)
- [ ] Integration tests for `VeniceProvider` with mock HTTP (text, image, graceful capability error)
- [ ] CLI tests (spawn `ai-powered` process): `text --mock`, `image --mock --output`, `--dry-run`,
      `--quiet`, `--json`, `config validate`, `health-check --mock`, `batch --mock`,
      `session list`, `session clear`
- [ ] All tests use `AI_MOCK=true`; no real API credentials required in CI

## 13 — Integration Examples (`integrations/`)

- [ ] Create `bash-example.sh` demonstrating text, image (`--output`), `--dry-run`,
      `--quiet`, `--session`, `--schema`, `--mock`, `--log`, `--debug`
- [ ] Create `powershell-example.ps1` with same modalities and flags
- [ ] Create `batch-example.bat` for Windows
- [ ] Create `php-example.php`, `python-example.py`, `csharp-example.cs`,
      `ruby-example.rb`, `go-example.go`, `rust-example.rs`, `java-example.java`,
      `perl-example.pl` — each demonstrating multi-modality shell invocation
- [ ] Create `web-example/index.html`, `web-example/styles.css`, `web-example/app.js`:
      mode toggle, modality tabs, streaming text panel, inline image/audio/video,
      cost display, multi-turn session panel; loads UMD bundle via relative script tag

## 14 — Documentation (`README.md`)

- [ ] Write README with exact structure: TL;DR, AI Agent Usage section (tool schemas,
      machine-readable instructions, function-calling examples), full human-oriented docs,
      cross-language examples, security best practices, web usage section
      (proxy + direct modes HTML/CSS/JS quick-start), architecture overview
- [ ] Write "Writing a Plugin" guide in README with minimal working example

