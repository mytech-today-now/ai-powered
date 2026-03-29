## Context

No shared AI infrastructure exists in this repository. The `ai-powered` package is a
greenfield npm library and CLI built with TypeScript 5+, ESM modules, and Commander.js.
It must be publishable to npm, embeddable in any Node.js project as a library, callable
from every major language via shell exec, and usable in a browser via a Vite-built bundle
and an optional Express proxy server. Providers: OpenAI, Anthropic, xAI/Grok, Venice.ai,
custom/local (Ollama-compatible), and mock.

## Goals / Non-Goals

**Goals:**
- Single source of truth for all AI configuration, provider instantiation, and key management
- Four invocation modes: CLI, library, agent tool-calling, browser (proxy + direct)
- Zero-duplication: future repos call `ai-powered` rather than re-implement AI config
- Production-grade: retries, circuit breaker, provider fallback, budget limits, plugin pipeline
- Browser-safe bundle with zero Node.js leakage, verified by Vite bundle analysis
- Fully mock-able CI pipeline (no real credentials required in CI)

**Non-Goals:**
- Built-in blog or JIRA ticket subcommands (delegated to downstream CLIs)
- Managing provider pricing data (estimated via token heuristics; actual cost from API response)
- Full OAuth or SSO flows (API key auth only in v0.1)

## Decisions

### D1 — ESM-only package (`"type": "module"`)
**Decision**: Use ESM throughout (`"type": "module"` in package.json, `tsc` outputs ESM).
**Rationale**: All major Node.js packages have moved to ESM; CommonJS interop via
dynamic `import()` is broadly supported. ESM is required for the Vite browser build to
tree-shake correctly. CJS dual-emit was considered and rejected (doubles build complexity,
causes subtle interop bugs with top-level await).
**Risk**: Some legacy CJS consumers may struggle → mitigated by documenting the ESM
requirement prominently in README.

### D2 — Provider abstraction via BaseProvider
**Decision**: Abstract class `BaseProvider` with one concrete subclass per provider.
**Rationale**: Adding Venice.ai (an OpenAI-compatible REST API) proves the pattern: the
`VeniceProvider` simply extends `OpenAiProvider` with a custom `baseURL` and `VENICE_API_KEY`.
Alternatives: a single mega-switch on provider name was rejected (untestable, non-extensible).
Interface-only was rejected (shared retry/circuit-breaker logic belongs on the base class).

### D3 — Config layering with Zod
**Decision**: All config layers are merged, then validated once via Zod before use.
**Rationale**: Fail-fast validation surfaces misconfigurations before any HTTP call.
Zod generates TypeScript types automatically, eliminating a parallel type definition.
Alternative (runtime duck-typing) rejected: too error-prone at the edges.

### D4 — Vite for browser bundle + tsc for Node
**Decision**: Two separate build pipelines: `tsc` for `dist/` (Node), Vite for `dist-web/`.
**Rationale**: Vite provides tree-shaking, Node-polyfill detection, and lib mode for dual
ESM/UMD output out of the box. `tsc`-only was rejected for the browser because it cannot
exclude Node built-ins or produce a UMD bundle.

### D5 — Express proxy server for browser key management
**Decision**: Ship `ai-powered serve` as a thin stateless Express gateway.
**Rationale**: Browser CORS constraints prevent direct provider calls in production. The
proxy holds API keys server-side. Alternatives (BFF in the consumer's server, edge functions)
require per-repo setup — contrary to the zero-duplication goal.

### D6 — Plugin pipeline (onRequest/onResponse)
**Decision**: Compose plugins as an ordered async middleware chain.
**Rationale**: Matches established middleware patterns (Express, Koa). Plugins cannot
mutate AiConfig to prevent accidental config corruption. A failing plugin is wrapped as
`PluginError` and bypassed rather than crashing the call.

### D7 — Mock provider selected at core factory level
**Decision**: When `AI_MOCK=true`, the factory substitutes `MockProvider` before any
real provider is instantiated.
**Rationale**: Centralizing mock selection in the factory means every code path (CLI, library,
browser, batch, sessions) is mockable with a single env var — no per-call mock flag threading.

## Risks / Trade-offs

- **xAI SDK API instability** → The xAI SDK is newer and may have breaking changes.
  Mitigation: pin a specific version; use a thin adapter that wraps the SDK so breaking
  changes are isolated to `providers/grok.ts`.
- **Venice.ai modality gaps** → Audio, TTS, and video endpoints may not exist in v0.1.
  Mitigation: `ProviderCapabilityError` is thrown gracefully; dynamic model discovery
  handles new modalities automatically when Venice.ai adds them.
- **Browser direct mode misuse** → Developers may ship direct mode to production accidentally.
  Mitigation: mandatory `console.warn` + visible DOM banner + SECURITY.md documentation +
  Vite secret-scan build step.
- **Token cost estimation inaccuracy** → Pre-call estimates use a heuristic tokenizer,
  not the provider's exact tokenizer.
  Mitigation: Always use actual usage data from provider response for final cost accounting;
  estimates are labeled "estimated" in output.
- **Large JSONL batch files** → Processing millions of rows in a single `batch` run could
  exhaust memory.
  Mitigation: Stream-read the JSONL file line-by-line; never load the full file into memory.

## Migration Plan

1. Create `openspec/changes/ai-powered/` artifact directory (done — this change).
2. Implement package scaffolding: `package.json`, `tsconfig.json`, `vite.config.ts`, lint/format configs.
3. Implement in capability order: `ai-core` → `providers` → `config-system` → `cli-commands`
   → `resilience-and-cost` → `plugin-system` → `template-system` → `batch-and-sessions`
   → `structured-output` → `web-module` → `proxy-server` → `security`.
4. Add comprehensive mock-based tests after each capability group.
5. Run `npm run build && npm run build:web` and verify zero Node leakage in `dist-web/`.
6. Verify CI passes with `AI_MOCK=true` (no real credentials).
7. Publish to npm via `npm publish` (manual or on GitHub release event).

**Rollback**: No existing files are modified by this change; rollback is simply deleting the
new `ai-powered/` directory and the `openspec/changes/ai-powered/` change directory.

## Open Questions

- **Q1**: Should `ai-powered serve` support TLS/HTTPS natively, or delegate TLS termination
  to a reverse proxy (nginx, Caddy)? → Lean toward delegating; add `--https` as a v0.2 item.
- **Q2**: Venice.ai image generation endpoint URL — confirm exact path (`/image/generate`
  vs. `/images/generations`) before implementation.
- **Q3**: xAI SDK package name — confirm whether it is `@xai/grok-sdk` or a different identifier
  before adding to `package.json`.
- **Q4**: Should `ConversationSession` use SQLite instead of flat JSON for large session history?
  → Flat JSON is sufficient for v0.1; SQLite is a v0.2 consideration.

