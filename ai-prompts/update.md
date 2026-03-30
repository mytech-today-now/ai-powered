# Shot-List Parser: Metadata Filtering, Description Extraction, and Duration Support

## Context

The `ai-powered` Video tab batch flow parses `.md`, `.json`, and `.jsonl` shot-list files into
an array of shot items, which are then POSTed to `POST /batch` on the proxy server. Two
classes of bug exist in the current implementation, and a third capability (per-shot duration)
is missing entirely across all three surfaces: the web UI, the proxy server schema, and the CLI
batch command.

The reference shot-list file for all examples below is:
`ai-prompts/roofing-commercial-shot-list2.md`

---

## Bug 1 — Metadata Sections Treated as Shots

### Current Behavior

`parseMdFile()` in `integrations/web-example/app.js` treats **every** ATX heading
(`#`/`##`/`###`/`####`) as the start of a new shot. The shot-list Markdown format includes two
types of sections that are **not** video prompts:

1. **A summary/metrics header** — typically the first `##`-level section, named `Summary` (or
   similar), containing only a Markdown table of aggregate statistics:

   ```markdown
   ## Summary

   | Metric          | Value              |
   |-----------------|------------------  |
   | Total Shots     | 8                  |
   | Total Duration  | 1:17               |
   | Generated       | 3/24/2026, 8:55 PM |
   ```

2. **A container heading** — typically `## Shot List`, which is a section wrapper with no body
   content of its own; the actual shots live under `###`-level child headings beneath it.

Both of these are being emitted as shot items and sent to the AI video provider, causing an
unwanted generation attempt for the metrics table.

### Required Fix — `parseMdFile()` in `integrations/web-example/app.js`

Apply **both** of the following detection rules. A section is classified as metadata (and
silently skipped) if **either** condition is true:

**Rule A — Known metadata heading names (case-insensitive):**
Skip sections whose heading text, after stripping bracketed tags like `[video]`, matches any of:
`summary`, `shot list`, `overview`, `metadata`, `details`, `characters`, `locations`, `notes`.

**Rule B — Table-only body with no descriptive prose:**
After collecting all body lines for a section, skip it if the body contains **zero** lines of
prose — i.e., every non-blank body line either starts with `|` (Markdown table row) or is a
table separator (`---`). A section with at least one prose line that does not start with `|`
is always kept.

These two rules are independent; either one is sufficient to skip a section. If both rules
pass (i.e., neither applies), the section is a valid shot.

---

## Bug 2 — Property Tables Leaked Into Prompt Text

### Current Behavior

Each shot section contains a property table immediately under `**Scene:**`:

```markdown
### Shot 1

**Scene:**

| Property        | Value       |
|-----------------|-------------|
| Duration        | 0:12        |
| Shot Type       | establishing|
| Camera Movement | pan         |
| Framing         | wide        |
| Visual Style    | Reality     |
| C:              | 806 / 4000  |

**Set:**
EXT. COMMERCIAL WAREHOUSE - STORMY NIGHT

**Description:**
A drone glides low over an expansive flat industrial roof. Storm water pools in wide black
sheets. A membrane seam has split — a dark wound running six feet across the surface.
```

The current parser collects all non-heading, non-separator, non-bold-key lines as the prompt.
This means the `| Property | Value |` table rows (excluding `| Duration | ... |`, which has a
separate fix) still end up in the prompt string sent to the video provider.

### Required Fix — `parseMdFile()` in `integrations/web-example/app.js`

Collect prompt text **only** from the body of the `**Description:**` bold-key section. The
extraction rules are:

1. Scan body lines for a line that matches `/^\*\*Description:\*\*/i` (the bold key marker).
2. Begin collecting prose lines immediately after that marker line.
3. Stop collecting when the next bold-key marker is encountered — any line matching
   `/^\*\*[^*]+\*\*:/` (e.g., `**Characters:**`, `**Set:**`, `**Actions:**`, `**Dialogue:**`,
   etc.) — or when the section ends.
4. Join the collected prose lines with a single space; collapse runs of whitespace; trim.
5. If the `**Description:**` section is absent or produces an empty string after trimming,
   skip the shot (do not emit it).

All other bold-key sections (`**Scene:**`, `**Set:**`, `**SFX:**`, `**Technical Details:**`,
`**Blocking:**`, `**Actions:**`, `**Dialogue:**`, `**Characters:**`, `**ANNC:**`) are parsed
for metadata extraction only (see Bug 3 / Duration below) and are **not** included in the
prompt string.

---

## Feature — Per-Shot Duration Support

### Overview

Every shot in a shot-list carries a `Duration` value that controls how long the generated
video clip should be. This value must be extracted at parse time, propagated through the batch
payload, validated by the server schema, and forwarded by the CLI.

**Default duration:** `12` seconds. Apply this default any time a shot's duration cannot be
determined from the source file.

### 3a — Duration Extraction in `parseMdFile()` (`integrations/web-example/app.js`)

The `| Duration | 0:12 |` row lives inside the property table under `**Scene:**`. Its format
is `M:SS` (minutes colon zero-padded seconds), for example:

| Raw value | Conversion          | Seconds |
|-----------|---------------------|---------|
| `0:05`    | 0×60 + 5            | 5       |
| `0:12`    | 0×60 + 12           | 12      |
| `1:09`    | 1×60 + 9            | 69      |

Parse the `Duration` cell with:
```js
const [m, s] = cell.split(":").map(Number);
const seconds = m * 60 + s;
```
If the result is `NaN`, `0`, or negative, fall back to the default of `12`.

Add the extracted value as a `duration` (integer, seconds) field on the shot item object.

### 3b — Duration Extraction in `parseJsonFile()` (`integrations/web-example/app.js`)

JSON and JSONL shot objects store duration in **seconds** (numeric). Read it as:

```js
const duration = Number(entry.duration ?? entry.Duration ?? 12);
```

Apply the same validity check: if the result is `NaN`, `≤ 0`, or non-finite, fall back to
`12`. Add the value as a `duration` field on the item object.

### 3c — Preflight Summary (`showBatchPreflight()` in `integrations/web-example/app.js`)

After parsing, compute the total duration of the batch as the sum of all shot `duration`
values. Format it as `M:SS` and display it in the `batchSummary` text alongside the shot
count:

> `9 shots loaded · Total duration: 1:17`

The existing text is currently: `"N shots loaded and ready to process."` — replace it with the
more informative form above. Continue to enable `btnBatchRun` on a non-empty valid list.

### 3d — Batch Payload (`runBatch()` in `integrations/web-example/app.js`)

Include `duration` in each item sent to `POST /batch`:

```js
items: batchItems.map((item) => ({
  modality: item.modality || "video",
  name:     item.name,
  prompt:   item.prompt,
  duration: item.duration ?? 12,          // ← add this field
  ...(provider ? { provider } : {}),
  ...(model    ? { model }    : {}),
}))
```

### 3e — Server Schema (`BatchItemSchema` in `src/ai-powered/server/routes.ts`)

Add `duration` as an optional positive integer field, defaulting to `12`:

```ts
duration: z.number().int().positive().optional().default(12),
```

Insert this field in `BatchItemSchema` alongside the existing `name` field. No changes to
`BatchBodySchema` are required.

### 3f — CLI Batch Command (`src/ai-powered/cli/index.ts`)

In the `processRow()` function inside the `batch` command action, the `row` object already
carries any fields from the input JSONL line. Extract and forward `duration` when calling
`generateVideo`:

```ts
const duration = typeof row["duration"] === "number" && row["duration"] > 0
  ? row["duration"]
  : 12;

// existing call:
const r = await client.generateVideo(prompt);
// replace with:
const r = await client.generateVideo(prompt, { duration });
```

If `generateVideo`'s second argument is not yet defined or the provider ignores it, pass the
object anyway — the provider implementation can accept and log it without breaking. The goal
is that the field travels through the full pipeline so providers can use it when their API
supports a clip-length parameter.

---

## Acceptance Criteria

1. Dropping `ai-prompts/roofing-commercial-shot-list2.md` onto the Video tab produces **8
   shots** (not 9 or 10): `Shot 1`, `Shot 2a`, `Shot 2b`, `Shot 4`, `Shot 5`, `Shot 6a`,
   `Shot 6b`, `Shot 8`. The `Summary` and `Shot List` sections are silently excluded.

2. The prompt text for each shot is **only** the content of the `**Description:**` block —
   property table rows do not appear in the prompt sent to the provider.

3. The preflight summary line reads: `8 shots loaded · Total duration: 1:17`
   (sum of 12+6+9+12+12+9+12+5 = 77 seconds = 1:17).

4. Each shot item in the `POST /batch` payload includes a `duration` field (integer, seconds).
   `Shot 8` has `duration: 5`; `Shot 1` has `duration: 12`.

5. A JSON/JSONL shot object with `"duration": 30` results in a parsed item with
   `duration: 30`. One with no `duration` field results in `duration: 12`.

6. The `BatchItemSchema` in `routes.ts` accepts and defaults `duration` to `12`.

7. The CLI `batch video` command reads `duration` from each JSONL row and passes it to
   `generateVideo()`.

8. `npm run build` and `npm test` complete with zero errors after all changes.
