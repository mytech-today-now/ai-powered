# create-fix-duration-beads.ps1
# Creates all Beads tasks for fix-duration with full descriptions from OpenSpec artifacts.
# Run from repository root:  pwsh -File .\scripts\create-fix-duration-beads.ps1
#
# Sources: openspec/changes/fix-duration/{proposal,deltas,design,implementation,tasks,summary}.md
#          openspec/changes/fix-duration/specs/*/spec.md
#          openspec/changes/fix-duration/tests/test-plan.md
#          openspec/changes/fix-duration/examples/fix-duration-examples.md
#          openspec/changes/fix-duration/fix-duration.json
#          openspec/changes/fix-duration/README.md
#
# NOTE: Uses --json flag so bd create writes JSON to the pipeline (not Write-Host),
# allowing regex to reliably capture the new issue ID from the JSON output.

. .\scripts\beads-helpers.ps1

Write-Host "`n=== Creating fix-duration Beads Tasks ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# STORY — top-level tracking issue
# ---------------------------------------------------------------------------
$story = bd create "[fix-duration] STORY: Fix Integer Duration Deserialization in Batch Video UI" `
  -Description "Bug fix | Priority: High | Estimate: 3 story points / ~4 hours | Status: draft | Labels: batch, video, duration, xai, deserialization, 422, ux, frontend | Spec authority: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2, §8 | Companion ticket: filmbuff repo (primary fix lives there). PROBLEM: The xAI Grok video API requires duration to be an integer (i32). filmbuff SceneSegmenter emits 5.800000000000001 via IEEE 754 arithmetic (14 words x 0.4 s/word). This float is passed verbatim to the xAI API producing a 422: 'invalid type: floating point 5.800000000000001, expected i32'. Shot 1 succeeds; Shot 2 stalls the entire batch. FOUR BUGS: BUG-1 (ingest) _buildItem() in shot-list-parsers.js spreads entry.duration verbatim — floats and {seconds:N} objects leak through. BUG-2 (submit) runBatch() in app.js spreads item.duration into API payload without Math.round() guard. BUG-3 (ui) Duration (s) input accepts 5.5 with no validation or button block. BUG-4 (ux) 422 duration errors surface raw PickFirst/i32 API text unintelligible to users. MODIFIED FILES: integrations/web-example/shot-list-parsers.js, integrations/web-example/app.js, tests/unit/shot-list-parsing.test.ts. DO NOT MODIFY: src/ai-powered/server/routes.ts (already correct). No new files. No new npm dependencies. No breaking changes. AC-1 through AC-6 in README.md. Source: openspec/changes/fix-duration/README.md | proposal.md | summary.md | fix-duration.json" `
  -Priority 1 -Type task --json
$storyId = [regex]::Match($story, 'bd-[a-z0-9]+').Value
Write-Host "Story: $storyId"

# ---------------------------------------------------------------------------
# PHASE 1 — FD-1: Fix _buildItem() duration coercion (shot-list-parsers.js)
# ---------------------------------------------------------------------------
$t1 = bd create "[fix-duration] T-001 FD-1.1: Replace bare entry.duration spread with coercion block in _buildItem()" `
  -Description "PHASE-1 CODE | File: integrations/web-example/shot-list-parsers.js | Location: inside _buildItem(), the line that spreads entry.duration (~line 44). BEFORE: ...(entry.duration !== undefined ? { duration: entry.duration } : {}), AFTER (three-case coercion): const raw = (typeof entry.duration === 'object' && entry.duration !== null) ? (entry.duration.seconds ?? entry.duration) : entry.duration; const coerced = (typeof raw === 'number' && !Number.isInteger(raw)) ? Math.round(raw) : raw; return { duration: coerced }; RULES per spec batch-ingest-duration-coercion/spec.md: (1) Flat float — Math.round(5.800000000000001) -> 6. (2) Object form {seconds:N} — extract .seconds then round (filmbuff JSONL exporter emits this form). (3) Integer — Number.isInteger() true -> pass through unchanged. (4) String — pass through unchanged. (5) Absent (undefined) -> no duration key on item. After this task T-002 adds the console.warn and T-003 adds the spec comment. Verification: $env:AI_MOCK='true'; npx vitest run tests/unit/shot-list-parsing.test.ts — T-DUR-01 and T-DUR-02 must pass. Source: openspec/changes/fix-duration/deltas.md §1 | implementation.md Phase 1 | specs/batch-ingest-duration-coercion/spec.md" `
  -Priority 1 -Type task --json
$t1Id = [regex]::Match($t1, 'bd-[a-z0-9]+').Value

$t2 = bd create "[fix-duration] T-002 FD-1.2: Emit console.warn when non-integer duration is rounded at ingest" `
  -Description "PHASE-1 CODE | File: integrations/web-example/shot-list-parsers.js | Location: inside the coercion block added in T-001, after coerced is computed. Add after the Math.round call: if (typeof raw === 'number' && !Number.isInteger(raw)) { console.warn('[batch-ingest] duration ' + raw + ' is not an integer; rounded to ' + coerced + '. See filmbuff/docs/specs/batch-shot-list-spec.md §2'); } RATIONALE (design.md D4): Silent coercion could hide bugs. Warning lets developers and integrators see that rounding occurred with the original value and rounded result. The warn is only emitted for non-integer numeric values — integer pass-through and string pass-through generate no warn. SCENARIO per spec: WHEN _buildItem({prompt:'test',duration:5.800000000000001},{},0) is called THEN a console.warn message is emitted containing '5.800000000000001' and '6'. Source: openspec/changes/fix-duration/deltas.md §1 | implementation.md Phase 1 | specs/batch-ingest-duration-coercion/spec.md | tasks.md FD-1.2" `
  -Priority 1 -Type task --json
$t2Id = [regex]::Match($t2, 'bd-[a-z0-9]+').Value

$t3 = bd create "[fix-duration] T-003 FD-1.3: Add spec comment above duration coercion block in _buildItem()" `
  -Description "PHASE-1 CODE | File: integrations/web-example/shot-list-parsers.js | Location: immediately above the coercion block added in T-001 (before the ...(entry.duration !== undefined ? ... line). Add comment: // spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2, §8 RULE per spec batch-ingest-duration-coercion/spec.md: 'The coercion block SHALL include the comment: // spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2, §8'. This is the final step of FD-1. After this task, run verification: $env:AI_MOCK='true'; npx vitest run tests/unit/shot-list-parsing.test.ts — T-DUR-01 and T-DUR-02 must pass with 0 failing. Source: openspec/changes/fix-duration/tasks.md FD-1.3 | deltas.md §1 | specs/batch-ingest-duration-coercion/spec.md" `
  -Priority 1 -Type task --json
$t3Id = [regex]::Match($t3, 'bd-[a-z0-9]+').Value

# ---------------------------------------------------------------------------
# PHASE 2 — FD-2: Last-line-of-defense guard in runBatch() (app.js)
# ---------------------------------------------------------------------------
$t4 = bd create "[fix-duration] T-004 FD-2.1: Add safeItems map with Math.round(item.duration) in runBatch()" `
  -Description "PHASE-2 CODE | File: integrations/web-example/app.js | Location: inside runBatch(), immediately BEFORE the 'const payload = {' block (~line 3625). ADD: const safeItems = batchItems.map(item => ({ ...item, ...(item.duration !== undefined ? { duration: Math.round(item.duration) } : {}), })); RULES per spec xai-submit-guard/spec.md: (1) safeItems is a NEW array — do NOT mutate batchItems in-place. batchItems is reused by preflight display and shot card rendering; mutating it would corrupt the displayed shot list (design.md D7). (2) Items without a duration field pass through unchanged. (3) Math.round() applied to integer values is a no-op (Math.round(8) === 8). (4) Math.round(5.800000000000001) === 6. RATIONALE (design.md D1): Defence-in-depth. Ingest layer catches file-upload floats. Submit layer catches floats from programmatically-constructed batchItems arrays or future code paths that bypass the parser. (design.md D2): Math.round() chosen over Math.floor()/Math.ceil() — rounds to nearest integer, preserving producer intent. SCENARIO: GIVEN batchItems=[{prompt:'A',duration:5.800000000000001}] WHEN runBatch() constructs payload THEN payload.items[0].duration===6 AND batchItems[0].duration===5.800000000000001 (unchanged). Source: openspec/changes/fix-duration/deltas.md §2 | implementation.md Phase 2 | specs/xai-submit-guard/spec.md | tasks.md FD-2.1" `
  -Priority 1 -Type task --json
$t4Id = [regex]::Match($t4, 'bd-[a-z0-9]+').Value

$t5 = bd create "[fix-duration] T-005 FD-2.2: Replace batchItems with safeItems as source for payload.items in runBatch()" `
  -Description "PHASE-2 CODE | File: integrations/web-example/app.js | Location: the 'const payload = {' block in runBatch() (~line 3625). BEFORE: items: batchItems.map((item) => ({ ... })) AFTER: items: safeItems.map((item) => ({ ... })) This is a one-word change (batchItems -> safeItems) in the payload construction. All other payload logic — provider, model, global batch constraints (batchAspectRatio, batchResolution, batchQuality, batchDuration, batchFps), per-shot overrides (item.aspectRatio, item.resolution, item.quality, item.duration, item.fps, item.width, item.height, item.images) — remains IDENTICAL. CRITICAL: The fetch() call body itself does not change. The safeItems variable (created in T-004) flows through the payload.items map so that the submitted JSON always contains integer durations. RULE: per spec xai-submit-guard/spec.md 'payload.items SHALL iterate over safeItems, not over batchItems'. Source: openspec/changes/fix-duration/deltas.md §2 | implementation.md Phase 2 | specs/xai-submit-guard/spec.md | tasks.md FD-2.2" `
  -Priority 1 -Type task --json
$t5Id = [regex]::Match($t5, 'bd-[a-z0-9]+').Value

$t6 = bd create "[fix-duration] T-006 FD-2.3: Add spec comment above safeItems block in runBatch()" `
  -Description "PHASE-2 CODE | File: integrations/web-example/app.js | Location: immediately above the safeItems const added in T-004. Add TWO comments: (1) Above the safeItems block: // Last-line-of-defense guard — spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2 (2) Inline after Math.round(item.duration): // spec: batch-shot-list-spec.md v1.0.0 §2 RULE per spec xai-submit-guard/spec.md: 'The safeItems construction block SHALL include the comment: // Last-line-of-defense guard — spec: filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2 AND each Math.round application SHALL be commented: // spec: batch-shot-list-spec.md v1.0.0 §2'. This is the final step of FD-2. After this task, run: $env:AI_MOCK='true'; npx vitest run tests/unit/ — all tests pass. Source: openspec/changes/fix-duration/tasks.md FD-2.3 | deltas.md §2 | specs/xai-submit-guard/spec.md" `
  -Priority 1 -Type task --json
$t6Id = [regex]::Match($t6, 'bd-[a-z0-9]+').Value

# ---------------------------------------------------------------------------
# PHASE 3 — FD-3: Duration (s) UI validation (app.js)
# ---------------------------------------------------------------------------
$t7 = bd create "[fix-duration] T-007 FD-3.1: Add DURATION_PATTERN constant at module scope in app.js" `
  -Description "PHASE-3 CODE | File: integrations/web-example/app.js | Location: at module scope, in the section where batch-related helper functions are defined, before the validateDuration function (T-008). ADD: const DURATION_PATTERN = /^[1-9][0-9]*$/; RATIONALE (design.md D5): Regex /^[1-9][0-9]*$/ rejects floats (5.5 fails — contains '.'), negative numbers, zero ('0' fails — no leading digit in [1-9]), empty string, and non-numeric text. Only positive integers pass. The regex is defined at module scope for reuse and testability. RULE per spec duration-ui-validation/spec.md: 'reject strings that do not match /^[1-9][0-9]*$/ (i.e., non-integer strings including floats, negative numbers, zero, empty string, and non-numeric text)'. Source: openspec/changes/fix-duration/deltas.md §3 | implementation.md Phase 3 Step 3.1 | specs/duration-ui-validation/spec.md | tasks.md FD-3.1" `
  -Priority 1 -Type task --json
$t7Id = [regex]::Match($t7, 'bd-[a-z0-9]+').Value

$t8 = bd create "[fix-duration] T-008 FD-3.2: Add validateDuration() function to app.js" `
  -Description "PHASE-3 CODE | File: integrations/web-example/app.js | Location: immediately after DURATION_PATTERN constant (T-007). ADD function: function validateDuration(value) { const trimmed = (value || '').trim(); if (!DURATION_PATTERN.test(trimmed)) { return 'Duration must be a whole number (e.g., 5)'; } const n = parseInt(trimmed, 10); if (n < 3 || n > 60) { return 'Duration must be between 3 and 60 seconds'; } return null; } RULES per spec duration-ui-validation/spec.md: (1) Non-integer strings (float '5.5', 'abc', '0', '-1', '') -> 'Duration must be a whole number (e.g., 5)'. (2) Integer strings outside [3,60] range ('2'->'Duration must be between 3 and 60 seconds', '61'->same). (3) Valid positive integer in [3,60] -> null. (4) Boundary values '3' and '60' -> null. RANGE [3,60] matches filmbuff/docs/specs/batch-shot-list-spec.md v1.0.0 §2. This is a pure function — no DOM side effects. The function must be exported or accessible for T-DUR-04 unit test. Source: openspec/changes/fix-duration/deltas.md §3 | implementation.md Phase 3 Step 3.1 | specs/duration-ui-validation/spec.md | tasks.md FD-3.2 | tests/test-plan.md T-DUR-04" `
  -Priority 1 -Type task --json
$t8Id = [regex]::Match($t8, 'bd-[a-z0-9]+').Value

$t9 = bd create "[fix-duration] T-009 FD-3.3: Inject error hint span below batch-duration input in app.js" `
  -Description "PHASE-3 CODE | File: integrations/web-example/app.js | Location: after the batchDurationEl DOM reference is established. ADD: const batchDurationHint = document.createElement('span'); batchDurationHint.className = 'field-error-hint'; batchDurationHint.style.cssText = 'color:var(--danger);font-size:0.85em;display:block;min-height:1.2em'; batchDurationEl.parentNode.insertBefore(batchDurationHint, batchDurationEl.nextSibling); RULE per spec duration-ui-validation/spec.md: 'the error message SHALL be displayed inline immediately below the batch-duration input in a dedicated span element'. Also add: let batchDurationError = null; (state variable used by applyDurationValidation in T-010). The min-height:1.2em on the span prevents layout reflow when the error appears/disappears. The span uses CSS variable --danger for theming consistency. Source: openspec/changes/fix-duration/deltas.md §3 | implementation.md Phase 3 Step 3.2 | specs/duration-ui-validation/spec.md | tasks.md FD-3.3" `
  -Priority 1 -Type task --json
$t9Id = [regex]::Match($t9, 'bd-[a-z0-9]+').Value

$t10 = bd create "[fix-duration] T-010 FD-3.4: Add change and blur event listeners on batchDurationEl" `
  -Description "PHASE-3 CODE | File: integrations/web-example/app.js | Location: after the batchDurationHint span is inserted (T-009). ADD: function applyDurationValidation() { batchDurationError = batchDurationEl.value ? validateDuration(batchDurationEl.value) : null; batchDurationHint.textContent = batchDurationError || ''; if (btnBatchSubmit) btnBatchSubmit.disabled = batchDurationError !== null; } batchDurationEl.addEventListener('change', applyDurationValidation); batchDurationEl.addEventListener('blur', applyDurationValidation); RULES per spec duration-ui-validation/spec.md: (1) Fires on BOTH change and blur events. (2) Empty field (no value) -> batchDurationError = null -> no error, Submit enabled. Validation only fires for non-empty values. (3) Error message set on batchDurationHint.textContent. (4) Submit button disabled while batchDurationError !== null. (5) Submit re-enabled when validation error is cleared. SCENARIO: batchDurationEl.value='5.5' -> change fires -> error hint text='Duration must be a whole number (e.g., 5)' AND btnBatchSubmit.disabled===true. Then value='6' -> change fires -> error hint text='' AND btnBatchSubmit.disabled===false. Source: openspec/changes/fix-duration/deltas.md §3 | implementation.md Phase 3 Step 3.2 | specs/duration-ui-validation/spec.md | tasks.md FD-3.4" `
  -Priority 1 -Type task --json
$t10Id = [regex]::Match($t10, 'bd-[a-z0-9]+').Value

$t11 = bd create "[fix-duration] T-011 FD-3.5: Verify btnBatchSubmit is disabled while batchDurationError is non-null" `
  -Description "PHASE-3 VERIFY | File: integrations/web-example/app.js | This task confirms that the btnBatchSubmit.disabled assignment in applyDurationValidation (added in T-010) correctly guards the Submit Batch button. CHECKLIST: (1) Open the web demo in browser. (2) Enter '5.5' in Duration (s) field -> tab away or change -> error message appears: 'Duration must be a whole number (e.g., 5)' -> Submit Batch button is visually disabled. (3) Enter '2' -> error: 'Duration must be between 3 and 60 seconds' -> Submit disabled. (4) Enter '6' -> error clears -> Submit re-enables. (5) Clear the field entirely -> no error shown -> Submit enabled. RULE per spec duration-ui-validation/spec.md: 'The Submit Batch button (btnBatchSubmit) SHALL be disabled while batchDurationError !== null. The button SHALL be re-enabled when the validation error is cleared.' Also confirm the guard uses 'if (btnBatchSubmit)' null-check to avoid TypeError if the button is absent in certain UI states. Source: openspec/changes/fix-duration/tasks.md FD-3.5 | specs/duration-ui-validation/spec.md (AC: Scenario Float 5.5 entered) | examples/fix-duration-examples.md Example 4" `
  -Priority 1 -Type task --json
$t11Id = [regex]::Match($t11, 'bd-[a-z0-9]+').Value

# ---------------------------------------------------------------------------
# PHASE 4 — FD-4: 422 duration error messaging (app.js)
# ---------------------------------------------------------------------------
$t12 = bd create "[fix-duration] T-012 FD-4.1: Add formatVideoApiError() function to app.js" `
  -Description "PHASE-4 CODE | File: integrations/web-example/app.js | Location: add before runBatch() (or near other batch helper functions). ADD: function formatVideoApiError(errorBody, shotIndex) { const isDurationTypeError = (errorBody.includes('expected i32') || errorBody.includes('expected a string')) && errorBody.includes('duration'); if (isDurationTypeError) { const match = errorBody.match(/floating point \`([^\`]+)\`/); const badValue = match ? match[1] : 'unknown'; return 'Shot ' + (shotIndex + 1) + ' failed: Duration must be a whole number of seconds. The value \"' + badValue + '\" is not a valid integer. Re-generate the shot list with a corrected duration, or manually edit the shot-list file to use an integer value.'; } return errorBody; } RULES per spec duration-error-messaging/spec.md: (1) BOTH conditions must match: ('expected i32' OR 'expected a string') AND 'duration' in errorBody. Fingerprint matching avoids false positives on other 422 causes (design.md D6). (2) Extract bad float from /floating point `([^`]+)`/ regex; fallback to 'unknown' if no match. (3) shotIndex is 0-based; display shotIndex+1 (1-based). (4) Pure function — no DOM side effects. Non-duration errors returned UNCHANGED. SCENARIO: errorBody contains 'floating point `5.800000000000001`, expected i32' AND 'duration' -> result='Shot 2 failed: Duration must be a whole number of seconds. The value \"5.800000000000001\" is not a valid integer. ...' Source: openspec/changes/fix-duration/deltas.md §4 | implementation.md Phase 4 Step 4.1 | specs/duration-error-messaging/spec.md | tasks.md FD-4.1 | examples/fix-duration-examples.md Example 5" `
  -Priority 2 -Type task --json
$t12Id = [regex]::Match($t12, 'bd-[a-z0-9]+').Value

$t13 = bd create "[fix-duration] T-013 FD-4.2: Apply formatVideoApiError() in batch submit catch block" `
  -Description "PHASE-4 CODE | File: integrations/web-example/app.js | Location: the catch block that handles errors from the batch submit fetch() call in runBatch(). BEFORE: } catch (err) { batchProgressLabel.textContent = 'Error: ' + (err.message || err); AFTER: } catch (err) { const rawMsg = err.message || String(err); const friendlyMsg = formatVideoApiError(rawMsg, /* shotIndex */ 0); batchProgressLabel.textContent = 'Error: ' + friendlyMsg; RULE per spec duration-error-messaging/spec.md: 'formatVideoApiError() SHALL be called in the catch block that handles batch submit fetch() errors. The return value SHALL replace the raw err.message in the error display shown to the user.' SHOTINDEX: Pass the shot index of the shot being processed when the error occurred, or 0 if index cannot be determined (e.g., HTTP-level errors before per-shot streaming begins). If the catch block has access to a running shot index, use it; otherwise default to 0. EXAMPLE (before/after from examples/fix-duration-examples.md Example 5): BEFORE: raw PickFirst/i32 API text shown to user. AFTER: 'Shot 1 failed: Duration must be a whole number of seconds. The value \"5.800000000000001\" is not a valid integer...' Source: openspec/changes/fix-duration/deltas.md §4 | implementation.md Phase 4 Step 4.2 | specs/duration-error-messaging/spec.md | tasks.md FD-4.2" `
  -Priority 2 -Type task --json
$t13Id = [regex]::Match($t13, 'bd-[a-z0-9]+').Value

# ---------------------------------------------------------------------------
# PHASE 5 — FD-5: Unit tests T-DUR-01 through T-DUR-04
# ---------------------------------------------------------------------------
$t14 = bd create "[fix-duration] T-014 FD-5.1: Add T-DUR-01 — _buildItem() rounds 5.800000000000001 to 6 on ingest" `
  -Description "PHASE-5 TEST | File: tests/unit/shot-list-parsing.test.ts | Add test: it('T-DUR-01: _buildItem() rounds float duration to nearest integer on ingest', () => { const entry = { prompt: 'Dialogue scene', duration: 5.800000000000001 }; const item = _buildItem(entry, {}, 0); expect(item).not.toBeNull(); expect(Number.isInteger(item!.duration)).toBe(true); expect(item!.duration).toBe(6); }); COVERS: BUG-1 fix — flat float duration coercion; spec §2 integer requirement. This is the primary regression test for T-001 (FD-1.1 coercion block). The value 5.800000000000001 is the exact IEEE 754 float produced by filmbuff SceneSegmenter (14 words x 0.4 s/word). Math.round(5.800000000000001) === 6. PREREQUISITE: _buildItem must be importable from shot-list-parsers.js into the test file. Verification: $env:AI_MOCK='true'; npx vitest run tests/unit/shot-list-parsing.test.ts — T-DUR-01 passing, 0 failing. Source: openspec/changes/fix-duration/tests/test-plan.md T-DUR-01 | tasks.md FD-5.1 | specs/batch-ingest-duration-coercion/spec.md" `
  -Priority 2 -Type task --json
$t14Id = [regex]::Match($t14, 'bd-[a-z0-9]+').Value

$t15 = bd create "[fix-duration] T-015 FD-5.2: Add T-DUR-02 — _buildItem() passes integer 8 through unchanged" `
  -Description "PHASE-5 TEST | File: tests/unit/shot-list-parsing.test.ts | Add test: it('T-DUR-02: _buildItem() passes integer duration through unchanged', () => { const entry = { prompt: 'Action scene', duration: 8 }; const item = _buildItem(entry, {}, 0); expect(item).not.toBeNull(); expect(item!.duration).toBe(8); expect(Number.isInteger(item!.duration)).toBe(true); }); COVERS: BUG-1 fix regression — no regression on integer durations. Design decision D2 (integer pass-through). Number.isInteger(8) === true -> no rounding applied -> item.duration === 8 exactly. This test is a no-regression guard: integer durations must NOT be altered by the coercion block. Verification: $env:AI_MOCK='true'; npx vitest run tests/unit/shot-list-parsing.test.ts — T-DUR-01 and T-DUR-02 both passing. Source: openspec/changes/fix-duration/tests/test-plan.md T-DUR-02 | tasks.md FD-5.2 | specs/batch-ingest-duration-coercion/spec.md" `
  -Priority 2 -Type task --json
$t15Id = [regex]::Match($t15, 'bd-[a-z0-9]+').Value

$t16 = bd create "[fix-duration] T-016 FD-5.3: Add T-DUR-03 — toSafeItems() coerces float to integer before API call" `
  -Description "PHASE-5 TEST | File: tests/unit/shot-list-parsing.test.ts | Add test: it('T-DUR-03: toSafeItems() coerces float duration to integer before API call', () => { const items = [{ name:'Shot 1',prompt:'Test A',modality:'video',duration:5.800000000000001 },{ name:'Shot 2',prompt:'Test B',modality:'video',duration:8 }]; const safe = toSafeItems(items); expect(Number.isInteger(safe[0].duration)).toBe(true); expect(safe[0].duration).toBe(6); expect(safe[1].duration).toBe(8); expect(items[0].duration).toBe(5.800000000000001); }); COVERS: BUG-2 fix — safeItems last-line-of-defense guard; design D7 (no mutation of original array). NOTE per test-plan.md: If runBatch() is not independently importable, extract the safeItems map logic into a pure helper function toSafeItems(items) and export it for testing. Alternatively, test via a mock fetch that captures the POST body. The original items[0].duration must remain 5.800000000000001 (no in-place mutation). Verification: $env:AI_MOCK='true'; npx vitest run tests/unit/shot-list-parsing.test.ts — T-DUR-01 through T-DUR-03 passing. Source: openspec/changes/fix-duration/tests/test-plan.md T-DUR-03 | tasks.md FD-5.3 | specs/xai-submit-guard/spec.md" `
  -Priority 2 -Type task --json
$t16Id = [regex]::Match($t16, 'bd-[a-z0-9]+').Value

$t17 = bd create "[fix-duration] T-017 FD-5.4: Add T-DUR-04 — validateDuration('5.5') returns expected error string" `
  -Description "PHASE-5 TEST | File: tests/unit/shot-list-parsing.test.ts | Add test: it('T-DUR-04: validateDuration rejects float input with inline error message', () => { expect(validateDuration('5.5')).toBe('Duration must be a whole number (e.g., 5)'); expect(validateDuration('0')).toBe('Duration must be a whole number (e.g., 5)'); expect(validateDuration('abc')).toBe('Duration must be a whole number (e.g., 5)'); expect(validateDuration('2')).toBe('Duration must be between 3 and 60 seconds'); expect(validateDuration('61')).toBe('Duration must be between 3 and 60 seconds'); expect(validateDuration('5')).toBeNull(); expect(validateDuration('3')).toBeNull(); expect(validateDuration('60')).toBeNull(); }); COVERS: BUG-3 fix — UI validation; AC-2; design D5 (range [3,60]). NOTE per test-plan.md: validateDuration() must be exported from app.js or extracted into a testable module to be directly importable in Vitest. If exporting from app.js is not feasible, test via a DOM simulation using jsdom or extract the validator into a separate utility module. All 8 assertions in the test body must pass. Verification: $env:AI_MOCK='true'; npx vitest run tests/unit/shot-list-parsing.test.ts — T-DUR-01 through T-DUR-04 ALL passing, 0 failing (AC-6). Source: openspec/changes/fix-duration/tests/test-plan.md T-DUR-04 | tasks.md FD-5.4 | specs/duration-ui-validation/spec.md" `
  -Priority 2 -Type task --json
$t17Id = [regex]::Match($t17, 'bd-[a-z0-9]+').Value

# ---------------------------------------------------------------------------
# PHASE 6 — FD-6: Full regression + build verification
# ---------------------------------------------------------------------------
$t18 = bd create "[fix-duration] T-018 FD-6.1: Run full test suite — existing count + 4 new passing, 0 failing" `
  -Description "PHASE-6 VERIFY | Command: $env:AI_MOCK='true'; npm test | Expected: all pre-existing tests pass PLUS 4 new tests (T-DUR-01 through T-DUR-04) passing, 0 failing. This is AC-5 (all existing tests pass) and AC-6 (T-DUR-01 through T-DUR-04 all pass) from the acceptance criteria. KEY RISK AREAS: (1) Any test that imports _buildItem() from shot-list-parsers.js — must now receive coerced integer durations for float inputs. (2) Any test that exercises runBatch() or the payload construction — safeItems replaces batchItems as the map source. (3) Any test that exercises the batch-duration input — applyDurationValidation now fires on change/blur. If recommended tests T-DUR-05 (object-form duration) and T-DUR-06 (formatVideoApiError) were added, the count will be existing + 6. SUMMARY: Total delta across all 3 files: ~109 lines added/changed (shot-list-parsers.js +14, app.js +55, test.ts +40). Zero new production files. Zero new npm dependencies. Source: openspec/changes/fix-duration/tasks.md FD-6.1 | summary.md | fix-duration.json acceptanceCriteria AC-5 AC-6" `
  -Priority 2 -Type task --json
$t18Id = [regex]::Match($t18, 'bd-[a-z0-9]+').Value

$t19 = bd create "[fix-duration] T-019 FD-6.2: TypeScript compile check — expected 0 errors" `
  -Description "PHASE-6 VERIFY | Command: npx tsc --noEmit | Expected: 0 TypeScript errors. The three modified files are JavaScript (.js) but the test file tests/unit/shot-list-parsing.test.ts is TypeScript. New type assertions (item!.duration) and potential _buildItem / toSafeItems / validateDuration import types must be clean. ALSO CHECK: src/ai-powered/server/routes.ts — DO NOT MODIFY this file (already correct per proposal.md and fix-duration.json doNotModify list). Confirm no TypeScript errors were introduced in any other file. This is a gating check — if tsc reports errors, resolve them before proceeding to T-020. Source: openspec/changes/fix-duration/tasks.md FD-6.2 | summary.md (Verification section) | proposal.md (Impact section)" `
  -Priority 2 -Type task --json
$t19Id = [regex]::Match($t19, 'bd-[a-z0-9]+').Value

$t20 = bd create "[fix-duration] T-020 FD-6.3: Build check — npm run build exits 0" `
  -Description "PHASE-6 VERIFY | Command: npm run build | Expected: exits 0 with no errors. Confirms that the production build (bundling integrations/web-example/app.js and shot-list-parsers.js) succeeds with the new functions (validateDuration, formatVideoApiError, safeItems logic). No new npm dependencies were added (fix-duration.json: newFiles: [], breakingChanges: false). Build must complete cleanly. If build fails, check: (1) DURATION_PATTERN regex syntax compatibility with the bundler. (2) Any module export changes to validateDuration or toSafeItems that may affect tree-shaking. Source: openspec/changes/fix-duration/tasks.md FD-6.3 | summary.md (Verification section) | fix-duration.json" `
  -Priority 3 -Type task --json
$t20Id = [regex]::Match($t20, 'bd-[a-z0-9]+').Value

$t21 = bd create "[fix-duration] T-021 FD-6.4: Manual verification in Chrome and Firefox per AC-1 through AC-6" `
  -Description "PHASE-6 VERIFY | Manual browser test in both Chrome and Firefox. CHECKLIST per tasks.md FD-6.4 and acceptance criteria: AC-1: Upload a .jsonl file with 'duration': 5.800000000000001 -> batch completes WITHOUT 422 error; value rounded to 6 in the API call (check Network tab: payload.items[n].duration === 6). AC-2: Type '5.5' in Duration (s) field -> blur/change -> error hint appears: 'Duration must be a whole number (e.g., 5)' -> Submit Batch button disabled. AC-3: If a 422 duration error occurs (simulate by temporarily bypassing guards), the user sees the formatVideoApiError() message NOT the raw PickFirst/i32 API text. AC-4: Upload a shot list where Shot 1 has integer duration 5 -> Shot 1 succeeds (no regression from FD-1.1 integer pass-through). AC-5: Run full automated test suite first ($env:AI_MOCK='true'; npm test) — all pass. AC-6: T-DUR-01 through T-DUR-04 all pass in the test suite run above. ALSO TEST: Example scenarios from examples/fix-duration-examples.md Examples 1-7 (JSONL float, object-form, JSON array, UI validation, 422 error, console.warn, safeItems guard). Source: openspec/changes/fix-duration/tasks.md FD-6.4 | README.md Acceptance Criteria | examples/fix-duration-examples.md" `
  -Priority 3 -Type task --json
$t21Id = [regex]::Match($t21, 'bd-[a-z0-9]+').Value

# ---------------------------------------------------------------------------
# DEPENDENCIES
# ---------------------------------------------------------------------------
Write-Host "`n=== Setting up dependencies ===" -ForegroundColor Cyan

# PHASE 1 internal chain: T-002 and T-003 both require the coercion block from T-001
bd dep add $t2Id $t1Id   # T-002 (warn) blocked by T-001 (coercion block must exist first)
bd dep add $t3Id $t1Id   # T-003 (comment) blocked by T-001 (comment goes above coercion block)

# PHASE 2 internal chain: T-005 and T-006 require safeItems from T-004
bd dep add $t5Id $t4Id   # T-005 (payload swap) blocked by T-004 (safeItems must be created)
bd dep add $t6Id $t4Id   # T-006 (comment) blocked by T-004 (comment goes above safeItems)

# PHASE 3 internal chain: sequential — each step builds on the previous
bd dep add $t8Id $t7Id   # T-008 (validateDuration fn) blocked by T-007 (DURATION_PATTERN constant)
bd dep add $t9Id $t8Id   # T-009 (hint span) blocked by T-008 (applyDurationValidation uses fn)
bd dep add $t10Id $t9Id  # T-010 (event listeners) blocked by T-009 (listeners use hint span)
bd dep add $t11Id $t10Id # T-011 (verify disable) blocked by T-010 (applyDurationValidation wired)

# PHASE 4 internal chain: T-013 requires formatVideoApiError from T-012
bd dep add $t13Id $t12Id # T-013 (apply in catch) blocked by T-012 (function must exist)

# PHASE 5 tests blocked by the code they test:
# T-DUR-01 and T-DUR-02 test _buildItem() -> need FD-1 complete (T-003 is last FD-1 step)
bd dep add $t14Id $t3Id  # T-014 (T-DUR-01) blocked by T-003 (FD-1 complete)
bd dep add $t15Id $t3Id  # T-015 (T-DUR-02) blocked by T-003 (FD-1 complete)
# T-DUR-03 tests safeItems/toSafeItems -> need FD-2 complete (T-006 is last FD-2 step)
bd dep add $t16Id $t6Id  # T-016 (T-DUR-03) blocked by T-006 (FD-2 complete)
# T-DUR-04 tests validateDuration -> need FD-3 wired (T-011 is last FD-3 step)
bd dep add $t17Id $t11Id # T-017 (T-DUR-04) blocked by T-011 (FD-3 complete)

# PHASE 6 verification blocked by all implementation and tests complete
# Full test suite blocked by all 4 unit tests added and formatVideoApiError applied
bd dep add $t18Id $t14Id # T-018 (npm test) blocked by T-014 (T-DUR-01 added)
bd dep add $t18Id $t15Id # T-018 (npm test) blocked by T-015 (T-DUR-02 added)
bd dep add $t18Id $t16Id # T-018 (npm test) blocked by T-016 (T-DUR-03 added)
bd dep add $t18Id $t17Id # T-018 (npm test) blocked by T-017 (T-DUR-04 added)
bd dep add $t18Id $t13Id # T-018 (npm test) blocked by T-013 (FD-4 complete — formatVideoApiError applied)

# TS check and build blocked by full test suite pass
bd dep add $t19Id $t18Id # T-019 (tsc) blocked by T-018 (tests must pass first)
bd dep add $t20Id $t18Id # T-020 (build) blocked by T-018 (tests must pass first)

# Manual verification blocked by both TS check and build
bd dep add $t21Id $t19Id # T-021 (manual) blocked by T-019 (TS clean)
bd dep add $t21Id $t20Id # T-021 (manual) blocked by T-020 (build clean)

# ---------------------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------------------
Write-Host "`n=== fix-duration Tasks Created ===" -ForegroundColor Green
Write-Host "Story:  $storyId"
Write-Host "FD-1 (Ingest coercion, shot-list-parsers.js):"
Write-Host "  T-001: $t1Id  T-002: $t2Id  T-003: $t3Id"
Write-Host "FD-2 (safeItems guard, app.js):"
Write-Host "  T-004: $t4Id  T-005: $t5Id  T-006: $t6Id"
Write-Host "FD-3 (UI validation, app.js):"
Write-Host "  T-007: $t7Id  T-008: $t8Id  T-009: $t9Id  T-010: $t10Id  T-011: $t11Id"
Write-Host "FD-4 (422 error messaging, app.js):"
Write-Host "  T-012: $t12Id  T-013: $t13Id"
Write-Host "FD-5 (Unit tests, shot-list-parsing.test.ts):"
Write-Host "  T-014: $t14Id  T-015: $t15Id  T-016: $t16Id  T-017: $t17Id"
Write-Host "FD-6 (Verification):"
Write-Host "  T-018: $t18Id  T-019: $t19Id  T-020: $t20Id  T-021: $t21Id"
Write-Host ""
Write-Host "Run 'bd ready' to see the first unblocked tasks." -ForegroundColor Yellow

bd stats

