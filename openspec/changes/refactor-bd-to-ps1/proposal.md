## Why

The repo depends on `bd.exe` (a compiled Go binary) and `dolt server` (a MySQL-compatible
database server process) for issue tracking. Both are heavyweight external dependencies that
require separate installation and a running server. Since all issue data already lives in
`.beads/issues.jsonl`, the entire stack can be replaced with native PowerShell scripts that
read and write JSONL directly — eliminating the binary and server dependency with zero data
migration required.

## What Changes

- **Rewrite `scripts/beads-query.ps1`** to implement all `bd` subcommands: `list`, `show`,
  `ready`, `search`, `create`, `update`, `close`, `dep`, and `stats` — with full `--json`
  output support and `--claim`, `--reason`, `--limit`, `--status`, `--type` flag parity.
- **Rewrite `scripts/beads-helpers.ps1`** to expose a `bd` PowerShell function/alias that
  routes all invocations to `beads-query.ps1`, plus convenience helpers (`bd-list-open`,
  `bd-show`, `bd-ready`, `bd-create`, `bd-update`, `bd-close`, `bd-search`, `bd-dep`).
- **Remove all references** to `bd.exe` binary and `dolt server` from scripts, docs, and
  helper text.
- **No data migration**: `.beads/issues.jsonl` and `.beads/interactions.jsonl` schemas are
  unchanged; scripts read/write them natively.

## Capabilities

### New Capabilities

- `bd-alias`: A PowerShell `bd` function (loaded via dot-sourcing `beads-helpers.ps1`) that
  accepts the same subcommand syntax as `bd.exe` and routes to `beads-query.ps1`.
- `full-command-parity`: All `bd` subcommands (`list`, `show`, `ready`, `search`, `create`,
  `update`, `close`, `dep`, `stats`) implemented in `beads-query.ps1` with flag parity and
  `--json` output mode.

### Modified Capabilities

- (none — `openspec/specs/` is currently empty)

## Impact

- `scripts/beads-query.ps1` — full rewrite; becomes the single source of truth for all
  issue read and write operations against `.beads/issues.jsonl`.
- `scripts/beads-helpers.ps1` — full rewrite; becomes the session loader that exposes `bd`
  and all convenience wrapper functions.
- `.beads/issues.jsonl` / `.beads/interactions.jsonl` — data files; schema unchanged.
- `.beads/config.json` — read by scripts for project metadata; no structural changes.
- No dependency on `bd.exe`, `dolt`, or any external binary after this change.

