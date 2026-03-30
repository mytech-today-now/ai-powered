# Test Plan: batch-api-route

**File:** `tests/integration/providers.test.ts`
**Framework:** Node.js test runner (or Vitest/Jest — match existing project convention)
**Mode:** All tests run with `AI_MOCK=true`; no real provider credentials required.

---

## Suite: `POST /batch` — validation

### T-BA-01: Missing `prompt` returns 400
- **GIVEN** the proxy server is running in mock mode
- **WHEN** `POST /batch` is called with `{ items: [{ modality: "video" }] }` (no `prompt`)
- **THEN** status is `400`
- **AND** the response body contains a Zod validation error referencing `items[0].prompt`

### T-BA-02: Empty items array returns 400
- **GIVEN** the proxy server is running in mock mode
- **WHEN** `POST /batch` is called with `{ items: [] }`
- **THEN** status is `400`

### T-BA-03: Unknown modality value returns 400
- **GIVEN** the proxy server is running in mock mode
- **WHEN** `POST /batch` is called with `{ items: [{ prompt: "x", modality: "hologram" }] }`
- **THEN** status is `400`
- **AND** the response body references the invalid enum value

### T-BA-04: Missing `items` field returns 400
- **GIVEN** the proxy server is running in mock mode
- **WHEN** `POST /batch` is called with `{}` (no `items` key)
- **THEN** status is `400`

---

## Suite: `POST /batch` — happy path

### T-BA-05: Text batch — two items, both succeed
- **GIVEN** mock mode active
- **WHEN** `POST /batch` with `{ items: [{ prompt: "Hello", modality: "text" }, { prompt: "World", modality: "text" }] }`
- **THEN** status is `200`, `Content-Type` includes `application/x-ndjson`
- **AND** response body contains exactly 2 newline-separated JSON lines
- **AND** both lines have `status: "ok"` and a non-empty `result` object

### T-BA-06: Video batch — one item
- **GIVEN** mock mode active
- **WHEN** `POST /batch` with `{ items: [{ prompt: "A sunset", modality: "video" }] }`
- **THEN** status is `200`
- **AND** the single NDJSON line has `status: "ok"` and `result.data` starting with `"data:video/"`

### T-BA-07: Default modality is video
- **GIVEN** mock mode active
- **WHEN** `POST /batch` with `{ items: [{ prompt: "A landscape" }] }` (no modality)
- **THEN** Zod defaults `modality` to `"video"`; response line has `modality: "video"`

### T-BA-08: Body-level `model` default applied to items
- **GIVEN** mock mode active
- **WHEN** `POST /batch` with `{ model: "gpt-4o", items: [{ prompt: "Hi", modality: "text" }] }`
- **THEN** the result line's `result.model` reflects the body-level model (or mock equivalent)

---

## Suite: `POST /batch` — error handling

### T-BA-09: Per-item error does not abort stream
- **GIVEN** mock mode where item 2 is configured to throw a non-fatal error
- **WHEN** `POST /batch` with 3 items is called
- **THEN** the stream produces 3 NDJSON lines
- **AND** line 1 and line 3 have `status: "ok"`, line 2 has `status: "error"`
- **AND** overall HTTP status remains `200` (the stream was established)

### T-BA-10: `index` field in each NDJSON line is correct
- **GIVEN** mock mode active
- **WHEN** `POST /batch` with 3 items is called
- **THEN** the three lines have `index: 0`, `index: 1`, `index: 2` respectively

### T-BA-11: `name` field defaults to `"Shot N"` when omitted
- **GIVEN** mock mode active
- **WHEN** `POST /batch` with an item that has no `name` field
- **THEN** the result line contains `name: "Shot 1"` (1-based auto-name)

