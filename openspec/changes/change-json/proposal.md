## Why

The `ai-powered` web demo and CLI already support single-shot text, image, audio, and video
generation. Users working on content-heavy workflows — such as producing commercial video
shot lists, batch-transcribing a folder of audio files, or running A/B tests across a list
of prompts — must currently issue one manual request at a time. There is no mechanism to
submit multiple shots in a single operation, observe per-shot progress, or export results.

On the CLI side, the `ai-powered batch <mode>` command requires file paths for `--input` and
`--output`, which prevents it from participating in shell pipelines. Adding `-` as a special
value for both flags aligns the CLI with the UNIX convention and enables composable workflows.

This change adds drag-and-drop batch file support to the web demo's Video tab, a streaming
NDJSON server route for batch execution, a live results panel with HTML and ZIP export, and
stdin/stdout piping for the CLI batch command — without breaking any existing behaviour.

## What Changes

- **Add** a batch drop-zone to `integrations/web-example/index.html` above the single-video
  form, accepting `.json`, `.jsonl`, and `.md` (shot-list) files.
- **Add** `parseJsonFile()` and `parseMdFile()` to `integrations/web-example/app.js` for
  converting uploaded files into arrays of `{ name, prompt, modality }` shot items.
- **Add** `showBatchPreflight()`, `runBatch()`, `renderShotCard()`, and `buildResultsHtml()`
  to `app.js` to drive the pre-flight panel, NDJSON streaming, live shot cards, and HTML export.
- **Add** JSZip via CDN to `index.html` and a ZIP download handler to `app.js`.
- **Add** `.batch-drop-zone`, `.batch-preflight`, `.batch-progress`, `.batch-results`, and
  `.shot-card` CSS classes to `integrations/web-example/styles.css`.
- **Add** `BatchItemSchema`, `BatchBodySchema`, and `POST /batch` streaming route to
  `src/ai-powered/server/routes.ts`.
- **Update** `src/ai-powered/cli/index.ts` batch command: `--input -` reads from stdin;
  `--output -` writes to stdout; add `writeLine()` helper.
- **Add** 5 `POST /batch` integration tests to `tests/integration/providers.test.ts`.
- **Update** `README.md` with a `## File Input` section documenting JSONL format and shot-list.

## Capabilities

### New Capabilities

- **`batch-drop-zone`**: Drag-and-drop and click-to-browse file upload on the Video tab that
  accepts `.json`, `.jsonl`, and `.md` files, shows a pre-flight shot-list preview panel, and
  provides a **Run Batch** button and a **✕ Clear** reset button.
- **`shot-list-parsing`**: Client-side parsers (`parseJsonFile`, `parseMdFile`) that normalise
  any accepted file format into an array of `{ name, prompt, modality }` shot items. Supports
  JSON arrays, `{shots:[…]}`, `{items:[…]}`, bare objects, NDJSON line-by-line fallback, and
  Markdown headings-as-names / paragraphs-as-prompts.
- **`batch-runner`**: `runBatch()` function that POSTs to `POST /batch`, reads the NDJSON
  response stream, renders a live shot card for each result, and updates a progress bar and
  counter. Batch requires proxy mode; direct mode is blocked with a user-visible error.
- **`video-results-page`**: After batch completion, **⬇ Download HTML** generates a
  self-contained `batch-results.html` with base64-embedded video data URIs. **⬇ Download ZIP**
  uses JSZip to package all `.mp4` files plus a `results.html` into `batch-videos.zip`.
- **`batch-api-route`**: `POST /batch` on the proxy server accepts a Zod-validated body
  `{ items: BatchItem[], model?, provider? }`, processes items sequentially, and streams one
  NDJSON object per item with `{ index, name, modality, prompt, status, result|error }`.
  Per-item errors write an `"error"` line and continue; budget/exhaustion errors end the stream.
- **`cli-stdin-stdout`**: `ai-powered batch <mode> --input - --output -` reads JSONL from
  stdin and writes NDJSON to stdout. Progress messages are suppressed on stderr when
  `--output -` is active to keep stdout clean for downstream consumers.

### Modified Capabilities

- **`batch-and-sessions`** (`specs/batch-and-sessions/spec.md`): Existing batch file-path
  behaviour is unchanged; this change adds stdin/stdout as an additional input/output channel.
- **`proxy-server`** (`specs/proxy-server/spec.md`): `POST /batch` is added to the route list;
  all other routes and behaviours are unchanged.
- **`web-module`** (`specs/web-module/spec.md`): The web demo gains batch drop-zone UI; the
  `createWebClient()` API and browser bundle are unaffected.

## Impact

- **Modified files** (no new source files): `integrations/web-example/index.html`,
  `integrations/web-example/app.js`, `integrations/web-example/styles.css`,
  `src/ai-powered/server/routes.ts`, `src/ai-powered/cli/index.ts`,
  `tests/integration/providers.test.ts`, `README.md`.
- **New npm dependency**: None. JSZip is loaded via CDN (cdnjs, SRI integrity hash); no npm install.
- **No breaking changes**: All existing routes, CLI commands, manual single-video form,
  streaming, sessions, and model selects continue to work without modification.
- **CI**: `AI_MOCK=true` covers all 5 new integration tests; no real credentials needed.
  `npm run build` passes with zero TypeScript errors; all 126 tests pass.

