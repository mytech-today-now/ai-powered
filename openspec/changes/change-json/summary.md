# Summary: change-json

## One-liner

Add drag-and-drop batch file upload, live NDJSON streaming results, HTML/ZIP export, and
stdin/stdout CLI piping to the `ai-powered` web demo and batch CLI command.

## Problem

The `ai-powered` web demo supports single-shot generation only. Users producing video shot
lists, batch prompts, or A/B test suites must click through one shot at a time with no way
to see aggregate results or export them. The CLI batch command requires explicit file paths,
making it impossible to use in shell pipelines like `cat shots.jsonl | ai-powered batch video`.

## Solution

**Web demo (Video tab):**
A batch drop-zone above the existing single-video form accepts `.json`, `.jsonl`, and `.md`
files. Client-side parsers (`parseJsonFile`, `parseMdFile`) normalise any accepted format
into a `{ name, prompt, modality }[]` shot list. A pre-flight panel shows the parsed shots
before the user clicks **Run Batch**. During execution, `runBatch()` POSTs to the new
`POST /batch` proxy route and reads the NDJSON response stream, rendering a live shot card
for each result. A progress bar and counter update after each item.

After completion, two export options are available: **⬇ Download HTML** produces a
self-contained `batch-results.html` with base64-embedded video data URIs (works offline);
**⬇ Download ZIP** uses JSZip (CDN, SRI hash) to package all `.mp4` files plus a
`results.html` into `batch-videos.zip`.

**Proxy server (`POST /batch`):**
A new route validates the body with Zod, processes items sequentially, and streams one JSON
line per item. Per-item errors write an `"error"` line and continue; budget/exhaustion errors
end the stream early. Response `Content-Type: application/x-ndjson`.

**CLI (`ai-powered batch <mode>`):**
`--input -` reads JSONL from stdin. `--output -` writes NDJSON to stdout (progress moved to
stderr). A `writeLine()` helper serialises each result. This enables shell composition:
```bash
cat shots.jsonl | ai-powered batch video --input - --output - | jq .status
```

## Scope at a glance

| Category | Count | Details |
|---|---|---|
| Modified files | 7 | `index.html`, `app.js`, `styles.css`, `routes.ts`, `cli/index.ts`, `providers.test.ts`, `README.md` |
| New files | 0 | No new source files |
| New npm dependencies | 0 | JSZip via CDN only |
| New spec capabilities | 6 | `batch-drop-zone`, `shot-list-parsing`, `batch-runner`, `video-results-page`, `batch-api-route`, `cli-stdin-stdout` |
| New tests | 5 | `POST /batch` integration tests in `providers.test.ts` |
| Total tests passing | 126 | Zero regressions |

## Key constraints

- **Proxy mode required** for batch: direct mode blocks with a user-visible error
- **No ES modules in `app.js`**: existing IIFE structure preserved; no npm imports
- **Sequential processing**: one shot at a time on the server — avoids provider rate limits
- **Base64 HTML trade-off**: large video files produce large HTML exports (documented)
- **Mock-mode safe**: all integration tests run with `AI_MOCK=true`; no real credentials needed

## Implementation order

```
1. HTML markup (drop-zone, panels, buttons)
2. CSS classes (batch-drop-zone, shot-card, etc.)
3. Client-side parsers (parseJsonFile, parseMdFile)
4. Drop-zone event wiring + pre-flight panel
5. POST /batch server route (Zod schemas + NDJSON streaming)
6. runBatch() + renderShotCard() + progress bar
7. buildResultsHtml() + ZIP download handler
8. CLI --input -/--output - + writeLine()
9. Integration tests (5 POST /batch cases)
10. README ## File Input section
11. Build + lint + test + smoke test
```

## Related artifacts

- Source JIRA: `ai-prompts/json-support-JIRA.md` (AI-002)
- Batch drop-zone spec: `openspec/changes/change-json/specs/batch-drop-zone/spec.md`
- Batch API spec: `openspec/changes/change-json/specs/batch-api-route/spec.md`
- CLI spec: `openspec/changes/change-json/specs/cli-stdin-stdout/spec.md`
- Baseline batch spec: `openspec/changes/ai-powered/specs/batch-and-sessions/spec.md`
- Baseline proxy spec: `openspec/changes/ai-powered/specs/proxy-server/spec.md`

