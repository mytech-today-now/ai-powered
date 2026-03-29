## ADDED Requirements

### Requirement: bd PowerShell Function

A `bd` function defined in `beads-helpers.ps1` that accepts the same subcommand syntax as
the `bd.exe` binary and delegates all execution to `beads-query.ps1`.

#### Scenario: Session loading via dot-source

- **WHEN** a user runs `. .\scripts\beads-helpers.ps1` in a PowerShell session
- **THEN** the `bd` function and all helper functions become available in that session
- **AND** a confirmation message is printed: `"Beads helper commands loaded! Run 'bd-help' for usage."`

#### Scenario: Subcommand routing

- **WHEN** the user runs `bd <subcommand> [args...]`
- **THEN** `beads-query.ps1` is invoked with `-Command <subcommand>` and all remaining args
  forwarded
- **AND** the exit code from `beads-query.ps1` is propagated as the exit code of `bd`

#### Scenario: Unknown subcommand

- **WHEN** the user runs `bd` with an unrecognized subcommand
- **THEN** `beads-query.ps1` prints an error listing the valid subcommands
- **AND** the process exits with a non-zero exit code

#### Scenario: No subcommand (bare bd)

- **WHEN** the user runs `bd` with no arguments
- **THEN** a usage summary is printed showing all available subcommands and their flags
- **AND** exit code is 0

### Requirement: Helper Convenience Functions

Named wrapper functions in `beads-helpers.ps1` for common workflows, all delegating to `bd`.

#### Scenario: bd-list-open

- **WHEN** `bd-list-open` is called
- **THEN** it calls `bd list --status open` and displays results

#### Scenario: bd-list-all

- **WHEN** `bd-list-all` is called
- **THEN** it calls `bd list` with no status filter

#### Scenario: bd-show

- **WHEN** `bd-show <id>` is called
- **THEN** it calls `bd show <id>`

#### Scenario: bd-ready

- **WHEN** `bd-ready` is called
- **THEN** it calls `bd ready` and displays issues with no unresolved `blocks` dependencies

#### Scenario: bd-create

- **WHEN** `bd-create "<title>"` is called with optional `-Description`, `-Priority`, `-Type`
- **THEN** it calls `bd create "<title>"` forwarding all flags

#### Scenario: bd-update

- **WHEN** `bd-update <id>` is called with optional flags (`-Claim`, `-Status`, `-Priority`)
- **THEN** it calls `bd update <id>` forwarding all flags

#### Scenario: bd-close

- **WHEN** `bd-close <id>` is called with optional `-Reason`
- **THEN** it calls `bd close <id> --reason <reason>`

#### Scenario: bd-search

- **WHEN** `bd-search "<query>"` is called
- **THEN** it calls `bd search "<query>"`

#### Scenario: bd-dep

- **WHEN** `bd-dep add <id> <dep-id> --type <type>` is called
- **THEN** it calls `bd dep add <id> <dep-id> --type <type>`

### Requirement: bd-help Output

#### Scenario: bd-help listing

- **WHEN** `bd-help` is called
- **THEN** it prints a formatted list of all available helper functions with usage examples
- **AND** it does NOT reference `bd.exe` or `dolt server`

