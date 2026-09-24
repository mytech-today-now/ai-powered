# Follow-up: finish the issuer decision gate for Issue 1

Prepared using the requested [prompt-refinement template](https://raw.githubusercontent.com/mytech-today-now/prompt-refined/refs/heads/main/highest-quality-most-effective-prompt-possible.md), retrieved on 2026-09-24. This is the transformed follow-up, not an unprocessed issue fragment.

```prompt
You are a senior TypeScript service architect and application security engineer working in
C:/GitHub/ai-powered. Finish the unresolved deployment decision gate for Issue 1 of the
self-service developer portal release. Do not use em-dashes in generated content,
documentation, comments, test descriptions, summaries, or other written output.

Objective and current evidence

The resource proxy already consumes external agent credentials. The local Issue 1 work has
created docs/auth-service-contract.md, tests/fixtures/auth-service/contract.json,
tests/fixtures/auth-service/fixtures.json, tests/unit/auth-service-contract.test.ts, and
openspec/changes/define-auth-service-boundary/. Beads implementation task bd-bns6 remains open.
The service owner, actual auth-service repository or separately deployable location, and durable
account database have not been confirmed. Do not assume an external service is absent merely
because this proxy checkout has no account handlers.

Complete AC-01-01 by recording a real, reviewable implementation location and persistence
decision with executable commands and observed results. Preserve AC-01-02 through AC-01-04:
the ten endpoint contracts, scoped-key-first delivery with real portal sessions and existing
RS256 verification, and named dependencies for all later items. The current fixture explicitly
marks the missing deployment decision as blocked; do not merely change its status to complete.

Inspect first

Read AGENTS.md, README.md, CONTRIBUTING.md, SECURITY.md, package.json, .openspec.yaml,
.github/workflows/ci.yml, scripts/README.md, and the existing Issue 1 contract and verification
report. Inspect the relevant linked Augment guidance. Load . ./scripts/beads-helpers.ps1 at
the start of each PowerShell session. Record git status --short, inspect bd-bns6, and claim
that implementation task before editing. Never edit .beads/issues.jsonl directly or close the
completed prompt-pack task as an implementation substitute.

Recheck the current consumers in auth.ts, server/auth.ts, server/index.ts, env.ts, payments.ts,
mcp-server.ts, and existing Settings / Configuration modules. Use package.json as runtime
authority. Preserve unrelated dirty work and the existing shared HTTPS base correction.

Resolve the missing contract

1. Use project evidence and the owner's answer to identify the accountable service owner and
   actual repository or deployable package location. If the required answer is still unavailable,
   ask one concise question for owner, location, and database while completing independent
   inspection. Do not fabricate a host, repository, deployment, credentials, or chosen database.
2. Inspect the selected service's actual files and instructions. Record its runtime, database,
   migrations, package scripts, session implementation, identity/email integration, and deployment
   configuration. Distinguish existing capabilities from proposed work.
3. If the owner explicitly selects a new separately deployable service, establish the smallest
   runnable service boundary and real persistence tooling under that authorized location.
   Do not implement all remaining portal items or put account issuance into arbitrary proxy handlers.
4. Record exact clean-install, local start, migration, test, and deployment commands supported by
   files that actually exist. Run authorized local commands yourself. A planned deploy command
   is not proof of deployment. Do not publish or change production credentials as part of this task.
5. Document gateway routing for the existing shared service base. Verification uses
   /api/auth/verify-key, funding uses /api/payments/x402, and MCP balance reads use
   /api/account/credits. Preserve all current consumers or explicitly identify a required compatible
   routing migration. Browser input must not control AIPOWERED_AUTH_ENDPOINT.
6. Update the decision record, portable fixtures, OpenSpec design/tasks, and verification report
   with evidence. Replace the deliberately blocked-decision test with tests that validate the actual
   selected implementation while retaining negative cases for missing owner/location/database.

Security and compatibility constraints

Accounts own management operations through authenticated sessions and CSRF checks. Agent keys
authorize resources; provider secrets never authenticate callers. AIPOWERED_API_KEY remains an
operator secret and is never issued to visitors. Preserve Authorization: Bearer RS256 JWT,
X-AI-Agent-Key, and the operator-only X-AI-API-Key contract.

Keep exact scopes read, generate, files:read, files:write; empty/malformed scopes authorize
nothing. Do not use an internal fallback after a visitor credential fails. Keep verified identity
server-assigned, stable across rotation, and unique across accounts. Preserve one-time disclosure,
no-store, safe metadata projections, and redacted instrumentation. Never store recoverable raw
agent keys. Do not read or print existing secrets.

The current 60-second cache and missing strict issuer-response validation remain item 7/8 work.
Do not claim immediate revocation or production readiness from the decision record. Keep provider
calls in the resource server. Retain file ownership, signed capabilities, and paid-generation
non-retry behavior. Add no unrelated billing, provider, or UI framework changes.

Verification and completion criteria

- Positive: the recorded owner and actual service path are evidenced, the selected service's local
  command starts, its minimal fixture uses the selected persistence boundary, and both repositories
  can consume the portable contract fixtures.
- Negative: missing issuer config, incomplete deployment metadata, provider-only caller auth,
  anonymous management, and attempts to substitute internal secrets remain denied.
- Boundary: root and prefixed HTTPS bases with trailing slashes work; URL userinfo/query/fragment
  fail before credential transmission; operation IDs and method/path pairs stay unique.
- Regression: retain SDK credential precedence, existing RS256 consumers, four exact scopes,
  generic proxy errors, and public health/static behavior.
- If new database work is necessary, use a disposable real database and verify migration,
  restart, transaction failure, and cross-instance behavior at the affected boundary. Preserve
  irreversible revocation during rollback/recovery. Do not substitute in-memory fixtures for
  claimed durable evidence.

Set AI_MOCK=true and run:
npm.cmd test -- tests/unit/auth.test.ts tests/server/proxy-auth.test.ts
npm.cmd test -- tests/unit/auth-service-contract.test.ts tests/unit/env.test.ts tests/unit/mcp.test.ts
npm.cmd run build
npm.cmd run build:web
npm.cmd run lint
npm.cmd run format:check:changed -- --files <actual changed TypeScript paths>
npm.cmd test

Use actual file arguments, not the placeholder above. The build script already includes build:web.
Run the selected service's real commands separately and report results. Existing proxy tests do
not prove an account issuer. No real provider charge is needed; denied work must leave spies untouched.

Deliver a report with outcome, current source evidence, changed files, real service/database
decision, commands and results, compatibility, migration/recovery notes, and remaining limits.
Include a table with columns Requirement or risk | Test level | Positive or negative path |
Expected result | Verification status. Separate proxy, issuer, database, browser, and deployed
evidence. Close bd-bns6 only after every applicable Issue 1 acceptance criterion and required check
passes. If owner/location/database is still unavailable, leave it open and state precisely which
decision is needed.
```
