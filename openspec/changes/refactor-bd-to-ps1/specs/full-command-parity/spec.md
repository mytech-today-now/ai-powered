## ADDED Requirements

### Requirement: list command

`bd list [--status <status>] [--json] [--limit <n>]`

#### Scenario: List all issues (human-readable)

- **WHEN** `bd list` is called
- **THEN** all issues from `.beads/issues.jsonl` are printed, deduplicated by ID (last-write-wins)
- **AND** output includes: id, type, priority, status, title
- **AND** issues are sorted by priority then id

#### Scenario: List with status filter

- **WHEN** `bd list --status open` is called
- **THEN** only issues with `status == "open"` are shown

#### Scenario: List with --json

- **WHEN** `bd list --json` is called
- **THEN** output is a valid JSON array of issue objects
- **AND** each object includes at minimum: `id`, `title`, `status`, `priority`, `issue_type`

---

### Requirement: show command

`bd show <id> [--json]`

#### Scenario: Show existing issue

- **WHEN** `bd show <id>` is called and the issue exists
- **THEN** all fields are printed: title, status, description, priority, type, labels, dependencies, spec, rules

#### Scenario: Show missing issue

- **WHEN** `bd show <id>` is called and the issue does not exist
- **THEN** an error is printed and exit code is non-zero

#### Scenario: Show with --json

- **WHEN** `bd show <id> --json` is called
- **THEN** the issue is output as a single JSON object

---

### Requirement: ready command

`bd ready [--json] [--limit <n>]`

#### Scenario: Ready issues

- **WHEN** `bd ready` is called
- **THEN** all open or in-progress issues with no unresolved `blocks`-type dependencies are listed
- **AND** results are sorted by priority (ascending)

#### Scenario: Ready with limit

- **WHEN** `bd ready --limit 1` is called
- **THEN** at most 1 issue is returned

#### Scenario: Ready with --json

- **WHEN** `bd ready --json` is called
- **THEN** output is a JSON array of ready issue objects

---

### Requirement: search command

`bd search "<query>" [--json]`

#### Scenario: Full-text search

- **WHEN** `bd search "some text"` is called
- **THEN** issues whose title or description contains the query string (case-insensitive) are listed

#### Scenario: No results

- **WHEN** no issues match the query
- **THEN** a "No issues found" message is printed and exit code is 0

---

### Requirement: create command

`bd create "<title>" [-d <description>] [-p <priority>] [-t <type>] [--json]`

#### Scenario: Create new issue

- **WHEN** `bd create "My issue"` is called
- **THEN** a new JSON record is appended to `.beads/issues.jsonl` with: generated id, title,
  status="open", created_at timestamp, priority (default 3), issue_type (default "task")
- **AND** the new issue id is printed

#### Scenario: Create with --json

- **WHEN** `bd create "My issue" --json` is called
- **THEN** the newly created issue object is printed as JSON

#### Scenario: ID generation

- **WHEN** a new issue is created
- **THEN** the id is a short unique identifier (e.g., `bd-<base36>` or `bd-<random>`)
- **AND** no two issues share the same id

---

### Requirement: update command

`bd update <id> [--status <status>] [--claim] [--priority <n>] [--json]`

#### Scenario: Claim an issue

- **WHEN** `bd update <id> --claim` is called
- **THEN** a new record is appended to `.beads/issues.jsonl` with `status="in-progress"`
  and `claimed_by` set to the current agent/user identifier

#### Scenario: Change status

- **WHEN** `bd update <id> --status <status>` is called
- **THEN** a delta record is appended updating only the status field

#### Scenario: Update with --json

- **WHEN** `bd update <id> --json` is called
- **THEN** the updated issue object is printed as JSON after the change

---

### Requirement: close command

`bd close <id> [--reason <text>] [--json]`

#### Scenario: Close an issue

- **WHEN** `bd close <id>` is called
- **THEN** a delta record is appended with `status="closed"` and optional `close_reason`
- **AND** a confirmation message is printed

#### Scenario: Close with --json

- **WHEN** `bd close <id> --json` is called
- **THEN** the closed issue object is printed as JSON

---

### Requirement: dep command

`bd dep add <id> <dep-id> [--type <type>]`  
`bd dep list <id>`  
`bd dep remove <id> <dep-id>`

#### Scenario: Add dependency

- **WHEN** `bd dep add <id> <dep-id> --type blocks` is called
- **THEN** a delta record is appended adding `{"type":"blocks","depends_on_id":"<dep-id>"}` to
  the issue's `dependencies` array

#### Scenario: Supported dependency types

- **WHEN** `--type` is provided
- **THEN** valid values are: `blocks`, `related`, `parent`, `child`, `discovered-from`

#### Scenario: List dependencies

- **WHEN** `bd dep list <id>` is called
- **THEN** all dependencies for the issue are printed with type and target id

---

### Requirement: stats command

`bd stats [--json]`

#### Scenario: Show statistics

- **WHEN** `bd stats` is called
- **THEN** a summary is printed: total issues, counts by status (open, in-progress, closed),
  counts by priority

#### Scenario: Stats with --json

- **WHEN** `bd stats --json` is called
- **THEN** statistics are returned as a JSON object

---

### Requirement: JSONL append-only storage

#### Scenario: Write operations append

- **WHEN** any mutation command runs (create, update, close, dep add)
- **THEN** a new JSON line is appended to `.beads/issues.jsonl`; existing lines are never modified

#### Scenario: Read resolution (last-write-wins)

- **WHEN** any read command runs
- **THEN** all lines for a given `id` are merged in order, with later fields overwriting earlier ones
- **AND** the final merged state is used for display and filtering

