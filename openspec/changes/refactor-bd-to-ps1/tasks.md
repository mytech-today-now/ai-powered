# Tasks: refactor-bd-to-ps1

## beads-query.ps1 — Full Rewrite

- [ ] Define full parameter block (`Command`, `Arg1`, `Arg2`, `Status`, `Description`,
      `Priority`, `Type`, `Reason`, `DepType`, `Limit`, `Json`, `Claim`)
- [ ] Implement `Get-Issues` helper: read all JSONL lines, deduplicate by id (last-write-wins),
      return merged issue map
- [ ] Implement `Append-Issue` helper: serialize hashtable to compact JSON, append to
      `.beads/issues.jsonl`
- [ ] Implement `New-IssueId` helper: generate `bd-<4 random base36 chars>`, check for
      collision, retry if needed
- [ ] Implement `list` command: read all issues, apply optional `--status` filter and `--limit`,
      output human-readable table or `--json` array
- [ ] Implement `show` command: find issue by id, print all fields human-readable or as JSON;
      error + non-zero exit if not found
- [ ] Implement `ready` command: filter to open/in-progress issues with no unresolved `blocks`
      dependencies, sort by priority, apply `--limit`, output human-readable or `--json`
- [ ] Implement `search` command: case-insensitive substring match on title + description,
      output matching issues human-readable or `--json`
- [ ] Implement `create` command: build new issue record with generated id and all provided
      fields, append to JSONL, print id or `--json` object
- [ ] Implement `update` command: read current issue, build delta record with changed fields
      (status, priority, claimed_by for `--claim`), append delta, print confirmation or
      `--json` object
- [ ] Implement `close` command: append delta with `status="closed"` and `close_reason`,
      print confirmation or `--json` object
- [ ] Implement `dep add` subcommand: read current dependencies, add new entry, append full
      updated dependencies array as delta record
- [ ] Implement `dep list` subcommand: print all dependencies for the issue
- [ ] Implement `dep remove` subcommand: read current dependencies, remove matching entry,
      append updated array as delta record
- [ ] Implement `stats` command: compute totals by status and priority, output human-readable
      summary or `--json` object
- [ ] Add usage/help output for unknown command or bare invocation (exit 0)
- [ ] Ensure all error messages go to stderr (`Write-Error`); all data output goes to stdout
- [ ] Verify empty `.beads/issues.jsonl` is handled gracefully (no errors, empty output)

## beads-helpers.ps1 — Full Rewrite

- [ ] Define `bd` function using `$PSScriptRoot` to resolve `beads-query.ps1` path; splat
      `@args` to forward all arguments; propagate exit code
- [ ] Rewrite `bd-list-open` to call `bd list --status open`
- [ ] Rewrite `bd-list-all` to call `bd list`
- [ ] Rewrite `bd-show` to call `bd show $Id`
- [ ] Add `bd-ready` function: calls `bd ready`
- [ ] Add `bd-create` function: accepts `$Title`, optional `-Description`, `-Priority`, `-Type`;
      calls `bd create`
- [ ] Add `bd-update` function: accepts `$Id`, optional `-Status`, `-Claim` switch,
      `-Priority`; calls `bd update`
- [ ] Add `bd-close` function: accepts `$Id`, optional `-Reason`; calls `bd close`
- [ ] Add `bd-search` function: accepts `$Query`; calls `bd search`
- [ ] Add `bd-dep` function: splats `@args` to `bd dep`
- [ ] Refactor `bd-list-augext` to call `bd show` + `bd list` instead of inline JSONL parsing
- [ ] Refactor `bd-list-charcount` to call `bd show` + `bd list` instead of inline JSONL parsing
- [ ] Update `bd-help` to list all new functions; remove any references to `bd.exe` or dolt
- [ ] Fix dot-source detection to use `$MyInvocation.InvocationName -eq '.'`
- [ ] Remove `Export-ModuleMember` call (scripts are dot-sourced, not imported as modules)

## Cleanup

- [ ] Remove any remaining `bd.exe` references from scripts, helper text, and `bd-help` output
- [ ] Remove any `dolt server` references from scripts and helper text
- [ ] Verify `.beads/config.json` is read correctly (project name, version)
- [ ] Smoke test: dot-source helpers, run `bd list`, `bd create "test"`, `bd show <id>`,
      `bd update <id> --claim`, `bd close <id> --reason "done"`, `bd stats`

