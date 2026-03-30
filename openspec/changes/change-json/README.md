# Change: change-json

**JIRA:** AI-002 (Story)
**Type:** Implementation
**Priority:** High
**Status:** Complete — all tasks done, all 126 tests passing

## Summary

Extends the `ai-powered` web demo with drag-and-drop batch file upload on the Video tab.
Dropped `.json`, `.jsonl`, or `.md` (shot-list) files are parsed client-side and displayed
in a pre-flight panel before execution. During the batch run, the proxy streams one NDJSON
line per shot and the UI renders live shot cards. After completion, users can download a
self-contained HTML results page or a JSZip-packaged ZIP of all video files.

The CLI `ai-powered batch <mode>` command also gains stdin (`--input -`) and stdout
(`--output -`) support, enabling shell piping and composable workflows.

## Artifacts

| Artifact | Description |
|---|---|
| [`proposal.md`](proposal.md) | Why this change is needed and what it modifies |
| [`design.md`](design.md) | Technical decisions, risks, migration plan, open questions |
| [`specs/batch-drop-zone/spec.md`](specs/batch-drop-zone/spec.md) | Drop-zone UI and pre-flight panel requirements |
| [`specs/shot-list-parsing/spec.md`](specs/shot-list-parsing/spec.md) | `parseJsonFile` and `parseMdFile` requirements |
| [`specs/batch-runner/spec.md`](specs/batch-runner/spec.md) | `runBatch` and `renderShotCard` requirements |
| [`specs/video-results-page/spec.md`](specs/video-results-page/spec.md) | HTML and ZIP download requirements |
| [`specs/batch-api-route/spec.md`](specs/batch-api-route/spec.md) | `POST /batch` server route requirements |
| [`specs/cli-stdin-stdout/spec.md`](specs/cli-stdin-stdout/spec.md) | `--input -` / `--output -` CLI requirements |
| [`tasks.md`](tasks.md) | Implementation checklist (all complete) |
| [`tests/batch-api-route.test-plan.md`](tests/batch-api-route.test-plan.md) | Test plan for `POST /batch` integration tests |
| [`tests/shot-list-parsing.test-plan.md`](tests/shot-list-parsing.test-plan.md) | Test plan for parser unit tests |
| [`tests/cli-stdin-stdout.test-plan.md`](tests/cli-stdin-stdout.test-plan.md) | Test plan for CLI stdin/stdout integration tests |
| [`summary.md`](summary.md) | One-page human-readable summary |

## Scope

### Files modified (no new source files)
- `integrations/web-example/index.html` — drop-zone, pre-flight, progress, results, JSZip CDN tag
- `integrations/web-example/app.js` — parsers, batch runner, results builder, download handlers
- `integrations/web-example/styles.css` — new batch UI classes
- `src/ai-powered/server/routes.ts` — `POST /batch` route with Zod validation + NDJSON streaming
- `src/ai-powered/cli/index.ts` — `--input -` stdin, `--output -` stdout, `writeLine()` helper
- `tests/integration/providers.test.ts` — 5 new `POST /batch` integration tests
- `README.md` — `## File Input` section

### No new npm dependencies
JSZip is loaded via cdnjs CDN with SRI integrity hash.

## Pre-conditions

- Proxy mode must be running (`npm run serve`) for batch execution from the web demo.
- `AI_MOCK=true` is sufficient for all integration tests — no real API credentials needed.

## Acceptance Criteria

- [x] Batch drop-zone on Video tab accepts `.json`, `.jsonl`, `.md`
- [x] Pre-flight panel shows parsed shot list before running
- [x] Batch runner streams NDJSON, populates shot cards live
- [x] Shot cards show `<video>` play button, individual download link for successful video shots
- [x] **⬇ Download HTML** produces self-contained `batch-results.html` with base64 video data URIs
- [x] **⬇ Download ZIP** packages all `.mp4` files + `results.html` via JSZip
- [x] `POST /batch` returns `application/x-ndjson` with per-item `status: "ok" | "error"`
- [x] Per-item errors write an error line and continue — stream is not aborted
- [x] `BudgetExceededError` and `AllProvidersExhaustedError` end the stream early
- [x] CLI `--input -` reads JSONL from stdin
- [x] CLI `--output -` writes NDJSON to stdout; progress suppressed on stdout
- [x] `npm run build` passes with zero TypeScript errors
- [x] All 126 tests pass — 5 new `POST /batch` integration tests included
- [x] `README.md` `## File Input` section committed
- [ ] End-to-end manual verification: drag `ai-prompts/roofing-commercial-shot-list2.md`
      onto Video tab → pre-flight shows shots → Run Batch → shot cards populate → Download ZIP works

