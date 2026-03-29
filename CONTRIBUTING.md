# Contributing to ai-powered

Thank you for contributing! Please read this guide before opening a PR.

---

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/add-venice-provider` |
| Bug fix | `fix/<short-description>` | `fix/mask-apikey-in-logs` |
| Refactor | `refactor/<short-description>` | `refactor/config-loader` |
| Docs | `docs/<short-description>` | `docs/plugin-guide` |
| CI/tooling | `ci/<short-description>` | `ci/add-coverage-report` |
| Release | `release/v<semver>` | `release/v0.2.0` |

---

## Commit Conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`, `perf`, `security`

**Examples:**
```
feat(providers): add VeniceProvider with /chat/completions support
fix(config): mask apiKey before logging merged config
security(pre-commit): add secret-scanning hook for sk-, xai-, ven- prefixes
```

Breaking changes **MUST** include `BREAKING CHANGE:` in the footer:
```
feat(core)!: rename getClient to getAiClient

BREAKING CHANGE: `getClient` export removed; use `getAiClient` instead.
```

---

## Pull Request Process

1. Create a branch from `main` following the naming convention above.
2. Implement changes with tests (`npm test` must pass; all tests use `AI_MOCK=true`).
3. Run `npm run lint && npm run format` before pushing.
4. The Husky pre-commit hook runs `lint-staged` + secret-scanning automatically.
5. Open a PR against `main` with a clear description referencing the bead task ID.
6. At least one review approval is required before merge.
7. Squash-merge is preferred to keep the main branch history clean.

---

## Plugin Authoring Guide

See [Writing a Plugin](README.md#writing-a-plugin) in the README for the full guide.

### Quick Start

A plugin is any object implementing the `AiPlugin` interface:

```typescript
import type { AiPlugin, RequestContext, ResponseContext } from "ai-powered";

export const myPlugin: AiPlugin = {
  name: "my-plugin",

  async onRequest(ctx: RequestContext): Promise<void> {
    // Mutate ctx.messages or ctx.config (frozen copy — cannot mutate AiConfig).
    // Throw PluginError to signal a non-fatal failure (plugin is bypassed).
  },

  async onResponse(ctx: ResponseContext): Promise<void> {
    // Inspect ctx.response; log, audit, or modify metadata.
  },

  async onError(error: Error): Promise<void> {
    // Called for every AiPowerError; useful for audit-log plugins.
  },
};
```

Register your plugin in `.ai-powered/config.json`:

```json
{
  "plugins": ["./my-plugin.js", "@my-scope/ai-powered-plugin"]
}
```

Rules:
- Plugins receive a **frozen copy** of `AiConfig`; modifying it throws a `TypeError`.
- Uncaught errors in a plugin are wrapped as `PluginError`, logged, and the plugin is bypassed.
- Plugins must be ESM (`"type": "module"`) and export a default or named `AiPlugin` object.
- Avoid synchronous blocking; all hooks must be `async`.

