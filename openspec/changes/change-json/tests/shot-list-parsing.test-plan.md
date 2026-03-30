# Test Plan: shot-list-parsing

**File:** `tests/unit/shot-list-parsing.test.ts` (new unit test file)
**Functions under test:** `parseJsonFile(text)`, `parseMdFile(text)` (extracted from `app.js`
or tested via browser DOM harness / jsdom)
**Framework:** Vitest or Jest (match existing project convention)
**Mode:** Pure unit tests — no network calls, no server.

---

## Suite: `parseJsonFile` — JSON array formats

### T-SP-01: Flat JSON array
- **INPUT:** `'[{"name":"A","prompt":"Ocean","modality":"video"}]'`
- **THEN:** returns `[{ name: "A", prompt: "Ocean", modality: "video" }]`

### T-SP-02: `{shots:[…]}` envelope
- **INPUT:** `'{"shots":[{"prompt":"Forest","modality":"text"}]}'`
- **THEN:** returns `[{ name: "Shot 1", prompt: "Forest", modality: "text" }]`

### T-SP-03: `{items:[…]}` envelope
- **INPUT:** `'{"items":[{"name":"B","prompt":"Sky"}]}'`
- **THEN:** returns `[{ name: "B", prompt: "Sky", modality: "video" }]` (default modality)

### T-SP-04: Bare object (single shot)
- **INPUT:** `'{"name":"C","prompt":"Rain"}'`
- **THEN:** returns `[{ name: "C", prompt: "Rain", modality: "video" }]`

---

## Suite: `parseJsonFile` — JSONL / NDJSON fallback

### T-SP-05: NDJSON two-line input
- **INPUT:** `'{"prompt":"Sun"}\n{"name":"B","prompt":"Moon"}'`
- **THEN:** returns 2 items; both have `modality: "video"`

### T-SP-06: NDJSON skips blank lines
- **INPUT:** `'{"prompt":"A"}\n\n{"prompt":"B"}'`
- **THEN:** returns exactly 2 items (blank line ignored)

### T-SP-07: NDJSON with one malformed line
- **INPUT:** `'{"prompt":"A"}\nnot-json\n{"prompt":"B"}'`
- **THEN:** skips the malformed line; returns 2 valid items

---

## Suite: `parseJsonFile` — default field values

### T-SP-08: Missing `modality` defaults to `"video"`
- **INPUT:** `'[{"prompt":"Dunes"}]'`
- **THEN:** returned item has `modality: "video"`

### T-SP-09: Missing `name` gets auto-name
- **INPUT:** `'[{"prompt":"Wave"},{"prompt":"Cloud"}]'`
- **THEN:** items have `name: "Shot 1"` and `name: "Shot 2"` respectively

### T-SP-10: Present `name` preserved as-is
- **INPUT:** `'[{"name":"My Shot","prompt":"Stars"}]'`
- **THEN:** returned item has `name: "My Shot"` (not overwritten)

---

## Suite: `parseJsonFile` — empty / invalid inputs

### T-SP-11: Empty JSON array returns empty array
- **INPUT:** `'[]'`
- **THEN:** returns `[]`

### T-SP-12: Completely invalid text returns empty array
- **INPUT:** `'not json at all!!!'`
- **THEN:** returns `[]` (no throw)

### T-SP-13: Empty string returns empty array
- **INPUT:** `''`
- **THEN:** returns `[]`

---

## Suite: `parseMdFile` — Markdown shot-list parsing

### T-SP-14: Single heading + paragraph
- **INPUT:** `'## Shot Alpha\n\nA mountain lake at sunrise'`
- **THEN:** returns `[{ name: "Shot Alpha", prompt: "A mountain lake at sunrise", modality: "video" }]`

### T-SP-15: Multiple heading+paragraph blocks
- **INPUT:** 3 heading+paragraph pairs
- **THEN:** returns exactly 3 items in document order

### T-SP-16: Paragraph before any heading uses auto-name
- **INPUT:** `'A lone wolf howling\n\n## Scene 2\n\nCity skyline'`
- **THEN:** first item has `name: "Shot 1"`, second has `name: "Scene 2"`

### T-SP-17: All modalities default to `"video"`
- **INPUT:** any valid Markdown shot-list
- **THEN:** every returned item has `modality: "video"`

### T-SP-18: H1, H2, H3 headings all accepted as shot names
- **INPUT:** `'# Title\n\nPrompt one\n\n## Sub\n\nPrompt two\n\n### Deep\n\nPrompt three'`
- **THEN:** 3 items with names "Title", "Sub", "Deep"

### T-SP-19: Empty Markdown file returns empty array
- **INPUT:** `''`
- **THEN:** returns `[]`

### T-SP-20: Markdown with only headings (no paragraphs) returns items with empty prompts or skips
- **INPUT:** `'## Header Only'`
- **THEN:** returns 0 items (no prompt text present) OR 1 item with empty prompt
  (implementation MUST document which behaviour is chosen and be consistent)

