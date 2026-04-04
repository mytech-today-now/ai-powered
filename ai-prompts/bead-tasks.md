bd-12qx [task] P1 [open] - [app-008] T-001: Create src/ai-powered/shared/ directory
bd-3svd [story] P1 [open] - [app-008] Add circuit-breaker and exponential-backoff retry to WebAiClient
bd-n1ia [task] P2 [open] - [vid-cntrl] T10: Pass videoOptions to client.generateVideo() in app.js
bd-qvw6 [task] P2 [open] - [app-005] Manual smoke test: genuine network error still shows red banner (App-004 regression)
bd-flh6 [task] P2 [open] - [app-005] Code review: no new npm dependencies, no server-side changes, only 2 files changed
bd-yb9a [task] P1 [open] [blocked] - [app-008] T-002: Create src/ai-powered/shared/resilience.ts
bd-cs7a [task] P1 [open] [blocked] - [app-008] T-004: Run tsc --strict on shared/resilience.ts — zero errors
bd-4qjy [task] P1 [open] [blocked] - [app-008] T-005: Add shared/resilience.ts import to fetch-client.ts
bd-9b5l [task] P1 [open] [blocked] - [app-008] T-018: Run full test suite — all pre-existing tests must pass
bd-dbo7 [task] P1 [open] [blocked] - [app-008] T-009: Instantiate CircuitBreaker in WebAiClient constructor
bd-itjc [task] P1 [open] [blocked] - [app-008] T-015: Confirm existing Node resilience exports unchanged
bd-q3t2 [task] P1 [open] [blocked] - [app-008] T-010: Wrap all outbound fetch calls with withRetryFetch + CircuitBreaker
bd-k0im [task] P1 [open] [blocked] - [app-008] T-012: Run npm run build — UMD bundle must compile without error
bd-4ykc [task] P1 [open] [blocked] - [app-008] T-016: Run tsc --strict on resilience.ts — zero errors
bd-0zf9 [task] P1 [open] [blocked] - [app-008] T-011: Verify AbortSignal forwarded in every wrapped fetch call
bd-ljyp [task] P1 [open] [blocked] - [app-008] T-008: Add private _breaker field to WebAiClient class
bd-y0jy [task] P1 [open] [blocked] - [app-008] T-007: Update WebClientOptions to intersect WebResilienceOptions
bd-alqq [task] P1 [open] [blocked] - [app-008] T-014: Add shared resilience re-exports to src/ai-powered/resilience.ts
bd-jdsz [task] P1 [open] [blocked] - [app-008] T-003: Verify no node: imports in shared/resilience.ts
bd-cojx [task] P1 [open] [blocked] - [app-008] T-017: Run App-008 Vitest spec tests — all must pass
bd-ases [task] P1 [open] [blocked] - [app-008] T-006: Export WebResilienceOptions interface from fetch-client.ts
bd-fln3 [task] P2 [open] [blocked] - [app-008] T-013: Measure bundle size delta — must be < 5 KB gzipped
bd-nori [task] P2 [open] [blocked] - [app-008] T-019: Run example script — all 5 scenarios must print expected output
bd-0n47 [task] P2 [open] [blocked] - [app-008] T-020: Code review — confirm all AC requirements met
bd-79jk [task] P2 [open] [blocked] - [app-008] T-021: Confirm WebAiClientOptions backward compatibility
bd-a8vh [task] P3 [open] [blocked] - [app-008] T-022: Update summary.md with actual bundle size delta
bd-p5ju [task] P3 [open] [blocked] - [app-008] T-023: Open PR targeting main — link to openspec/changes/app-008/