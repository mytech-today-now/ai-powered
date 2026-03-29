# Changelog

All notable changes to `ai-powered` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] – 2026-03-27

### Added

- `AiConfig` Zod schema with full field set (modality, provider, model, apiKey,
  temperature, maxTokens, systemPrompt, stream, profile, fallbackProviders,
  budgetSession, warnBudget, plugins, templateDirs, mock, logFile, debug).
- Layered config loader: global `~/.ai-powered/config.json` → project-local
  `./.ai-powered/config.json` → named profile → `AI_*` environment variables → CLI flags.
- Config version mismatch detection with automatic backup and migration.
- `package.json`, `tsconfig.json`, `vite.config.ts` scaffolding for dual Node + browser builds.
- `.env.example` documenting all environment variables.
- `.gitignore`, `.eslintrc.json`, `.prettierrc`, `lint-staged` configuration.
- Husky pre-commit hook: lint-staged + secret-scanning.
- GitHub Actions CI workflow: build, lint, test (`AI_MOCK=true`), publish on release.
- `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE` (MIT).

[0.1.0]: https://github.com/mytech-today-now/ai-powered/releases/tag/v0.1.0

