## Context

The `ai-powered` web demo (`integrations/web-example/`) already has a Video tab that supports
single-shot generation via the proxy. The CLI already has a `batch` command that reads from
a file path and writes to a file path. Neither supports multi-shot workflows initiated from
the browser or shell-pipeline composition via stdin/stdout.

The `more-video-providers` change proved that NDJSON streaming from a proxy route is a viable
transport for real-time progress. This change applies the same pattern at the batch level:
the browser POSTs a list of shots and reads the response as a streaming NDJSON body, rendering
each result card as it arrives — giving users live feedback on long-running batches.

## Goals / Non-Goals

**Goals:**
- Drop-zone accepting `.json`, `.jsonl`, and `.md` files on the Video tab only
- Normalised `{ name, prompt, modality }` item shape regardless of input format
- Pre-flight panel showing the parsed shot list before execution
- Live NDJSON streaming to shot cards with a per-item progress bar
- Self-contained downloadable HTML results page (base64-embedded video data URIs)
- JSZip-based ZIP download of all video files + results.html
- `POST /batch` sequential NDJSON-streaming route with Zod validation
- Per-item error isolation: one failed shot does not abort the stream
- `--input -` / `--output -` for CLI stdin/stdout piping
- Zero breaking changes to all existing functionality

**Non-Goals:**
- Parallel batch execution (sequential only in v1)
- Batch support on tabs other than Video (text/image batch not wired to the drop-zone)
- Server-side file upload (all file reading is done client-side via FileReader API)
- Authentication on `POST /batch` (inherits the same trust model as other proxy routes)
- Batch resume / retry of failed items from the UI

## Decisions

### D1 — Client-side file reading via FileReader API
**Decision:** All file parsing happens in the browser using the `FileReader` API; the parsed
shot list is sent to the server as a plain JSON body.
**Rationale:** No new server dependencies; works with the existing Express proxy. File content
is never stored server-side, avoiding multipart upload complexity and temp-file cleanup.

### D2 — Single `parseJsonFile()` handles JSON, JSONL, and fallback
**Decision:** One parser handles `.json` and `.jsonl`. It first attempts `JSON.parse()`; if
that fails, it falls back to line-by-line NDJSON parsing. Shape normalisation (array, `{shots}`,
`{items}`, bare object) is applied after parsing.
**Rationale:** Users save JSONL files with either extension. A single parser with a fallback
path is simpler and more resilient than two separate parsers with explicit extension switching.

### D3 — Sequential server-side processing; NDJSON stream per item
**Decision:** `POST /batch` processes items one at a time, writing one JSON line per item as
soon as it completes. `BudgetExceededError` and `AllProvidersExhaustedError` terminate the
stream early; all other per-item errors write an `"error"` line and continue.
**Rationale:** Sequential processing avoids rate-limit exhaustion on provider APIs. The
NDJSON transport lets the browser update the UI in real time without WebSocket infrastructure.
Early termination on budget/exhaustion prevents runaway spend.

### D4 — JSZip loaded via CDN with SRI integrity hash
**Decision:** JSZip is included via a `<script>` tag pointing to the cdnjs CDN, with a
`integrity="sha384-…"` attribute and `crossorigin="anonymous"`.
**Rationale:** No npm dependency added to the package; the web demo already uses a CDN pattern
for other third-party libraries. SRI hash prevents supply-chain substitution.

### D5 — Self-contained HTML via base64 data URIs
**Decision:** `buildResultsHtml()` embeds video binary as `data:video/mp4;base64,…` URIs
inside a `<video src="…">` element. The downloaded HTML is fully self-contained.
**Rationale:** Sharing the results file requires no server. The file works offline and after
the proxy session ends. Trade-off: large files for long videos (documented in Risks).

### D6 — `--output -` suppresses stderr progress messages
**Decision:** When `--output -` is active, all progress output (spinner, per-item status lines)
is suppressed so stdout contains only valid NDJSON for downstream consumers.
**Rationale:** Mixing progress text with NDJSON on stdout would break `| jq .` and similar
pipeline consumers. Stderr is the correct channel for diagnostics, but consumers that redirect
both streams benefit from clean stdout.

### D7 — Zod validation on `POST /batch` via `BatchBodySchema`
**Decision:** `BatchBodySchema` (array of `BatchItemSchema`) is validated with Zod at the
route entry point. Invalid bodies return `400` with a structured error before any AI call.
**Rationale:** Consistent with all other proxy routes. Early validation prevents partial
execution of a malformed batch.

## Risks / Trade-offs

- **Large base64 HTML files** → Long videos produce large `batch-results.html` (potentially
  tens of MB). Mitigation: document the trade-off in the README; consider a future URL-based
  export option.
- **JSZip CDN availability** → If cdnjs is unavailable the ZIP download button is disabled.
  Mitigation: ZIP is a convenience feature; the HTML download and individual shot downloads
  do not depend on JSZip.
- **NDJSON stream truncation on network error** → If the proxy connection drops mid-stream,
  the browser will have a partial result set with no error indicator.
  Mitigation: the progress label shows "N of total" so users can see if the count is short;
  a future change could add a heartbeat line.
- **Sequential throughput** → Large batches (> 20 shots) may take several minutes.
  Mitigation: the live progress bar gives feedback; document the limitation.

## Migration Plan

1. Update `integrations/web-example/index.html`: add drop-zone markup, pre-flight panel,
   progress bar, results panel, `<hr>` divider, JSZip `<script>` tag.
2. Update `integrations/web-example/styles.css`: add all new CSS classes.
3. Update `integrations/web-example/app.js`: add parsers, drop-zone listeners, batch runner,
   results builder, download handlers.
4. Update `src/ai-powered/server/routes.ts`: add `BatchItemSchema`, `BatchBodySchema`,
   and `POST /batch` route.
5. Update `src/ai-powered/cli/index.ts`: add `writeLine()` helper; update `--input` and
   `--output` handling to detect `-` and switch to stdin/stdout.
6. Add 5 integration tests to `tests/integration/providers.test.ts`.
7. Update `README.md`: add `## File Input` section.
8. Run `npm run build` — zero TypeScript errors.
9. Run `npm test` — all 126 tests pass (5 new POST /batch tests included).
10. Manual smoke test: drag `ai-prompts/roofing-commercial-shot-list2.md` onto the Video tab,
    verify pre-flight, run batch, verify shot cards, download ZIP.

**Rollback:** Remove the `POST /batch` route from `routes.ts`, revert `cli/index.ts` to
file-path-only I/O, and revert the web demo files. No database or config changes involved.

## Open Questions

- **Q1:** Should `POST /batch` be rate-limited independently of `POST /video`? → Not in v1;
  the sequential processing model inherently limits throughput. Revisit if abuse is observed.
- **Q2:** Should the drop-zone accept `.txt` files (one prompt per line)? → Not in scope for
  this change; could be added as a follow-up with a `parseTxtFile()` parser.
- **Q3:** Should failed shot items be re-runnable from the results panel? → Not in v1;
  the user can clear and re-run the full batch or edit the input file.

