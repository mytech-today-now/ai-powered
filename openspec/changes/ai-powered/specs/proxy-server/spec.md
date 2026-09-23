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

### Requirement: GET /models error handling
The system SHALL return a structured JSON error for `GET /models` when provider construction
or model discovery fails. Provider construction failures SHALL use HTTP 503 with code
`PROVIDER_SETUP_ERROR`; model discovery failures SHALL use HTTP 500 with code
`MODEL_LIST_ERROR`. The route SHALL return `[]` only when `listModels()` genuinely resolves to
an empty array.

#### Scenario: Provider setup failure returns structured 503
- **WHEN** `GET /api/ai-powered/models` is called with a provider that cannot be constructed
- **THEN** the server responds with HTTP 503 and a JSON body containing `{ error, code:
  "PROVIDER_SETUP_ERROR" }` without secret material

#### Scenario: listModels failure is surfaced
- **WHEN** provider construction succeeds but `listModels()` rejects
- **THEN** the server responds with HTTP 500 and code `MODEL_LIST_ERROR`

#### Scenario: Empty model list stays empty
- **WHEN** `GET /api/ai-powered/models` reaches a provider whose `listModels()` resolves to `[]`
- **THEN** the server responds with HTTP 200 and body `[]`

---

### Requirement: CORS, rate limiting, and security headers
The server SHALL enforce CORS with a configurable `--cors-origin` (default localhost; accepts
comma-separated list or `*`). Same-origin requests SHALL be identified by matching the request
`Host` and effective protocol, using the first `X-Forwarded-Proto` value when present. Valid
cross-origin HTTP(S) requests SHALL receive CORS permission only when the origin exactly matches
the configured allowlist or its one-label wildcard pattern. Missing, `null`, malformed, or
untrusted origins SHALL not receive `Access-Control-Allow-Origin`; missing-origin requests may
continue for non-browser clients, and CORS SHALL never satisfy caller authentication. Per-IP rate limiting SHALL be applied via `express-rate-limit`
(default 60 req/min, configurable via `--rate-limit`). HTTP security headers SHALL be set via
`helmet`: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Strict-Transport-Security`. Request body size limits SHALL be enforced. Rate-limit exceeded
SHALL return HTTP 429; all providers exhausted SHALL return HTTP 503.

#### Scenario: Null and missing origins do not gain browser read access
- **WHEN** a request has `Origin: null`, a malformed `Origin`, or no `Origin`
- **THEN** the server does not emit `Access-Control-Allow-Origin`, and the route's independent
  authentication policy remains in force

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

### Requirement: Public media URL guidance
When image-to-video or video-to-video routes require uploaded media to be fetched by a provider,
the server SHALL require `PROXY_PUBLIC_BASE_URL` to point at a public HTTPS URL. The error
message SHALL stay generic and SHALL not hard-code a tunnel-specific hostname.

#### Scenario: Missing public media URL returns a hosted-service hint
- **WHEN** `POST /video` needs public media URLs and `PROXY_PUBLIC_BASE_URL` is absent
- **THEN** the server returns HTTP 422 with a message that instructs the caller to set
  `PROXY_PUBLIC_BASE_URL` to a public HTTPS address, such as a Render service URL

### Requirement: Owner-bound uploaded file references
The server SHALL bind every uploaded file reference to the authenticated caller principal and
check that binding before generation, ordinary download, or deletion. Missing, expired, deleted,
malformed, and cross-principal refs SHALL use safe generic responses. Provider-facing media SHALL
use a separate short-lived, provider-purpose signed capability endpoint; possession of that
capability SHALL NOT authorize the ordinary browser/API download route. File refs, capabilities,
and private filenames SHALL be absent from normal request logs.

#### Scenario: Owner-only file retrieval
- **WHEN** an authenticated owner uploads a file and requests `GET /files/:uuid`
- **THEN** the server returns the original bytes with MIME, content-length, and `private, no-store`
  headers

#### Scenario: Cross-principal retrieval is denied
- **WHEN** a different authenticated principal requests the same `GET /files/:uuid`
- **THEN** the server returns the same generic not-found response used for an expired or deleted ref

#### Scenario: Provider capability is purpose-bound
- **WHEN** a provider receives a capability URL generated for its provider and before the five-minute
  capability lifetime expires
- **THEN** `GET /files/provider` may return the media, but the capability cannot be reused as a
  browser/API download token and fails after deletion or expiry

#### Scenario: CORS does not replace file authorization
- **WHEN** a request has an allowlisted browser origin but no authenticated caller credential
- **THEN** the server denies ordinary file access even when CORS response headers are present

---

### Requirement: Server integrates core features
The proxy server SHALL fully integrate: provider fallback/failover, budget limits, plugin
pipeline, prompt templates, mock mode, and Pino structured logging. All proxied requests
SHALL be logged (with keys masked). `--log` SHALL write to `ai-powered.jsonl`.

#### Scenario: Plugin pipeline runs on server requests
- **WHEN** the `audit-log` plugin is configured and a browser client sends a request
- **THEN** the plugin writes an audit entry for the proxied request
