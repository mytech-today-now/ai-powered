# Deltas: ai-powered

This document summarizes all capability specification changes introduced by the `ai-powered`
change. Because `openspec/specs/` was empty before this change, all deltas are **ADDED**
(no existing specs were modified or removed).

---

## Summary of Spec Changes

| Capability | Status | Spec Path |
|---|---|---|
| `ai-core` | ✅ ADDED | `specs/ai-core/spec.md` |
| `providers` | ✅ ADDED | `specs/providers/spec.md` |
| `config-system` | ✅ ADDED | `specs/config-system/spec.md` |
| `cli-commands` | ✅ ADDED | `specs/cli-commands/spec.md` |
| `resilience-and-cost` | ✅ ADDED | `specs/resilience-and-cost/spec.md` |
| `plugin-system` | ✅ ADDED | `specs/plugin-system/spec.md` |
| `template-system` | ✅ ADDED | `specs/template-system/spec.md` |
| `batch-and-sessions` | ✅ ADDED | `specs/batch-and-sessions/spec.md` |
| `structured-output` | ✅ ADDED | `specs/structured-output/spec.md` |
| `web-module` | ✅ ADDED | `specs/web-module/spec.md` |
| `proxy-server` | ✅ ADDED | `specs/proxy-server/spec.md` |
| `security` | ✅ ADDED | `specs/security/spec.md` |

---

## ADDED: ai-core
New capability. Defines `AiClient` interface, `AiConfig` Zod schema, `getAiClient()` factory,
multi-modal dispatch (text/image/audio/video/streaming), dynamic model discovery, mock mode.

## ADDED: providers
New capability. Defines `BaseProvider` abstract class; concrete implementations for OpenAI,
Anthropic, xAI/Grok, Venice.ai (text+image; openai-compatible), custom/local (Ollama), and mock.

## ADDED: config-system
New capability. Defines layered config loading (global → local → profile → env → flags),
named profiles, config sub-commands (get/set/list/delete/reset/path/validate), migration,
backup, and the interactive setup wizard.

## ADDED: cli-commands
New capability. Defines the single `ai-powered` CLI binary with all commands, global flags,
stdin/stdout/stderr interoperability, `--output` for binary modalities, `--dry-run`, `--quiet`,
`--no-color`, lifecycle flags (`--init`/`--update`/`--uninstall`), and `health-check`.

## ADDED: resilience-and-cost
New capability. Defines exponential-backoff retries, circuit breaker, ordered provider
fallback/failover, token estimation, per-call and cumulative cost tracking, budget ceilings
(`--budget-session`, `--warn-budget`, `BudgetExceededError`).

## ADDED: plugin-system
New capability. Defines `AiPlugin` interface with `onRequest`/`onResponse`/`onError` hooks,
dynamic plugin loading, sandboxing, and three built-in plugins: `audit-log`, `rate-limiter`,
`prompt-shield`.

## ADDED: template-system
New capability. Defines named prompt templates (JSON/YAML with mustache placeholders),
resolution order, CLI `--template`/`--var` flags, `list-templates` command, and three
built-in templates: `summarize`, `translate`, `qa`.

## ADDED: batch-and-sessions
New capability. Defines JSONL batch processing (per-row overrides, concurrency, progress,
per-row error capture, dry-run), multi-turn conversation sessions with file-system persistence,
and the exported `ConversationSession` class.

## ADDED: structured-output
New capability. Defines `--schema` flag accepting JSON Schema or Zod file, Zod compilation,
provider native structured-output integration, retry on validation failure, and the
`generateStructured<T>()` library method.

## ADDED: web-module
New capability. Defines the browser-safe `createWebClient()` factory, `WebAiClient` methods
returning `Promise<Blob>`/`ReadableStream<string>`, proxy and direct modes, sessionStorage
sessions, Vite ESM+UMD dual bundle, and the `integrations/web-example/` demo.

## ADDED: proxy-server
New capability. Defines `ai-powered serve` Express.js gateway with all `/api/ai-powered/*`
routes, SSE `/stream` endpoint, CORS, per-IP rate limiting, helmet headers, and full
integration of core features (fallback, budget, plugins, templates, mock).

## ADDED: security
New capability. Defines `maskApiKey()` utility with per-provider rules, `.gitignore`
auto-management via `--init`, Husky pre-commit secret-scanning hook, Vite browser bundle
secret-scanning build step, runtime git-tracked credential warning, and browser direct-mode
on-screen security banner.

---

## Known Deviations from JIRA (Design Decisions)

| # | JIRA Requirement | Deviation | Rationale |
|---|---|---|---|
| D1 | "build with tsc" | Dual pipeline: tsc (Node) + Vite (browser) | tsc cannot produce UMD or exclude Node built-ins for browser |
| D2 | xAI SDK name unspecified | Package name TBD — see design.md Open Question Q3 | Verify npm package name before install |
| D3 | Venice audio/TTS/video endpoints | `ProviderCapabilityError` thrown if not yet live | Graceful degradation as specified; dynamic discovery picks up new endpoints |
| D4 | Session storage (file) | Flat JSON per session file (SQLite deferred to v0.2) | Sufficient for v0.1 scope |

