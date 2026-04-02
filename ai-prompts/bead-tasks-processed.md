Using Augmentcode AI (with Augment-extensions) in VS Code:
- Load bead tasks using 'scripts\beads-helpers.ps1' (dot-sourceit to get the 'bd' alias: . .\scripts\beads-helpers.ps1) or call 'scripts\beads-query.ps1' directly
- Check task completion status with "bd list --status open" or "bd ready " — skip any task whose status is not open/in-progress
- For each remaining task in this batch:
    - Claim the task before starting: "bd update <id> --claim"
    - Generate production-quality code that fully satisfies the bead task requirements
    - Follow professional coding standards at all times
    - Do not use stubs, placeholders, or incomplete implementations
    - Do not hallucinate or make up functionality
    - Never reuse the same code pattern for multiple distinct tasks
    - Address every TODO in the relevant files:
        • If a TODO is relevant, implement the required change
        • If a TODO is not relevant, explicitly document why it can be ignored
    - Do not proceed until all TODOs are explicitly resolved or justified
(batch 1):
bd-am8y [task] P2 [open] - [vid-cntrl] T28: Manual web demo — Video tab controls -> Generate Video
bd-cssz [task] P2 [open] - [vid-cntrl] T9: Collect video control values from DOM in app.js
bd-n1ia [task] P2 [open] - [vid-cntrl] T10: Pass videoOptions to client.generateVideo() in app.js
After completing the tasks above:
- Mark the processed bead task(s) as closed in 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl'.  Do NOT delete the bead task from 'G:\_kyle\temp_documents\GitHub\ai-powered\.beads\issues.jsonl' — only mark it as closed.
- Also record completion in 'G:\_kyle\temp_documents\GitHub\ai-powered\completed.jsonl'
