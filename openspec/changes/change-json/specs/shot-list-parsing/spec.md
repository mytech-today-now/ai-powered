## ADDED Requirements

### Requirement: JSON and JSONL file parsing (`parseJsonFile`)
The system SHALL implement a `parseJsonFile(text)` function in `app.js` that converts the
text content of a `.json` or `.jsonl` file into an array of normalised shot items
`{ name: string, prompt: string, modality: string }`. The function SHALL support:

1. **JSON array** — each element is a shot item.
2. **`{shots:[…]}`** — the `shots` property is the item array.
3. **`{items:[…]}`** — the `items` property is the item array.
4. **Bare object** — wrap the single object in an array.
5. **NDJSON fallback** — if top-level `JSON.parse()` fails, split on newlines and parse each
   non-empty line as a JSON object.

Items missing `modality` SHALL default to `"video"`. Items missing `name` SHALL be assigned
an auto-generated name `"Shot N"` (where N is the 1-based index).

#### Scenario: JSON array input
- **WHEN** `parseJsonFile('[{"name":"A","prompt":"A sunset","modality":"video"}]')` is called
- **THEN** it returns `[{ name: "A", prompt: "A sunset", modality: "video" }]`

#### Scenario: `{shots:[…]}` envelope
- **WHEN** `parseJsonFile('{"shots":[{"prompt":"Ocean waves"}]}')` is called
- **THEN** it returns `[{ name: "Shot 1", prompt: "Ocean waves", modality: "video" }]`

#### Scenario: NDJSON fallback
- **WHEN** the input is two newline-separated JSON objects (not a valid top-level JSON array)
- **THEN** each line is parsed independently and both items are returned in the array

#### Scenario: Missing modality defaults to video
- **WHEN** an item in the parsed array has no `modality` field
- **THEN** the returned item has `modality: "video"`

---

### Requirement: Markdown shot-list parsing (`parseMdFile`)
The system SHALL implement a `parseMdFile(text)` function in `app.js` that converts a
Markdown file into an array of `{ name, prompt, modality }` shot items using the convention:

- ATX headings (`#`, `##`, `###`) become the `name` of the next shot.
- Non-empty paragraphs (text blocks between blank lines that are not headings) become the
  `prompt` of the current shot.
- Shots with no heading use the auto-name `"Shot N"`.
- `modality` defaults to `"video"` for all items parsed from Markdown.

#### Scenario: Headings become shot names
- **WHEN** a Markdown file contains `## Shot Alpha\n\nA mountain lake` 
- **THEN** `parseMdFile()` returns `[{ name: "Shot Alpha", prompt: "A mountain lake", modality: "video" }]`

#### Scenario: Paragraphs without heading use auto-name
- **WHEN** a Markdown file begins with a paragraph (no preceding heading)
- **THEN** the paragraph is assigned the name `"Shot 1"` and modality `"video"`

#### Scenario: Multiple shots parsed from single file
- **WHEN** a Markdown file contains 5 heading+paragraph blocks
- **THEN** `parseMdFile()` returns an array of exactly 5 shot items in document order

---

### Requirement: Empty and malformed file handling
If a file produces zero valid shot items after parsing, the system SHALL display a user-visible
error message in the drop-zone ("No valid shots found in file") and SHALL NOT show the
pre-flight panel or enable the **Run Batch** button.

#### Scenario: Empty JSON array
- **WHEN** `parseJsonFile('[]')` is called
- **THEN** it returns an empty array, and the UI shows the "No valid shots found" error

#### Scenario: Completely malformed file
- **WHEN** a file contains text that cannot be parsed as JSON or as a Markdown shot list
- **THEN** the UI shows the "No valid shots found" error and no pre-flight panel is rendered

