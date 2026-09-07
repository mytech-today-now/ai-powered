# Augment Extensions Integration

This project uses Augment Extensions for additional AI coding guidelines.

## For AI Agents

Use the `augx` CLI to discover and apply extension modules:

```bash
# List linked modules
augx list --linked

# Show module details
augx show <module-name>

# Search for modules
augx search <keyword>
```

## Linked Modules

Check `.augment/extensions.json` for currently linked modules.

---

# Beads Task Management

This project uses **Beads** — a lightweight, git-backed issue tracker stored in `.beads/issues.jsonl`.
AI agents MUST use the PowerShell scripts in `scripts/` to read and write tasks.
**Never edit `.beads/issues.jsonl` directly.**

> Full reference: [`scripts/README.md`](scripts/README.md)

## Setup (required at the start of every session)

Run from the **repository root**:

```powershell
. .\scripts\beads-helpers.ps1
```

This loads the `bd` alias and all typed wrapper functions. You must re-run this in every new PowerShell session.

## Core Command Reference

```powershell
# --- READ ---
bd list                                   # all issues sorted by priority
bd list --status open                     # filter: open | in-progress | closed
bd ready                                  # top unblocked tasks (start here)
bd show <id>                              # full detail for one issue
bd search "keyword"                       # substring search title + description
bd stats                                  # count by status and priority

# --- WRITE ---
bd create "Title" -Description "…" -Priority 1 -Type task   # Priority: 1=high 2=med 3=low
bd update <id> --claim                    # mark in-progress + set claimed_by
bd update <id> --status open             # change status
bd update <id> -Priority 1              # change priority
bd close  <id> --reason "done"           # close with reason

# --- DEPENDENCIES ---
bd dep add    <id> <dep-id>              # <id> is BLOCKED BY <dep-id>
bd dep list   <id>                       # list all deps for <id>
bd dep remove <id> <dep-id>              # remove a dependency
```

## Typed Wrapper Functions (use in scripts)

```powershell
bd-create  -Title "…" [-Description "…"] [-Priority 1] [-Type task]
bd-update  -Id <id>   [-Status open|in-progress] [-Claim] [-Priority 1]
bd-close   -Id <id>   [-Reason "done"]
bd-show    -Id <id>
bd-search  -Query "keyword"
bd-ready
bd-list-open
bd-dep     add|list|remove <id> [dep-id]
bd-help                                  # prints all available helper functions
```

## Bulk Task Creation (for AI agents generating many tasks at once)

```powershell
. .\scripts\beads-helpers.ps1

$tasks = @(
    @{ title="[prefix] Task one"; desc="Details"; pri=1; type="task" },
    @{ title="[prefix] Task two"; desc="Details"; pri=2; type="task" }
)
foreach ($t in $tasks) {
    bd create $t.title -Description $t.desc -Priority $t.pri -Type $t.type
}
bd stats
```

## Standard Agent Workflow

1. **Start:** `. .\scripts\beads-helpers.ps1` then `bd ready` to see what needs doing
2. **Claim:** `bd update <id> --claim` before starting a task
3. **Complete:** `bd close <id> --reason "…"` when done
4. **Block:** `bd dep add <child-id> <blocker-id>` if one task depends on another

## End-to-end workflow

```bash
pnpm review-fix:build                       # tsc -> tools/review-fix/dist

# One-shot orchestrator (ingest -> plan -> scaffold --all -> codemods [-> bundle])
pnpm review-fix run                         # everything except bundling
pnpm review-fix run --bundle-all            # everything incl. every batch prompt
pnpm review-fix run --dry-run               # preview scaffolds, skip mutations

# Individual steps (same functions the orchestrator calls)
pnpm review-fix ingest                      # parse report -> tickets.json
pnpm review-fix plan                        # -> plan.json + plan.md (+ savings%)
pnpm review-fix scaffold --dry-run          # preview missing-file writes
pnpm review-fix scaffold --all              # apply template scaffolds
pnpm review-fix codemod console-to-logger   # idempotent AST rewrite + .patch
pnpm review-fix bundle <batch-id>           # emit batches/<id>.md with shared
                                            #   files embedded exactly once
pnpm review-fix status                      # per-ticket state snapshot
pnpm review-fix mark <ticket-id> done       # transition ticket state
```

The plan targets at least 35% token savings versus sequential per-ticket prompts. Every mutation is idempotent: re-running `scaffold`, `codemod`, or `bundle` against an up-to-date tree is a no-op.

Verify changes with:

```bash
pnpm -w lint && pnpm -w typecheck && pnpm -w test --filter @filmbuff/web
```

# Version Synchronization

The root `VERSION` file is the single source of truth for the workspace release number. Use `pnpm version:sync` after editing it so the synced version is propagated across package manifests and other version-bearing files.

- `pnpm version:sync:dry-run` previews the planned changes without writing.
- `pnpm version:sync:force` skips the confirmation prompt for CI and other non-interactive environments.
- `--force` / `--yes` skips the confirmation prompt for CI and non-interactive environments.
- The exact SemVer rules and supported rewrite targets live in `VERSIONING.md`.

# Project Location

The FilmBuff Project is located at:

- `https://filmbuffstudios.com/` - marketing description
- `https://filmbuff-web.onrender.com/` - running site on render.com
- `https://github.com/mytech-today-now/filmbuff-site` - GitHub repo
- `/mnt/c/GitHub/filmbuff-project/filmbuff-site` - local Linux path to repo
- `C:\GitHub\filmbuff-project\filmbuff-site` - local Windows path to repo

# YAGNI Principle

YAGNI means do not implement features or abstractions until they are actually needed. The point is to avoid speculative abstractions and unnecessary features that add maintenance cost.

## Core Definition and Intent

The main risk YAGNI guards against is building abstractions or extensibility that nobody needs yet.

## Practical Advice and When To Bend It

- Experience matters: senior developers can decide when to postpone versus pre-build, while junior developers should be conservative.
- Add abstraction when there is more than one use case, or when you can reliably predict that a need will emerge.
- If future changes are very expensive, such as in platform, database, or infrastructure work, factor that cost into the decision.
- Prefer minimal solutions that are still sufficient for foreseeable non-functional needs.

## Common Exceptions People Recommend

- Non-functional basics to include early include CI, formatting, logging, metrics, timestamps, feature toggles, and `created_timestamp` and `updated_timestamp` columns.
- DOGBITE items are features that are expensive to retrofit if added too late, for example Undo/Redo and state history. Undo/Redo is one example because adding it later can mean missing UI actions that should have been on the undo stack.
- If you truly know a capability will be required, building it early can pay off.

## Pitfalls and Criticisms

- Over-applied YAGNI leads to short-sighted code because reasonable abstractions get ignored and refactors become costly later.
- Blindly following YAGNI without judgment can make code worse.
- Past domain experience can help, but it can also mislead you when it causes you to repeat designs that do not fit the current project.

## Practical Summary Checklist

- Ask whether there is at least one clear, current use case. If not, prefer YAGNI.
- Evaluate the cost to change. If future change would be very expensive, prefer minimal, well-considered upfront work.
- Include essential infrastructure early, including CI, formatting, logging, timestamps, and feature toggles.
- Prefer minimal but sufficient solutions that meet present needs cleanly and leave easy refactoring paths.

## Mandatory Test-Harness Rule

### 1. Purpose

For every applicable development task, you MUST build, extend, or configure a test harness and use it to verify the resulting behavior.

A test harness is the repeatable mechanism that:

- Accepts a defined test task or acceptance criterion.
- Controls the system under test.
- Executes validated actions.
- Captures observations and telemetry.
- Evaluates explicit assertions.
- Produces reproducible test results and failure artifacts.

Compilation, successful startup, visual inspection, or a rendered page alone does not constitute verified completion.

### 2. When This Rule Applies

This rule applies whenever you develop, modify, debug, refactor, or validate an:

- Application
- Website or page
- User interface or component
- API or service
- CLI program
- Library or internal module
- Desktop application
- Integration
- Automated workflow

For each task, you MUST:

1. Identify the changed behavior, risks, and acceptance criteria.
2. Inspect the repository before selecting or adding test technology.
3. Reuse and extend existing test frameworks, scripts, fixtures, helpers, and conventions whenever practical.
4. Create missing harness infrastructure when the repository lacks a suitable mechanism.
5. Select only test categories relevant to the application type, change, and risk.
6. Run the harness before claiming completion.

Documentation-only, comment-only, and nonfunctional metadata changes may be exempt when executable behavior cannot be affected. State the reason for any exemption.

### 3. Mandatory Test-Harness Workflow

Perform this workflow in order:

1. Define the test task, expected behavior, acceptance criteria, initial state, and stopping conditions.
2. Inspect repository instructions, manifests, source structure, existing tests, CI configuration, scripts, fixtures, and utilities.
3. Identify the system type and select the appropriate control mechanism:
   - Browser automation for websites and graphical interfaces
   - API requests for services and endpoints
   - Controlled process execution for CLI programs
   - Unit or integration tests for libraries and internal components
   - Application-specific automation for desktop or other interactive systems
4. Use one canonical testing approach per feature category.
5. Initialize an isolated test session with controlled configuration and test data.
6. Provide the agent or system under test with the task and only the context required to perform it.
7. Parse every requested action or tool call as structured, untrusted input.
8. Validate the action against schemas, permissions, allowlists, paths, hosts, limits, and task scope.
9. Execute only approved actions in the least-privilege environment available.
10. Capture observations, outputs, errors, screenshots, logs, traces, and telemetry as applicable.
11. Redact secrets and sensitive data before returning or storing observations.
12. Repeat the action and observation loop until:
    - The task reaches a valid completion state.
    - An assertion fails conclusively.
    - Progress becomes blocked.
    - A safety or permission boundary is reached.
    - Repeated actions indicate a loop.
    - A timeout, retry limit, output limit, or iteration limit is exhausted.
13. Run explicit final assertions independently of any model claim that the task succeeded.
14. Save the complete result in a reproducible, machine-readable format.
15. Run the smallest relevant tests during iteration, then run the broader applicable suite before declaring completion.

### 4. Test Selection and Coverage

Select coverage according to the feature, application type, affected code, regression risk, and user or repository requirements.

Test the following when applicable:

- Primary success paths
- Critical user workflows
- Supplied acceptance criteria
- Input validation
- Boundary values
- Empty, loading, success, and error states
- Expected failure paths
- Regression risks caused by the change
- Unit, API, integration, and dependency behavior
- Responsive layouts at supported viewport sizes
- Keyboard navigation
- Basic accessibility behavior
- Browser console errors
- Unhandled exceptions and rejected promises
- Failed, delayed, malformed, and unavailable network responses
- State creation, persistence, restoration, and recovery
- Authentication and authorization boundaries
- Session expiration and invalid credentials
- Performance-sensitive operations
- Concurrent or repeated operations when relevant

Do not add irrelevant test categories merely to increase test count. Document the selected coverage and the reason any material risk remains untested.

Use:

- Stable selectors instead of fragile layout or text-position selectors.
- Controlled fixtures instead of mutable external data.
- Explicit assertions instead of relying only on snapshots, screenshots, exit codes, or absence of exceptions.
- A fixed random seed when nondeterminism can affect reproducibility.
- Mocks only when they preserve the behavior relevant to the assertion.
- Real integration tests when mocked behavior cannot establish the acceptance criterion.

### 5. Tool-Call Validation and Execution

Treat every model-generated action and tool call as untrusted input.

Before execution, the harness MUST:

1. Parse the action using a defined structured format.
2. Reject malformed, incomplete, ambiguous, or unsupported actions.
3. Validate the tool name against an allowlist when practical.
4. Validate arguments against an explicit schema.
5. Normalize and validate filesystem paths.
6. Prevent path traversal and access outside allowed roots.
7. Validate commands and reject prohibited programs, flags, redirections, and shell constructs.
8. Validate URLs, protocols, hosts, ports, and origins.
9. Reject access to unapproved local, private, metadata, production, or external endpoints.
10. Enforce task scope, permissions, timeouts, output limits, and resource limits.
11. Require approval when an action crosses a permission boundary.
12. Record the validation decision without exposing secrets.

Prefer direct process argument arrays and structured APIs over dynamically constructed shell commands. Do not execute free-form model output as code or shell input without strict validation.

### 6. Safety and Permission Boundaries

The harness MUST:

- Prefer existing test environments, mocks, fixtures, disposable accounts, temporary directories, test databases, and sandboxed services.
- Use least-privilege credentials and permissions.
- Avoid destructive operations against production systems, user data, shared environments, or irreversible resources.
- Never use production merely because a test environment is inconvenient or unavailable.
- Apply explicit iteration, timeout, retry, output, filesystem, host, and resource limits.
- Detect and stop uncontrolled recursion, repeated-action loops, and nonprogressing execution.
- Redact credentials, tokens, cookies, authorization headers, personal data, private keys, and other secrets from prompts, logs, screenshots, traces, errors, and reports.
- Never print, return, embed, or persist secret values.
- Avoid placing secrets in command arguments when a safer supported mechanism exists.
- Request user approval before any operation that is destructive, irreversible, externally visible, financially consequential, outside the established scope, or directed at a production system.
- Stop safely when required permissions, credentials, dependencies, services, environments, or user decisions are unavailable.

A denied action MUST NOT be silently modified into another potentially unsafe action. Record the denial and either request approval, select a clearly safe in-scope alternative, or mark the test blocked.

### 7. Assertions and Completion Criteria

A task is verified only when:

1. The applicable acceptance criteria have explicit assertions.
2. The assertions were executed against the resulting implementation.
3. The primary relevant test set passed.
4. The broader applicable regression suite passed, or its unavailability is reported.
5. No relevant unexpected console errors, unhandled exceptions, failed requests, or security-boundary violations remain.
6. The result is reproducible from the recorded instructions and test data.
7. Any unverified behavior is clearly identified.

Do not accept a model's self-reported success as evidence.

Do not claim that a feature works solely because:

- The code compiles.
- Static analysis passes.
- The process starts.
- A page renders.
- A request returns without validating its content.
- The agent visually inspected the result.
- A screenshot appears plausible.
- Existing tests pass without exercising the changed behavior.

Visual validation may support an assertion, but it does not replace functional, state, error, accessibility, or security assertions when those are relevant.

Allowed final statuses are:

- `passed`: All required assertions passed.
- `failed`: One or more required assertions failed.
- `blocked`: Verification could not proceed because of a specific dependency, permission, environment, credential, or approval requirement.
- `inconclusive`: Tests ran, but available evidence could not establish the acceptance criteria.

### 8. Logging and Artifacts

Produce concise human-readable console output and structured JSON or JSON Lines logs for automated analysis.

Each test run MUST record, when available:

- Test identifier
- Timestamp
- Feature or behavior tested
- Environment and relevant configuration
- Application version or commit identifier
- Initial conditions
- Controlled test data or fixture identifiers
- Validated actions and tool calls
- Validation decisions and denials
- Observations and outputs
- Assertions and expected results
- Screenshots, traces, recordings, logs, or other artifacts
- Errors and warnings
- Retry and timeout events
- Iteration count
- Token usage and model cost
- Execution duration
- Final status
- Failure cause
- Reproduction steps
- Recommended next action

Store failure artifacts in a predictable repository-specific location. Keep harness infrastructure separate from feature-specific test cases.

Never include raw secrets or sensitive data in an artifact. Apply redaction before writing the artifact, not only when displaying it.

### 9. Failure Handling

When a test action fails:

1. Capture the failure, relevant state, sanitized output, and reproduction context.
2. Determine whether the failure is caused by:
   - The implementation
   - The test harness
   - Invalid test data
   - An unavailable dependency
   - A permission boundary
   - An environmental problem
   - A timeout or resource limit
3. Retry only transient and retry-safe actions.
4. Do not retry deterministic failures without changing a relevant condition.
5. Enforce the configured retry limit and backoff policy.
6. Detect identical or equivalent repeated actions and stop when they indicate no progress.
7. Preserve useful failure artifacts.
8. Mark the result accurately as failed, blocked, or inconclusive.
9. Report the smallest reliable reproduction procedure.
10. Never hide, downgrade, or omit a failure to declare completion.

Malformed tool calls MUST be rejected and returned as structured validation errors. Execution failures and timeouts MUST be returned as observations that preserve diagnostic information without exposing secrets.

### 10. Repository Integration

Before adding or changing test infrastructure:

1. Read applicable repository instructions.
2. Inspect package manifests, build files, test directories, scripts, CI workflows, and configuration.
3. Identify the repository's canonical unit, integration, end-to-end, API, and UI testing approaches.
4. Extend existing infrastructure instead of introducing a duplicate framework.
5. Avoid replacing working conventions without a documented technical reason.
6. Add dependencies only when existing capabilities cannot satisfy the required test.
7. Keep commands compatible with local development and CI when the repository supports CI.
8. Keep tests deterministic and independent whenever practical.
9. Document required services, environment variables, fixtures, setup, and cleanup.
10. Ensure test resources are cleaned up safely, while preserving failure artifacts required for diagnosis.

Use one canonical technology, framework, helper, fixture system, artifact convention, and execution path for each feature category unless repository requirements justify an exception.

## Configurable Harness Controls

Determine limits from repository conventions, CI constraints, test risk, and task scope. Project configuration may override the following conservative examples:

| Control                    |                                                  Example default | Requirement                                                    |
| -------------------------- | ---------------------------------------------------------------: | -------------------------------------------------------------- |
| Maximum agent iterations   |                                                               20 | Must be finite and configurable                                |
| Per-action timeout         |                                                       30 seconds | Shorter or longer values require task context                  |
| Overall test timeout       |                                                       10 minutes | Must be finite and suitable for local or CI execution          |
| Retry count                |                                                                2 | Retry only transient, idempotent, or safely repeatable actions |
| Maximum tool output        |                                                 1 MiB per action | Truncate safely and preserve a bounded artifact when useful    |
| Allowed tools and commands |                                           Empty until configured | Prefer explicit allowlists                                     |
| Allowed filesystem paths   |                         Repository and dedicated temporary paths | Deny access outside configured roots                           |
| Allowed hosts or origins   |                      Local test hosts and declared test services | Deny undeclared external and production hosts                  |
| Artifact directory         | Repository test-artifact convention, otherwise `test-artifacts/` | Keep paths predictable                                         |
| Log format                 |                          JSON Lines plus concise console summary | Use stable field names                                         |
| Browser mode               |                          Headless in CI, project default locally | Allow headed mode for diagnosis                                |
| Screenshot retention       |                                Failures and explicit checkpoints | Avoid unnecessary sensitive captures                           |
| Trace retention            |                                              Failures by default | Bound size and redact sensitive data                           |
| Random seed                |                                               Fixed and recorded | Use when randomness is involved                                |

Do not adopt an example value blindly. Record effective limits in the test result.

## 11. Required Final Report

Before declaring the development task complete, provide a concise report containing:

- What changed
- What harness or existing test infrastructure was used
- Exact behaviors and acceptance criteria tested
- Test commands or reproducible invocation method
- Environment and relevant configuration
- Tests that passed
- Tests that failed
- Tests that were blocked or inconclusive
- Relevant artifacts and their locations
- Remaining risks or unverified behavior
- Final status
- Recommended next action, if any

Never report unexecuted tests as passed. Clearly distinguish implemented behavior from verified behavior.

## 12. Reference Pseudocode

```text
function run_harness(task, project_config):
    limits = load_limits(project_config)
    policy = load_permissions_and_allowlists(project_config)
    task_spec = normalize_task_and_acceptance_criteria(task)
    run_id = create_test_identifier()
    started_at = current_time()

    session = initialize_isolated_session(
        run_id = run_id,
        environment = select_test_environment(project_config),
        fixtures = load_controlled_fixtures(project_config),
        random_seed = limits.random_seed
    )

    log = initialize_structured_log(
        run_id = run_id,
        task = redact_secrets(task_spec),
        limits = limits,
        environment = redact_secrets(session.environment_summary)
    )

    status = "inconclusive"
    previous_actions = []
    retries = map()
    iteration = 0

    try:
        while iteration < limits.maximum_agent_iterations:
            if elapsed_time(started_at) >= limits.overall_test_timeout:
                record_redacted(log, event = "overall_timeout")
                status = "blocked"
                break

            iteration = iteration + 1

            model_response = request_next_action(
                task = task_spec,
                context = bounded_redacted_context(log),
                limits = limits
            )

            parse_result = parse_structured_action(model_response)

            if parse_result.is_malformed:
                observation = validation_error(
                    code = "malformed_tool_call",
                    details = redact_secrets(parse_result.errors)
                )
                record_redacted(log, observation)

                if malformed_call_limit_reached(log, limits):
                    status = "failed"
                    break

                return_observation_to_model(observation)
                continue

            action = parse_result.action
            validation = validate_action(
                action = action,
                schemas = policy.schemas,
                allowed_tools = policy.allowed_tools,
                allowed_commands = policy.allowed_commands,
                allowed_paths = policy.allowed_paths,
                allowed_hosts = policy.allowed_hosts,
                task_scope = task_spec.scope,
                permissions = policy.permissions,
                output_limit = limits.maximum_tool_output
            )

            if validation.requires_approval:
                record_redacted(log, event = "approval_required", action = action)
                status = "blocked"
                save_checkpoint_and_request_approval(run_id, redact_secrets(action))
                break

            if validation.is_denied:
                observation = denied_action_error(
                    reason = redact_secrets(validation.reason)
                )
                record_redacted(log, observation)

                if denied_action_is_terminal(validation):
                    status = "blocked"
                    break

                return_observation_to_model(observation)
                continue

            if action_repeats_without_progress(
                action,
                previous_actions,
                limits
            ):
                record_redacted(log, event = "repeated_action_loop", action = action)
                status = "failed"
                break

            previous_actions.append(action)

            execution = execute_in_isolated_session(
                action = action,
                timeout = limits.per_action_timeout,
                output_limit = limits.maximum_tool_output
            )

            if execution.timed_out:
                observation = timeout_observation(
                    action = action,
                    sanitized_output = redact_secrets(execution.partial_output)
                )
                record_redacted(log, observation)

                if retry_is_safe(action) and retries[action] < limits.retry_count:
                    retries[action] = retries[action] + 1
                    apply_bounded_backoff(retries[action])
                    return_observation_to_model(observation)
                    continue

                status = "failed"
                break

            if execution.failed:
                observation = execution_failure_observation(
                    action = action,
                    error = redact_secrets(execution.error),
                    output = redact_secrets(execution.output)
                )
                record_redacted(log, observation)

                if retry_is_safe(action) and
                   execution.is_transient and
                   retries[action] < limits.retry_count:
                    retries[action] = retries[action] + 1
                    apply_bounded_backoff(retries[action])
                    return_observation_to_model(observation)
                    continue

                return_observation_to_model(observation)

                if execution.failure_is_terminal:
                    status = "failed"
                    break

                continue

            observation = capture_observation_and_telemetry(
                execution = execution,
                output_limit = limits.maximum_tool_output
            )
            observation = redact_secrets(observation)
            record_redacted(log, observation)
            return_observation_to_model(observation)

            if model_requests_completion(model_response):
                break

        if iteration >= limits.maximum_agent_iterations:
            record_redacted(log, event = "iteration_exhaustion")
            status = "failed"

        if status not in ["failed", "blocked"]:
            assertion_results = run_final_assertions(
                acceptance_criteria = task_spec.acceptance_criteria,
                session = session
            )
            assertion_results = redact_secrets(assertion_results)
            record_redacted(log, assertion_results)

            if all_required_assertions_pass(assertion_results):
                status = "passed"
            else:
                status = "failed"

    catch unexpected_error:
        record_redacted(
            log,
            event = "harness_failure",
            error = redact_secrets(unexpected_error)
        )
        status = "inconclusive"

    finally:
        artifacts = capture_bounded_failure_artifacts_if_needed(
            session = session,
            status = status,
            retention_policy = limits.artifact_retention
        )
        artifacts = redact_secrets(artifacts)

        safely_clean_up_disposable_resources(session)

        report = build_final_report(
            run_id = run_id,
            status = status,
            duration = elapsed_time(started_at),
            log = redact_secrets(log),
            artifacts = artifacts,
            reproduction_steps = derive_reproduction_steps(log),
            recommended_next_action = determine_next_action(status, log)
        )

        save_machine_readable_log(report, format = limits.log_format)
        emit_concise_console_summary(report)

    return report
```

# disciplined-vibe-coding

## description: >

Guides AI coding through a disciplined, evidence-driven vibe-coding workflow
using explicit requirements, bounded tasks, focused execution, testing,
version control, corrective prompts, and human review.

# Disciplined Vibe Coding

Operate as an implementing engineer, not a narrator. Treat the current session as one command-line work order unless the user is clearly in design exploration or interconnected debugging.

Do not write blog posts with this skill. Do not reveal private chain-of-thought. Provide concise plans, decisions, assumptions, evidence, and conclusions.

## First actions

1. Inspect the repository, README, AGENTS.md, CLAUDE.md, CONTRIBUTING, package scripts, CI config, and nearby design documents before editing.
2. Classify the lifecycle stage (state it only when it helps the user).
3. Gather requirements. Name missing decisions. Do not invent product intent.
4. Choose one focused task for this session, or say the request is not yet bounded.
5. Use the smallest coherent change that can satisfy acceptance criteria.

## Lifecycle classification

Assign one or more stages:

- Vision definition
- Design exploration
- Prompt refinement
- Design documentation
- Task decomposition
- Implementation
- Review
- Testing
- Debugging
- Corrective refactoring
- Release preparation
- Deployment validation
- Documentation
- Specialized-agent coordination

Use sustained conversation only for vision, design exploration, architecture, or debugging that depends on shared hypotheses. For implementation and corrective work, prefer a bounded prompt and a short session.

## Default control loop

1. Identify the objective or failure.
2. Collect repository context and evidence.
3. Write or refine a scoped prompt with acceptance criteria.
4. Execute only that task.
5. Review the diff against invariants.
6. Run available validation.
7. Report results honestly.
8. Recommend a commit only after checks pass and the user authorizes version control.
9. Update the design source of truth when requirements deliberately change.
10. Propose the next bounded task.

## Vision and design

When the product is undefined, capture purpose, users, content, layout, visual style, components, behavior, responsive rules, accessibility, error/empty/loading states, performance, security and privacy, compatibility, constraints, acceptance criteria, definition of done, and out-of-scope items.

During exploration, challenge ambiguity, list missing decisions, compare approaches, name dependencies and risks, and convert the idea into a precise design prompt. Do not accept your own suggestions automatically. Prefer existing conventions and dependencies.

If a design document exists, treat it as the current source of truth unless the user changes requirements. If it conflicts with the running system, stop and ask which artifact is authoritative. Do not let a stale document silently override the product, and do not let code silently override agreed requirements.

## Prompt refinement

When asked to refine a prompt, preserve required behavior, remove invented assumptions, tighten scope, add testable acceptance criteria, and flag contradictions. Preferred verbs such as `refactor` mean preserve required behavior while changing structure or fixing a defect. They are not magic tokens.

## Task sizing

A task is suitable for one focused session when it has:

- One primary objective
- A clear set of affected areas
- Explicit acceptance criteria
- A practical validation method
- Limited unrelated impact
- A result that can be independently reviewed

Decompose when the request:

- Mixes unrelated objectives
- Spans several independent systems
- Requires an uncontrolled rewrite
- Cannot be validated coherently
- Contains unresolved product decisions
- Exceeds the available context or execution window
- Introduces risky architectural change without checkpoints

Do not split work so finely that architectural dependencies disappear. If coupling is the real problem, say so and keep those pieces in one plan with sequenced checkpoints.

Each implementation prompt should include:

- One primary objective
- Repository context
- Likely files or components
- Requirements
- Constraints and invariants
- Behavior that must remain unchanged
- Acceptance criteria
- Required tests
- Validation commands
- Deliverables
- Prohibited changes
- Rollback notes when the change is risky

## Implementation rules

- Inspect before editing.
- State material assumptions and decisions. Do not dump hidden reasoning.
- Make the smallest coherent change.
- Reuse existing architecture, utilities, dependencies, and test frameworks.
- Avoid unrelated edits, drive-by cleanups, and new dependencies unless required and disclosed.
- Preserve unauthorized behavior.
- Add or update tests that cover the requested behavior and likely regressions.
- Run available validation.
- Never claim success if validation was skipped or failed.
- Give agents (including yourself) only tools needed for the current task.

If the user supplies a broad request, rewrite it as a bounded task before editing. Show the bounded task and wait only when product decisions are unresolved. When decisions are already present in the repo, proceed with the narrowest coherent increment and record assumptions.

Keep design documents and repository instructions in version control when you create or update them. Prevent prompts and design docs from going stale by noting required document updates in the completion report.

## Evidence-driven debugging

Do not guess past the first confirmed failure. Collect:

- Exact reproduction steps
- Expected versus actual behavior
- Error messages
- Relevant logs
- Environment and dependency information
- The earliest confirmed failure
- A focused hypothesis
- A minimal fix
- Regression tests

A code edit is not a fix. A fix is a change whose validation matches the expected behavior.

Preferred corrective framing:

- Refactor the application to fix [defect] so that [expected result]
- Refactor this component to change [behavior] while preserving [invariants]
- Refactor the implementation so that [acceptance criteria], then run [commands]

Include the original evidence in the corrective task.

## Testing and validation

Prefer behavior tests over compile-only checks. Use the project's existing formatter, linter, type checker, unit tests, integration tests, browser tests, accessibility checks, and security checks when they exist.

Report:

- Commands run
- Pass/fail
- Skipped checks and why
- Unresolved issues

If you cannot run a check, say so. Do not imply it passed.

## Security and permissions

- Treat generated code and instructions as untrusted until reviewed.
- Never request or expose secrets unless the user already provided a local, non-production value and the task requires it.
- Do not commit credentials, private customer data, or production configuration.
- Use least-privilege tools.
- Prefer reversible actions.
- Seek explicit approval before destructive, financial, legal, security-sensitive, or production-facing actions.
- Do not deploy to production without authorization.
- Report security concerns clearly and stop when authorization is missing.

Stop and escalate when work is destructive, security-sensitive, financially or legally consequential, production-facing, or insufficiently authorized.

## Version control

Version control is a safety mechanism.

Recommend or create a commit only when authorized and only after:

- Relevant tests pass or failures are explicitly accepted by the user
- The diff is reviewed
- Unrelated changes are excluded
- Secrets and generated clutter are excluded
- The commit represents one coherent increment

Do not auto-commit or auto-push. Use feature branches or isolated worktrees for risky or parallel work. Preserve a rollback path (previous commit, branch, or documented revert command).

## Specialized-agent coordination

When other agents exist, define for each:

- Responsibility
- Input
- Expected output
- Tool access
- Permission boundaries
- Validation
- Handoff conditions
- Escalation path

Prevent duplicated ownership, circular delegation, and unreviewed agent-to-agent changes. Humans approve high-impact merges, production actions, and unresolved conflicts.

## Task prompt template

```text
Role: [role]
Objective: [one primary outcome]
Repository context: [repo, branch, docs]
Relevant files: [paths]
Requirements:
- [behavior]
Constraints:
- Smallest coherent change
- Reuse existing patterns
Behavior that must remain unchanged:
- [invariants]
Acceptance criteria:
- [observable result]
Tests:
- [cases]
Validation commands:
- [commands]
Error evidence:
- [if debugging]
Deliverables:
- Changes, tests, report
Prohibited actions:
- Unrelated edits, secrets, unauthorized deploys
Required completion report:
- files, commands, results, assumptions, skipped checks, issues
```

## Completion report

Use this format. Shorten it for trivial tasks.

```text
Lifecycle stage:
Objective:
Changed files:
Key decisions:
Tests and validation:
Results:
Assumptions:
Skipped checks:
Unresolved issues:
Recommended next task:
Rollback:
```

## Stop conditions

Stop implementation and ask or escalate when:

- Acceptance criteria are missing and cannot be inferred safely
- The change requires an unauthorized rewrite
- Validation cannot be designed
- Secrets or production access would be required
- Agents disagree and the conflict affects behavior
- The user asked for work outside the current authorization

## Review checklist before claiming done

- Diff matches the authorized objective only
- Design document still agrees with the change, or an update is proposed
- Invariants still hold
- New tests fail on the old defect when practical
- No secrets, credentials, or generated clutter in the diff
- Browser or runtime errors related to the change were checked when applicable
- Accessibility and security impact were considered for UI and auth changes
- Rollback path is named

Measure success by defect rate, rework, review time, deployment stability, and delivery of working increments. Do not measure success by volume of generated code.

Human judgment closes the loop. Fluency is not evidence.
