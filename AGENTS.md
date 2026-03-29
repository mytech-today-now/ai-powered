# Augment Extensions Integration

This project uses Augment Extensions for additional AI coding guidelines.

## For AI Agents

Use the `augx` CLI to discover and apply extension modules:

```bash
# List linked modules
augx list --linked

# Show module details
augx show <module-name>

# Search for modules
augx search <keyword>
```

## Linked Modules

Check `.augment/extensions.json` for currently linked modules.

---

# Beads Task Management

This project uses **Beads** — a lightweight, git-backed issue tracker stored in `.beads/issues.jsonl`.
AI agents MUST use the PowerShell scripts in `scripts/` to read and write tasks.
**Never edit `.beads/issues.jsonl` directly.**

> Full reference: [`scripts/README.md`](scripts/README.md)

## Setup (required at the start of every session)

Run from the **repository root**:

```powershell
. .\scripts\beads-helpers.ps1
```

This loads the `bd` alias and all typed wrapper functions. You must re-run this in every new PowerShell session.

## Core Command Reference

```powershell
# --- READ ---
bd list                                   # all issues sorted by priority
bd list --status open                     # filter: open | in-progress | closed
bd ready                                  # top unblocked tasks (start here)
bd show <id>                              # full detail for one issue
bd search "keyword"                       # substring search title + description
bd stats                                  # count by status and priority

# --- WRITE ---
bd create "Title" -Description "…" -Priority 1 -Type task   # Priority: 1=high 2=med 3=low
bd update <id> --claim                    # mark in-progress + set claimed_by
bd update <id> --status open             # change status
bd update <id> -Priority 1              # change priority
bd close  <id> --reason "done"           # close with reason

# --- DEPENDENCIES ---
bd dep add    <id> <dep-id>              # <id> is BLOCKED BY <dep-id>
bd dep list   <id>                       # list all deps for <id>
bd dep remove <id> <dep-id>              # remove a dependency
```

## Typed Wrapper Functions (use in scripts)

```powershell
bd-create  -Title "…" [-Description "…"] [-Priority 1] [-Type task]
bd-update  -Id <id>   [-Status open|in-progress] [-Claim] [-Priority 1]
bd-close   -Id <id>   [-Reason "done"]
bd-show    -Id <id>
bd-search  -Query "keyword"
bd-ready
bd-list-open
bd-dep     add|list|remove <id> [dep-id]
bd-help                                  # prints all available helper functions
```

## Bulk Task Creation (for AI agents generating many tasks at once)

```powershell
. .\scripts\beads-helpers.ps1

$tasks = @(
    @{ title="[prefix] Task one"; desc="Details"; pri=1; type="task" },
    @{ title="[prefix] Task two"; desc="Details"; pri=2; type="task" }
)
foreach ($t in $tasks) {
    bd create $t.title -Description $t.desc -Priority $t.pri -Type $t.type
}
bd stats
```

## Standard Agent Workflow

1. **Start:** `. .\scripts\beads-helpers.ps1` then `bd ready` to see what needs doing
2. **Claim:** `bd update <id> --claim` before starting a task
3. **Complete:** `bd close <id> --reason "…"` when done
4. **Block:** `bd dep add <child-id> <blocker-id>` if one task depends on another