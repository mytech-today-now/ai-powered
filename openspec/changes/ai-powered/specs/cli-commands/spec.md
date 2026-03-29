## ADDED Requirements

### Requirement: Single ai-powered CLI binary
The system SHALL register `ai-powered` as the sole CLI binary in `package.json` `bin` field.
It SHALL use Commander.js for command/flag parsing. All commands SHALL support `--help`.

#### Scenario: Binary invokable after npm install
- **WHEN** `npm install -g ai-powered` is run
- **THEN** `ai-powered --help` prints the full command list and exits with code 0

---

### Requirement: Core commands
The system SHALL implement the following commands: `text`, `image`, `audio transcribe`,
`audio speak`, `video`, `structured`, `wizard` (alias `setup`), `list-models [modality]`,
`list-templates`, `config <subcommand>`, `health-check`, `batch <mode>`, `serve`,
`session list`, `session clear <id>`.

#### Scenario: Text command with prompt argument
- **WHEN** `ai-powered text "What is 2+2?"` is run
- **THEN** the system prints the AI response to stdout and exits with code 0

#### Scenario: Image command saves to file
- **WHEN** `ai-powered image "a cat" --output cat.png` is run
- **THEN** the system writes the binary PNG to `cat.png` and prints a confirmation to stderr

#### Scenario: list-models returns JSON
- **WHEN** `ai-powered list-models text --json` is run
- **THEN** the system prints a JSON array of model descriptors and exits with code 0

---

### Requirement: Global flags on every command
Every command SHALL accept: `--provider`, `--model`, `--api-key`, `--temperature`,
`--max-tokens`, `--json`, `--modality`, `--stream`, `--profile`, `--mock`, `--dry-run`,
`--quiet`, `--no-color`, `--no-fallback`, `--budget-session <USD>`, `--warn-budget <USD>`,
`--log`, `--debug`.

#### Scenario: --json flag on text command
- **WHEN** `ai-powered text "hello" --json` is run
- **THEN** stdout contains a valid JSON object with `content`, `usage`, `model`, `cost`, `modality`

#### Scenario: --quiet suppresses decorative output
- **WHEN** `ai-powered text "hello" --quiet` is run
- **THEN** only the raw result is written to stdout; no spinners, banners, or progress bars appear

---

### Requirement: stdin and interoperability
The system SHALL read full input from stdin when no prompt argument is provided.
The `--stdin` flag SHALL explicitly enable stdin reading. stdout SHALL carry only final
results; stderr SHALL carry logs, errors, and progress. Exit codes: 0 success, 1 error,
2 validation/health-check failure. `NO_COLOR=1` env var SHALL disable ANSI codes.

#### Scenario: Piped prompt via stdin
- **WHEN** `echo "Summarize this" | ai-powered text` is run
- **THEN** the system reads the prompt from stdin and prints the response to stdout

---

### Requirement: --output flag for binary modalities
For `image`, `audio speak`, and `video` commands, `--output <filepath>` SHALL write the
binary result directly to disk. Without `--output`, the CLI SHALL print base64 with a
MIME-type header in `--json` mode, or emit a warning in human mode suggesting `--output`.

#### Scenario: Audio synthesize saves MP3
- **WHEN** `ai-powered audio speak "Hello world" --output hello.mp3` is run
- **THEN** the system writes an MP3 file to `hello.mp3` and prints "Saved to hello.mp3" to stderr

---

### Requirement: --dry-run cost estimation
The system SHALL support `--dry-run` on all commands. When set, the CLI SHALL validate inputs,
resolve provider and model, estimate token count and projected cost, print a structured report,
and exit with code 0 without making any real API call. Combine with `--json` for machine-readable output.

#### Scenario: --dry-run with --mock
- **WHEN** `ai-powered text "Hello" --dry-run --mock` is run
- **THEN** the system prints an estimated cost report and exits with code 0, making no HTTP call

---

### Requirement: health-check command
The system SHALL implement `ai-powered health-check` that checks in order: (1) config valid,
(2) required API keys present and non-empty (masked), (3) lightweight connectivity probe for
each configured provider, (4) local model endpoint reachable if configured. Exit code SHALL be
0 only if all checks pass; 2 otherwise. `--json` SHALL produce `[{ check, status, message }]`.
Health-check SHALL NEVER make a billable generation call.

#### Scenario: health-check passes with valid config and keys
- **WHEN** `ai-powered health-check --mock` is run with a valid config and mock keys
- **THEN** all checks report pass and the command exits with code 0

#### Scenario: health-check fails with missing API key
- **WHEN** no API key is configured for the active provider
- **THEN** the key-check step reports fail and the command exits with code 2

