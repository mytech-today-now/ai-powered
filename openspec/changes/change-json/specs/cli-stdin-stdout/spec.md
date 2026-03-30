## MODIFIED Requirements

> **Scope note:** This spec extends `openspec/changes/ai-powered/specs/batch-and-sessions/spec.md`.
> All existing requirements in that spec remain unchanged. This document adds stdin/stdout
> support to the existing `ai-powered batch <mode>` command.

---

### Requirement: `--input -` reads batch items from stdin
The system SHALL treat `-` as a special value for the `--input` flag on the `batch` command.
When `--input -` is specified, the CLI SHALL read all of stdin as UTF-8 text and parse it as
NDJSON (one JSON object per line). Each parsed line SHALL be treated as a batch item with the
same shape as the JSONL file format. If stdin produces zero valid items, the CLI SHALL exit
with code 1 and print an error to stderr.

#### Scenario: stdin NDJSON parsed as batch items
- **WHEN** `echo '{"prompt":"A sunrise"}' | ai-powered batch video --input -` is run
- **THEN** the CLI reads the line from stdin, processes it as a single video batch item,
  and exits with code 0

#### Scenario: Empty stdin exits with error
- **WHEN** `ai-powered batch video --input -` is run with no stdin data (immediate EOF)
- **THEN** the CLI prints "No batch items read from stdin" to stderr and exits with code 1

#### Scenario: Multi-item stdin processed sequentially
- **WHEN** stdin contains 3 NDJSON lines
- **THEN** all 3 items are processed in order and results are written (to file or stdout)

---

### Requirement: `--output -` writes NDJSON results to stdout
The system SHALL treat `-` as a special value for the `--output` flag on the `batch` command.
When `--output -` is specified, the CLI SHALL write each result as a JSON line to stdout
using a `writeLine(obj)` helper that calls `process.stdout.write(JSON.stringify(obj) + '\n')`.
No result file is created on disk. The CLI SHALL exit with code 0 after all items are processed
(or the appropriate non-zero code on fatal error).

#### Scenario: Results written to stdout as NDJSON
- **WHEN** `ai-powered batch text --input items.jsonl --output -` is run
- **THEN** each result appears as one JSON line on stdout in the order items were processed

#### Scenario: stdout output is valid for piping to `jq`
- **WHEN** `cat shots.jsonl | ai-powered batch video --input - --output - | jq .status` is run
- **THEN** `jq` receives valid JSON input; the `status` field of each result is printed

---

### Requirement: Progress suppression when `--output -` is active
When `--output -` is set, the system SHALL suppress all non-result output from stdout.
Progress messages (spinner, per-item status lines, summary) SHALL be written to stderr only.
Stderr output SHALL remain enabled unless `--quiet` is also set.

#### Scenario: No progress text mixed into stdout
- **WHEN** `ai-powered batch video --input items.jsonl --output - 2>/dev/null` is run
- **THEN** every line on stdout is a valid JSON object; no human-readable progress text appears

#### Scenario: Progress visible on stderr independently
- **WHEN** `ai-powered batch video --input items.jsonl --output -` is run without stderr
  redirection
- **THEN** progress messages (e.g. "Processing 1/3…") appear on stderr, not stdout

---

### Requirement: `writeLine()` helper in CLI batch command
The system SHALL implement a `writeLine(obj: object): void` helper in `src/ai-powered/cli/index.ts`
that serialises `obj` to JSON and writes it followed by a newline to the active output stream
(stdout when `--output -`; appended to the output file otherwise).

#### Scenario: writeLine writes valid JSON line
- **WHEN** `writeLine({ index: 0, status: "ok" })` is called with stdout as the target
- **THEN** `process.stdout.write` is called with `'{"index":0,"status":"ok"}\n'`

