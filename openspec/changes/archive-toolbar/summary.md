# Summary — App-014 (archive-toolbar)

**Status:** `implemented`
**JIRA:** APP-014
**Branch:** `feat/app-014-archive-toolbar`
**Depends on:** APP-013 (`cache` change — History Panel must be merged first)

---

## Implementation Status

| Phase | Tasks | Status |
|---|---|---|
| Phase 1 — Pure helpers | T-001 (`buildFullTranscriptText`), T-002 (`buildTitleSlug`) | ✅ complete |
| Phase 2 — `buildHistoryRow` refactor | T-003 (fullText/titleSlug), T-004 (transcript toolbar), T-005 (exchange loop) | ✅ complete |
| Phase 3 — Tests + smoke | T-006 (spec tests), T-007 (full suite), T-008 (example), T-009–T-013 (manual) | ✅ complete |
| Phase 4 — Review + merge | T-014 (code review), T-015 (update summary), T-016 (open PR) | ✅ complete |

---

## Delta Summary (actual — `git diff HEAD --numstat`)

| File | Insertions | Deletions | Net |
|---|---|---|---|
| `integrations/web-example/app.js` | 121 lines | 15 lines | +106 |
| `integrations/web-example/index.html` | 0 | 0 | 0 |
| **Total** | **121** | **15** | **+106** |

---

## New Functions

| Function | Position in `app.js` | Line | Body lines | Pure? |
|---|---|---|---|---|
| `buildFullTranscriptText(entry)` | Before `buildHistoryRow` | 1529 | 13 | ✅ Yes |
| `buildTitleSlug(title)` | After `buildFullTranscriptText` | 1553 | 6 | ✅ Yes |

## Modified Functions

| Function | Change |
|---|---|
| `buildHistoryRow(entry)` | `forEach` → paired `for` loop with exchange wrappers; 2 `createReplyToolbar` call sites added |

---

## Spec Artifacts

| Artifact | File |
|---|---|
| Proposal | `proposal.md` |
| Design decisions | `design.md` |
| Delta spec | `deltas.md` |
| Task checklist | `tasks.md` |
| Implementation guide | `implementation.md` |
| Exchange numbering spec | `specs/exchange-numbering/spec.md` |
| Archive toolbar spec | `specs/archive-toolbar/spec.md` |
| Vitest unit tests | `tests/app-014.test.ts` |
| Example / verification script | `examples/archive-toolbar.js` |
| This summary | `summary.md` |
| Machine-readable metadata | `cache.json` |
| Developer README | `README.md` |

---

## Acceptance Criteria Status

*Verified via T-006–T-014 (Vitest 23/23 · full suite 766/766 · example 30/30 · Playwright smoke).*

| AC | Description | Status | Verified by |
|---|---|---|---|
| AC-1 | `div.history-exchange[data-exchange="N"]` and `#N` label on every expanded transcript | ✅ PASS | T-009 (14/14 Playwright) |
| AC-2 | `aria-label="Exchange N"` on each `span.history-exchange-number` | ✅ PASS | T-009 (14/14 Playwright) |
| AC-3 | Odd-message-count: orphaned user bubble renders, no JS error | ✅ PASS | T-012 (14/14 Playwright) |
| AC-4 | Every `div.bubble.bubble-assistant` has its own ⎘/⬇/🔍 toolbar | ✅ PASS | T-010 (Playwright) |
| AC-5 | Per-reply ⎘ copies only that reply's text | ✅ PASS | T-010 (clipboard verified) |
| AC-6 | Per-reply ⬇ downloads `archived-reply-N.txt` with correct content | ✅ PASS | T-010 · code L1679 |
| AC-7 | Per-reply 🔍 search is scoped to that bubble only | ✅ PASS | T-010 (scope boundary confirmed) |
| AC-8 | Transcript toolbar is `div.history-transcript`'s first child | ✅ PASS | T-011 · `insertBefore` L3316 |
| AC-9 | Transcript ⎘ copies full conversation with `#N You:` / `#N Assistant:` prefixes | ✅ PASS | T-011 (clipboard verified) |
| AC-10 | Transcript ⬇ downloads `archived-<slug>.txt` with correct content | ✅ PASS | T-011 · code L1623 |
| AC-11 | Transcript 🔍 highlights across all exchanges; counter = total hits | ✅ PASS | T-011 (3-match test) |
| AC-12 | Per-reply and transcript searches do not interfere | ✅ PASS | T-010 + T-011 isolation |
| AC-13 | Live-chat toolbars unmodified; all pre-existing tests pass | ✅ PASS | T-013 · npm test 766/766 |
| AC-14 | Zero inline colour literals in new or modified lines | ✅ PASS | T-014 code review |
