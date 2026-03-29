# Bulk task creation for ai-powered openspec change
# Run from repo root: . .\scripts\beads-helpers.ps1; .\scripts\_create-ai-powered-tasks.ps1

. "$PSScriptRoot\beads-helpers.ps1"

function New-Task {
    param([string]$Title, [string]$Desc, [int]$Pri = 2)
    $json = bd create $Title -Description $Desc -Priority $Pri -Type task --json
    return ($json | ConvertFrom-Json).id
}

Write-Host "Creating ai-powered tasks..." -ForegroundColor Cyan

# ── SECTION 1: Package Scaffolding ────────────────────────────────────────────
$t11 = New-Task "Scaffold core config files" `
"Create package.json (name: ai-powered, v0.1.0, type: module, bin, main, types, exports map for '.' and 'ai-powered/web', scripts: build/build:web/dev:web/serve/test/lint/format/prepare, repository, keywords, files array). Create tsconfig.json (strict: true, module: NodeNext, outDir: dist, declaration: true, ESM target). Create vite.config.ts (lib mode, entry src/ai-powered/web/index.ts, dual ESM+UMD output to dist-web/). Create .env.example with all env vars commented: OPENAI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY, VENICE_API_KEY, AI_PROVIDER, AI_MODEL, AI_PROFILE, AI_MOCK, NO_COLOR." 1

$t12 = New-Task "Scaffold project boilerplate and CI" `
"Create .gitignore (node_modules/, dist/, dist-web/, .env, .env.local, .ai-powered/config.json, ai-powered.jsonl, ai-powered-audit.jsonl, logs/). Create .eslintrc.json and .prettierrc for TypeScript+ESM. Configure lint-staged in package.json. Create VERSION (0.1.0), LICENSE (MIT), empty CHANGELOG.md (v0.1.0 entry), CONTRIBUTING.md (branch naming, commit conventions, PR process, plugin authoring guide), SECURITY.md (key-handling, masking standards, vulnerability reporting, browser proxy-mode-only production requirement). Set up Husky: npm run prepare installs hooks; .husky/pre-commit runs lint-staged + secret-scanning script. Create .github/workflows/ci.yml: build, lint, test with AI_MOCK=true, npm publish on release event." 1

# ── SECTION 2: Core Engine ────────────────────────────────────────────────────
$t21 = New-Task "Define AiConfig Zod schema and layered config loader" `
"In src/ai-powered/core.ts: Define AiConfig Zod schema (modality, provider, model, apiKey, temperature, maxTokens, systemPrompt, stream, profile, fallbackProviders, fallback bool, budgetSession, warnBudget, plugins, templateDirs, mock, logFile, debug, per-modality defaults). Implement layered config loader merging: global ~/.ai-powered/config.json -> project-local ./.ai-powered/config.json -> named profile -> env vars prefixed AI_ -> CLI flags. Each layer deep-merges. Validate merged config via Zod; throw ConfigError with all failures before any API call. Named profiles stored under 'profiles' key; throw ConfigError for missing profiles. Detect config version mismatch; backup old config to config.json.bak.<timestamp> and migrate. Spec: specs/config-system/spec.md." 1

$t22 = New-Task "Implement getAiClient factory and AiClient class" `
"Export getAiClient(toolName?, overrides?) factory: reads layered config, resolves active profile, applies overrides (CLI flags highest precedence via deep-merge), instantiates provider via providers/index.ts, attaches plugin pipeline, returns configured AiClient. AiClient class methods: generateText(prompt, options?), generateImage(prompt, options?), transcribeAudio(buffer, options?), synthesizeSpeech(text, options?), generateVideo(prompt, options?), streamText(prompt, options?) -> AsyncIterable<string>, generateStructured<T>(prompt, schema, options?) -> Promise<T>, listModels(modality?), getCumulativeCost(), session(id). All accept optional AbortSignal. Unsupported modality -> ProviderCapabilityError. Export from src/ai-powered/index.ts as primary library entry point. Spec: specs/ai-core/spec.md." 1

$t23 = New-Task "Implement token estimation and cost calculator" `
"Implement estimateTokens(text): number heuristic (labeled 'estimated' in all output). Cost calculator using provider-reported usage data; compute USD per call from model pricing lookup. Accumulate per-call cost in cumulativeCost. Every result object (TextResult, ImageResult, AudioResult) must include: usage.promptTokens, usage.completionTokens, usage.totalTokens, cost (USD float, 6 decimal places). getCumulativeCost() returns sum across session. Cost tracked in mock mode with plausible fixture values. Log cost at INFO level after each call. Result shapes: TextResult{content,model,usage,cost,modality:'text'}, ImageResult{data,model,cost,modality:'image'}. Spec: specs/resilience-and-cost/spec.md, specs/ai-core/spec.md." 1

$t24 = New-Task "Implement budget enforcement and model list cache" `
"Budget: before every API call check cumulative cost against budgetSession ceiling; throw BudgetExceededError(currentCost, limit) with exit code 1 if limit would be exceeded. Emit WARNING log when cost crosses warnBudget threshold without blocking. BudgetExceededError must name current cost and configured limit. Model cache: listAvailableModels(provider, modality) using lru-cache, configurable TTL (default 5 min); second call within TTL returns cached result with no HTTP request. Result shape: { id, name, capabilities, contextWindow? }[]. Spec: specs/resilience-and-cost/spec.md, specs/ai-core/spec.md." 1

# ── SECTION 3: Providers ──────────────────────────────────────────────────────
$t31 = New-Task "Implement BaseProvider abstract class and providers registry" `
"Create src/ai-powered/providers/base.ts: BaseProvider abstract class with abstract methods for each modality (generateText, generateImage, transcribeAudio, synthesizeSpeech, generateVideo, streamText, listModels(modality)) and readonly name: string. Adding a provider = extend BaseProvider + register in index.ts only. Create providers/index.ts: map provider name -> class; export createProvider(config) factory. Spec: specs/providers/spec.md." 1

$t32 = New-Task "Implement OpenAI and Anthropic providers" `
"OpenAiProvider using 'openai' npm SDK: GPT-4o and o1 series (text), DALL-E 3 (image), Whisper (transcription), TTS (synthesis). Read OPENAI_API_KEY; mask as 'sk-****' in all logs/output. Streaming via AsyncIterable<string> using OpenAI streaming API. AnthropicProvider using '@anthropic-ai/sdk': Claude models for text + streaming. Read ANTHROPIC_API_KEY; mask as 'sk-ant-****'. Unsupported modalities (image, audio, video) throw ProviderCapabilityError naming provider and modality. Spec: specs/providers/spec.md." 1

$t33 = New-Task "Implement xAI/Grok and Venice.ai providers" `
"GrokProvider: text + streaming via latest official xAI SDK. Read XAI_API_KEY; mask as 'xai-****'. Unsupported modalities throw ProviderCapabilityError. NOTE: confirm xAI SDK npm package name before adding to package.json (design.md Open Question Q3). VeniceProvider: first-class named provider using 'openai' npm SDK with baseURL: 'https://api.venice.ai/api/v1' and VENICE_API_KEY (masked 'ven-****'). Text via /chat/completions (streaming, temperature, max_tokens, system prompt, structured JSON). Image via Venice image endpoint (confirm path: /image/generate vs /images/generations per design.md Q2). Audio/TTS/video gracefully throw ProviderCapabilityError. Dynamic model discovery via GET /models with capability filtering. Spec: specs/providers/spec.md." 1

$t34 = New-Task "Implement Custom/Ollama and Mock providers" `
"CustomProvider: accept baseURL, apiKey, headers, type ('openai-compatible' | 'ollama' | 'other'). For Ollama (default http://localhost:11434): auto-detect models via GET /api/tags. Persist custom provider config in ~/.ai-powered/config.json. MockProvider in providers/mock.ts: deterministic fixture responses for ALL modalities without HTTP calls. Include plausible usage (token counts) and cost fields. When AI_MOCK=true: factory selects MockProvider regardless of configured real provider. Mock fixture shapes must match real provider API shapes exactly. Spec: specs/providers/spec.md, specs/ai-core/spec.md." 1

# ── SECTION 4: Resilience ─────────────────────────────────────────────────────
$t41 = New-Task "Implement exponential-backoff retry wrapper" `
"In src/ai-powered/core.ts or resilience.ts: retry wrapper with default 3 retries, jitter, configurable max. Retry on: HTTP 429, 5xx server errors, network timeouts. Throw immediately (no retry) on 4xx except 429. Log each retry attempt at DEBUG: attempt number, wait duration, error reason. Spec: specs/resilience-and-cost/spec.md." 1

$t42 = New-Task "Implement per-provider circuit breaker" `
"Per-provider circuit breaker: open after N consecutive failures (default 5). When open: fast-fail with CircuitOpenError including provider name and estimated recovery time. Reset after interval (default 60s): allow one probe request; on success close circuit. N and reset interval configurable via config. Spec: specs/resilience-and-cost/spec.md." 1

$t43 = New-Task "Implement provider fallback/failover loop" `
"Config accepts ordered fallbackProviders array. On primary provider failure (network, rate limit, quota, open circuit): iterate fallbackProviders in order, log switchover at INFO level. Throw AllProvidersExhaustedError (listing all providers and failure reasons) if all fail. Disable via --no-fallback or fallback: false in config; throw immediately on primary failure when disabled. Return HTTP 503 from proxy server when all exhausted. Spec: specs/resilience-and-cost/spec.md." 1

# ── SECTION 5: Plugin System ──────────────────────────────────────────────────
$t51 = New-Task "Implement AiPlugin interface, plugin loader, and pipeline" `
"Export from src/ai-powered/index.ts: AiPlugin interface { name: string; version: string; description?: string; onRequest?(ctx: RequestContext): Promise<RequestContext>; onResponse?(ctx: ResponseContext): Promise<ResponseContext>; onError?(err: AiPowerError): Promise<void> }. Export RequestContext and ResponseContext interfaces. Plugin loader: dynamically import() each plugin from config plugins array (file paths or npm package names). onRequest pipeline: registration order, executed before each provider call. onResponse pipeline: reverse order, after response. onError: broadcast to all plugins on AiPowerError. Plugins receive frozen copy of AiConfig (cannot mutate original). Spec: specs/plugin-system/spec.md." 2

$t52 = New-Task "Implement plugin sandboxing and PluginError handling" `
"Plugin sandboxing: pass frozen Object.freeze() copy of AiConfig to each plugin hook. PluginError wrapping: if a plugin onRequest/onResponse throws, catch it, wrap as PluginError, log at WARNING, bypass that plugin for the remainder of the session, continue with remaining plugins. The overall request must NOT fail due to a single plugin's error. Spec: specs/plugin-system/spec.md." 2

$t53 = New-Task "Implement built-in plugins: audit-log, rate-limiter, prompt-shield" `
"audit-log plugin: append JSONL entry per call to configurable path (default ./ai-powered-audit.jsonl). Entry: timestamp, provider, model, prompt hash (NOT raw prompt), usage, cost, masked headers. Mask all API keys via maskApiKey before writing. Activatable via plugins: ['audit-log']. rate-limiter plugin: client-side token-bucket, default 60 req/min configurable. When bucket empty, pause request (do NOT reject) until capacity available. prompt-shield plugin: heuristic injection-detection on every onRequest prompt. On detection: log WARNING with pattern. Configurable reject mode (default false); when reject: true, throw PluginError without dispatching to provider. Spec: specs/plugin-system/spec.md." 2

# ── SECTION 6: Template System ────────────────────────────────────────────────
$t61 = New-Task "Implement template schema, renderTemplate, resolver, and listTemplates" `
"Define template Zod schema (name, description, modality, provider?, model?, system?, userPrompt, defaults). Validate on load; throw ValidationError naming invalid file if userPrompt missing. renderTemplate(name, vars): mustache-style {{variable}} substitution; use defaults for missing vars. Template resolver search order: (1) built-in defaults/ dir, (2) config.templateDirs paths, (3) file path if contains path separator. User template overrides built-in by same name. listTemplates(): return all templates with name, modality, description (built-in and user-defined). Support --template <name> and --var <key>=<value> flags on text/image/audio speak/structured commands. Spec: specs/template-system/spec.md." 2

$t62 = New-Task "Create built-in templates: summarize, translate, qa" `
"Create in src/ai-powered/templates/defaults/: summarize (text modality, summarizes input text {{text}}, includes language default so missing vars never error), translate (text modality, translates to {{targetLanguage}}, default: 'English'), qa (text modality, answers {{question}} from {{context}}). Each has meaningful description and sensible defaults. Bundle built-in template registry (no fs access) into web module for browser-safe use. Verify list-templates --json output includes all three. Spec: specs/template-system/spec.md." 2

# ── SECTION 7: CLI ────────────────────────────────────────────────────────────
$t71 = New-Task "Implement root Commander.js program and global flags" `
"Register 'ai-powered' binary in package.json bin field. Root Commander.js program with lifecycle flags: --status, --init (create .ai-powered/, update .gitignore, run wizard if no config, print next steps), --update (check npm for newer version, update, migrate config), --uninstall (remove local hooks and repo-specific files), --install, --log, --debug. All commands support --help. Global flags on every command: --provider, --model, --api-key, --temperature, --max-tokens, --json, --modality, --stream, --profile, --mock, --dry-run, --quiet, --no-color, --no-fallback, --budget-session <USD>, --warn-budget <USD>, --log, --debug. Binary invokable after npm install -g; ai-powered --help exits code 0. Spec: specs/cli-commands/spec.md." 1

$t72 = New-Task "Implement modality commands: text, image, audio, video, structured" `
"text: --stream, --session, --template, --var, --schema, all global flags. Read stdin when no prompt arg or --stdin flag. image: --output saves PNG/JPEG; without --output in --json mode print base64+MIME header, else warn. audio transcribe: read audio file or stdin. audio speak: --output saves MP3/WAV. video: --output. structured: --schema <file|json> (JSON Schema file, Zod schema file, or inline JSON string), --max-retries (default 2, retry when response fails schema validation). stdout = final results only; stderr = logs/errors/progress. Exit codes: 0 success, 1 error, 2 validation/health failure. NO_COLOR=1 env var disables ANSI. Spec: specs/cli-commands/spec.md, specs/structured-output/spec.md." 1

$t73 = New-Task "Implement wizard, list-models, list-templates, config, health-check" `
"wizard/setup: delegate to cli/wizard.ts. list-models [modality]: query provider, --json returns JSON array. list-templates: all templates with name/modality/description, --json includes at minimum summarize/translate/qa. config sub-commands: get <key> (mask API keys in output), set <key> <value>, list (mask all keys), delete <key>, reset (prompt confirmation first), path, validate (full Zod schema, all errors, exit 0 if valid). All config sub-commands respect --profile and --json. health-check: 4 checks (config valid, API keys present+masked, connectivity probe, local model reachable); exit 0 all pass / 2 otherwise; --json -> [{check,status,message}]; NEVER makes billable generation call. Spec: specs/cli-commands/spec.md, specs/config-system/spec.md." 1

$t74 = New-Task "Implement batch, serve, and session commands" `
"batch <mode>: --input <JSONL file>, --output <file> (required), --concurrency <n> (default 3), cli-progress bar (suppress with --quiet), per-row error in output without aborting batch, --dry-run (cost estimate per row, no API calls), budget/mock support. Stream-read JSONL line-by-line (never load full file into memory). Each output row: prompt, response, usage, cost, error?. serve: delegate to src/ai-powered/server/index.ts. session list: list session IDs with creation timestamps. session clear <id>: delete ~/.ai-powered/sessions/<id>.json, exit 0. Spec: specs/cli-commands/spec.md, specs/batch-and-sessions/spec.md." 1

$t75 = New-Task "Implement stdin, --dry-run, --quiet, --no-color, --log, --session" `
"stdin: read full input from stdin when no prompt arg; --stdin flag explicitly enables. --session <id> on text command: persist message history to ~/.ai-powered/sessions/<id>.json; prepend prior messages on each call; exclude session files from git via .gitignore. --dry-run: validate inputs, resolve provider/model, estimateTokens, print structured cost report, exit 0 with no API call; --json for machine-readable output. --quiet: suppress spinners/banners/progress bars; only raw result to stdout. --no-color: disable ANSI; honor NO_COLOR=1 env var. --log: write all log entries to ./logs/ai-powered.jsonl. ConversationSession library class: export from index.ts with append(role, content), getHistory(), clear(). Spec: specs/cli-commands/spec.md, specs/batch-and-sessions/spec.md." 1

$t76 = New-Task "Implement CLI wizard (cli/wizard.ts)" `
"Interactive multi-step wizard using @inquirer/prompts: (1) choose modality, (2) select provider including Venice.ai with modality availability notes, (3) enter and validate API key via lightweight live API call (Venice: GET /models to confirm key before saving), (4) set model defaults, (5) save to .env and/or ~/.ai-powered/config.json (both targets supported simultaneously), (6) print next steps. Also support --template mode for creating a custom prompt template. Spec: specs/config-system/spec.md (Requirement: Setup wizard)." 2

# ── SECTION 8: Logging ────────────────────────────────────────────────────────
$t81 = New-Task "Set up Pino logger and maskApiKey utility" `
"Set up Pino logger in src/ai-powered/utils.ts: INFO default, TRACE/DEBUG when --debug; pretty-print in dev, JSONL transport when --log. Implement maskApiKey(key: string): string as THE single masking utility used everywhere: OpenAI sk-* -> 'sk-****', Anthropic sk-ant-* -> 'sk-ant-****', xAI xai-* -> 'xai-****', Venice ven-* -> 'ven-****', unknown/custom -> '[REDACTED]'. No inline masking anywhere else in codebase. Spec: specs/security/spec.md." 1

$t82 = New-Task "Enforce maskApiKey everywhere and git-tracked credential warning" `
"Audit all code paths: ensure maskApiKey called on every log statement, error message, wizard confirmation, config sub-command output, and any path that could expose an API key. No raw API key in any log, error.message, or JSON output. Implement git-tracked credential check: at startup and during health-check, detect if .env or .ai-powered/config.json is tracked by git; emit WARNING log and (in non-quiet mode) print user-facing alert suggesting .gitignore update. Warning message: 'Credential file .env is tracked by git. Add to .gitignore immediately.' Spec: specs/security/spec.md." 1

# ── SECTION 9: Web Module ─────────────────────────────────────────────────────
$t91 = New-Task "Implement createWebClient factory and WebAiClient methods" `
"In src/ai-powered/web/index.ts: export createWebClient(options: WebClientOptions): WebAiClient with discriminated union. Proxy mode { mode: 'proxy', proxyUrl, profile? }: routes all calls to \${proxyUrl}/api/ai-powered/*; no API key in browser. Direct mode { mode: 'direct', provider, apiKey, model? }: emit console.warn AND render visible DOM security banner (red, fixed position, non-suppressible) reading 'WARNING: Direct mode exposes your API key. Use proxy mode in production.' WebAiClient methods: generateText -> Promise<TextResult>, generateImage -> Promise<Blob>, transcribeAudio -> Promise<string>, synthesizeSpeech -> Promise<Blob>, generateVideo -> Promise<Blob>, streamText -> ReadableStream<string> (SSE parse, terminates on data: [DONE]). All accept AbortSignal. session(id): session-aware client prepending history. Spec: specs/web-module/spec.md." 2

$t92 = New-Task "Implement browser fetch client and sessionStorage sessions" `
"In src/ai-powered/web/fetch-client.ts: native-fetch adapters for all modalities using ONLY web-standard APIs (native fetch, ReadableStream, TextDecoder, Blob, URL, sessionStorage). ZERO references to fs, path, process, child_process, or any Node.js built-ins (verified by Vite bundle analysis). streamText: SSE parsing (data: {...} events). Binary responses return Blob (usable with URL.createObjectURL for img/audio/video elements). Browser ConversationSession: store history in sessionStorage keyed by session ID; clears on tab close. session(id) on WebAiClient prepends history to each request. Spec: specs/web-module/spec.md." 2

$t93 = New-Task "Vite dual ESM/UMD build, secret scan, and package exports map" `
"Vite lib mode config: entry src/ai-powered/web/index.ts, outputs: dist-web/ai-powered.esm.js (ES module) and dist-web/ai-powered.umd.js (UMD global: window.AiPowered). npm run build:web produces dual bundle. npm run dev:web: Vite dev server at http://localhost:5173 serving integrations/web-example/ with HMR. Add Vite plugin or post-build script: scan dist-web/ for sk-, sk-ant-, xai-, ven- prefixes; fail build (non-zero exit + descriptive error naming prefix + file) if found. Verify zero Node.js API leakage in dist-web/. Add 'ai-powered/web' subpath in package.json exports map pointing to browser entry. dist-web/ must be in .gitignore. Spec: specs/web-module/spec.md, specs/security/spec.md." 2

# ── SECTION 10: Proxy Server ──────────────────────────────────────────────────
$t101 = New-Task "Implement Express proxy server with all API routes and SSE" `
"In src/ai-powered/server/index.ts: Express app with helmet (Content-Security-Policy, X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Strict-Transport-Security on all responses), CORS (configurable --cors-origin, default localhost), express-rate-limit (default 60 req/min, configurable --rate-limit, return 429 on exceed), body-size limit, Pino logging. In server/routes.ts: all /api/ai-powered/* routes with Zod input validation. Routes: POST /text, POST /image, POST /audio/transcribe, POST /audio/speak, POST /video, POST /structured, GET /models, GET /health, GET /config (all API keys masked), POST /stream (Content-Type: text/event-stream, emit data: {'delta':'...'}, terminate data: [DONE]). API keys NEVER sent to browser. All providers exhausted -> 503. Server logs 'ai-powered proxy server listening on :PORT' on start. Spec: specs/proxy-server/spec.md." 2

$t102 = New-Task "Integrate core features into proxy server" `
"Each server route calls getAiClient() per request. Integrate fully: provider fallback/failover, budget limits (BudgetExceededError -> appropriate HTTP error response), plugin pipeline (onRequest/onResponse/onError run on all proxied requests; audit-log plugin records proxied requests), prompt templates (--template/--var params honored in routes), mock mode (--mock flag routes all requests to MockProvider), Pino structured logging with all keys masked via maskApiKey, --log writes to ai-powered.jsonl. CLI flags: --port (default 3001), --cors-origin, --rate-limit, --profile, --log, --debug, --mock. Spec: specs/proxy-server/spec.md." 2

# ── SECTION 11: Security ──────────────────────────────────────────────────────
$t111 = New-Task "Implement .gitignore auto-management and lifecycle --init" `
"Implement --init .gitignore append logic: check for existing entries before adding; append if missing: .env, .env.local, .ai-powered/config.json, ai-powered.jsonl, ai-powered-audit.jsonl, ~/.ai-powered/, dist-web/, logs/. NEVER overwrite or corrupt existing .gitignore content. Running --init twice must not add duplicate entries. --init full flow: detect existing installation, create missing local wrapper hooks, create .ai-powered/config.json, run wizard interactively if no config exists, print next steps. See specs/security/spec.md." 1

$t112 = New-Task "Implement pre-commit and Vite browser bundle secret scanning" `
"Husky .husky/pre-commit script: grep staged files for patterns sk-, sk-ant-, xai-, ven-. If potential key found: abort commit with clear error message naming file and line number. Vite build-time scan: post-build rollup plugin or custom Vite plugin scans dist-web/ for same patterns; npm run build:web fails with non-zero exit naming key prefix and file location. Ensure dist-web/ is in .gitignore (verified: git status shows no untracked dist-web/ after build). Spec: specs/security/spec.md." 1

# ── SECTION 12: Tests ─────────────────────────────────────────────────────────
$t121 = New-Task "Unit tests: AiConfig, maskApiKey, renderTemplate, ConversationSession" `
"All tests use AI_MOCK=true; no real credentials required in CI. AiConfig Zod validation: test valid config accepted (typed AiConfig returned), test each invalid field produces ConfigError with readable message. maskApiKey: test sk-* -> 'sk-****', sk-ant-* -> 'sk-ant-****', xai-* -> 'xai-****', ven-* -> 'ven-****', unknown -> '[REDACTED]'. renderTemplate: test {{var}} substitution, missing var uses default, missing required var throws ValidationError. ConversationSession: test append(role, content), getHistory() returns full ordered history, clear() empties history. Spec: tasks.md section 12." 2

$t122 = New-Task "Unit tests: retry, circuit breaker, budget, plugin pipeline, config layering" `
"Retry: mock provider throws N times then succeeds; verify retry count, then eventual success; verify 4xx throws immediately. Circuit breaker: open after N failures with CircuitOpenError, reset after interval (fake timers), probe on reset. Budget: BudgetExceededError thrown when cumulative cost would exceed limit; WARNING log at warnBudget without blocking. Plugin pipeline: onRequest chain executes in registration order; failed plugin bypassed + session continues; onError broadcast to all. Config layering: each layer overrides below (global < project < profile < env < flags). Spec: tasks.md section 12." 2

$t123 = New-Task "Integration tests: MockProvider and VeniceProvider with mock HTTP" `
"MockProvider integration: test ALL modalities (generateText, generateImage, transcribeAudio, synthesizeSpeech, generateVideo, streamText) return properly shaped fixture responses with plausible usage and cost fields. Verify no HTTP calls made (intercept network). VeniceProvider with mock HTTP server: test generateText calls /chat/completions and returns valid TextResult; test generateImage calls image endpoint and returns ImageResult; test synthesizeSpeech throws ProviderCapabilityError gracefully (not an unhandled rejection). All use AI_MOCK=true. Spec: tasks.md section 12." 2

$t124 = New-Task "CLI integration tests: spawn ai-powered binary with AI_MOCK=true" `
"Spawn ai-powered binary process for each scenario (AI_MOCK=true, no real credentials): text --mock (stdout content, exit 0), image --mock --output <tmpfile> (file written, confirmation to stderr), structured --schema <file> --mock (valid JSON response), --dry-run (cost report, exit 0, no HTTP), --quiet (only raw result on stdout), --json (valid JSON with content/usage/model/cost/modality), config validate (exit 0 on valid config), health-check --mock (all checks pass, exit 0), batch --mock --input <tmpfile> --output <tmpfile> (5 rows in, 5 rows out), session list (lists sessions), session clear (file deleted). Spec: tasks.md section 12." 2

# ── SECTION 13: Integration Examples ─────────────────────────────────────────
$t131 = New-Task "Create shell and multi-language integration examples" `
"In integrations/: bash-example.sh demonstrating text, image (--output), --dry-run, --quiet, --session, --schema, --mock, --log, --debug. powershell-example.ps1 with same modalities and flags. batch-example.bat for Windows. Language examples each demonstrating multi-modality shell invocation: php-example.php, python-example.py, csharp-example.cs, ruby-example.rb, go-example.go, rust-example.rs, java-example.java, perl-example.pl. Spec: tasks.md section 13." 3

$t132 = New-Task "Create web-example demo (integrations/web-example/)" `
"Create integrations/web-example/index.html, styles.css, app.js as self-contained page requiring NO build step. Load dist-web/ai-powered.umd.js via relative <script> tag. Features: mode toggle (proxy vs direct with security warning shown on direct selection), modality tabs (text/image/audio/video/structured), streaming text with token-by-token DOM rendering, inline <img>/<audio>/<video> for binary outputs, cost/usage display, multi-turn session panel. Opening index.html directly in browser must work without npm or build commands. window.AiPowered.createWebClient must be available as global. Spec: specs/web-module/spec.md, tasks.md section 13." 3

# ── SECTION 14: Documentation ─────────────────────────────────────────────────
$t141 = New-Task "Write README.md with full structure" `
"Write README.md: TL;DR section, AI Agent Usage section (tool schemas, machine-readable instructions, function-calling examples for all modalities), full human-oriented docs covering all CLI commands with examples, cross-language shell invocation examples (11+ languages), security best practices, web usage section (proxy + direct modes with HTML/CSS/JS quick-start code), architecture overview (four invocation modes: CLI/library/agent tool-calling/browser). Document ESM-only requirement (design decision D1) prominently. All examples use --mock for safety. Spec: tasks.md section 14." 3

$t142 = New-Task "Write Plugin authoring guide in README" `
"Add 'Writing a Plugin' section to README.md with minimal working TypeScript example of a custom AiPlugin: implementing onRequest (modify ctx.messages), onResponse (log usage), onError (capture errors) hooks; exporting the plugin object; adding to config plugins array as file path or npm package name. Cover: plugin sandboxing (frozen AiConfig received), PluginError behavior (bypass on throw, session continues), publishing as npm package. Reference built-in audit-log plugin source as real example. Include CONTRIBUTING.md plugin authoring guide cross-reference. Spec: tasks.md section 14." 3

Write-Host "" -ForegroundColor Cyan
Write-Host "All tasks created. Setting up dependencies..." -ForegroundColor Cyan

# ── DEPENDENCIES ──────────────────────────────────────────────────────────────
# T1.2 blocked by T1.1
bd dep add $t12 $t11

# Section 2 blocked by T1.1 (scaffolding)
bd dep add $t21 $t11
bd dep add $t22 $t11
bd dep add $t23 $t22
bd dep add $t24 $t22

# Section 3 blocked by T2.2
bd dep add $t31 $t22
bd dep add $t32 $t31
bd dep add $t33 $t31
bd dep add $t34 $t31

# Section 4 blocked by T3.1
bd dep add $t41 $t31
bd dep add $t42 $t31
bd dep add $t43 $t31

# Section 5 blocked by T2.2
bd dep add $t51 $t22
bd dep add $t52 $t51
bd dep add $t53 $t51

# Section 6 blocked by T2.1
bd dep add $t61 $t21
bd dep add $t62 $t61

# Section 7 blocked by T2.2 + T3.2 (need provider + core)
bd dep add $t71 $t22
bd dep add $t71 $t32
bd dep add $t72 $t71
bd dep add $t73 $t71
bd dep add $t74 $t71
bd dep add $t75 $t71
bd dep add $t75 $t62
bd dep add $t76 $t71

# Section 8: T8.1 blocked by T1.1; T8.2 blocked by T8.1
bd dep add $t81 $t11
bd dep add $t82 $t81

# Section 9 blocked by T2.2 + T6.2
bd dep add $t91 $t22
bd dep add $t91 $t62
bd dep add $t92 $t91
bd dep add $t93 $t91

# Section 10 blocked by T9.1 + T7.4
bd dep add $t101 $t91
bd dep add $t101 $t74
bd dep add $t102 $t101

# Section 11 blocked by T8.1 + T1.2
bd dep add $t111 $t81
bd dep add $t111 $t12
bd dep add $t112 $t81
bd dep add $t112 $t12

# Section 12 blocked by all relevant implementations
bd dep add $t121 $t21
bd dep add $t121 $t81
bd dep add $t121 $t61
bd dep add $t121 $t75
bd dep add $t122 $t41
bd dep add $t122 $t42
bd dep add $t122 $t24
bd dep add $t122 $t51
bd dep add $t122 $t21
bd dep add $t123 $t34
bd dep add $t123 $t33
bd dep add $t124 $t72
bd dep add $t124 $t73
bd dep add $t124 $t74
bd dep add $t124 $t75

# Section 13 blocked by T7.1 + T7.2
bd dep add $t131 $t72
bd dep add $t132 $t93

# Section 14 blocked by tests + examples
bd dep add $t141 $t121
bd dep add $t141 $t122
bd dep add $t141 $t131
bd dep add $t142 $t141

Write-Host "" -ForegroundColor Cyan
Write-Host "Done! Running stats..." -ForegroundColor Cyan
bd stats

