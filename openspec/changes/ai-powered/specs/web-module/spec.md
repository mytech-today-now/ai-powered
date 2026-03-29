## ADDED Requirements

### Requirement: Browser-safe web module
The system SHALL expose a browser-safe subset of ai-powered via `src/ai-powered/web/index.ts`
exported as the `ai-powered/web` subpath in `package.json` exports map. The module SHALL use
ONLY web-standard APIs (native `fetch`, `ReadableStream`, `TextDecoder`, `Blob`, `URL`,
`sessionStorage`). It SHALL contain ZERO references to `fs`, `path`, `process`,
`child_process`, or any Node.js built-ins. The Vite build MUST verify this via bundle analysis.

#### Scenario: Zero Node.js API leakage in browser bundle
- **WHEN** `npm run build:web` is run and the bundle is analyzed
- **THEN** no Node.js built-in module (fs, path, os, etc.) appears in `dist-web/` output

---

### Requirement: createWebClient factory
The system SHALL export `createWebClient(options: WebClientOptions): WebAiClient` accepting a
discriminated union:
- **Proxy mode**: `{ mode: 'proxy', proxyUrl: string, profile?: string }` — routes all calls
  through the `ai-powered serve` proxy; API keys never reach the browser.
- **Direct mode**: `{ mode: 'direct', provider: string, apiKey: string, model?: string }` —
  calls provider APIs directly; emits `console.warn` and renders a visible security warning
  banner in the UI on every instantiation; MUST NOT be used in production.

#### Scenario: Proxy mode routes through proxy server
- **WHEN** `createWebClient({ mode: 'proxy', proxyUrl: 'http://localhost:3001' })` is called
  and `generateText` is invoked
- **THEN** the browser sends a POST to `http://localhost:3001/api/ai-powered/text` with no API key in the request

#### Scenario: Direct mode emits console warning
- **WHEN** `createWebClient({ mode: 'direct', provider: 'openai', apiKey: 'sk-...' })` is called
- **THEN** `console.warn` is invoked with a message about direct mode security risks

---

### Requirement: WebAiClient methods
`WebAiClient` SHALL expose: `generateText(prompt, options?) → Promise<TextResult>`,
`generateImage(prompt, options?) → Promise<Blob>`, `transcribeAudio(audioBlob, options?) → Promise<string>`,
`synthesizeSpeech(text, options?) → Promise<Blob>`, `generateVideo(prompt, options?) → Promise<Blob>`,
`streamText(prompt, options?) → ReadableStream<string>`. All methods SHALL accept an optional
`AbortSignal` for cancellation.

#### Scenario: generateImage returns Blob renderable in img element
- **WHEN** `client.generateImage('a sunset')` resolves
- **THEN** the returned `Blob` can be assigned to `URL.createObjectURL(blob)` and rendered
  as `<img src="...">` without additional processing

#### Scenario: streamText returns ReadableStream chunks
- **WHEN** `client.streamText('Tell me a story')` is called
- **THEN** the returned `ReadableStream<string>` emits text deltas that can be piped to the DOM

---

### Requirement: Browser sessionStorage sessions
The system SHALL store conversation session history in `sessionStorage` keyed by session ID.
Sessions SHALL clear automatically when the browser tab closes. `WebAiClient.session(id)`
SHALL return a session-aware client that prepends history to each request.

#### Scenario: Session history persists within tab
- **WHEN** two messages are exchanged using `client.session('chat1').generateText(...)` in the same tab
- **THEN** the second call includes the first exchange in the request context

---

### Requirement: Vite dual ESM/UMD build
The system SHALL produce `dist-web/ai-powered.esm.js` (ES module) and
`dist-web/ai-powered.umd.js` (UMD for plain `<script>` tag) via `npm run build:web`.
`npm run dev:web` SHALL start a Vite dev server at `http://localhost:5173` serving
`integrations/web-example/` with hot module replacement.

#### Scenario: UMD bundle loads via script tag
- **WHEN** `<script src="dist-web/ai-powered.umd.js"></script>` is added to an HTML page
- **THEN** `window.AiPowered.createWebClient` is available as a global function

---

### Requirement: Web demo
The system SHALL include `integrations/web-example/` as a self-contained HTML/CSS/JS page
requiring no build step. It SHALL load the UMD bundle via a relative `<script>` tag and
demonstrate: mode toggle (proxy vs. direct), modality tabs (text/image/audio/video/structured),
streaming text with token-by-token DOM rendering, inline `<img>`/`<audio>`/`<video>` for
binary outputs, cost/usage display, and a multi-turn session panel.

#### Scenario: Web demo runs without build tooling
- **WHEN** `integrations/web-example/index.html` is opened directly in a browser
- **THEN** all UI features are functional without running npm or any build command

