Using Augmentcode AI (with Augment-extensions) in VS Code:
- Load bead tasks using 'scripts\beads-helpers.ps1' (dot-sourceit to get the 'bd' alias: . .\scripts\beads-helpers.ps1) or call 'scripts\beads-query.ps1' directly
- Check task completion status with "bd list --status open" or "bd ready " â€” skip any task whose status is not open/in-progress
- For each remaining task in this batch:
    - Claim the task before starting: "bd update <id> --claim"
    - Generate production-quality code that fully satisfies the bead task requirements
    - Follow professional coding standards at all times
    - Do not use stubs, placeholders, or incomplete implementations
    - Do not hallucinate or make up functionality
    - Never reuse the same code pattern for multiple distinct tasks
    - Address every TODO in the relevant files:
        â€¢ If a TODO is relevant, implement the required change
        â€¢ If a TODO is not relevant, explicitly document why it can be ignored
    - Do not proceed until all TODOs are explicitly resolved or justified
(batch 3):
[ bd-k842 ] [ open ] [ P1 ] [ [correct-video] Enforce Frame-Accurate Shot Duration in Programmatic and Batch Video Generation ] [ correct-batch-programmatic-video (refactor, critical, 13 SP, ~26 h, 15 tasks). Epic: AI-VIDEO-CORE. JIRA: AI-VIDEO: Enforce Frame-Accurate Shot Duration in Programmatic and Batch Video Generation. DEFECTS FIXED: (1) AI Pacing Engine Override -- engine silently extends duration without logging. (2) Frame-Boundary Rounding Ceiling -- Math.ceil() on every inline frame-count derivation always adds frames on fractional boundaries. (3) Batch Parser Silent Fallback -- missing/blank duration silently replaced with project default. WHAT CHANGES: Introduce canonical durationToFrames(seconds, fps) -- Math.round() only, WARN on drift > 0.001 frames. Gate AI pacing engine to fire only for null/undefined/'auto' durations. Batch parser strict mode: missing duration = hard error + zero clips unless allowAutoduration: true. Three duration notations: decimal seconds, HH:MM:SS.mmm, Nf@fps. Pre-render render-queue-validator: rejects entire job if any shot frame-count mismatches by > 1 frame. ESLint rule no-inline-frame-arithmetic blocks * frameRate / * fps outside durationToFrames.ts. BREAKING: batch files with missing durations previously rendered silently; now hard error. Spec: openspec/changes/correct-batch-programmatic-video/. ACs: AC-1 programmatic API matrix 9 durations x 24+30 fps; AC-2 batch CSV 20 shots; AC-3 missing duration hard error zero clips; AC-4 AI pacing bypass (0.1s shot); AC-5 no regressions; AC-6 ESLint rule active in CI. ] [ dependencies: none ] [ blockers: none ] [ blocking: none ]
[ bd-7axx ] [ open ] [ P1 ] [ [correct-video] TASK-15: Integration tests, full build, smoke tests, and release notes ] [ PHASE 5 -- INTEGRATION TESTS, FULL BUILD, SMOKE TESTS, RELEASE NOTES. FILE: tests/integration/programmatic-frame-accuracy.test.ts (NEW). Spec: tests/test-plan.md Integration Tests + Manual Smoke Tests; tasks.md TASK-15; summary.md AC table. INTEGRATION TESTS: T-INT-01..T-INT-05: submit shots at 24fps and 30fps via mock render pipeline; assert rendered frame counts match AC-1 table exactly. T-INT-06 (AC-4): POST {duration:0.1} at 30fps -> Math.round(0.1*30)=3 frames; AI pacing engine not called; no other component alters it. T-INT-07 (AC-5): ='true'; npm test -- all existing tests (scene composition, audio mixing, export, auth, asset management) pass without modification. BUILD: npm run build -- zero TypeScript errors (tsc --noEmit). TEST: ='true'; npm test -- all existing + new tests pass. LINT: npm run lint -- zero lint errors including no-inline-frame-arithmetic rule (AC-6). SMOKE TESTS: S-01 single-shot 4.5s=135 frames no AI log; S-02 batch CSV scene-02 drift warn; S-03 B-3 CSV error clip-02 identified; S-04 0.25s@30=8 frames; S-05 'auto' AI engine activated; S-06 B-2 JSON promo-01+promo-03=96 frames; S-07 ESLint blocks new inline arithmetic; S-08 full regression. RELEASE NOTES: draft breaking-change entry: batch files with missing duration fields previously rendered silently; now produce hard error + zero clips unless allowAutoduration:true. DEPENDS ON: TASK-11, TASK-12, TASK-13, TASK-14. ] [ dependencies: bd-vpdd, bd-ki0z, bd-4dux, bd-nkng ] [ blockers: bd-vpdd, bd-ki0z, bd-4dux, bd-nkng ] [ blocking: none ]
After completing the tasks above:
- Mark the processed bead task(s) as closed in 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl'.  Do NOT delete the bead task from 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl' â€” only mark it as closed.
- Also record completion in 'G:\_kyle\temp_documents\GitHub\ai-powered\completed.jsonl'

---

Using Augmentcode AI (with Augment-extensions) in VS Code:
- Load bead tasks using 'scripts\beads-helpers.ps1' (dot-sourceit to get the 'bd' alias: . .\scripts\beads-helpers.ps1) or call 'scripts\beads-query.ps1' directly
- Check task completion status with "bd list --status open" or "bd ready " â€” skip any task whose status is not open/in-progress
- For each remaining task in this batch:
    - Claim the task before starting: "bd update <id> --claim"
    - Generate production-quality code that fully satisfies the bead task requirements
    - Follow professional coding standards at all times
    - Do not use stubs, placeholders, or incomplete implementations
    - Do not hallucinate or make up functionality
    - Never reuse the same code pattern for multiple distinct tasks
    - Address every TODO in the relevant files:
        â€¢ If a TODO is relevant, implement the required change
        â€¢ If a TODO is not relevant, explicitly document why it can be ignored
    - Do not proceed until all TODOs are explicitly resolved or justified
(batch 4):
[ bd-9wnu ] [ open ] [ P1 ] [ [correct-video] TASK-08: Implement validateRenderJob() in render-queue/assembler.ts ] [ PHASE 3 -- RENDER QUEUE VALIDATOR. FILE: src/ai-powered/render-queue/assembler.ts (MODIFY). Spec: specs/render-queue-validator/spec.md; implementation.md Â§5; deltas.md ADDED render-queue-validator; design.md architecture diagram; tasks.md TASK-08. IMPLEMENT validateRenderJob(job: RenderJob): void. CHECKS: (1) every shot has Number.isInteger(frameCount) && frameCount >= 1; (2) for shots with durationSource=='explicit': Math.abs(shot.frameCount - durationToFrames(shot.durationSeconds, job.frameRate)) <= 1; (3) no shot has frameCount == 0; (4) if job.totalDuration set: Math.abs(sum(frameCounts) - Math.round(totalDuration * fps)) <= 1. ATOMICITY: collect ALL failing shots before throwing -- single exhaustive error listing every failure: [ERROR] Pre-render validation failed for job ID: - shot 'shotId': expected N frames, computed M frames. Delta: +/-D frames. Job rejected. Fix the pipeline configuration and resubmit. EXCEPTION: if any downstream component modifies a resolved frameCount post-validation throw [FATAL]. IMPORT durationToFrames. TESTS: T-RQV-01..T-RQV-05. DEPENDS ON: TASK-01, TASK-02, TASK-03, TASK-04. ] [ dependencies: bd-59yi, bd-gvew, bd-wsp5, bd-e2bz ] [ blockers: bd-59yi, bd-gvew, bd-wsp5, bd-e2bz ] [ blocking: bd-ptde, bd-nkng ]
[ bd-gvew ] [ open ] [ P1 ] [ [correct-video] TASK-02: Add AI pacing engine duration guard to shot scheduler ] [ PHASE 1 -- SHOT SCHEDULER AI PACING ENGINE GATE. FILE: src/ai-powered/shot-scheduler/index.ts (MODIFY). Spec: specs/shot-scheduler/spec.md REQ-SS-02; implementation.md Â§2; design.md D3; deltas.md MODIFIED shot-scheduler. Add isExplicitDuration(value) guard at scheduler entry point BEFORE delegating to AI pacing engine. CLASSIFICATION TABLE (REQ-SS-02): numeric value -> skip engine; decimal string '3.5' -> skip engine; timecode '00:00:04.500' -> skip engine; frame notation '96f@24' -> skip engine; 'auto' string -> invoke engine; null/undefined + allowAutoduration:true -> invoke engine; null/undefined + allowAutoduration:false -> throw [ERROR]. BEHAVIOUR: if explicit -> parseDuration() then durationToFrames() then return {frameCount, durationSource:'explicit'}. If auto/null + allowAutoduration -> aiPacingEngine.assign() then durationToFrames(). If null/undefined + !allowAutoduration -> throw error: [ERROR] Shot 'shotId' has no explicit duration and allowAutoduration is false. Add inline comment referencing REQ-SS-02 classification table in spec.md. TESTS: T-SS-01 through T-SS-08 (tests/unit/shot-scheduler.test.ts). DEPENDS ON: TASK-01. ] [ dependencies: bd-59yi ] [ blockers: bd-59yi ] [ blocking: bd-9wnu, bd-wsp5 ]
[ bd-i3au ] [ open ] [ P1 ] [ [correct-video] TASK-05: Implement hard error for missing duration in batch parser ] [ PHASE 2 -- BATCH PARSER HARD ERROR FOR MISSING DURATION. FILE: src/ai-powered/batch-parser/index.ts (MODIFY). Spec: specs/batch-file-parser/spec.md; implementation.md Â§4; design.md D4; deltas.md MODIFIED batch-file-parser; tasks.md TASK-05. IMPLEMENT validateBatchDurations(shots, allowAutoduration): if allowAutoduration is true return immediately (shots routed to AI engine). Otherwise collect all shots where duration is null/undefined/empty. If any found throw error: [ERROR] Batch parse failed: shot(s) 'id1', 'id2' have no explicit duration and allowAutoduration is false. Set duration_seconds for each shot, or add allowAutoduration: true at the batch level. Batch rejected. 0 shots rendered. ATOMICITY: halt immediately; return empty result set; zero clips rendered; no partial output files. Call validateBatchDurations() after all shots parsed, before any pipeline call. TEST: T-BFP-03 (B-3 CSV, clip-02 blank, no allowAutoduration -> error with clip-02 listed). AC-3 satisfied. DEPENDS ON: TASK-01. ] [ dependencies: bd-59yi ] [ blockers: bd-59yi ] [ blocking: bd-4dux, bd-qrwj ]
After completing the tasks above:
- Mark the processed bead task(s) as closed in 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl'.  Do NOT delete the bead task from 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl' â€” only mark it as closed.
- Also record completion in 'G:\_kyle\temp_documents\GitHub\ai-powered\completed.jsonl'

---

Using Augmentcode AI (with Augment-extensions) in VS Code:
- Load bead tasks using 'scripts\beads-helpers.ps1' (dot-sourceit to get the 'bd' alias: . .\scripts\beads-helpers.ps1) or call 'scripts\beads-query.ps1' directly
- Check task completion status with "bd list --status open" or "bd ready " â€” skip any task whose status is not open/in-progress
- For each remaining task in this batch:
    - Claim the task before starting: "bd update <id> --claim"
    - Generate production-quality code that fully satisfies the bead task requirements
    - Follow professional coding standards at all times
    - Do not use stubs, placeholders, or incomplete implementations
    - Do not hallucinate or make up functionality
    - Never reuse the same code pattern for multiple distinct tasks
    - Address every TODO in the relevant files:
        â€¢ If a TODO is relevant, implement the required change
        â€¢ If a TODO is not relevant, explicitly document why it can be ignored
    - Do not proceed until all TODOs are explicitly resolved or justified
(batch 5):
[ bd-ptde ] [ open ] [ P1 ] [ [correct-video] TASK-09: Wire validateRenderJob() into job submission path ] [ PHASE 3 -- WIRE VALIDATOR INTO JOB SUBMISSION PATH. FILE: src/ai-powered/render-queue/assembler.ts (MODIFY). Spec: specs/render-queue-validator/spec.md; deltas.md ADDED render-queue-validator; tasks.md TASK-09. OPERATION: Call validateRenderJob(job) at the job submission entry point, BEFORE any clip is passed to the render provider. If validateRenderJob throws, catch the error, surface it to the API response / caller log, and ensure zero clips are rendered. VERIFY: (1) When validation passes, job proceeds to render queue normally. (2) When validation fails, zero clips are rendered and the detailed error report is visible in API response body and server log. (3) Smoke test S-01: POST {projectFrameRate:30, shots:[{duration:4.5,...}]} -> response shows 135 frames rendered, no AI pacing log entries. (4) Smoke test S-03: B-3 CSV submitted -> API returns error with clip-02 identified, no output files on disk. AC-3 fully satisfied. DEPENDS ON: TASK-08. ] [ dependencies: bd-9wnu ] [ blockers: bd-9wnu ] [ blocking: bd-nkng ]
[ bd-4dux ] [ open ] [ P2 ] [ [correct-video] TASK-13: Unit tests batch parser strict mode -- T-BFP-01 through T-BFP-07 ] [ PHASE 5 -- UNIT TESTS: BATCH PARSER STRICT MODE. FILE: tests/unit/batch-parser-strict.test.ts (NEW). Spec: tests/test-plan.md Batch Parser Tests; tasks.md TASK-13; specs/batch-file-parser/spec.md; examples/pipeline-examples.md B-1..B-5. TESTS (7): T-BFP-01: valid CSV B-1 all explicit 30fps -- 4 shots correct frame counts; warn for scene-02 only. T-BFP-02: JSON B-2 mixed formats 24fps -- 4 shots; promo-01 and promo-03 both 96 frames. T-BFP-03: CSV B-3 clip-02 blank duration, no allowAutoduration -- error thrown matching '[ERROR]...clip-02...allowAutoduration...0 shots rendered'; result empty. T-BFP-04: YAML B-4 frame notation 60fps -- frame-shot-02=18 frames (not extended); total=438 frames. T-BFP-05: '00:00:03.500' at 30fps -- parsedSeconds=3.5; frames=105; no warn. T-BFP-06: TOML B-5 mixed explicit+auto, allowAutoduration:true -- reel-01=180 frames; reel-02 routed to AI engine; reel-03=105 frames. T-BFP-07: duration:'3s' (unrecognised) -- error thrown; zero clips rendered. REGRESSION GUARD: all existing batch-parser tests pass. COMMAND: ='true'; npm test -- tests/unit/batch-parser-strict. DEPENDS ON: TASK-05, TASK-06, TASK-07. ] [ dependencies: bd-i3au, bd-qrwj, bd-hmlk ] [ blockers: bd-i3au, bd-qrwj, bd-hmlk ] [ blocking: bd-7axx ]
[ bd-4zyh ] [ open ] [ P2 ] [ [correct-video] TASK-10: Create ESLint custom rule no-inline-frame-arithmetic ] [ PHASE 4 -- ESLINT CUSTOM RULE. FILE: eslint-rules/no-inline-frame-arithmetic.js (NEW). Spec: design.md D2; implementation.md Â§6; deltas.md frame-count-utility ESLint enforcement; tasks.md TASK-10; summary.md ESLint Rule row. IMPLEMENT ESLint rule module: type='problem'; docs.description='Disallow inline * frameRate / * fps arithmetic outside durationToFrames.ts'; messageId noInlineFrameArithmetic='Do not compute frame counts with inline arithmetic. Use durationToFrames(duration, frameRate) instead.' CREATE function(context): skip file if filename ends with 'durationToFrames.ts'. BinaryExpression visitor: if operator=='*' and right is Identifier matching /^(frameRate|fps|fr)$/ -> context.report. PROVIDE fix suggestion pointing to durationToFrames(). WRITE rule unit tests: 3 valid cases (calls inside durationToFrames.ts, non-frame multiplications, durationToFrames() calls), 3 invalid cases (explicit * frameRate, * fps, * fr in other files). SMOKE TEST S-07: add 'const f = duration * frameRate;' outside utility file -> npm run lint reports error. DEPENDS ON: TASK-03, TASK-04 (all inline arithmetic must be replaced before rule is enforced at error level). ] [ dependencies: bd-wsp5, bd-e2bz ] [ blockers: bd-wsp5, bd-e2bz ] [ blocking: bd-vpdd ]
After completing the tasks above:
- Mark the processed bead task(s) as closed in 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl'.  Do NOT delete the bead task from 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl' â€” only mark it as closed.
- Also record completion in 'G:\_kyle\temp_documents\GitHub\ai-powered\completed.jsonl'

---

Using Augmentcode AI (with Augment-extensions) in VS Code:
- Load bead tasks using 'scripts\beads-helpers.ps1' (dot-sourceit to get the 'bd' alias: . .\scripts\beads-helpers.ps1) or call 'scripts\beads-query.ps1' directly
- Check task completion status with "bd list --status open" or "bd ready " â€” skip any task whose status is not open/in-progress
- For each remaining task in this batch:
    - Claim the task before starting: "bd update <id> --claim"
    - Generate production-quality code that fully satisfies the bead task requirements
    - Follow professional coding standards at all times
    - Do not use stubs, placeholders, or incomplete implementations
    - Do not hallucinate or make up functionality
    - Never reuse the same code pattern for multiple distinct tasks
    - Address every TODO in the relevant files:
        â€¢ If a TODO is relevant, implement the required change
        â€¢ If a TODO is not relevant, explicitly document why it can be ignored
    - Do not proceed until all TODOs are explicitly resolved or justified
(batch 6):
[ bd-e2bz ] [ open ] [ P2 ] [ [correct-video] TASK-04: Replace inline frame arithmetic in render-pipeline ] [ PHASE 1 -- REPLACE INLINE FRAME ARITHMETIC IN RENDER PIPELINE. FILES: src/ai-powered/render-pipeline/*.ts (MODIFY). Spec: proposal.md What Changes; deltas.md; design.md D2; tasks.md TASK-04; summary.md File Impact (MOD render-pipeline). OPERATION: Search all files in src/ai-powered/render-pipeline/ for '* frameRate' or '* fps' arithmetic expressions used to derive frame counts. Replace each with durationToFrames(duration, frameRate). Add import {durationToFrames} from '../utils/durationToFrames' to each affected file. VERIFY: npx tsc --noEmit passes; all pre-existing render-pipeline tests pass (no regressions). After this task the ESLint no-inline-frame-arithmetic rule must report zero violations across the entire render-pipeline directory. DEPENDS ON: TASK-01, TASK-03. ] [ dependencies: bd-59yi, bd-wsp5 ] [ blockers: bd-59yi, bd-wsp5 ] [ blocking: bd-9wnu, bd-4zyh ]
[ bd-hmlk ] [ open ] [ P2 ] [ [correct-video] TASK-07: Implement allowAutoduration opt-in path in batch parser ] [ PHASE 2 -- allowAutoduration OPT-IN PATH. FILE: src/ai-powered/batch-parser/index.ts (MODIFY). Spec: specs/batch-file-parser/spec.md; deltas.md MODIFIED batch-file-parser; design.md D4; tasks.md TASK-07; proposal.md What Changes. When allowAutoduration: true at the batch/project level, shots with null/undefined/'auto' duration are VALID -- do not throw. Route those shots to the AI pacing engine via the shot scheduler (durationSource:'ai'). Shots WITH explicit durations in the same batch still bypass the AI engine and call durationToFrames() directly. Mixed batch (some explicit, some auto) must work correctly -- confirmed by T-BFP-06. TEST: T-BFP-06 -- TOML B-5 batch: reel-01 explicit=180 frames, reel-02 null+allowAutoduration=engine, reel-03 explicit=105 frames. Explicit shots bypass engine. Auto shot goes through engine. AC-2 (batch CSV) and AC-3 (missing+!allowAutoduration) both satisfied. DEPENDS ON: TASK-06. ] [ dependencies: bd-qrwj ] [ blockers: bd-qrwj ] [ blocking: bd-4dux ]
[ bd-ki0z ] [ open ] [ P2 ] [ [correct-video] TASK-12: Unit tests durationToFrames() -- T-FCU-01 through T-FCU-12 ] [ PHASE 5 -- UNIT TESTS: durationToFrames(). FILE: tests/unit/duration-to-frames.test.ts (NEW). Spec: tests/test-plan.md Frame-Count Utility Tests; tasks.md TASK-12; specs/frame-count-utility/spec.md. TESTS (12): T-FCU-01: 0.5s@24fps=12, @30fps=15, no warn. T-FCU-02: 1.0s@24=24, @30=30, no warn. T-FCU-03: 1.5s@24=36, @30=45, no warn. T-FCU-04: 2.0s@24=48, @30=60, no warn. T-FCU-05: 2.5s@24=60, @30=75, no warn. T-FCU-06: 3.0s@24=72, @30=90, no warn. T-FCU-07: 3.333s@24=80(warn), @30=100(warn). T-FCU-08: 4.75s@24=114(no warn), @30=143(warn). T-FCU-09: 10.0s@24=240, @30=300, no warn. T-FCU-10: durationToFrames(2.333,30) -> logger.warn called with '2.333s', '30 fps', '70 frames', '+0.000333s'. T-FCU-11: durationToFrames(4.5,30) -> returns 135; logger.warn NOT called. T-FCU-12: durationToFrames(0.001,30) produces 0.03 -> rounds to 0 -> minimum frame guard returns 1. Each test asserts: return value == expected frames AND logger.warn called iff 'Yes warn'. COMMAND: ='true'; npm test -- tests/unit/duration-to-frames. DEPENDS ON: TASK-01. ] [ dependencies: bd-59yi ] [ blockers: bd-59yi ] [ blocking: bd-7axx ]
After completing the tasks above:
- Mark the processed bead task(s) as closed in 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl'.  Do NOT delete the bead task from 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl' â€” only mark it as closed.
- Also record completion in 'G:\_kyle\temp_documents\GitHub\ai-powered\completed.jsonl'

---

Using Augmentcode AI (with Augment-extensions) in VS Code:
- Load bead tasks using 'scripts\beads-helpers.ps1' (dot-sourceit to get the 'bd' alias: . .\scripts\beads-helpers.ps1) or call 'scripts\beads-query.ps1' directly
- Check task completion status with "bd list --status open" or "bd ready " â€” skip any task whose status is not open/in-progress
- For each remaining task in this batch:
    - Claim the task before starting: "bd update <id> --claim"
    - Generate production-quality code that fully satisfies the bead task requirements
    - Follow professional coding standards at all times
    - Do not use stubs, placeholders, or incomplete implementations
    - Do not hallucinate or make up functionality
    - Never reuse the same code pattern for multiple distinct tasks
    - Address every TODO in the relevant files:
        â€¢ If a TODO is relevant, implement the required change
        â€¢ If a TODO is not relevant, explicitly document why it can be ignored
    - Do not proceed until all TODOs are explicitly resolved or justified
(batch 7):
[ bd-nkng ] [ open ] [ P2 ] [ [correct-video] TASK-14: Unit tests render queue validator -- T-RQV-01 through T-RQV-05 ] [ PHASE 5 -- UNIT TESTS: RENDER QUEUE VALIDATOR. FILE: tests/unit/render-queue-validator.test.ts (NEW). Spec: tests/test-plan.md Render Queue Validator Tests; tasks.md TASK-14; specs/render-queue-validator/spec.md; implementation.md Â§5. TESTS (5): T-RQV-01: valid job -- all shots correct integer frame counts within Â±1 of user durations; validateRenderJob() does NOT throw; job enqueued. T-RQV-02: frame-count mismatch -- one shot frameCount=90 but user supplied 3.267s@30fps (expected 98); error thrown listing that shot with expected/computed/delta. T-RQV-03: zero-frame shot -- one shot frameCount=0; error thrown; zero clips rendered. T-RQV-04: totalDuration mismatch -- sum=174; totalDuration=8.0s@24fps expects 192; delta=-18 frames; job rejected. T-RQV-05: exhaustive report -- three shots fail; single error message lists all three shot IDs and deltas (not just first failure). COMMAND: ='true'; npm test -- tests/unit/render-queue-validator. DEPENDS ON: TASK-08, TASK-09. ] [ dependencies: bd-9wnu, bd-ptde ] [ blockers: bd-9wnu, bd-ptde ] [ blocking: bd-7axx ]
[ bd-qrwj ] [ open ] [ P2 ] [ [correct-video] TASK-06: Implement multi-format duration parsing (decimal, HH:MM:SS.mmm, Nf@fps) ] [ PHASE 2 -- MULTI-FORMAT DURATION PARSING. FILE: src/ai-powered/batch-parser/index.ts (MODIFY). Spec: specs/batch-file-parser/spec.md; implementation.md Â§3; deltas.md MODIFIED batch-file-parser; design.md D5; tasks.md TASK-06. IMPLEMENT parseDurationToSeconds(raw: string|number): number supporting THREE formats: (1) decimal number or decimal string: '3.5' or 3.5 -> 3.5. (2) HH:MM:SS.mmm timecode string: '00:00:03.500' -> 3.5 (hh*3600 + mm*60 + ss+ms). (3) Nf@fps frame notation string: '105f@30' -> 105/30 = 3.5. UNRECOGNISED FORMAT: throw hard error: [ERROR] Unrecognised duration format: 'value'. Accepted: decimal seconds, HH:MM:SS.mmm, or Nf@fps -- not silent fallback. Parsed durationSeconds passed to pipeline UNCHANGED -- no further normalisation before durationToFrames(). TESTS: T-BFP-01 (CSV 30fps), T-BFP-02 (JSON mixed 24fps), T-BFP-04 (YAML frame notation 60fps), T-BFP-05 (timecode round-trip), T-BFP-07 (unrecognised '3s' -> hard error). DEPENDS ON: TASK-05. ] [ dependencies: bd-i3au ] [ blockers: bd-i3au ] [ blocking: bd-4dux, bd-hmlk ]
[ bd-vpdd ] [ open ] [ P2 ] [ [correct-video] TASK-11: Register ESLint rule in eslint.config.js and CI ] [ PHASE 4 -- REGISTER ESLINT RULE IN CI. FILE: eslint.config.js (MODIFY). Spec: design.md D2; implementation.md Â§7; tasks.md TASK-11; deltas.md frame-count-utility ESLint enforcement; summary.md AC-6. OPERATION: import noInlineFrameArithmetic from './eslint-rules/no-inline-frame-arithmetic.js'. Add config entry: plugins: {'local': {rules: {'no-inline-frame-arithmetic': noInlineFrameArithmetic}}}, rules: {'local/no-inline-frame-arithmetic': 'error'}. VERIFY: (1) npm run lint -- confirms ZERO new violations in baseline (all existing inline uses already replaced by TASK-03 and TASK-04). (2) Smoke test S-07 confirmed: a PR introducing a new '* frameRate' expression is blocked by the rule (exit code non-zero). (3) AC-6 code review: durationToFrames() in exactly one module; no inline * frameRate elsewhere; rule active in CI. CI confirmation: the lint step in the build pipeline must block any future inline arithmetic regressions. DEPENDS ON: TASK-10. ] [ dependencies: bd-4zyh ] [ blockers: bd-4zyh ] [ blocking: bd-7axx ]
After completing the tasks above:
- Mark the processed bead task(s) as closed in 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl'.  Do NOT delete the bead task from 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl' â€” only mark it as closed.
- Also record completion in 'G:\_kyle\temp_documents\GitHub\ai-powered\completed.jsonl'

---

Using Augmentcode AI (with Augment-extensions) in VS Code:
- Load bead tasks using 'scripts\beads-helpers.ps1' (dot-sourceit to get the 'bd' alias: . .\scripts\beads-helpers.ps1) or call 'scripts\beads-query.ps1' directly
- Check task completion status with "bd list --status open" or "bd ready " â€” skip any task whose status is not open/in-progress
- For each remaining task in this batch:
    - Claim the task before starting: "bd update <id> --claim"
    - Generate production-quality code that fully satisfies the bead task requirements
    - Follow professional coding standards at all times
    - Do not use stubs, placeholders, or incomplete implementations
    - Do not hallucinate or make up functionality
    - Never reuse the same code pattern for multiple distinct tasks
    - Address every TODO in the relevant files:
        â€¢ If a TODO is relevant, implement the required change
        â€¢ If a TODO is not relevant, explicitly document why it can be ignored
    - Do not proceed until all TODOs are explicitly resolved or justified
(batch 8):
[ bd-wsp5 ] [ open ] [ P2 ] [ [correct-video] TASK-03: Replace inline frame arithmetic in shot-scheduler/index.ts ] [ PHASE 1 -- REPLACE INLINE FRAME ARITHMETIC IN SHOT SCHEDULER. FILE: src/ai-powered/shot-scheduler/index.ts (MODIFY). Spec: deltas.md MODIFIED shot-scheduler; design.md D2; tasks.md TASK-03. OPERATION: Identify ALL expressions matching '* frameRate' or '* fps' inside shot-scheduler/index.ts. Replace each with durationToFrames(duration, frameRate) call. Import durationToFrames from '../utils/durationToFrames' at top of file. GUARD: After this task, running ESLint no-inline-frame-arithmetic rule should report ZERO violations in this file. VERIFY: npx tsc --noEmit passes; no logic change for shots with explicit durations; all T-SS-01..T-SS-08 tests still pass. ACCEPTANCE: grep '* frameRate' shot-scheduler/index.ts returns no hits outside comments. DEPENDS ON: TASK-01, TASK-02. ] [ dependencies: bd-59yi, bd-gvew ] [ blockers: bd-59yi, bd-gvew ] [ blocking: bd-9wnu, bd-4zyh, bd-e2bz ]
After completing the tasks above:
- Mark the processed bead task(s) as closed in 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl'.  Do NOT delete the bead task from 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl' â€” only mark it as closed.
- Also record completion in 'G:\_kyle\temp_documents\GitHub\ai-powered\completed.jsonl'
