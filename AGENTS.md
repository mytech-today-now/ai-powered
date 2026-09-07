# Repository Guide

## Working Rules

- Treat `C:\GitHub\ai-powered` as the source of truth.
- Read the relevant repository docs before editing: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `package.json`, `.openspec.yaml`, `.github/workflows/ci.yml`, and `scripts/README.md`.
- Keep changes small, follow existing patterns, and avoid new dependencies or abstractions unless the task requires them.
- Source code lives in `src/`, tests live in `tests/`, OpenSpec artifacts live in `openspec/`, and PowerShell helpers live in `scripts/`.
- Treat `dist/` and `dist-web/` as generated build outputs.

## Augment Extensions

- This repo uses Augment Extensions. Check `.augment/extensions.json` when you need repo-specific guidance.
- Use `augx list --linked`, `augx show <module>`, or `augx search <keyword>` to inspect linked modules.

## Beads Task Tracking

- Beads issues live in `.beads/issues.jsonl`. Never edit that file directly.
- At the start of each PowerShell session, run `. .\scripts\beads-helpers.ps1` from the repo root.
- Use `bd ready` to find the next unblocked task.
- Claim work with `bd update <id> --claim` before editing.
- Finish with `bd close <id> --reason "done"` when the task is complete.
- Use `bd list`, `bd show <id>`, `bd search`, `bd stats`, and `bd dep add`, `bd dep list`, and `bd dep remove` through `bd` or the helper functions in `scripts\beads-helpers.ps1`.
- Prefer the typed wrapper functions from `scripts\beads-helpers.ps1` when scripting Beads work.
- When changing Beads tooling, verify it with `pwsh -File .\scripts\_smoke-test.ps1`.

## OpenSpec

- This repo uses the OpenSpec workflow defined by `.openspec.yaml`.
- Keep behavior changes aligned with the relevant artifacts under `openspec/`.
- Use kebab-case for capability and change names.
- Each spec file should cover one capability area and use clear WHEN/THEN scenarios.
- Update the matching `openspec/changes/<change-name>/` files when implementation and spec need to stay in sync.

## Build and Test

- Use Node.js 20+ and the npm scripts in `package.json`.
- Prefer `npm ci` for a clean install.
- Common commands:
  - `npm run build`
  - `npm run build:web`
  - `npm run lint`
  - `npm run format`
  - `npm test`
  - `npm run dev:web`
  - `npm run serve`
- Tests run in mock mode by default. Do not require live provider credentials unless a task explicitly needs them.
- For code changes, run the smallest relevant checks first, then the broader checks before finishing.
- If you change TypeScript or runtime code, run `npm run build` and `npm test`.
- If you change the browser bundle or proxy behavior, also run `npm run build:web`.
- For the repo's main CI checks, expect `npm run build`, `npm run build:web`, `npm run lint`, `npx prettier --check "src/**/*.ts" "tests/**/*.ts"`, and `npm test`.

## Security

- Never commit secrets or API keys.
- Use the repo's `maskApiKey()` convention anywhere credential values might appear in logs or errors.
- Follow `SECURITY.md` for credential handling and browser proxy guidance.
- Keep local config files like `.env` and `.ai-powered/config.json` out of version control.

## Contributing

- Follow `CONTRIBUTING.md` for branch naming, commit messages, and PR expectations.
