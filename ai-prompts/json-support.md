# Feature: File Upload, Batch Processing, and Shot-List Support for the ai-powered Web Demo

## Overview

Add drag-and-drop (and click-to-browse) file upload to every text-based prompt
textarea in `integrations/web-example/`. Depending on file type, the app either
populates the textarea (plain text) or runs a full batch of AI calls (JSON array,
JSONL, shot-list Markdown), one item at a time.

Before any batch is submitted, a **pre-flight cost estimate** for the entire file
must be shown and confirmed by the user. Cost tracking in the footer updates after
every individual call during batch execution.

All existing functionality — manual typing, session history, model selects,
proxy/direct modes, streaming — must continue to work unchanged.

---

## Context: Existing CLI Batch Support

The CLI already supports JSONL batch processing:

```bash
ai-powered batch text --input prompts.jsonl --output results.jsonl
ai-powered batch text --dry-run --input prompts.jsonl --output /dev/null
```

The `batch` command (`src/ai-powered/cli/index.ts`) reads JSONL line-by-line,
dispatches calls with `--concurrency` parallelism, and writes results to a JSONL
output file. The `--dry-run` flag estimates tokens and cost per row without making
API calls, using `estimateCost()` from `src/ai-powered/config.ts`.

This feature request extends equivalent capability to the **web demo UI** only.
No changes to the CLI, TypeScript library source (`src/`), or existing tests are
required. The proxy server needs one new route: `POST /batch`.

---

## Scope — Files to Modify

| File | Change |
|---|---|
| `integrations/web-example/index.html` | Drop-zone overlay markup + hidden `<input type="file">` per textarea |
| `integrations/web-example/app.js` | Drag-and-drop handlers, file parsers, shot-list parser, pre-flight estimate, batch runner |
| `integrations/web-example/styles.css` | Drop-zone visual states, pre-flight panel, batch progress bar |
| `src/ai-powered/server/routes.ts` | New `POST /batch` endpoint (sequential, returns NDJSON stream) |
| `README.md` | New `## File Input` section with format examples for all modalities |

Do **not** create new files beyond modifying the five listed above.

---

## Affected Tabs and Accepted File Types

| Tab | Textarea ID | Accepted file types |
|---|---|---|
| Text | `#text-prompt` | `.txt`, `.md`, `.json`, `.jsonl` |
| Image | `#image-prompt` | `.txt`, `.md`, `.json`, `.jsonl` |
| Video | `#video-prompt` | `.txt`, `.md` (shot-list), `.json`, `.jsonl` |
| Structured | `#structured-prompt` | `.txt`, `.md`, `.json`, `.jsonl` |
| Audio → TTS | `#tts-text` | `.txt`, `.md`, `.json`, `.jsonl` |

The **Audio → Transcription** sub-section already has its own binary file picker
(`#audio-file-input`). Do **not** add a text drop-zone there.

---

## File-Type Handling Rules

### 1 — Plain text (`.txt` and any unrecognised extension)
- Read as UTF-8 via `FileReader.readAsText()`.
- Set the target textarea `.value` to the file contents.
- Dispatch an `input` event on the textarea.
- Do **not** auto-submit. The user still clicks the action button.

### 2 — Markdown (`.md`)

#### 2a — Shot-list template detection (Video tab only)
A file is recognised as a shot-list if **all three** of these patterns exist in
the text:
- A line `## Summary` followed within 20 lines by a markdown table containing a
  `Total Shots` row.
- A line `## Shot List`.
- At least one line matching `### Shot ` (case-insensitive).

When the drop target is the **Video tab** and the file is recognised as a
shot-list, invoke the shot-list batch processor (see §Shot-List Processing).

When the drop target is **any other tab**, or the file is not a shot-list,
fall through to plain-text handling (rule 1).

#### 2b — Non-shot-list Markdown on Video tab
Place the file contents in `#video-prompt` as plain text. Do not auto-submit.

### 3 — JSON (`.json`)
- Read as UTF-8 and attempt `JSON.parse()`.
- **Object** (`{…}`): stringify into the textarea, do not auto-submit.
- **Array** (`[…]`): treat each element as an independent batch item.
  Each element must be a JSON object. Run the pre-flight estimate, then execute
  as a sequential batch (same rules as JSONL, §4 below).
- Parse failure: show an inline error, do not modify the textarea.

### 4 — JSON Lines (`.jsonl`)
- Read as UTF-8, split on `\n`.
- Skip blank lines and lines beginning with `//` or `#`.
- Parse each non-blank line as an independent JSON object.
- Parse failure on any line: display "Line N: Invalid JSON — \<message\>", abort
  remaining items (do not submit further lines).
- Run the **pre-flight cost estimate** (§Pre-flight Cost Estimate) before
  submitting any calls.
- Execute items **sequentially** (one call at a time) using the batch runner
  (§Batch Runner).

#### JSONL field schema per modality

| Modality | Required field | Optional overrides |
|---|---|---|
| text | `prompt` | `model`, `provider` |
| image | `prompt` | `model`, `provider` |
| video | `prompt` | `model`, `provider` |
| audio / TTS | `text` | `model`, `provider` |
| structured | `prompt` | `model`, `provider`, `schema` (inline JSON Schema string) |

---

## Shot-List Processing (`.md` → Video batch)

### Template structure
The shot-list template used by `ai-prompts/roofing-commercial-shot-list2.md` is
the canonical reference. Each shot section has this structure:

```markdown
### Shot N          ← heading (may also be "Shot Na", "Shot 2b", etc.)

**Scene:**

| Property       | Value        |
|----------------|--------------|
| Duration       | 0:12         |
| Shot Type      | establishing |
| Camera Movement| pan          |
| Framing        | wide         |
| Visual Style   | Reality      |

**Set:**
EXT. COMMERCIAL WAREHOUSE - STORMY NIGHT

**Description:**
<one or more lines of visual description>

**Characters:**
...
**Actions:**
...
**Dialogue:**
...
**Blocking:**
...
**SFX:**
...
**Technical Details:**
Shot Type: establishing. Camera Movement: pan. Framing: wide. Visual Style: Reality
```

### Extraction rules
For each `### Shot …` section:
1. Parse the `**Scene:**` property table to extract: `Duration`, `Shot Type`,
   `Camera Movement`, `Framing`, `Visual Style`.
2. Extract the `**Set:**` line (everything after the bold heading until the next
   `**` heading).
3. Extract all lines of `**Description:**` until the next `**` heading; trim
   leading/trailing whitespace and join with a space.
4. Ignore `**Characters:**`, `**Actions:**`, `**Blocking:**`, `**SFX:**`,
   `**Dialogue:**` for the video prompt (they are not needed by the video model).
   If `**Dialogue:**` contains non-"No dialogue" content, append it as a
   parenthetical: `(Dialogue: "<text>")`.

### Prompt construction
Build the video prompt for each shot as:

```
[{Shot Type} | {Camera Movement} | {Framing} | {Visual Style}]
Set: {Set line}
{Description text}
```

Example output for Shot 1 of the reference file:

```
[establishing | pan | wide | Reality]
Set: EXT. COMMERCIAL WAREHOUSE - STORMY NIGHT
A drone glides low over an expansive flat industrial roof. Storm water pools in
wide black sheets. A membrane seam has split — a dark wound running six feet
across the surface.
```

### Summary metadata
Read the `## Summary` table to extract `Total Shots` and `Total Duration`.
Display these in the pre-flight panel so the user knows the scope before
confirming.

---

## Pre-flight Cost Estimate

Before executing any batch (JSONL, JSON array, or shot-list), display a
confirmation panel in the output area with the following information:

```
📋 Batch ready: N items  ·  Est. total cost: $X.XXXXXX
   [Run Batch]   [Cancel]
```

### Estimation algorithm

1. Fetch `GET /pricing?modality=<current-tab-modality>` from the proxy. Cache
   the result for the session; re-fetch only when the provider or model selection
   changes.

2. For **text / structured** modalities:
   - Estimate prompt tokens per item: `Math.ceil(prompt.length / 4)` (standard
     4-chars-per-token approximation).
   - Estimate completion tokens per item: use the model's average from pricing,
     or default to 256 tokens.
   - `estimatedCostPerItem = (promptTokens * inputRatePerToken) + (completionTokens * outputRatePerToken)`
   - `totalEstimatedCost = sum over all items`

3. For **image** modality:
   - Use `perImageUsd` from the pricing table for the selected model.
   - `totalEstimatedCost = N * perImageUsd`

4. For **video** modality:
   - Use `perVideoUsd` (or `perVideoClipUsd`) from the pricing table.
   - `totalEstimatedCost = N * perVideoUsd`

5. For **audio / TTS** modality:
   - Use `perMinuteUsd` and estimate audio duration as
     `Math.ceil(text.length / 800)` minutes (≈ 150 words/min, ≈ 5 chars/word).
   - `totalEstimatedCost = sum of perMinuteUsd * estimatedMinutes per item`

6. If `/pricing` is unreachable or the model is not in the pricing table, display
   `Est. total cost: unknown` and still allow the user to proceed.

7. Mark all estimates with `(est.)` — they are never exact.

8. For shot-list files, also display: `Total Duration: M:SS  ·  N shots`.

---

## Batch Runner

After the user confirms the pre-flight panel:

1. Disable all action buttons on the active tab.
2. Show a **Cancel** button. Clicking it sets a cancellation flag; the runner
   checks this flag after each call and stops before the next item.
3. Clear the output box and display:
   `Processing item 1 / N…`
4. For each item (sequentially):
   a. Build the request body from the item's fields plus the current UI model/
      provider selection (item-level fields override UI selection for that call
      only).
   b. POST to the appropriate proxy endpoint (`/text`, `/image`, `/video`,
      `/audio/speak`, `/structured`).
   c. On success: append the result to the output box, call `addUsage(result.usage,
      result.cost)` to update the footer, advance the progress counter.
   d. On API error: append an error entry for that item (do not abort); continue
      to the next item.
   e. Check the cancellation flag; if set, stop and display "Batch cancelled after
      N / total items."
5. On completion: display "Batch complete: N succeeded, M failed."
6. Re-enable all action buttons.

---

## New Server Route: `POST /batch`

Add a `POST /batch` route to `src/ai-powered/server/routes.ts`.

### Request body (Zod-validated)
```ts
{
  modality: "text" | "image" | "video" | "audio/speak" | "structured",
  items: Array<{
    prompt?: string,   // required for text/image/video/structured
    text?: string,     // required for audio/speak
    model?: string,
    provider?: string,
    schema?: string,   // structured only: inline JSON Schema
  }>,
  model?: string,      // default model for all items (item-level overrides this)
  provider?: string,
}
```

### Response
Stream NDJSON (one JSON object per line, `Content-Type: application/x-ndjson`):
```jsonl
{"index":0,"ok":true,"result":{…}}
{"index":1,"ok":false,"error":"Rate limit exceeded"}
{"index":2,"ok":true,"result":{…}}
```

Each `result` object matches the response shape of the corresponding single-item
route (`/text`, `/image`, etc.) — including `usage` and `cost` fields.

Items are processed **sequentially** on the server (no concurrency for the web
demo; the CLI `batch` command already handles concurrent CLI use).

### Zod schema placement
Add the new `BatchBodySchema` alongside the existing `TextBodySchema`,
`ImageBodySchema`, etc. in `routes.ts`. Reuse `buildOverrides()` and `wrap()`
exactly as the existing routes do.

---

## Drop-Zone UX Requirements

1. **Overlay, not replacement**: Wrap each target textarea in
   `<div class="drop-zone">`. The textarea stays fully editable. The overlay
   appears only while a file is being dragged over the window.

2. **Window-level drag detection**: Listen on `window` for `dragenter` /
   `dragleave` / `dragover` / `drop`. Activate the overlay only for the
   currently visible tab panel.

3. **Visual states** (CSS class toggles on `.drop-zone`):
   - `.drop-zone--active` — file is over the window.
   - `.drop-zone--accepted` — recognised file dropped (flash ~600 ms, then remove).
   - `.drop-zone--rejected` — binary/unsupported file dropped (show message
     2 s, then remove).

4. **Click-to-browse**: The overlay contains a `<span>Drop a file here or click
   to browse</span>`. Clicking anywhere on the overlay triggers the hidden
   `<input type="file">` for that tab.

5. **Accepted MIME / extensions** (text-based tabs only):
   `text/plain`, `text/markdown`, `application/json`, `application/x-ndjson`,
   `.txt`, `.md`, `.json`, `.jsonl`
   Dropped binary files (images, audio, video, PDFs) must be rejected with a
   visible message.

6. **Keyboard accessibility**: `role="button"`, `tabindex="0"`, responds to
   `Enter` / `Space` to open the file picker.
   `aria-label="Drop a file or press Enter to browse"`.

---

## Error Handling

| Situation | Behaviour |
|---|---|
| File read error | "Could not read file: \<message\>" in the drop-zone; textarea unchanged |
| `.json` parse failure | "Invalid JSON: \<message\>" inline; textarea unchanged |
| `.jsonl` line parse failure | "Line N: Invalid JSON — \<message\>"; abort remaining items |
| Shot-list pattern not detected on Video tab | Fall back to plain-text populate; no auto-submit |
| API error during batch | Append error entry for that item; continue to next item |
| `/pricing` fetch failure | Show "Est. cost: unknown"; allow batch to proceed |

All error messages must be dismissible via a close ✕ button.

---

## README.md Additions

Add a new `## File Input` section. Do not remove or modify any existing content.
Include:

1. A one-paragraph description of what file input does.
2. JSONL format examples for all five modalities (see field schema table above).
3. A shot-list subsection explaining the `.md` template format, referencing
   `ai-prompts/roofing-commercial-shot-list2.md` as the canonical example.

**JSONL examples to include:**

```jsonl
# Text
{"prompt": "Explain quantum entanglement in two sentences."}
{"prompt": "Summarise the French Revolution.", "model": "gpt-4o"}

# Image
{"prompt": "A serene mountain lake at sunrise, photorealistic, 4k"}
{"prompt": "Abstract oil painting of a jazz musician", "model": "dall-e-3"}

# Video
{"prompt": "A time-lapse of clouds over mountain peaks at golden hour"}
{"prompt": "Ocean waves crashing on a rocky shore, slow motion"}

# Audio / TTS
{"text": "Hello, welcome to the ai-powered demo."}
{"text": "Text-to-speech example number two.", "model": "tts-1-hd"}

# Structured
{"prompt": "List 3 programming languages with name, yearCreated, and paradigm."}
{"prompt": "Describe the solar system as a JSON object.", "schema": "{\"type\":\"object\"}"}
```

---

## Implementation Constraints

- All file reading is **browser-only** (`FileReader` API). No additional server
  dependencies beyond the new `POST /batch` route.
- Vanilla JS only in `app.js` — no ES modules, no npm packages in the browser,
  preserve the existing IIFE structure.
- All new CSS goes in `styles.css`. No inline `<style>` blocks in `index.html`.
  Reuse existing CSS variables (`--accent`, `--border`, `--text-muted`, etc.).
- The `POST /batch` route in `routes.ts` must use the existing `wrap()`,
  `parseBody()`, `buildOverrides()`, and `getAiClient()` helpers. No new utility
  functions outside `routes.ts`.
- After all changes, run `npm test` and confirm all existing tests still pass.
  Add tests for `POST /batch` in `tests/integration/providers.test.ts` covering:
  at least one happy-path sequential batch and one batch where a single item
  fails without aborting the rest.
- Verify the complete flow end-to-end: drag `ai-prompts/roofing-commercial-shot-list2.md`
  onto the Video tab → pre-flight panel shows 8 shots + estimated cost → click
  "Run Batch" → 8 sequential video calls fire and update the footer after each.

