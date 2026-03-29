## Architecture

Two scripts, one data layer.

```
beads-helpers.ps1          (session loader + alias layer)
  └─ bd <cmd> [args]  ──►  beads-query.ps1  (command engine)
                                └─ .beads/issues.jsonl  (append-only JSONL store)
```

`beads-helpers.ps1` is dot-sourced by the user once per session. It defines the `bd` function
and all convenience wrappers. It never touches the data layer directly.

`beads-query.ps1` owns all reads and writes to `.beads/issues.jsonl`. It is the single source
of truth for issue state.

---

## beads-query.ps1 Design

### Parameter surface

```powershell
param(
    [Parameter(Position=0)] [string]$Command = "list",
    [Parameter(Position=1)] [string]$Arg1 = "",   # id or subcommand (dep add/list)
    [Parameter(Position=2)] [string]$Arg2 = "",   # dep-id for dep commands
    [string]$Status     = "",
    [string]$Description = "",
    [int]$Priority      = 3,
    [string]$Type       = "task",
    [string]$Reason     = "",
    [string]$DepType    = "blocks",
    [int]$Limit         = 0,
    [switch]$Json,
    [switch]$Claim
)
```

### Read path: `Get-Issues`

Reads every line of `.beads/issues.jsonl`, deserializes each, and merges by id
(last-write-wins property merge). Returns a `[hashtable]` keyed by id, or the `.Values`
collection for iteration.

```powershell
function Get-Issues {
    $map = [ordered]@{}
    Get-Content $beadsFile | Where-Object { $_.Trim() } | ForEach-Object {
        $rec = $_ | ConvertFrom-Json
        if (-not $map.ContainsKey($rec.id)) { $map[$rec.id] = $rec }
        else {
            $rec.PSObject.Properties | ForEach-Object {
                $map[$rec.id] | Add-Member -NotePropertyName $_.Name -NotePropertyValue $_.Value -Force
            }
        }
    }
    return $map
}
```

### Write path: `Append-Issue`

Serializes a hashtable/PSObject to compact JSON and appends a single line to the file.
Never rewrites existing lines.

```powershell
function Append-Issue([hashtable]$record) {
    $line = $record | ConvertTo-Json -Compress -Depth 10
    Add-Content -Path $beadsFile -Value $line -Encoding UTF8
}
```

### ID generation

Short base-36 IDs: `bd-` + 4 random chars from `[0-9a-z]` (e.g. `bd-k3x9`).
Collision check: regenerate if id already exists in current issues map.

### --json output

Every command that produces output has two branches:
- Human-readable: colored `Write-Host` output
- `--json` / `$Json`: `$result | ConvertTo-Json -Depth 10 | Write-Output`

JSON output always goes to stdout. Error messages always go to stderr via `Write-Error`.

### ready command logic

An issue is "ready" when:
1. Its status is `open` or `in-progress`
2. It has no dependency of type `blocks` where the blocking issue's status is not `closed`

### dep command

`dep` uses positional args: `bd dep <subcommand> <id> [dep-id] [--type <type>]`
- Subcommands: `add`, `list`, `remove`
- Appends a delta record containing only `id` and the updated `dependencies` array (full array
  rebuild from current state + new entry).

---

## beads-helpers.ps1 Design

### The `bd` function

```powershell
function bd {
    $scriptPath = Join-Path $PSScriptRoot "beads-query.ps1"
    & $scriptPath @args
    return $LASTEXITCODE
}
```

Uses `$PSScriptRoot` so the path resolves correctly regardless of working directory.
Splats `@args` to forward all positional and named arguments verbatim.

### Convenience wrappers

All wrappers call `bd` (not `beads-query.ps1` directly), so they benefit from any future
changes to the alias layer.

```powershell
function bd-list-open  { bd list --status open }
function bd-list-all   { bd list }
function bd-show       { param([string]$Id) bd show $Id }
function bd-ready      { bd ready }
function bd-create     { param([string]$Title, [string]$Description="", [int]$Priority=3, [string]$Type="task")
                         bd create $Title -Description $Description -Priority $Priority -Type $Type }
function bd-update     { param([string]$Id, [string]$Status="", [switch]$Claim, [int]$Priority=0)
                         $extra = if ($Claim) { "--claim" } else { "" }
                         bd update $Id --status $Status $extra }
function bd-close      { param([string]$Id, [string]$Reason="Completed") bd close $Id --reason $Reason }
function bd-search     { param([string]$Query) bd search $Query }
function bd-dep        { bd dep @args }
```

### bd-list-augext / bd-list-charcount

These remain but are refactored to call `bd show` and `bd list` with filtering instead of
duplicating JSONL parsing logic inline.

### Module vs dot-source detection

```powershell
if ($MyInvocation.InvocationName -eq '.') {
    Write-Host "Beads helper commands loaded! Run 'bd-help' for usage." -ForegroundColor Green
}
```

---

## Data Format

Issue record (full):
```json
{
  "id": "bd-k3x9",
  "title": "Refactor something",
  "status": "open",
  "priority": 2,
  "issue_type": "task",
  "description": "Details here",
  "labels": [],
  "dependencies": [{"type": "blocks", "depends_on_id": "bd-ab12"}],
  "claimed_by": "",
  "close_reason": "",
  "created_at": "2026-03-25T15:00:00Z",
  "updated_at": "2026-03-25T15:01:00Z"
}
```

Delta record (update/close — only changed fields + id):
```json
{"id": "bd-k3x9", "status": "closed", "close_reason": "Done", "updated_at": "..."}
```

---

## Not In Scope

- Dolt / MySQL sync — removed entirely
- `bd init` — `.beads/` directory and `config.json` are assumed to exist (created by initial setup)
- Network operations, webhooks, or external API calls
- Branch/merge collision resolution (not needed with local JSONL)

