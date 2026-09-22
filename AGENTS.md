# Repository Guide

# Codex Working Instructions

## Command Execution

- Act as my implementation agent.
- When a task requires shell, PowerShell, Git, npm, Python, Docker, testing, or other commands, execute those commands yourself using the available integrated terminal or Codex tools.
- Do not ask me to copy and paste commands into a terminal.
- Do not merely provide commands for me to run.
- Keep the command, output, diagnosis, and result in this Codex chat.
- Before running a command, briefly state its purpose.
- After running it, inspect the output and continue working.
- If a command fails, diagnose the failure, correct the command or code, and retry.
- Do not claim that a command succeeded unless you actually executed it and verified the result.
- Run relevant tests, builds, linters, and validation commands after making changes.
- Ask for confirmation only before destructive actions, credential changes, external communication, or actions blocked by permissions.
- At the end, summarize commands executed, files changed, tests performed, and any remaining issues.

## Working Rules

- Treat `C:\GitHub\ai-powered` as the source of truth.
- Read the relevant repository docs before editing: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `package.json`, `.openspec.yaml`, `.github/workflows/ci.yml`, and `scripts/README.md`.
- Keep changes small, follow existing patterns, and avoid new dependencies or abstractions unless the task requires them.
- Source code lives in `src/`, tests live in `tests/`, OpenSpec artifacts live in `openspec/`, and PowerShell helpers live in `scripts/`.
- Treat `dist/` and `dist-web/` as generated build outputs.

## Codex / VS Code Tool Inventory

Repository root: `C:\GitHub\ai-powered`

These are the repository and Codex capabilities observed on 2026-09-20. Host-specific Codex paths may change.

### Direct Codex tools

- `exec_command` — runs PowerShell commands in the repository.
- `write_stdin` — interacts with long-running terminal processes.
- `apply_patch` — edits workspace files.
- `view_image` — inspects local image files.
- `mcp__node_repl__js` — runs persistent Node.js JavaScript; usable for browser automation when the related connector is active.
- `mcp__node_repl__js_add_node_module_dir` — adds a local `node_modules` directory to Node resolution.
- `mcp__node_repl__js_reset` — resets the Node REPL.
- `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` — discovers and reads MCP resources.
- `web__run` — performs web searches and page retrieval; not a repository mutation tool.
- `multi_agent_v1__*` — creates and manages delegated Codex agents when explicitly authorized.
- `get_goal`, `create_goal`, `update_goal` — manages explicit Codex goals.

### VS Code Codex extension

- Extension namespace: `@ext:openai.chatgpt`
- Extension filesystem path is host-managed and was not exposed in this session.
- Commands:
  - `chatgpt.addToThread`
  - `chatgpt.addFileToThread`
  - `chatgpt.newChat`
  - `chatgpt.newCodexPanel`
  - `chatgpt.openCommandMenu`
  - `chatgpt.openSidebar`
- Shared Codex configuration:
  - `C:\Users\kyle_\.codex\config.toml`
  - `C:\GitHub\ai-powered\.codex\config.toml` if a project-local configuration is added.
- Repository instructions:
  - `C:\GitHub\ai-powered\AGENTS.md`
  - `C:\Users\kyle_\.codex\AGENTS.md` for global instructions, if present.

### Repository-local tools and applications

- PowerShell:
  - `C:\Program Files\PowerShell\7\pwsh.exe`
  - `powershell.exe` fallback
- Node/npm tooling:
  - `node`
  - `npm`
  - `npx`
  - `C:\GitHub\ai-powered\node_modules\.bin\`
- Git repository:
  - `C:\GitHub\ai-powered\.git`
- Application source:
  - `C:\GitHub\ai-powered\src\`
  - `C:\GitHub\ai-powered\src\ai-powered\`
- CLI/server generated entry:
  - `C:\GitHub\ai-powered\dist\ai-powered\cli\index.js`
- Browser demo:
  - `C:\GitHub\ai-powered\integrations\web-example\index.html`
  - `C:\GitHub\ai-powered\integrations\web-example\app.js`
  - `C:\GitHub\ai-powered\integrations\web-example\styles.css`
- Generated outputs; do not hand-edit:
  - `C:\GitHub\ai-powered\dist\`
  - `C:\GitHub\ai-powered\dist-web\`
- Tests:
  - `C:\GitHub\ai-powered\tests\`
  - `C:\GitHub\ai-powered\.playwright-cli\`
- Beads task tracker:
  - `C:\GitHub\ai-powered\scripts\beads-helpers.ps1`
  - `C:\GitHub\ai-powered\scripts\beads-query.ps1`
  - `C:\GitHub\ai-powered\scripts\_smoke-test.ps1`
  - `C:\GitHub\ai-powered\.beads\issues.jsonl`
  - Load with `. .\scripts\beads-helpers.ps1`, then use `bd`.
  - Never edit `.beads\issues.jsonl` directly.
- Augment Extensions:
  - `C:\GitHub\ai-powered\.augment\extensions.json`
  - `C:\GitHub\ai-powered\.augment\commands\`
  - `C:\GitHub\ai-powered\.augment\rules\`
  - `C:\GitHub\ai-powered\.augment\skills\`
  - Commands: `augx list --linked`, `augx show <module>`, `augx search <keyword>`
- OpenSpec:
  - `C:\GitHub\ai-powered\.openspec.yaml`
  - `C:\GitHub\ai-powered\openspec\`
  - `C:\GitHub\ai-powered\.augment\commands\opsx-*.md`
- CI:
  - `C:\GitHub\ai-powered\.github\workflows\ci.yml`

### npm application commands

Run from `C:\GitHub\ai-powered`:

- `npm ci`
- `npm run build`
- `npm run build:web`
- `npm run dev:web`
- `npm start`
- `npm run serve`
- `npm run serve:ngrok`
- `npm test`
- `npm run test:watch`
- `npm run lint`
- `npm run format`
- `npx prettier --check "src/**/*.ts" "tests/**/*.ts"`
- `npx playwright install --with-deps chromium`

### Codex skills available on this host

- `imagegen` — `C:\Users\kyle_\.codex\skills\.system\imagegen\SKILL.md`
- `openai-docs` — `C:\Users\kyle_\.codex\skills\.system\openai-docs\SKILL.md`
- `plugin-creator` — `C:\Users\kyle_\.codex\skills\.system\plugin-creator\SKILL.md`
- `skill-creator` — `C:\Users\kyle_\.codex\skills\.system\skill-creator\SKILL.md`
- `skill-installer` — `C:\Users\kyle_\.codex\skills\.system\skill-installer\SKILL.md`
- `playwright` — `C:\Users\kyle_\.codex\skills\playwright\SKILL.md`
- `browser:control-in-app-browser` — `C:\Users\kyle_\.codex\plugins\cache\openai-bundled\browser\26.908.70816\skills\control-in-app-browser\SKILL.md`
- `chrome:control-chrome` — `C:\Users\kyle_\.codex\plugins\cache\openai-bundled\chrome\26.908.70816\skills\control-chrome\SKILL.md`
- `computer-use:computer-use` — `C:\Users\kyle_\.codex\plugins\cache\openai-bundled\computer-use\26.908.70816\skills\computer-use\SKILL.md`
- `build-web-apps:frontend-app-builder` — `C:\Users\kyle_\.codex\plugins\cache\openai-api-curated\build-web-apps\1dc19589\skills\frontend-app-builder\SKILL.md`
- `build-web-apps:frontend-testing-debugging` — `C:\Users\kyle_\.codex\plugins\cache\openai-api-curated\build-web-apps\1dc19589\skills\frontend-testing-debugging\SKILL.md`
- `build-web-apps:react-best-practices` — `C:\Users\kyle_\.codex\plugins\cache\openai-api-curated\build-web-apps\1dc19589\skills\react-best-practices\SKILL.md`
- `build-web-apps:shadcn` — `C:\Users\kyle_\.codex\plugins\cache\openai-api-curated\build-web-apps\1dc19589\skills\shadcn-best-practices\SKILL.md`
- `build-web-apps:stripe-best-practices` — `C:\Users\kyle_\.codex\plugins\cache\openai-api-curated\build-web-apps\1dc19589\skills\stripe-best-practices\SKILL.md`
- `build-web-apps:supabase-postgres-best-practices` — `C:\Users\kyle_\.codex\plugins\cache\openai-api-curated\build-web-apps\1dc19589\skills\supabase-best-practices\SKILL.md`
- `documents:documents` — `C:\Users\kyle_\.codex\plugins\cache\openai-primary-runtime\documents\26.909.61513\skills\documents\SKILL.md`
- `pdf:pdf` — `C:\Users\kyle_\.codex\plugins\cache\openai-primary-runtime\pdf\26.909.61513\skills\pdf\SKILL.md`
- `presentations:Presentations` — `C:\Users\kyle_\.codex\plugins\cache\openai-primary-runtime\presentations\26.909.61513\skills\presentations\SKILL.md`
- `spreadsheets:Spreadsheets` — `C:\Users\kyle_\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.909.61513\skills\spreadsheets\SKILL.md`
- `spreadsheets:excel-live-control` — `C:\Users\kyle_\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.909.61513\skills\excel-live-control\SKILL.md`
- `template-creator:template-creator` — `C:\Users\kyle_\.codex\plugins\cache\openai-primary-runtime\template-creator\26.909.61513\skills\template-creator\SKILL.md`
- `visualize:visualize` — `C:\Users\kyle_\.codex\plugins\cache\openai-bundled\visualize\1.0.37\skills\visualize\SKILL.md`

Installed skill files do not guarantee that a corresponding browser, Chrome, desktop, or external-service connector is active in every Codex session. Verify the callable tool surface before relying on those integrations.

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

## Version Synchronization

The root `VERSION` file is the single source of truth for the workspace version.

- After editing `VERSION`, run `pnpm version:sync`.
- Use `pnpm version:sync:dry-run` to preview changes.
- Use `pnpm version:sync:force` in non-interactive contexts.
- `VERSIONING.md` defines the SemVer rules and supported rewrite targets.

## YAGNI

Prefer the smallest change that satisfies the current task. Add abstractions only when there is a clear current use case or when the cost of changing later is high.

## Working Rules

- Inspect the repository before editing.
- Reuse existing scripts, utilities, fixtures, and test harnesses.
- Keep changes focused and avoid unrelated edits.
- Avoid new dependencies unless the task requires them.
- Prefer behavior-based validation over compile-only checks.
- Run the smallest relevant tests first, then broader checks when they are useful.
- Never claim completion if the required validation was skipped or failed.
- Record skipped checks and any remaining risk.
- Use `test-artifacts/` or `test-results/` for local failure artifacts when you need them.
