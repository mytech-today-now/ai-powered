<#
.SYNOPSIS  App-013 (cache) bead task creation script.
.USAGE     . .\scripts\beads-helpers.ps1; . .\scripts\create-cache-beads.ps1
#>
Set-StrictMode -Off   # clear any strict mode set by prior dot-sourced scripts

function New-Bead {
    param([string]$Title,[string]$Description,[int]$Priority,[string]$Type="task")
    # bd uses Write-Host (stream 6); redirect 6>&1 so output can be captured
    $raw = (bd create $Title -Description $Description -Priority $Priority -Type $Type) 6>&1 | Out-String
    if ($raw -match 'Created:\s*(bd-[a-z0-9]+)') { return $Matches[1] }
    throw "bd create did not return a bead ID. Raw output: $raw"
}

# ── Descriptions (single-quoted here-strings: zero PS interpretation) ─────────

$dStory = @'
Text tab has only a destructive Clear button — no soft-reset, no history. Three problems: sessionStorage is ephemeral (lost on tab close); users must choose between losing context or cluttering one thread; there is no way to review prior conversations. This story adds: (1) a New Conversation button that archives before clearing; (2) a localStorage archive (key: ai-demo-archive) that survives browser restarts; (3) a collapsible History panel sorted newest-first with expand/delete per row. Files: app.js +120 lines, index.html +16 lines, 0 deletions, 0 regressions. 11 new functions, 8 new HTML elements. JIRA: APP-013. Branch: feat/app-013-conversation-history. Spec: openspec/changes/cache/.
'@

$dT001 = @'
Insert after saveSessionMessages in app.js. Four additions: (1) const ARCHIVE_KEY = "ai-demo-archive". (2) getArchive(): JSON.parse with Array.isArray guard — returns [] for absent key, null value, or corrupt JSON. BUG CAUGHT IN SPEC: JSON.parse("null") returns null without throwing; Array.isArray guard is required. (3) saveArchive(entries): localStorage.setItem with JSON.stringify. (4) prependToArchive(entry): unshift at index 0 for newest-first, then QuotaExceededError retry loop — pop oldest and retry until write succeeds or array empty; return true on success, false on unrecoverable failure. Verify: grep shows exactly one definition of each function. Spec: openspec/changes/cache/specs/conversation-archive/spec.md. Delta: deltas.md section 1a.
'@

$dT002 = @'
Insert after prependToArchive in app.js. Rules: find first role="user" message; if none or content.trim() is empty return "Untitled conversation"; trim content; if trimmed length is 80 or fewer return verbatim; if greater than 80 return first 80 chars plus U+2026 (ellipsis), stored length = 81. Examples: "What is the capital of France?" (31 chars) stored verbatim. "A"*80 stored verbatim, no ellipsis. "B"*81 truncated to "B"*80 plus ellipsis. Whitespace-only maps to "Untitled conversation". Empty array maps to "Untitled conversation". Vitest suite covers 7 test cases for this function. Spec: specs/conversation-archive/spec.md. Delta: deltas.md section 1b.
'@

$dT003 = @'
Insert after makeArchiveTitle in app.js. Pure function — no DOM, no storage. Six buckets: under 60s -> "just now"; 1-59 min -> "N minutes ago"; 1-23 h -> "N hours ago"; 24-47 h -> "yesterday" (covers 25 h and 47 h equally); 2-6 days -> "N days ago"; 7+ days -> toLocaleDateString year/month/day. Design: "yesterday" starts at 86400s and ends at 172800s so natural speech patterns hold. Timestamp computed at render time, not stored, so display stays accurate across sessions. Vitest suite: one test per bucket, 6 tests total. Spec: specs/conversation-archive/spec.md. Delta: deltas.md section 1b.
'@

$dT004 = @'
Additive-only change in index.html. Add title="Discard this conversation without saving" to the existing #btn-session-clear button. Do NOT change label ("Clear"), class ("btn btn--ghost"), id, or any other attribute. The app.js btnSessionClear event listener body must remain byte-for-byte identical — verified in T-021. This is a zero-risk additive HTML attribute satisfying AC-14. Delta: deltas.md section 2a.
'@

$dT005 = @'
In index.html, insert immediately after #btn-session-clear: <button id="btn-new-conversation" class="btn btn--ghost" title="Archive this conversation and start fresh">New Conversation</button>. Positioned adjacent to Clear so users see both options side by side. Hover tooltip semantics: "Archive and start fresh" vs "Discard without saving". No other HTML elements modified in this step. AC-1 requirement. Delta: deltas.md section 2a.
'@

$dT006 = @'
In index.html, insert the history panel block immediately after the closing tag of #session-history. Structure: div#history-panel-wrap containing div#history-panel-header with button#btn-history-toggle (class="btn btn--ghost", aria-expanded="false", label "Conversation History (N)") and button#btn-history-clear-all (class="btn btn--ghost btn--danger"); then div#history-panel-body (class="hidden", role="list"); then p#history-panel-warning (class="hidden", aria-live="polite"). Both body and warning start hidden. aria-live="polite" ensures screen readers announce overflow warnings. AC-16: no inline colour literals. Delta: deltas.md section 2b.
'@

$dT007 = @'
Add _newConvDebounced flag, showNewConvTooltip(msg), and handleNewConversation() to app.js. Seven-step sequence: (1) if _newConvDebounced return; set true for 200 ms debounce. (2) getSessionMessages(); if length is 0 call showNewConvTooltip and return — no archive write. (3) build entry: id=crypto.randomUUID(), startedAt and archivedAt=new Date().toISOString(), title=makeArchiveTitle(msgs), messages=JSON.parse(JSON.stringify(msgs)) deep copy. (4) prependToArchive(entry); if returns false call showHistoryPanelWarning. (5) sessionStorage.removeItem(SESSION_KEY). (6) clear sessionHistory.innerHTML, textOutput.innerHTML, textUsage.textContent, scroll to top. (7) renderHistoryPanel(). showNewConvTooltip: remove pre-existing .new-conv-tip, create div, insertAdjacentElement after button, setTimeout 2000 ms. Spec: specs/new-conversation-button/spec.md.
'@

$dT008 = @'
Add showHistoryPanelWarning(msg) before renderHistoryPanel in app.js. Steps: getElementById("history-panel-warning"); if null return without throwing; set textContent to msg; remove "hidden" class. Called when prependToArchive returns false. Element has aria-live="polite" for screen reader announcement. Warning text: U+26A0 " Storage full — this conversation could not be archived. Consider clearing old history." Must be null-safe — element may not exist in all layouts. Spec: specs/history-panel/spec.md.
'@

$dT009 = @'
Add renderHistoryPanel() in app.js, placed before buildHistoryRow. Steps: (1) getArchive() for entries. (2) getElementById for history-count, history-panel-body, btn-history-toggle — return early if any absent. (3) Read aria-expanded to pick chevron char (U+25BE expanded, U+25B8 collapsed). (4) Set countEl.textContent. (5) Set toggle text to chevron plus " Conversation History (" plus count plus ")". (6) Clear body innerHTML. (7) If entries empty, append p.history-empty "No archived conversations yet." and return. (8) forEach entry: body.appendChild(buildHistoryRow(entry)). Called after every soft reset, delete, Clear All, and on page load. Spec: specs/history-panel/spec.md.
'@

$dT010 = @'
Add buildHistoryRow(entry) in app.js. Returns div.history-row[role=listitem][data-id=entry.id] containing: (1) div.history-row-summary with: (a) button.history-chevron showing U+25B8 plus title, aria-expanded=false; (b) span.history-meta showing message count plus " messages · Archived " plus relativeTime(entry.archivedAt); (c) button.history-delete with aria-label "Delete conversation: " plus title. (2) div.history-transcript (class="hidden") with one div.bubble.bubble-{role} per message — "user" role shows label "You", "assistant" shows "Assistant" — using same .bubble and .bubble-label CSS classes as live chat. Chevron click: flip aria-expanded, swap chevron char, toggle transcript hidden. Delete click: call handleDeleteEntry. No inline colour literals. Spec: specs/history-panel/spec.md.
'@

$dT011 = @'
Add handleDeleteEntry(id, rowEl) in app.js. Appends div.history-confirm-bar inside rowEl containing: text "Delete this conversation? This cannot be undone. ", then button.btn.btn--ghost.btn--danger "Confirm", then button.btn.btn--ghost "Cancel". Cancel listener: confirmBar.remove(). Confirm listener: getArchive().filter(e => e.id !== id) -> saveArchive(filtered) -> renderHistoryPanel(). Design: inline bar (not native confirm()) for per-row delete — non-blocking, contextual. Clear All uses native confirm() because it is a high-stakes infrequent action. No inline colour literals. Spec: specs/history-panel/spec.md.
'@

$dT012 = @'
In IIFE init block of app.js, immediately after btnSessionClear.addEventListener block, add three listener groups. (1) New Conversation: getElementById("btn-new-conversation").addEventListener("click", handleNewConversation). (2) History toggle: flip aria-expanded on btn-history-toggle and toggle "hidden" on #history-panel-body. (3) Clear All: getArchive().length; if 0 return; native confirm("Delete all N archived conversation(s)? This cannot be undone."); on OK: localStorage.removeItem(ARCHIVE_KEY); renderHistoryPanel(). Singular "conversation" for N=1, plural for N>1. Do not alter btnSessionClear listener. Delta: deltas.md section 1e.
'@

$dT013 = @'
In IIFE init block of app.js, add renderHistoryPanel() on the line immediately following the existing renderSessionHistory() call. This re-hydrates the panel from localStorage on every page load — including new tabs and browser restarts when sessionStorage is empty. Without this call, archived conversations from prior sessions would not appear until the user clicks New Conversation. Verify: archive a conversation, close the tab, reopen, confirm panel shows the archived entry with correct count in toggle button. Delta: deltas.md section 1e.
'@

$dT014 = @'
Run: npx vitest run openspec/changes/cache/tests/app-013.test.ts. Expected: 22 passed, 0 failed across 4 suites. Suite breakdown: getArchive (4 tests: absent key, null string value, corrupt JSON, valid roundtrip); saveArchive/getArchive roundtrip (1: all 5 fields preserved); prependToArchive (4: newest-first order, returns true, QuotaExceededError trim-oldest retry with 2 forced failures, returns false on 999 forced failures); makeArchiveTitle (7: short verbatim, exact-80 no-ellipsis, 81-char truncated, whitespace-only, empty array, no-user-message, leading-whitespace strip); relativeTime (6: one per bucket). getArchive uses Array.isArray guard — bug caught during spec authoring. Test file: openspec/changes/cache/tests/app-013.test.ts.
'@

$dT015 = @'
Run: npm test. All pre-existing tests must continue to pass — zero regressions. App-013 is purely additive: +136 lines, 0 deletions. No existing function signatures changed. getSessionMessages, saveSessionMessages, addBubble, renderSessionHistory, appendSession, buildHistoryPrompt are all unchanged. btnSessionClear listener body is untouched. Expected: same test count as baseline, exit code 0. If any pre-existing test fails the implementation has introduced a regression — compare git diff for unintended changes before continuing. Summary: openspec/changes/cache/summary.md.
'@

$dT016 = @'
Run: node openspec/changes/cache/examples/soft-reset-conversations.js. Expected final output: "35 passed, 0 failed" and "All scenarios passed." Scenario coverage: (1) prependToArchive newest-first across two inserts; (2) makeArchiveTitle: short/exact-80/over-80/empty/no-user/empty-array; (3) relativeTime: all 6 buckets; (4) getArchive safety: absent/null/corrupt/valid-empty; (5) QuotaExceededError retry with 2 forced failures — assert 2 oldest trimmed; (6) unrecoverable overflow with 999 forced failures — returns false, archive stays empty; (7) saveArchive+getArchive roundtrip — all 5 fields including 4-message array preserved. Script uses in-memory shim, runs in plain Node.js with no build step.
'@

$dT017 = @'
Start a conversation with at least 2 user messages and 2 assistant replies. Click "New Conversation". Verify: (A) #session-history innerHTML empty; (B) #text-output empty; (C) #text-usage empty; (D) DevTools Local Storage ai-demo-archive has one JSON entry with UUID id, ISO-8601 archivedAt, correct title (first 80 chars of first user message), and messages array matching the full conversation. Then send "Do you remember what we just discussed?" — AI must not mention the previous topic (context isolated, AC-4). Verify button tooltip on hover reads "Archive this conversation and start fresh" (AC-1). Verify "Clear" tooltip reads "Discard this conversation without saving" (AC-14).
'@

$dT018 = @'
Archive 3 conversations (A=Python, B=recipes, C=CSS). Open history panel. Verify: toggle reads "Conversation History (3)"; rows ordered C, B, A newest-first (AC-6); each row shows message count and relative timestamp. Expand C row: all bubbles appear chronologically with "You"/"Assistant" labels and .bubble CSS classes (AC-7). Click Delete on B: verify inline confirm bar appears — NOT a native dialog (AC-8). Click Cancel: bar removed, B still visible. Click Delete on B again then Confirm: B gone, count decrements to 2, ai-demo-archive has 2 entries. Click Clear All: native confirm must say "Delete all 2 archived conversations? This cannot be undone." (AC-9). Click OK: panel shows "No archived conversations yet.", ai-demo-archive key absent from Local Storage.
'@

$dT019 = @'
Archive a conversation with at least 3 messages. Confirm ai-demo-archive in DevTools Local Storage. Fully close the browser (not just the tab — close the application). Wait 5 seconds. Reopen the browser and navigate to the app. Verify: (A) sessionStorage has no ai-demo-session key (ephemeral, as expected); (B) localStorage still has ai-demo-archive; (C) history panel toggle shows count >= 1; (D) panel displays the archived conversation with correct title and message count; (E) expanding the row shows the full transcript. AC-5 confirmed: localStorage persists across browser restarts unlike sessionStorage. Run in Chrome, Firefox, and Edge.
'@

$dT020 = @'
Load the app in a fresh browser tab (sessionStorage empty). Click "New Conversation" immediately without typing anything. Verify: (A) no new entry in ai-demo-archive (key absent or array unchanged in DevTools); (B) div.new-conv-tip appears below button with text "Nothing to archive — start typing first."; (C) tooltip disappears after approximately 2 seconds; (D) #session-history, #text-output, #text-usage unchanged; (E) no console errors. Repeat click rapidly while first tooltip is still visible — confirm only one tooltip is present (pre-existing removed before new one created). AC-3 requirement.
'@

$dT021 = @'
Review the git diff against main. Verify all 16 ACs: (AC-1) #btn-new-conversation present adjacent to Clear, correct title. (AC-2) prependToArchive called before sessionStorage.removeItem. (AC-3) msgs.length===0 guard returns before archive write. (AC-4) buildHistoryPrompt uses getSessionMessages on cleared sessionStorage. (AC-5) localStorage used, not sessionStorage. (AC-6) unshift guarantees newest-first. (AC-7) .bubble.bubble-{role} and .bubble-label classes in buildHistoryRow. (AC-8) handleDeleteEntry uses inline bar, not confirm(). (AC-9) Clear All uses native confirm() with count. (AC-10) makeArchiveTitle 80-char rule with ellipsis. (AC-11) relativeTime 6-bucket pure function. (AC-12) QuotaExceededError retry loop. (AC-13) 200 ms debounce flag. (AC-14) btnSessionClear listener byte-for-byte unchanged. (AC-15) npm test exits 0. (AC-16) zero inline colour literals in diff. Spec: openspec/changes/cache/README.md.
'@

$dT022 = @'
After all implementation and verification tasks pass, update openspec/changes/cache/summary.md: (1) Change status from "spec-complete" to "Implemented". (2) Fill actual line numbers for each new function (grep each function name). (3) Update Implementation Status table — change "not started" to task ID and "complete" per phase. (4) Update AC Verification Status table — change "pending" to "pass" with test reference. (5) Record actual net line delta from git diff --stat. Also update cache.json: set "status" field to "implemented". Spec: openspec/changes/cache/summary.md.
'@

$dT023 = @'
Create PR from feat/app-013-conversation-history targeting main. Title: "[app-013] Soft-reset conversations with persistent localStorage history". Body must include: (1) Summary of what changed. (2) Link to openspec/changes/cache/. (3) Link to JIRA APP-013. (4) Files-changed table (app.js +120, index.html +16, 0 deletions). (5) 11 new functions list. (6) All 16 AC checkboxes from README.md. (7) Test results: 22/22 Vitest, full suite green, 35/35 example script. (8) Bug found and fixed note: getArchive Array.isArray guard catches JSON.parse("null") returning null without throwing. (9) Design decisions table. Must pass all CI checks before merge.
'@

# ── Bead creation ─────────────────────────────────────────────────────────────

Write-Host "`n=== App-013 (cache) — Bead Task Creation ===" -ForegroundColor Cyan

Write-Host "`n[Story]" -ForegroundColor Yellow
$STORY = New-Bead "[app-013] Soft-reset conversations with persistent localStorage history" $dStory 2 "story"
Write-Host "  Story  : $STORY"

Write-Host "`n[Phase 1 - Storage Helpers]" -ForegroundColor Yellow
$T001 = New-Bead "[app-013] T-001: Add ARCHIVE_KEY, getArchive, saveArchive, and prependToArchive to app.js" $dT001 2
$T002 = New-Bead "[app-013] T-002: Add makeArchiveTitle utility to app.js" $dT002 2
$T003 = New-Bead "[app-013] T-003: Add relativeTime utility to app.js" $dT003 2
Write-Host "  T-001:$T001  T-002:$T002  T-003:$T003"

Write-Host "`n[Phase 2 - HTML Structure]" -ForegroundColor Yellow
$T004 = New-Bead "[app-013] T-004: Add title tooltip to #btn-session-clear in index.html" $dT004 2
$T005 = New-Bead "[app-013] T-005: Add #btn-new-conversation button to index.html" $dT005 2
$T006 = New-Bead "[app-013] T-006: Add #history-panel-wrap block to index.html" $dT006 2
Write-Host "  T-004:$T004  T-005:$T005  T-006:$T006"

Write-Host "`n[Phase 3 - New Conversation Button]" -ForegroundColor Yellow
$T007 = New-Bead "[app-013] T-007: Implement handleNewConversation and showNewConvTooltip in app.js" $dT007 2
Write-Host "  T-007:$T007"

Write-Host "`n[Phase 4 - History Panel JS]" -ForegroundColor Yellow
$T008 = New-Bead "[app-013] T-008: Add showHistoryPanelWarning to app.js" $dT008 2
$T009 = New-Bead "[app-013] T-009: Implement renderHistoryPanel in app.js" $dT009 2
$T010 = New-Bead "[app-013] T-010: Implement buildHistoryRow in app.js" $dT010 2
$T011 = New-Bead "[app-013] T-011: Implement handleDeleteEntry in app.js" $dT011 2
Write-Host "  T-008:$T008  T-009:$T009  T-010:$T010  T-011:$T011"

Write-Host "`n[Phase 5 - Event Listener Wiring]" -ForegroundColor Yellow
$T012 = New-Bead "[app-013] T-012: Wire New Conversation, history toggle, and Clear All listeners in IIFE" $dT012 2
$T013 = New-Bead "[app-013] T-013: Add renderHistoryPanel call on page load in IIFE init block" $dT013 2
Write-Host "  T-012:$T012  T-013:$T013"

Write-Host "`n[Phase 6 - Tests and Verification]" -ForegroundColor Yellow
$T014 = New-Bead "[app-013] T-014: Run App-013 Vitest spec tests - all 22 must pass" $dT014 2
$T015 = New-Bead "[app-013] T-015: Run full test suite - all pre-existing tests must pass" $dT015 2
$T016 = New-Bead "[app-013] T-016: Run example script - all 7 scenarios and 35 assertions must pass" $dT016 2
$T017 = New-Bead "[app-013] T-017: Manual smoke test - New Conversation soft-reset flow" $dT017 2
$T018 = New-Bead "[app-013] T-018: Manual smoke test - history panel expand, delete, and Clear All" $dT018 2
$T019 = New-Bead "[app-013] T-019: Manual smoke test - cross-session persistence" $dT019 2
$T020 = New-Bead "[app-013] T-020: Manual smoke test - empty-session guard" $dT020 2
Write-Host "  T-014:$T014  T-015:$T015  T-016:$T016"
Write-Host "  T-017:$T017  T-018:$T018  T-019:$T019  T-020:$T020"

Write-Host "`n[Phase 7 - Review and Merge]" -ForegroundColor Yellow
$T021 = New-Bead "[app-013] T-021: Code review - confirm all 16 AC requirements met" $dT021 3
$T022 = New-Bead "[app-013] T-022: Update summary.md with actual status and line numbers" $dT022 3
$T023 = New-Bead "[app-013] T-023: Open PR targeting main - link to openspec/changes/cache/ and JIRA APP-013" $dT023 3
Write-Host "  T-021:$T021  T-022:$T022  T-023:$T023"

# ── Dependency wiring ─────────────────────────────────────────────────────────

Write-Host "`n[Wiring dependencies]" -ForegroundColor Yellow

# Phase 1
bd dep add $T002 $T001; bd dep add $T003 $T001

# Phase 2
bd dep add $T005 $T004; bd dep add $T006 $T005

# Phase 3 needs all utilities + HTML
bd dep add $T007 $T001; bd dep add $T007 $T002; bd dep add $T007 $T003
bd dep add $T007 $T005; bd dep add $T007 $T006

# Phase 4
bd dep add $T009 $T008; bd dep add $T009 $T001
bd dep add $T010 $T009; bd dep add $T010 $T003
bd dep add $T011 $T009

# Phase 5
bd dep add $T012 $T007; bd dep add $T012 $T009
bd dep add $T012 $T010; bd dep add $T012 $T011
bd dep add $T013 $T009; bd dep add $T013 $T012

# Phase 6 — all need full implementation
foreach ($T in @($T014,$T015,$T016,$T017,$T018,$T019,$T020)) {
    bd dep add $T $T013
}

# Phase 7
foreach ($T in @($T014,$T015,$T016,$T017,$T018,$T019,$T020)) {
    bd dep add $T021 $T
}
bd dep add $T022 $T021
bd dep add $T023 $T022
bd dep add $STORY $T023

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Story: $STORY"
Write-Host "Tasks: $T001 $T002 $T003 $T004 $T005 $T006 $T007 $T008 $T009 $T010 $T011 $T012 $T013 $T014 $T015 $T016 $T017 $T018 $T019 $T020 $T021 $T022 $T023"
bd stats
