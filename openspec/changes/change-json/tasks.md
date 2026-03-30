# Tasks: change-json

> **JIRA:** AI-002 (Story: Add Batch Processing, Video Results Page, stdin/stdout CLI Support,
> and Shot-List Support)
> **Status:** All tasks below are COMPLETE as of 2026-03-30.

## 1 — Web Demo HTML (`integrations/web-example/index.html`)

- [x] Add JSZip CDN `<script>` tag with SRI `integrity` hash and `crossorigin="anonymous"`
- [x] Add batch drop-zone markup: container div, drag-target area, hidden `<input type="file">`
      with `accept=".json,.jsonl,.md"`, and instructional label text
- [x] Add pre-flight panel: shot-list `<ul>`, **Run Batch** button, **✕ Clear** button
- [x] Add progress bar: `<progress>` element and "N / total" counter label
- [x] Add results panel: container for dynamically appended shot cards
- [x] Add **⬇ Download HTML** and **⬇ Download ZIP** download buttons (hidden until batch complete)
- [x] Add `<hr>` divider between the batch section and the existing single-video form

## 2 — Web Demo Styles (`integrations/web-example/styles.css`)

- [x] Add `.batch-drop-zone` — border-dashed, hover/drag-over states; uses `--border` and `--surface`
- [x] Add `.drag-over` modifier — highlighted border colour using `--primary`
- [x] Add `.batch-preflight` — shot-list preview panel layout
- [x] Add `.batch-progress` — progress bar and counter row
- [x] Add `.batch-results` — results panel container
- [x] Add `.shot-card` — individual result card with name, badge, prompt, video, download link
- [x] Add status badge utility classes: `.badge-ok` (green) and `.badge-error` (red/danger)
- [x] All new classes use existing CSS variables (`--primary`, `--border`, `--surface`,
      `--muted`, `--text`, `--danger`, `--radius`)

## 3 — Web Demo Logic (`integrations/web-example/app.js`)

- [x] Implement `parseJsonFile(text)`: JSON array, `{shots}`, `{items}`, bare object,
      NDJSON line-by-line fallback; auto-name missing names; default modality to `"video"`
- [x] Implement `parseMdFile(text)`: ATX heading → name, paragraph → prompt, default modality `"video"`
- [x] Implement `loadBatchFile(file)`: read via `FileReader`, dispatch to parser by extension,
      call `showBatchPreflight()` or show "No valid shots" error
- [x] Wire drop-zone `dragover`, `dragleave`, `drop` event listeners
- [x] Wire `<input type="file">` `change` event listener
- [x] Implement `showBatchPreflight(shots)`: render shot-list rows, show panel, enable **Run Batch**
- [x] Implement `clearBatch()`: hide pre-flight, reset drop-zone, clear results panel
- [x] Implement `runBatch()`: validate proxy mode, POST to `/batch`, read NDJSON stream,
      call `renderShotCard()` per line, update progress bar and counter, set completion label
- [x] Implement `renderShotCard(result)`: build DOM element with name, badge, prompt, `<video>`
      (for ok video results), individual download link, and error text (for error results)
- [x] Implement `escHtml(str)`: HTML-escape helper used in `buildResultsHtml`
- [x] Implement `buildResultsHtml(items)`: produce self-contained HTML string with base64 URIs
- [x] Implement ZIP download handler: iterate results, add `.mp4` files to JSZip, trigger download
- [x] Implement HTML download handler: call `buildResultsHtml`, trigger `batch-results.html` download
- [x] Preserve existing IIFE structure; no ES module syntax; no npm imports

## 4 — Server Route (`src/ai-powered/server/routes.ts`)

- [x] Define `BatchItemSchema` (Zod): `modality` (enum, default `"video"`), `name` (optional),
      `prompt` (required), `model`, `provider`, `template`, `vars` (all optional)
- [x] Define `BatchBodySchema` (Zod): `items` (non-empty array of `BatchItemSchema`),
      `model` and `provider` as optional body-level defaults
- [x] Register `POST /batch` route:
      - Validate body with `BatchBodySchema`; return `400` on failure
      - Set `Content-Type: application/x-ndjson`
      - Loop items sequentially; call the appropriate `AiClient` method per modality
      - Write result line immediately on item completion
      - On per-item error: write `"error"` line, continue to next item
      - On `BudgetExceededError` or `AllProvidersExhaustedError`: write error line, close stream
- [x] Add `POST /batch` to the JSDoc route-list comment at the top of `routes.ts`

## 5 — CLI (`src/ai-powered/cli/index.ts`)

- [x] Add `writeLine(obj: object, stream: NodeJS.WritableStream): void` helper
- [x] Update `--input` handling: detect `"-"`, read all of `process.stdin` as UTF-8,
      parse NDJSON lines, exit with code 1 if zero items found
- [x] Update `--output` handling: detect `"-"`, write each result via `writeLine` to stdout,
      skip file creation
- [x] Suppress spinner and per-item progress messages on stdout when `--output -` is active;
      route them to stderr instead

## 6 — Integration Tests (`tests/integration/providers.test.ts`)

- [x] Test: `POST /batch` with missing `prompt` field → `400` with Zod error
- [x] Test: `POST /batch` with `items: []` → `400`
- [x] Test: `POST /batch` with 2 text items in mock mode → `200`, 2 NDJSON lines, both `status:"ok"`
- [x] Test: `POST /batch` with 1 video item in mock mode → `200`, 1 NDJSON line, `status:"ok"`,
      `result.data` starts with `"data:video/"`
- [x] Test: `POST /batch` where first item succeeds, second item fails (mock throws) →
      `200`, 2 lines: first `status:"ok"`, second `status:"error"`

## 7 — Documentation (`README.md`)

- [x] Add `## File Input` section documenting accepted file formats with JSONL examples
- [x] Add shot-list Markdown subsection with example headings/paragraph structure
- [x] Add CLI stdin/stdout examples:
      `cat prompts.jsonl | ai-powered batch text --input - --output -`
      `cat shots.jsonl | ai-powered batch video --input - --output - | jq .`

## 8 — Build and Verification

- [x] `npm run build` — zero TypeScript errors in Node build
- [x] `npm run build:web` — zero errors in browser bundle; no Node built-ins leaked
- [x] `npm test` — all 126 tests pass (5 new `POST /batch` integration tests included)
- [x] `npm run lint` — zero lint errors
- [x] Manual end-to-end: drag `ai-prompts/roofing-commercial-shot-list2.md` onto Video tab →
      pre-flight shows shots → Run Batch → shot cards populate live → Download ZIP works

