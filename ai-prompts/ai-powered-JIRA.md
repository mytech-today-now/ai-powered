JIRA Ticket
Issue Key: AI-001
Issue Type: Epic / Task (Implementation)
Summary: Implement ai-powered – Complete, Modular, Zero-Duplication TypeScript AI-Powered Tooling Framework (Multi-Modal CLI + Library + Agent Tool-Calling Engine)
Description
1. High-Level Goal
Create a reusable core package called ai-powered that owns ALL AI credential loading, provider selection, client instantiation, and common utilities for every AI modality: text completion/generation, image generation/editing, audio transcription (speech-to-text) and synthesis (text-to-speech), and video generation/processing (where supported by the provider). Supported providers include OpenAI, Anthropic, xAI/Grok, and Venice.ai, with Venice.ai providing privacy-preserving, uncensored text generation and image generation via an OpenAI-compatible REST API.
The framework exposes a single unified CLI command named ai-powered. This CLI does NOT contain blog or jira-ticket as built-in subcommands. Instead, ai-powered acts as a shared AI engine that other CLIs (in the same repo or in completely separate repositories) can call via shell execution, piping, or direct invocation.
All features of ai-powered (text, image, audio, video, structured output, model listing, config management, status, health-check, wizard, logging, debugging, etc.) must be explicitly designed to be invokable in four primary ways:

CLI invocation (human and script usage)
Direct library invocation (importing and calling from TypeScript/JavaScript code)
Programmatic / tool-calling interface optimized for other AI agents, autonomous agents, and LLM tool-use systems.
Browser / web application invocation (calling the ai-powered browser module or its companion proxy server from any HTML/CSS/JS page running in a modern web browser).

This makes ai-powered a first-class, discoverable tool that other AI agents can reliably use for their own purposes (e.g., via function calling, ReAct loops, or external tool execution), and a first-class web dependency that any static website or single-page application can embed.
Any new CLI tool (e.g. a blog CLI in one repo, a jira-ticket CLI in another repo, or future tools in new repos) will not implement its own AI configuration. It will simply call the ai-powered CLI (using child_process, exec, spawn, etc.) and pipe prompts to it or pass arguments. This eliminates repeated AI config code forever across all repositories and keeps future development extremely cheap in tokens.
The ai-powered CLI must be highly interoperable and easily callable/configurable from:

.ps1 (PowerShell) scripts
.bat files
bash scripts
piped input (stdin)
PHP
Python
C#
Ruby
Go
Rust
Java
Perl
HTML/CSS/JS website (browser) — via the browser module (direct fetch to provider APIs) or via the companion proxy server (ai-powered serve)

In the future, when the ai-powered package is added to a new repository, lightweight hooks/wrappers can be created in that repo’s own CLIs so they can seamlessly use the shared ai-powered engine for all AI needs across text, image, video, and audio modalities.
2. Handling Existing Installations
The generated code must include explicit support for managing the ai-powered package itself when it is already installed via npm in any repository:

ai-powered --install (or npm install ai-powered followed by ai-powered --init): detects existing installation, runs setup.
ai-powered --init: runs in the current repo (detects package presence via package.json), creates any missing local wrapper hooks if desired, updates .gitignore for security, runs the wizard if no config exists, and prints next steps.
ai-powered --update: checks for newer version on npm, updates the package, rebuilds, re-applies .gitignore rules, and migrates config if needed.
ai-powered --uninstall: removes local hooks, cleans up any repo-specific files created by the package, and instructs the user to run npm uninstall ai-powered.

These commands must be top-level flags (handled in the Commander.js root) and work whether the package was freshly installed or was already present.
3. Exact Project Structure (must be created exactly as shown)
textai-powered/                   # standalone package (can be published to npm and installed in any repo)
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── CHANGELOG.md              # full changelog with version history
├── CONTRIBUTING.md           # contribution guidelines, PR process, coding standards
├── SECURITY.md               # security policy, vulnerability reporting process, key-handling rules
├── VERSION                   # plain-text file containing current version
├── LICENSE                   # MIT license
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── .husky/                   # pre-commit hooks
├── .github/workflows/ci.yml  # GitHub Actions CI/CD
├── src/
│   └── ai-powered/
│       ├── index.ts          # exports for library usage
│       ├── core.ts           # main AI Manager + config + multi-modal support
│       ├── providers/        # one file per provider for easy extension
│       │   ├── index.ts
│       │   ├── base.ts
│       │   ├── openai.ts
│       │   ├── anthropic.ts
│       │   ├── grok.ts       # xAI / Grok support
│       │   └── venice.ts     # Venice.ai support (text + image; OpenAI-compatible)
│       ├── utils.ts          # token estimation, logging, model listing, caching
│       ├── templates/        # prompt template system (built-in + user-defined templates)
│       │   ├── index.ts      # template registry, render(), listTemplates()
│       │   └── defaults/     # built-in named templates (e.g. summarize, translate, qa)
│       ├── plugins/          # plugin system entry point
│       ├── web/              # browser-compatible module (zero Node.js APIs)
│       │   ├── index.ts      # browser entry point; exports createWebClient()
│       │   └── fetch-client.ts  # native-fetch provider adapters (text/image/audio/video/streaming)
│       ├── server/           # optional proxy server for secure browser key management
│       │   ├── index.ts      # Express proxy server entry point (ai-powered serve)
│       │   └── routes.ts     # /api/ai-powered/* proxy routes with CORS + rate limiting
│       └── cli/              # CLI entry point only
│           ├── index.ts      # Commander.js setup
│           └── wizard.ts     # interactive setup wizard
├── integrations/             # example scripts showing how to call the CLI from every language
│   ├── bash-example.sh
│   ├── powershell-example.ps1
│   ├── batch-example.bat
│   ├── php-example.php
│   ├── python-example.py
│   ├── csharp-example.cs
│   ├── ruby-example.rb
│   ├── go-example.go
│   ├── rust-example.rs
│   ├── java-example.java
│   ├── perl-example.pl
│   └── web-example/          # self-contained browser demo (no build step required)
│       ├── index.html        # demo UI: all modalities, streaming, binary output rendering
│       ├── styles.css        # minimal responsive styles
│       └── app.js            # vanilla JS using the browser module or proxy server
├── tests/                    # comprehensive tests
│   ├── unit/
│   ├── integration/
│   └── cli/
├── dist/                     # Node.js build output (generated by tsc)
├── dist-web/                 # browser build output (generated by Vite)
│   ├── ai-powered.esm.js     # ES module browser bundle
│   └── ai-powered.umd.js     # UMD bundle for plain <script> tag usage
└── vite.config.ts            # Vite config for browser bundle and dev server
4. Technical Stack (use exactly these – no substitutions)

TypeScript 5+ with strict mode
Node.js 20+
commander.js for CLI parsing
inquirer (or latest @inquirer/prompts) for the interactive wizard
dotenv for .env loading
zod for runtime validation of config and structured outputs
Official SDKs only: openai, @anthropic-ai/sdk, @xai/grok-sdk (or latest xAI SDK) plus any necessary extensions for image/audio/video; Venice.ai uses its OpenAI-compatible REST API (base URL: https://api.venice.ai/api/v1) via the openai SDK with a custom baseURL and the VENICE_API_KEY credential — no separate SDK required
pino for lightweight structured logging (with pretty-print and JSONL transport)
fs-extra for file operations
ora, chalk, cli-progress for rich UX
node-cache or lru-cache for optional caching
retry or built-in exponential backoff for resilience
Use ESM ("type": "module" in package.json)
Build with tsc; include ESLint, Prettier, Husky, lint-staged
Vite 5+ for browser bundling (npm run build:web → dist-web/; npm run dev:web → local dev server at http://localhost:5173); configured in vite.config.ts with lib mode for ES module + UMD dual output
express and cors for the companion proxy server (ai-powered serve); helmet for HTTP security headers; express-rate-limit for per-IP rate limiting
The browser module (src/ai-powered/web/) must use only web-standard APIs: native fetch, ReadableStream, TextDecoder, Blob, URL, sessionStorage — no Node.js built-ins whatsoever; Vite's build must be verified with rollup-plugin-node-builtins / rollup-plugin-visualizer to confirm zero Node leakage into dist-web/

5. Detailed Requirements
AI Core (src/ai-powered/core.ts)

Strongly-typed AiConfig using Zod schema that includes modality (text | image | audio | video), provider, model, and per-modality defaults.
Load configuration from layered sources with clear precedence: global (~/.ai-powered/config.json), project-local (./.ai-powered/config.json – auto-gitignored), named profiles, environment variables (prefixed AI_), and runtime CLI flags.
Support multiple named profiles (default, prod, dev, etc.) selectable via --profile.
Automatic config migration and backup on updates.
Support dynamic model discovery: listAvailableModels(provider: string, modality: 'text' | 'image' | 'audio' | 'video') that queries the provider’s API (or local endpoint) for current models and returns them with capabilities.
Factory: getAiClient(toolName?: string, overrides?: Partial<AiClientOptions>): Promise<AiClient>
Unified AiClient interface (for library usage inside other TS projects) that fully supports all modalities plus streaming (see exact interface in original prompt).
Support at minimum: OpenAI (GPT-4o, o1, DALL·E, Whisper, TTS, etc.), Anthropic (Claude text + any future image/audio), xAI/Grok (text + any available), and Venice.ai (text generation via OpenAI-compatible chat completions; image generation via Venice image endpoint; speech-to-text, text-to-speech, and video generation where Venice.ai adds support in future releases — the provider must be implemented in a forward-compatible way using dynamic model discovery so new Venice modalities are picked up automatically).
Make adding a new provider trivial by implementing BaseProvider abstract class (must support model listing per modality).
Built-in resilience: automatic retries with exponential backoff, rate-limit handling, simple circuit breaker.
Provider fallback/failover: each modality config accepts an ordered fallbackProviders array. When the primary provider fails (network error, rate limit, quota exhaustion, or circuit-breaker open), the core automatically retries the same request against each fallback provider in order, logs the switchover event, and surfaces the final error only if all providers are exhausted. Fallback can be disabled via --no-fallback or the config key fallback: false.
Optional caching layer (configurable TTL) for model lists and repeated prompts.
Automatic token/usage estimation, real-time cost tracking (per-call and cumulative), and logging for every modality.
Budget / spend limits: support per-session (--budget-session <USD>) and global (budgetGlobal in config) spend ceilings. Before every API call the core checks cumulative cost; if the limit would be exceeded it aborts with a BudgetExceededError and a clear user message. Optional --warn-budget <USD> emits a warning when that threshold is crossed without blocking execution.
Comprehensive error handling: centralized typed errors (AiPowerError, ProviderError, ConfigError, ValidationError, BudgetExceededError, etc.), graceful degradation, detailed context in errors, user-friendly messages, and structured error reporting for logging.
Robust logging: use Pino throughout the app for structured logging at INFO level by default. --debug enables TRACE/DEBUG level with step-by-step details. --log writes all log entries (including debug if enabled) to ./ai-powered.jsonl in JSON Lines format in /logs directory if it exists, otherwise in the repo root. Logging covers every internal step, errors, usage, and costs. Never include raw secrets in any log.
Mock mode for testing: when AI_MOCK=true (env var) or --mock flag is set, every provider call returns a deterministic, provider-shaped fixture response without making any real HTTP request. Mock responses include plausible token counts and cost fields so cost tracking and budget enforcement are exercisable in CI without credentials. The mock layer is implemented in src/ai-powered/providers/mock.ts and is automatically selected by the core when mock mode is active.

Support for User-Specified/Custom AI Providers

Allow a built-in “custom” provider in config and wizard.
Custom provider accepts: baseURL, apiKey, modality-specific headers, and a type (openai-compatible | ollama | other).
For local models (Ollama, LM Studio, etc.): automatically detect and query local endpoints (e.g., http://localhost:11434 for Ollama) for available models per modality.
For any other provider: support OpenAI-compatible endpoints out of the box; allow user to define custom request/response mappers if needed for non-compatible APIs.
All custom providers are persisted in ~/.ai-powered/config.json and selectable in the wizard.

Venice.ai Provider Requirements

Venice.ai must be a first-class named provider (not treated as a generic custom provider):
API key stored as VENICE_API_KEY in .env / ~/.ai-powered/config.json and auto-gitignored; always masked as ven-**** in logs.
Base URL: https://api.venice.ai/api/v1 — instantiate via the openai npm SDK with a custom baseURL and the Venice API key; no additional HTTP client required.
Text generation: call /chat/completions with any Venice-supported model (e.g., llama-3.3-70b, mistral-31-24b, deepseek-r1-671b); support streaming, temperature, max_tokens, system prompt, and structured JSON output.
Image generation: call Venice image generation endpoint (/image/generate); support prompt, model (e.g., fluently-xl, flux-dev, stable-diffusion-3.5), width, height, and steps parameters; return base64 or URL per Venice API response format.
Speech-to-text (transcription): implement via Venice audio endpoint when available; fall back with a clear provider-capability error (not an unhandled exception) if the modality is not yet supported.
Text-to-speech (synthesis): implement via Venice audio endpoint when available; same graceful fallback as above.
Video generation: implement via Venice video endpoint when available; same graceful fallback as above.
Dynamic model discovery: listAvailableModels('venice', modality) must call GET /models (Venice list-models endpoint), filter by the model's reported capabilities (type field or equivalent), and return results so new Venice models are picked up automatically without code changes.
The wizard must prompt for VENICE_API_KEY, validate it with a lightweight /models call, and offer Venice.ai in the provider selection list for every modality (with a clear note for modalities not yet supported by Venice.ai).

CLI Requirements – Single Command ai-powered

Main binary: ai-powered [options] <mode> registered in package.jsonbin.
Supported modes/commands: text, image, audio transcribe, audio speak, video, structured, wizard (or setup), list-models [modality], list-templates, config, health-check, batch, serve, session list, session clear <id>.
Top-level flags (available on every command and as standalone): --status, --help, --init, --update, --uninstall, --install, --log, --debug.
Global flags on every command: --provider, --model, --api-key, --temperature, --max-tokens, --json, --modality, --stream, --profile, --mock, --dry-run, --quiet, --no-color, --no-fallback, --budget-session <USD>, --warn-budget <USD>.
--output <path> flag for binary modalities: for image, audio speak, and video commands, --output <filepath> saves the binary result (PNG/JPEG, MP3/WAV, MP4, etc.) directly to disk rather than printing base64 to stdout. If --output is omitted for a binary modality, the CLI prints base64-encoded content to stdout with a MIME-type header in JSON mode, or emits an informative warning in human mode. --output is ignored for text and structured commands.
--dry-run / cost estimate: when --dry-run is passed, the CLI validates inputs, resolves the provider and model, estimates token count and projected cost using the local estimator, prints a structured cost-estimate report, and exits with code 0 without making any real API call. Combine with --json for machine-readable estimates.
--quiet / --no-color for scripting: --quiet suppresses all informational output (spinners, progress, banners, warnings) and only emits the final result to stdout and errors to stderr. --no-color disables all ANSI color codes in every output stream. Both flags are always respected, including inside the wizard (--quiet exits the wizard immediately with an error in that context). The NO_COLOR=1 environment variable is also honored as per the no-color.org convention.
config sub-commands: the config command exposes the following sub-commands — config get <key> (print a single config value, masking any key field), config set <key> <value> (write a value to the active profile's config file), config list (pretty-print the full resolved config with all secrets masked), config delete <key> (remove a key from the active profile), config reset (restore the active profile to defaults with confirmation prompt), config path (print the file path of the active config), config validate (run Zod validation against the current config and report any issues). All sub-commands respect --profile and --json.
health-check behavior: ai-powered health-check performs the following checks in order and reports pass/fail for each — (1) config file is present and passes Zod validation, (2) required API keys for the active profile's providers are set and non-empty (masked in output), (3) a lightweight connectivity probe (e.g., list-models call) succeeds for each configured provider, (4) optional local model endpoint (Ollama etc.) is reachable if configured. Exit code is 0 only if all checks pass; otherwise exit code 2. With --json the output is a machine-readable array of { check, status, message } objects. health-check must never make a billable generation call.
Structured output schema input: the structured command accepts --schema <file> where <file> is a path to a JSON Schema (draft-7 or draft-2020-12) or a TypeScript-compatible Zod schema file (evaluated at runtime). The schema is compiled via Zod and passed to the provider's structured-output or function-calling mechanism. The response is validated against the schema before being returned; if validation fails the CLI retries up to --max-retries times then exits with a ValidationError. --schema is also accepted as an inline JSON string.
Batch processing: ai-powered batch <mode> --input <file> processes multiple prompts from a JSONL input file (one JSON object per line, each with a prompt field plus optional per-row overrides for model, temperature, etc.). Results are written to a JSONL output file specified by --output <file> (required for batch). Progress is shown via a cli-progress bar unless --quiet is set. Concurrency is controlled by --concurrency <n> (default 3). Each result row includes the original prompt, response, usage, cost, and any error. Batch mode respects --mock, --dry-run, and all budget flags.
Conversation / multi-turn support: the text command gains --session <id> to enable stateful multi-turn conversation. The session stores the full message history (user + assistant turns) in ~/.ai-powered/sessions/<id>.json. When --session is provided, prior messages are prepended to each new request. ai-powered session list prints all saved sessions; ai-powered session clear <id> deletes a session. Session files are excluded from git via .gitignore rules added by --init. The library exposes a ConversationSession class with append(role, content), getHistory(), and clear() for programmatic use.
Critical interoperability: If no prompt/input is provided as argument, read full input from stdin. Support explicit --stdin flag. Output clean stdout for results, stderr for logs/errors, consistent exit codes (0 = success, 1 = error, 2 = validation/health-check failure). When --json is used, return structured JSON with content, usage, model, modality, cost, etc.
Generate full example scripts in integrations/ folder demonstrating exactly how to call ai-powered (with all modalities and new flags including --log, --debug, --output, --dry-run, --quiet, --no-color, --session, --schema, --mock) from every listed language.

CLI Wizard (src/ai-powered/cli/wizard.ts)

Command: ai-powered wizard
Fully interactive and verbose (choose modality, provider, models, API keys, defaults, brand guidelines, validation test calls, save to .env + global config, end with clear instructions).

Plugin API (src/ai-powered/plugins/)

The plugin system provides a stable, versioned extension point. A plugin is a plain ESM module that exports a default object conforming to the AiPlugin interface:
interface AiPlugin { name: string; version: string; description?: string; onRequest?(ctx: RequestContext): Promise<RequestContext>; onResponse?(ctx: ResponseContext): Promise<ResponseContext>; onError?(err: AiPowerError): Promise<void>; }
Plugins are discovered from the plugins array in config (file paths or npm package names), loaded dynamically via import(), and composed into a pipeline. The core invokes onRequest hooks before every provider call (allowing header injection, prompt rewriting, logging, rate limiting, etc.) and onResponse hooks after (allowing post-processing, caching, telemetry). Plugins are sandboxed: they may not mutate the config object directly. A plugin that throws causes a PluginError (wrapped, not swallowed) and the failing plugin is bypassed for the remainder of the session.
Built-in plugins shipped with the package: audit-log (append every request/response to a JSONL file), rate-limiter (client-side token-bucket), and prompt-shield (basic injection-detection heuristic).
The README must include a "Writing a Plugin" guide with a minimal working example.

Prompt Template System (src/ai-powered/templates/)

Named, reusable prompt templates are stored as JSON or YAML files. A template contains: name, description, modality, provider (optional), model (optional), system (optional system prompt), userPrompt (mustache-style {{variable}} placeholders), and defaults (default variable values).
CLI usage: ai-powered text --template summarize --var text="$(cat article.txt)". The template is resolved from the built-in defaults/ directory first, then from user-defined paths in config (templateDirs array), then from a file path if the value contains a path separator.
Library usage: import { renderTemplate } from 'ai-powered/templates'; const prompt = renderTemplate('summarize', { text: '...' });
ai-powered list-templates prints all available templates with name, modality, and description. --json returns machine-readable output.
Custom templates can be created by the wizard (ai-powered wizard --template) or placed manually in ~/.ai-powered/templates/. Template files are validated against a Zod schema on load.

Library Usage (for future repos)

When installed via npm, src/ai-powered/index.ts (exported as main) should allow direct library usage: import { getAiClient } from 'ai-powered';
Provide clear documentation in README on how to create lightweight wrapper hooks in any new repo’s own CLI.

Web / Browser Module (src/ai-powered/web/)

The web module exposes a browser-safe subset of ai-powered that uses only web-standard APIs (native fetch, ReadableStream, TextDecoder, Blob, URL, sessionStorage). It contains zero Node.js built-ins and zero references to fs, path, process, child_process, or any Node core module. The Vite build must verify this via bundle analysis.
Entry point: import { createWebClient } from 'ai-powered/web' (or via the UMD global window.AiPowered in plain <script> usage). The function signature is: createWebClient(options: WebClientOptions): WebAiClient where WebClientOptions is a discriminated union of two modes:
Proxy mode (recommended for production): { mode: 'proxy', proxyUrl: string, profile?: string }. The client sends all requests to the running ai-powered proxy server (see below). API keys never leave the server. This is the required mode for any public-facing website.
Direct mode (development and demos only): { mode: 'direct', provider: string, apiKey: string, model?: string }. The client calls the provider REST API directly from the browser using the supplied key. The module emits a loud console.warn on every instantiation in direct mode and, in non-production environments, renders a visible on-screen warning banner. Direct mode must never be used in production; this restriction must be documented prominently in README and SECURITY.md.
WebAiClient methods mirror the server AiClient interface with browser-appropriate return types: generateText(prompt, options?) → Promise<TextResult>, generateImage(prompt, options?) → Promise<Blob>, transcribeAudio(audioBlob, options?) → Promise<string>, synthesizeSpeech(text, options?) → Promise<Blob>, generateVideo(prompt, options?) → Promise<Blob>, streamText(prompt, options?) → ReadableStream<string>. All methods accept an optional AbortSignal for cancellation.
Streaming: streamText() returns a native ReadableStream<string>. Each chunk is a decoded text delta. The integrations/web-example/app.js demonstrates rendering stream chunks token-by-token into the DOM as they arrive.
Binary modalities in the browser: generateImage(), synthesizeSpeech(), and generateVideo() return a Blob. The caller creates an object URL (URL.createObjectURL(blob)) and assigns it to an <img src>, <audio src>, or <video src> element. The demo in integrations/web-example/ demonstrates this for all three modalities.
Conversation / multi-turn in the browser: ConversationSession history is stored in sessionStorage (keyed by session ID) instead of the file system. The WebAiClient.session(id) method returns a session-aware client. Sessions clear automatically when the browser tab closes.
Config in the browser: there is no file-system config. Settings are passed via createWebClient() options or, in proxy mode, resolved server-side. The proxy server's /api/ai-powered/config endpoint (GET, read-only, keys masked) lets the browser UI display the current provider and model.
Prompt templates in the browser: the web module bundles the compiled template registry. Built-in templates are available; user-defined templates are passed as inline objects to createWebClient() rather than loaded from disk.
Browser build scripts: npm run build:web (Vite lib build → dist-web/ai-powered.esm.js + dist-web/ai-powered.umd.js); npm run dev:web (Vite dev server at http://localhost:5173 serving integrations/web-example/ with hot module replacement).
Web demo (integrations/web-example/): a self-contained HTML/CSS/JS page requiring no build step. It loads the UMD bundle via a relative <script> tag. Features: mode toggle (proxy vs. direct), modality tabs (text / image / audio / video / structured), streaming text panel with token-by-token rendering, inline <img> for generated images, <audio> for synthesized speech, <video> for generated video, cost/usage display, and a multi-turn session panel.

Companion Proxy Server (ai-powered serve)

ai-powered serve starts an Express.js HTTP server that acts as a secure gateway between browser clients and AI provider APIs. API keys are held exclusively on the server and never sent to the browser.
CLI: ai-powered serve [options] with flags: --port <n> (default 3001), --cors-origin <origin> (default localhost; accepts comma-separated list or * for open access), --rate-limit <requests-per-minute> (default 60 per IP), --profile <name>, --log, --debug, --mock.
Routes exposed (all prefixed /api/ai-powered/): POST /text, POST /image, POST /audio/transcribe, POST /audio/speak, POST /video, POST /structured, GET /models, GET /health, GET /config (keys masked), POST /stream (SSE endpoint for streaming text).
The /stream endpoint uses Server-Sent Events (Content-Type: text/event-stream) and streams token deltas as data: {"delta":"..."} events, terminated by data: [DONE].
The server enforces: CORS (configurable allowed origins), per-IP rate limiting (express-rate-limit), HTTP security headers (helmet), request body size limits, and Zod input validation on every route. 429 is returned on rate-limit exceeded; 503 when all providers are exhausted.
The server respects all core features: provider fallback/failover, budget limits, mock mode, plugin pipeline, and prompt templates.
All proxied requests are logged via Pino (keys masked); --log writes to ai-powered.jsonl.

Security Requirements (mandatory)

Never log, print, or output raw API keys anywhere. Key masking must be consistent across all providers: OpenAI keys → sk-****, Anthropic keys → sk-ant-****, xAI/Grok keys → xai-****, Venice.ai keys → ven-****,  and any custom/unknown key → [REDACTED]. A single maskApiKey(key: string): string utility in utils.ts must be used everywhere (logs, --status output, error messages, wizard confirmations) so masking cannot be inconsistently applied.
Automatically manage .gitignore in any repo where ai-powered is installed (append exact lines listed in prompt).
Store credentials only in ~/.ai-powered/config.json or .env files; never commit them.
Use secure key handling, runtime checks that warn if credentials appear in git-tracked files.
All error messages and --status output must redact sensitive data.
Include pre-commit secret scanning hook via Husky.
Browser-specific security: API keys must never be embedded in the Vite/browser bundle at build time. A Vite plugin must scan dist-web/ output for known key prefixes (sk-, sk-ant-, xai-, ven-) and fail the build if any are found. The dist-web/ directory must be added to .gitignore. Direct mode must always display a visible on-screen security warning and emit console.warn; it must never be silenced programmatically. SECURITY.md must state that proxy mode is the only production-safe browser deployment pattern. The proxy server must set Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, and Strict-Transport-Security headers via helmet.

Additional Non-Functional Requirements

Full TypeScript types, JSDoc on every public API.
Excellent error messages with full context.
.env.example with all possible env vars clearly commented, including VENICE_API_KEY with a comment explaining the Venice.ai base URL (https://api.venice.ai/api/v1) and supported modalities.
package.json with exact fields (name: "ai-powered", version: "0.1.0", type: "module", bin, main, types, exports (including 'ai-powered/web' subpath for the browser entry), scripts (build, build:web, dev:web, serve, test, lint, format), repository, keywords, files array). The exports map must expose both the Node entry and the browser entry so bundlers can tree-shake correctly.
tsconfig.json with strict settings, ESM output to dist/.
README.md with exact structure: TL;DR, prominent AI Agent Usage section (tool schemas, machine-readable instructions, examples for LLMs/agents), full human-oriented documentation, cross-language examples, security best practices, architecture overview.
Generate complete CHANGELOG.md (initial entry for v0.1.0) and VERSION file containing "0.1.0".
Generate CONTRIBUTING.md covering PR process, branch naming, commit message conventions, and how to write a plugin. Generate SECURITY.md covering the vulnerability reporting process, key-handling rules, and masking standards.
Generate comprehensive tests covering core, providers, CLI, and integrations. Mock mode (AI_MOCK=true) must be used for all tests so CI requires no real API credentials.
Generate GitHub Actions workflow for CI (build, lint, test, publish on release).
Include LICENSE (MIT), ESLint/Prettier/Husky config for code quality.

6. Out of Scope

Built-in blog or jira-ticket subcommands (other CLIs will call this package instead).

7. Acceptance Criteria

Every single file in the exact project structure is generated with complete, correct, runnable TypeScript code (no omissions, no summaries).
Package is fully ready for npm publishing (package.json, build scripts, types, etc.).
All example scripts in integrations/ are generated and updated for all modalities + new flags (--log, --debug, --output, --dry-run, --quiet, --no-color, --session, --schema, --mock).
CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, VERSION, LICENSE, GitHub Actions workflow, lint configs, Husky hooks are all present and correct.
Security rules, logging, resilience, caching, streaming, structured output, dynamic model discovery, custom/local providers, multi-profile config, and four invocation modes (CLI/library/agent/browser) are fully implemented and tested.
Venice.ai provider is fully implemented in src/ai-powered/providers/venice.ts: text generation and image generation work end-to-end; speech-to-text, text-to-speech, and video modalities degrade gracefully with a clear provider-capability error; dynamic model discovery via GET /models is verified; VENICE_API_KEY is validated by the wizard and masked in all logs.
--output flag is verified for image, audio speak, and video commands: binary files are written to the specified path and a confirmation message is printed to stderr.
config sub-commands (get, set, list, delete, reset, path, validate) are all implemented, tested, and documented.
--dry-run exits with code 0 and prints a cost estimate without any real API call; verified in tests using --mock.
--quiet and --no-color are verified to suppress all decorative output; NO_COLOR=1 env var is honored.
Plugin API is fully defined: AiPlugin interface is exported from index.ts; the three built-in plugins (audit-log, rate-limiter, prompt-shield) are implemented and tested; the README contains a working plugin authoring guide.
Provider fallback/failover is tested: a mock primary failure triggers automatic retry against the first fallback provider; all switchover events appear in the structured log.
Prompt template system is fully implemented: built-in templates are loadable via CLI and library; custom templates are validated on load; list-templates --json works correctly.
health-check exits with code 0 on a healthy config (verified with --mock) and code 2 on missing keys or unreachable endpoints; JSON output is machine-readable.
Mock mode (AI_MOCK=true / --mock) is used for all CI tests; no real API credentials are required in the CI environment; mock responses include plausible usage and cost fields.
Budget / spend limits: BudgetExceededError is thrown and tested when cumulative cost exceeds --budget-session; --warn-budget emits a warning without blocking.
Batch processing (ai-powered batch) produces a JSONL output file with one result row per input row; concurrency is respected; errors are recorded per-row, not process-fatal.
Conversation / multi-turn: --session persists history across CLI invocations; ConversationSession is exported and exercised in unit tests; session list and session clear work correctly.
Structured output --schema validates responses against the provided JSON Schema; a validation failure triggers a retry up to --max-retries; ValidationError is raised after exhausted retries.
Browser / Web Module: npm run build:web succeeds and produces dist-web/ai-powered.esm.js and dist-web/ai-powered.umd.js; bundle analysis confirms zero Node.js built-ins in the browser bundle.
npm run dev:web starts the Vite dev server and serves integrations/web-example/ at http://localhost:5173 with hot module replacement.
createWebClient() is exported from 'ai-powered/web' and works in both proxy mode and direct mode. Direct mode emits console.warn and renders a visible security warning banner in the UI.
Proxy mode: ai-powered serve starts the Express proxy on port 3001 (configurable); all /api/ai-powered/* routes accept browser requests and return correct responses; SSE streaming via /api/ai-powered/stream delivers token deltas.
All provider REST calls from WebAiClient use native fetch and work in Chrome, Firefox, Safari, and Edge (latest stable versions).
Binary modalities in the browser: generateImage() returns a Blob that renders in an <img> element; synthesizeSpeech() returns a Blob that plays in an <audio> element; generateVideo() returns a Blob that plays in a <video> element. All demonstrated in integrations/web-example/.
streamText() returns a ReadableStream<string>; the demo renders chunks into the DOM as they arrive without buffering the full response.
sessionStorage-based conversation sessions persist across multiple createWebClient() calls within the same browser tab and are cleared on tab close.
The Vite build plugin secret-scan step fails the build if any API key prefix (sk-, sk-ant-, xai-, ven-) is found in dist-web/ output; this is verified in CI.
dist-web/ is present in .gitignore; CI confirms the directory is excluded from commits.
The proxy server returns correct helmet headers (Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security) verified by the health-check endpoint.
vite.config.ts is present and correctly configures lib mode, entry point (src/ai-powered/web/index.ts), and dual ESM/UMD formats.
package.json includes scripts: build:web, dev:web, and the exports map includes an 'ai-powered/web' subpath pointing to the browser entry.
README and SECURITY.md document proxy mode as the only production-safe browser deployment; direct mode is documented with explicit warnings.
README contains the exact required sections, including a detailed AI Agent Usage section optimized for LLMs and a Web Usage section with HTML/CSS/JS quick-start examples for both proxy and direct modes.
After generation, the following exact terminal commands are output:textnpm install && npm run build && npm run build:web
git add . && git commit -m "feat: initial ai-powered shared AI engine with multi-modal (text/image/video/audio) support, dynamic model querying, wizard, custom/local providers including Venice.ai (text+image; OpenAI-compatible, privacy-preserving), --init/--update/--uninstall/--status, rich --help, VERSION/CHANGELOG/CONTRIBUTING/SECURITY, credential security via .gitignore and consistent key masking, --output for binary modalities, config sub-commands, --dry-run cost estimation, --quiet/--no-color scripting flags, Plugin API with built-in plugins, provider fallback/failover, prompt template system, health-check, mock mode, budget/spend limits, batch processing, conversation/multi-turn sessions, structured output schema input, browser/web module (createWebClient proxy+direct modes), Vite browser bundle (dist-web/ ESM+UMD), companion proxy server (ai-powered serve) with Express+CORS+helmet+rate-limiting, SSE streaming, browser binary Blob output, sessionStorage conversations, browser secret-scan CI check, web-example demo (HTML/CSS/JS), expanded integrations for all languages and new flags, layered config/profiles, streaming, caching, resilience, cost tracking, comprehensive mock-based tests, production-grade architecture, robust error handling, Pino logging, --log (ai-powered.jsonl), --debug flags, and explicit agent-friendly design for CLI + library + tool-calling + browser invocation" && git push origin main
npm publish
The implementation follows the prompt exactly and produces production-grade, zero-duplication AI tooling.

Definition of Done

Code reviewed and passes lint/test/CI
All files committed to repository
Package successfully published to npm
Documentation verified for both humans and AI agents

Labels: typescript, cli, ai, npm-package, multi-modal, agent-tool-calling, browser, web, proxy-server
Priority: Highest
Assignee: Senior TypeScript Engineer (or AI coding agent)
Component: AI Infrastructure