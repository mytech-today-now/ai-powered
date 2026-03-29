## ADDED Requirements

### Requirement: ai-powered serve command
The system SHALL implement `ai-powered serve` that starts an Express.js HTTP proxy server
acting as a secure gateway between browser clients and AI provider APIs. API keys SHALL be
held exclusively on the server and NEVER transmitted to the browser. Default port SHALL be
3001 configurable via `--port <n>`.

#### Scenario: Server starts on default port
- **WHEN** `ai-powered serve --mock` is run
- **THEN** the server starts on port 3001 and logs "ai-powered proxy server listening on :3001"

#### Scenario: Server starts on custom port
- **WHEN** `ai-powered serve --port 8080 --mock` is run
- **THEN** the server listens on port 8080

---

### Requirement: API routes
The system SHALL expose these routes under `/api/ai-powered/`:
`POST /text`, `POST /image`, `POST /audio/transcribe`, `POST /audio/speak`, `POST /video`,
`POST /structured`, `GET /models`, `GET /health`, `GET /config` (keys masked),
`POST /stream` (SSE streaming endpoint). All routes SHALL validate request bodies via Zod.
The `/stream` endpoint SHALL use SSE (`Content-Type: text/event-stream`) emitting
`data: {"delta":"..."}` events terminated by `data: [DONE]`.

#### Scenario: /text route proxies to provider
- **WHEN** `POST /api/ai-powered/text` with `{ prompt: "Hello" }` is sent to the server
- **THEN** the server calls the configured AI provider and returns `{ content, model, usage, cost }`

#### Scenario: /stream SSE streaming
- **WHEN** `POST /api/ai-powered/stream` is called with `{ prompt: "Tell a story" }`
- **THEN** the server responds with `Content-Type: text/event-stream` and streams
  `data: {"delta":"..."}` events ending with `data: [DONE]`

#### Scenario: /config returns masked keys
- **WHEN** `GET /api/ai-powered/config` is called
- **THEN** the response contains the current provider and model with all API key values masked

---

### Requirement: CORS, rate limiting, and security headers
The server SHALL enforce CORS with a configurable `--cors-origin` (default localhost; accepts
comma-separated list or `*`). Per-IP rate limiting SHALL be applied via `express-rate-limit`
(default 60 req/min, configurable via `--rate-limit`). HTTP security headers SHALL be set via
`helmet`: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Strict-Transport-Security`. Request body size limits SHALL be enforced. Rate-limit exceeded
SHALL return HTTP 429; all providers exhausted SHALL return HTTP 503.

#### Scenario: Rate limit returns 429
- **WHEN** more than the configured requests per minute are sent from one IP
- **THEN** the server returns HTTP 429 with a message indicating when to retry

#### Scenario: Helmet headers present on all responses
- **WHEN** any route is called on the proxy server
- **THEN** the response includes `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, and `Strict-Transport-Security` headers

---

### Requirement: Server CLI flags
`ai-powered serve` SHALL support: `--port <n>` (default 3001), `--cors-origin <origin>`,
`--rate-limit <req-per-min>` (default 60), `--profile <name>`, `--log`, `--debug`, `--mock`.

#### Scenario: --mock flag uses mock provider
- **WHEN** `ai-powered serve --mock` is running
- **THEN** all routes return mock responses without making real API calls

---

### Requirement: Server integrates core features
The proxy server SHALL fully integrate: provider fallback/failover, budget limits, plugin
pipeline, prompt templates, mock mode, and Pino structured logging. All proxied requests
SHALL be logged (with keys masked). `--log` SHALL write to `ai-powered.jsonl`.

#### Scenario: Plugin pipeline runs on server requests
- **WHEN** the `audit-log` plugin is configured and a browser client sends a request
- **THEN** the plugin writes an audit entry for the proxied request

