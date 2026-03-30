# Test Plan: cli-stdin-stdout

**File:** `tests/integration/cli-batch.test.ts` (new integration test file)
**Command under test:** `ai-powered batch <mode> --input - --output -`
**Framework:** Node.js `child_process.spawn` or Vitest (match existing project convention)
**Mode:** All tests use `AI_MOCK=true`; no real provider credentials required.

---

## Suite: `--input -` — reading from stdin

### T-CS-01: Single NDJSON line from stdin produces one result
- **GIVEN** `AI_MOCK=true`
- **WHEN** `echo '{"prompt":"A sunrise","modality":"text"}' | ai-powered batch text --input - --output results.jsonl`
  is executed
- **THEN** the process exits with code `0`
- **AND** `results.jsonl` contains exactly 1 JSON line with `status: "ok"`

### T-CS-02: Three NDJSON lines produce three results
- **GIVEN** a file `three.jsonl` with 3 prompt lines and `AI_MOCK=true`
- **WHEN** `cat three.jsonl | ai-powered batch text --input - --output results.jsonl`
- **THEN** exit code `0`; `results.jsonl` contains 3 lines

### T-CS-03: Empty stdin exits with code 1
- **GIVEN** `AI_MOCK=true`
- **WHEN** `ai-powered batch text --input -` with stdin closed immediately (empty pipe)
- **THEN** exit code is `1`
- **AND** stderr contains "No batch items read from stdin" (or equivalent message)

### T-CS-04: stdin with blank lines and one valid item
- **GIVEN** stdin content: `'\n\n{"prompt":"Stars"}\n'`
- **WHEN** `... | ai-powered batch text --input - --output -`
- **THEN** exit code `0`; stdout contains exactly 1 NDJSON line (blank lines skipped)

### T-CS-05: stdin NDJSON with modality defaulting to batch mode modality
- **GIVEN** stdin: `'{"prompt":"A forest"}'` (no modality field)
- **WHEN** `... | ai-powered batch video --input - --output -`
- **THEN** exit code `0`; stdout line has `modality: "video"` or result consistent with video mode

---

## Suite: `--output -` — writing to stdout

### T-CS-06: Results written as NDJSON to stdout
- **GIVEN** `AI_MOCK=true`, input file `two.jsonl` with 2 items
- **WHEN** `ai-powered batch text --input two.jsonl --output -`
- **THEN** exit code `0`; stdout contains 2 newline-delimited JSON lines
- **AND** each line is valid JSON parseable with `JSON.parse()`

### T-CS-07: stdout NDJSON is valid for `jq` consumption
- **GIVEN** `AI_MOCK=true`, one-item input
- **WHEN** `ai-powered batch text --input item.jsonl --output - | jq -e .status`
- **THEN** `jq` exit code is `0`; printed value is `"ok"` or `"error"`

### T-CS-08: No progress text appears on stdout
- **GIVEN** `AI_MOCK=true`, one-item input
- **WHEN** `ai-powered batch text --input item.jsonl --output -`
- **THEN** every line on stdout starts with `{` (is a JSON object); no human-readable text
  is present on stdout

---

## Suite: `--output -` — progress on stderr

### T-CS-09: Progress messages appear on stderr, not stdout
- **GIVEN** `AI_MOCK=true`, one-item input
- **WHEN** stdout and stderr are captured separately:
  `ai-powered batch text --input item.jsonl --output - 2>err.txt`
- **THEN** `err.txt` contains at least one non-JSON progress line (e.g. "Processing…")
- **AND** stdout contains only NDJSON lines

### T-CS-10: `--quiet` suppresses stderr progress
- **GIVEN** `AI_MOCK=true`, one-item input
- **WHEN** `ai-powered batch text --input item.jsonl --output - --quiet 2>err.txt`
- **THEN** `err.txt` is empty (or contains only error-level messages)
- **AND** stdout contains the NDJSON result line

---

## Suite: Combined `--input -` and `--output -`

### T-CS-11: Full pipe: stdin to stdout
- **GIVEN** `AI_MOCK=true`
- **WHEN** `echo '{"prompt":"Clouds"}' | ai-powered batch text --input - --output -`
- **THEN** exit code `0`; stdout contains exactly one JSON line with `status: "ok"`

### T-CS-12: Multi-item pipe round-trip
- **GIVEN** `AI_MOCK=true`
- **WHEN** `printf '{"prompt":"A"}\n{"prompt":"B"}\n' | ai-powered batch text --input - --output -`
- **THEN** exit code `0`; stdout contains exactly 2 JSON lines in the order they were processed

