#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\beads-helpers.ps1"

function New-Bead([string]$Title, [string]$Desc, [int]$Pri, [string]$Typ) {
    $rec = bd create $Title -Description $Desc -Priority $Pri -Type $Typ --json | ConvertFrom-Json
    if (-not $rec.id) { throw "bd create returned no id for: $Title" }
    return $rec.id
}

Write-Host "`n=== Creating App-014 Beads Tasks ===" -ForegroundColor Cyan

# STORY
$d = "APP-014 (archive-toolbar). Depends on APP-013. SINGLE FILE CHANGE: integrations/web-example/app.js only -- index.html and styles.css must NOT change. WHAT: (1) Add pure helpers buildFullTranscriptText and buildTitleSlug before buildHistoryRow. (2) Call createReplyToolbar on div.history-transcript before the message loop. (3) Replace flat forEach with paired for(i+=2) loop wrapping each pair in div.history-exchange[data-exchange=N] with span.history-exchange-number (aria-label=Exchange N) and calling createReplyToolbar on each assistant bubble. All toolbar logic reuses existing functions verbatim. New capabilities: archive-transcript-toolbar, archive-reply-toolbar, exchange-numbering. 14 ACs. Spec: openspec/changes/archive-toolbar/ -- README.md, proposal.md, design.md, deltas.md, tasks.md, implementation.md, specs/, tests/app-014.test.ts, examples/archive-toolbar.js, summary.md, cache.json."
$storyId = New-Bead "[app-014] History Panel: copy / save / search toolbars + numbered exchange markers in archived conversations" $d 1 "story"
Write-Host "  Story : $storyId" -ForegroundColor Green

# T-001
$d = "FILE: integrations/web-example/app.js. POSITION: immediately before buildHistoryRow. Spec refs: proposal.md Step 1, deltas.md Delta 1, specs/archive-toolbar/spec.md Part A, design.md Decision 2. PURPOSE: Pure function, no DOM, no side effects. Converts ArchiveEntry into numbered plain-text for transcript-level Copy and Save. FORMAT: each message prefixed '#N You:' or '#N Assistant:'; exchanges separated by one blank line; trimEnd() applied; no trailing newline. Odd message count omits '#N Assistant:' for last exchange. Multi-line content preserved verbatim. EXAMPLE (2-exchange async/await): '#1 You: What does async/await do? / #1 Assistant: async/await is syntactic sugar over Promises. / (blank) / #2 You: Can I use it inside forEach? / #2 Assistant: No -- use for...of or Promise.all instead.' EXAMPLE (3-msg odd count, closures): '#1 You: Explain closures. / #1 Assistant: A closure captures variables from its outer scope. / (blank) / #2 You: Can you show a TypeScript example?' (no #2 Assistant line). ACCEPTANCE: (1) 4-msg entry: correct format, one blank line between exchanges, no trailing newline. (2) 3-msg entry: '#2 You:' present, '#2 Assistant:' absent. (3) empty messages[]: empty string. (4) no DOM APIs called -- pure and testable in Node.js."
$t001 = New-Bead "[app-014] T-001: Add buildFullTranscriptText(entry) to app.js" $d 1 "task"
Write-Host "  T-001 : $t001"

# T-002
$d = "FILE: integrations/web-example/app.js. POSITION: immediately after buildFullTranscriptText, immediately before buildHistoryRow. Spec refs: proposal.md Step 2, deltas.md Delta 2, design.md Decision 6, specs/archive-toolbar/spec.md Part A slug section. PURPOSE: Pure function, no DOM. Derives filesystem-safe slug from entry.title for the download filename 'archived-SLUG.txt'. ALGORITHM (in order): (1) toLowerCase; (2) replace whitespace RUNS with one hyphen; (3) strip all chars not in a-z, 0-9, or hyphen (removes periods, ?, /, commas, colons, Unicode). SLUG TABLE (from deltas.md Delta 2): 'Explain recursion.' -> 'explain-recursion'; 'What is the capital of France?' -> 'what-is-the-capital-of-france'; 'CSS Grid vs Flexbox' -> 'css-grid-vs-flexbox'; 'TCP, UDP, and QUIC' -> 'tcp-udp-and-quic'; 'SQL: SELECT * FROM users' -> 'sql-select--from-users'; all-non-ASCII -> '' (filename becomes 'archived-.txt' -- acceptable). DESIGN NOTE (Decision 6): same algorithm as Jekyll/Hugo/Eleventy; safe on all OSes without percent-encoding. ACCEPTANCE: all slug examples match exactly; empty input returns ''; all-non-ASCII returns ''."
$t002 = New-Bead "[app-014] T-002: Add buildTitleSlug(title) to app.js" $d 1 "task"
Write-Host "  T-002 : $t002"

# T-003
$d = "FILE: integrations/web-example/app.js. POSITION: inside buildHistoryRow(entry) as the FIRST two const declarations, before any document.createElement call. Spec refs: deltas.md Delta 3a, implementation.md Step 2, tasks.md T-003. PURPOSE: Precompute fullText and titleSlug so they are available to createReplyToolbar (T-004) and the per-reply filename construction inside the loop (T-005). ADD: const fullText = buildFullTranscriptText(entry); const titleSlug = buildTitleSlug(entry.title); ACCEPTANCE: (1) Both consts appear before the first document.createElement call in the function body. (2) No other changes at this step."
$t003 = New-Bead "[app-014] T-003: Compute fullText and titleSlug at the top of buildHistoryRow" $d 1 "task"
Write-Host "  T-003 : $t003"

# T-004
$d = "FILE: integrations/web-example/app.js. POSITION: inside buildHistoryRow, AFTER setting transcript.className to 'history-transcript hidden', BEFORE the message loop. Spec refs: deltas.md Delta 3b, specs/archive-toolbar/spec.md Part A Trigger Point, implementation.md Step 3, design.md Decision 4, tasks.md T-004. PURPOSE: One createReplyToolbar call injecting a whole-transcript toolbar into div.history-transcript as its firstChild (above all exchange divs). DESIGN NOTE (Decision 4): calling it before the loop guarantees position 0. DESCRIPTOR: modality='text', text=fullText, dataUrl=null, srcUrl=null, mimeType='text/plain', filename='archived-'+titleSlug+'.txt'. BUTTON BEHAVIOURS: Copy -- copies fullText in numbered '#N You:/Assistant:' format to clipboard. Save -- downloads 'archived-SLUG.txt' with same numbered content. Search -- inline regex bar scoped to div.history-transcript; highlights across ALL exchange divs simultaneously; counter equals total hits across the whole conversation. ACCEPTANCE: (1) .reply-toolbar is div.history-transcript firstChild after expand. (2) Copy copies numbered plain text. (3) Save filename = 'archived-'+buildTitleSlug(entry.title)+'.txt'. (4) Search highlights span all exchange divs simultaneously."
$t004 = New-Bead "[app-014] T-004: Attach whole-transcript createReplyToolbar to the transcript div" $d 1 "task"
Write-Host "  T-004 : $t004"

# T-005
$d = "FILE: integrations/web-example/app.js. OPERATION: REMOVE the entire entry.messages.forEach block inside buildHistoryRow. INSERT the paired for loop from deltas.md Delta 3c. Spec refs: deltas.md Delta 3c, specs/exchange-numbering/spec.md, specs/archive-toolbar/spec.md Part B, implementation.md Steps 4+5, design.md Decisions 3/5/7/8. LOOP STRUCTURE: let exchNum=0; for(i=0; i less-than messages.length; i+=2) { exchNum++; userMsg=messages[i]; asstMsg=messages[i+1]; }. EXCHANGE WRAPPER: div.history-exchange with className and data-exchange=String(exchNum). NUMBER LABEL: span.history-exchange-number with textContent='#N' and aria-label='Exchange N'. USER BUBBLE: div.bubble.bubble-user with span.bubble-label 'You' and p of userMsg.content -- NO toolbar on user bubbles (Decision 5). ASSISTANT BUBBLE (only when asstMsg exists): div.bubble.bubble-assistant with span.bubble-label 'Assistant' and p of asstMsg.content; createReplyToolbar called on asstBubble BEFORE exchDiv.appendChild(asstBubble) so toolbar becomes asstBubble.firstChild; descriptor: modality='text', text=asstMsg.content, filename='archived-reply-'+exchNum+'.txt'. GUARD: if(asstMsg) prevents crash on odd message count (Decision 7). KEY RULES: (1) exchNum is 1-based (Decision 3). (2) data-exchange is a string via setAttribute (Decision 8). (3) User bubbles get NO toolbar. ACCEPTANCE: exchange wrappers present with correct data-exchange; #N labels with aria-label; per-reply toolbars on assistant bubbles only; odd count handled without error."
$t005 = New-Bead "[app-014] T-005: Replace flat forEach with paired for loop -- exchange wrappers + per-reply toolbars" $d 1 "task"
Write-Host "  T-005 : $t005"

# T-006
$d = "COMMAND: npx vitest run openspec/changes/archive-toolbar/tests/app-014.test.ts. Spec refs: tasks.md T-006, tests/app-014.test.ts (already written -- just run it). 23 Vitest unit tests, no DOM required. COVERAGE buildFullTranscriptText (8 tests): empty messages[] returns ''; single exchange #1 labels correct; two exchanges separated by exactly one blank line; three exchanges numbered correctly; odd count omits #N Assistant line; no trailing newline; multi-line content preserved; single orphaned user message. COVERAGE buildTitleSlug (15 tests): empty string; toLowerCase; spaces to hyphens; whitespace runs collapse to one hyphen; period stripped; question mark stripped; slash stripped; colon+asterisk stripped; comma stripped; U+2026 ellipsis stripped; numbers preserved; existing hyphens preserved; all-non-ASCII returns ''; lowercase+slug table. NOTE: test file defines the functions inline and is self-contained -- runs before app.js is modified. ACCEPTANCE: all 23 tests pass; exit code 0."
$t006 = New-Bead "[app-014] T-006: Run App-014 Vitest spec tests -- all 23 must pass" $d 2 "task"
Write-Host "  T-006 : $t006"

# T-007
$d = "COMMAND: npm test. Spec refs: tasks.md T-007, implementation.md Step 6, JIRA AC-13. PURPOSE: Confirm the changes to buildHistoryRow and the two new pure helpers introduce zero regressions. All pre-existing Vitest tests for live-chat toolbars, session storage, archive functions (getArchive, saveArchive, prependToArchive, makeArchiveTitle, relativeTime), and all other tested functionality must pass. ACCEPTANCE: npm test exits with code 0; no test failures; no new ESLint errors."
$t007 = New-Bead "[app-014] T-007: Run full test suite -- zero regressions" $d 2 "task"
Write-Host "  T-007 : $t007"

# T-008
$d = "COMMAND: node openspec/changes/archive-toolbar/examples/archive-toolbar.js. Spec refs: tasks.md T-008, examples/archive-toolbar.js. 10 labelled scenarios, 30 assertions, no browser or DOM required. SCENARIOS: (1) standard 2-exchange conversation format; (2) odd message count -- no #N Assistant line for last exchange; (3) single exchange; (4) empty messages array; (5) multi-line content preserved verbatim; (6) plain title slugs (period, question mark); (7) punctuation in slugs (em dash, slash, colon+star, comma); (8) edge cases (empty, non-ASCII, numbers, whitespace-run collapse); (9) end-to-end filename derivation for 5 titles; (10) per-reply filename pattern 'archived-reply-N.txt' for N=1 through 5. ACCEPTANCE: script prints 'All scenarios PASSED.' and exits with code 0."
$t008 = New-Bead "[app-014] T-008: Run example script -- all 30 assertions pass" $d 2 "task"
Write-Host "  T-008 : $t008"

# T-009
$d = "MANUAL TEST. Spec refs: tasks.md T-009, specs/exchange-numbering/spec.md, JIRA AC-1 and AC-2. SETUP: npm run dev:web; open http://localhost:5173; send a 4-message conversation (2 user + 2 assistant) in the Text tab; click New Conversation to archive it. VERIFY in History Panel after expanding the archived row: (a) Two div.history-exchange elements in DevTools with data-exchange='1' and data-exchange='2'. (b) Each contains span.history-exchange-number with textContent '#1'/'#2' and aria-label 'Exchange 1'/'Exchange 2'. (c) span.history-exchange-number appears ABOVE the user bubble. (d) User bubbles have NO .reply-toolbar child. (e) DevTools console: zero errors. EXTENDED: archive a 6-message conversation; confirm data-exchange='3' and '#3' label appear correctly for the third pair."
$t009 = New-Bead "[app-014] T-009: Manual smoke -- exchange numbers visible on every expanded transcript" $d 2 "task"
Write-Host "  T-009 : $t009"

# T-010
$d = "MANUAL TEST. Spec refs: tasks.md T-010, JIRA AC-4/AC-5/AC-6/AC-7, specs/archive-toolbar/spec.md Part B. PREREQUISITE: Archive a 4-message sky conversation -- Exchange #1: 'What colour is the sky?' / 'The sky appears blue due to Rayleigh scattering.'; Exchange #2: 'And at sunset?' / 'At sunset the sky turns orange and red as light travels through more atmosphere.' Expand the row. COPY TEST (AC-5): Click Copy on exchange #2 assistant toolbar. Paste into text editor. Content must be ONLY the exchange #2 reply text. SAVE TEST (AC-6): Click Save on exchange #1 toolbar; confirm filename 'archived-reply-1.txt' and content is ONLY the Rayleigh scattering reply. Click Save on exchange #2; filename 'archived-reply-2.txt'. SEARCH TEST (AC-7): Click Search on exchange #1 toolbar; type 'light' (once in exchange #1, twice in exchange #2). Counter reads '1 match'. Only exchange #1 bubble shows highlight. Press Escape: highlights clear."
$t010 = New-Bead "[app-014] T-010: Manual smoke -- per-reply copy, save, and search" $d 2 "task"
Write-Host "  T-010 : $t010"

# T-011
$d = "MANUAL TEST. Spec refs: tasks.md T-011, JIRA AC-8/AC-9/AC-10/AC-11, specs/archive-toolbar/spec.md Part A. PREREQUISITE: Archive a 4-message recursion conversation -- Exchange #1: 'Explain recursion.' / 'Recursion is when a function calls itself to solve a smaller problem.'; Exchange #2: 'Give me a Python example.' / 'def factorial(n): return 1 if n less-than-or-eq 1 else n * factorial(n-1)'. Expand the row. POSITION TEST (AC-8): in DevTools confirm .reply-toolbar is div.history-transcript firstChild. COPY TEST (AC-9): Click Copy on the TRANSCRIPT toolbar. Paste: must be '#1 You: Explain recursion. / #1 Assistant: Recursion is... / (blank) / #2 You: Give me a Python example. / #2 Assistant: def factorial...' SAVE TEST (AC-10): Click Save on transcript toolbar; filename must be 'archived-explain-recursion.txt' (period stripped). SEARCH TEST (AC-11): archive a conversation where 'function' appears once in exchange #1 and twice in exchange #2; type 'function'; counter reads '3 matches'; all three highlighted across both exchanges; Escape clears all highlights."
$t011 = New-Bead "[app-014] T-011: Manual smoke -- transcript-level copy, save, and search" $d 2 "task"
Write-Host "  T-011 : $t011"

# T-012
$d = "MANUAL TEST. Spec refs: tasks.md T-012, JIRA AC-3, design.md Decision 7, specs/exchange-numbering/spec.md Edge Case. SETUP: In DevTools Console, read the 'ai-demo-archive' key, prepend an entry with 3 messages: [{role:'user',content:'Hello?'},{role:'assistant',content:'Hi there!'},{role:'user',content:'Can you explain monads?'}], write it back, reload. VERIFY: (a) 'ai-demo-archive' entry appears in History Panel. (b) Expand: Exchange #1 has user bubble + assistant bubble + assistant toolbar. (c) Exchange #2 has ONLY the user bubble 'Can you explain monads?' -- no assistant bubble, no .reply-toolbar. (d) DevTools console: zero errors. (e) Transcript Copy produces: '#1 You: Hello? / #1 Assistant: Hi there! / (blank) / #2 You: Can you explain monads?' with NO '#2 Assistant:' line."
$t012 = New-Bead "[app-014] T-012: Manual smoke -- odd-message-count conversation renders without error" $d 2 "task"
Write-Host "  T-012 : $t012"

# T-013
$d = "MANUAL TEST. Spec refs: tasks.md T-013, JIRA AC-13, implementation.md pre-PR checklist. PURPOSE: Confirm changes to buildHistoryRow do NOT affect any live-chat toolbar behaviour. STEPS: (1) Text tab -- send a message, verify reply toolbar Copy/Save/Search all work identically to before. (2) Image tab -- generate image, verify toolbar appears. (3) Audio tab -- verify toolbar appears. (4) Structured Data tab -- verify toolbar appears. FUNCTIONS TO CONFIRM UNCHANGED by source inspection (no lines modified in these bodies): createReplyToolbar, copyReplyContent, saveReplyContent, createSearchBar, activateInlineSearch, applySearchHighlights, clearSearchHighlights, triggerDownload, showToolbarFeedback, createToolbarBtn. ACCEPTANCE: all live-chat toolbars work identically to before this story; npm test exits 0."
$t013 = New-Bead "[app-014] T-013: Manual smoke -- existing live-chat toolbar completely unaffected" $d 2 "task"
Write-Host "  T-013 : $t013"

# T-014
$d = "CODE REVIEW. Spec refs: tasks.md T-014, summary.md AC table, JIRA AC-1 through AC-14. Verify all 14 ACs by code inspection + results from T-006 through T-013: AC-1: div.history-exchange[data-exchange=N] and span #N on every transcript (T-009). AC-2: aria-label='Exchange N' on each span (T-009, DevTools). AC-3: odd count: orphaned user bubble, no crash (T-012). AC-4: every assistant bubble has .reply-toolbar with Copy/Save/Search (T-009, T-010). AC-5: per-reply Copy copies only that reply text (T-010). AC-6: per-reply Save downloads 'archived-reply-N.txt' (T-010). AC-7: per-reply Search scoped to that bubble; counter = hits in bubble only (T-010). AC-8: transcript toolbar is div.history-transcript firstChild (T-011). AC-9: transcript Copy produces numbered '#N You:/Assistant:' text (T-011). AC-10: transcript Save downloads 'archived-SLUG.txt' (T-011). AC-11: transcript Search highlights all exchanges; counter = total (T-011). AC-12: per-reply and transcript searches do not interfere -- open both simultaneously and confirm no duplicate toolbars or nested highlights. AC-13: live-chat toolbars unmodified; npm test exits 0 (T-007, T-013). AC-14: zero inline colour literals -- regex search diff for hex codes and rgb() in changes. ALSO VERIFY: new functions appear before buildHistoryRow; no changes to index.html, styles.css, src/, server/."
$t014 = New-Bead "[app-014] T-014: Code review -- confirm all 14 ACs met" $d 2 "task"
Write-Host "  T-014 : $t014"

# T-015
$d = "FILE: openspec/changes/archive-toolbar/summary.md. Spec refs: tasks.md T-015, summary.md. UPDATES: (1) Status header: 'spec-complete' -> 'implemented'. (2) Implementation Status table: mark all 4 phases complete. (3) Delta Summary table: replace estimated counts with ACTUAL from 'git diff --stat HEAD~1 integrations/web-example/app.js'. (4) New Functions table: fill in ACTUAL line numbers of buildFullTranscriptText and buildTitleSlug. (5) Acceptance Criteria Status table: update all 14 rows from 'pending' to the checkmark PASS format. ACCEPTANCE: summary.md reflects implemented state; no 'pending' rows remain in the AC table."
$t015 = New-Bead "[app-014] T-015: Update summary.md with actual line numbers and final AC status" $d 3 "task"
Write-Host "  T-015 : $t015"

# T-016
$d = "GIT + GITHUB TASK. Spec refs: tasks.md T-016, cache.json branch field, JIRA PR guidance. BRANCH: feat/app-014-archive-toolbar. STEPS: (1) git checkout -b feat/app-014-archive-toolbar. (2) git add integrations/web-example/app.js openspec/changes/archive-toolbar/summary.md. (3) git commit with first line 'feat(web-example): copy/save/search toolbars + exchange numbering in archived transcripts (App-014)' and body listing new functions with actual line numbers, test results (N/N Vitest, N/N full suite, 30/30 examples), 'All 14 ACs verified.', 'Closes APP-014'. (4) git push -u origin feat/app-014-archive-toolbar. (5) Open GitHub PR targeting main. PR BODY MUST INCLUDE: summary paragraph, files-changed table (app.js only), new functions table with actual line numbers, 3 key design decisions, test results, all 14 AC checkboxes checked, link to openspec/changes/archive-toolbar/."
$t016 = New-Bead "[app-014] T-016: Open PR targeting main -- feat/app-014-archive-toolbar" $d 3 "task"
Write-Host "  T-016 : $t016"

# DEPENDENCIES
Write-Host "`n  Wiring dependencies..." -ForegroundColor Yellow
bd dep add $t002 $t001
bd dep add $t003 $t001
bd dep add $t003 $t002
bd dep add $t004 $t003
bd dep add $t005 $t004
bd dep add $t006 $t001
bd dep add $t006 $t002
bd dep add $t007 $t005
bd dep add $t008 $t001
bd dep add $t008 $t002
bd dep add $t009 $t005
bd dep add $t010 $t005
bd dep add $t011 $t005
bd dep add $t012 $t005
bd dep add $t013 $t005
bd dep add $t014 $t006
bd dep add $t014 $t007
bd dep add $t014 $t008
bd dep add $t014 $t009
bd dep add $t014 $t010
bd dep add $t014 $t011
bd dep add $t014 $t012
bd dep add $t014 $t013
bd dep add $t015 $t014
bd dep add $t016 $t015
Write-Host "  Dependencies wired." -ForegroundColor Green

Write-Host ""
bd stats
Write-Host "`n=== App-014 complete ===" -ForegroundColor Cyan
Write-Host "  Story : $storyId"
Write-Host "  Tasks : $t001 $t002 $t003 $t004 $t005 $t006 $t007 $t008 $t009 $t010 $t011 $t012 $t013 $t014 $t015 $t016"
Write-Host "  Start : bd ready" -ForegroundColor DarkGray
