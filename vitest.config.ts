import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for ai-powered.
 *
 * All tests run with AI_MOCK=true; no real API credentials are required.
 * The environment variable is set in the GitHub Actions CI workflow and
 * can be set locally via `.env` or the shell before running `npm test`.
 */
export default defineConfig({
  test: {
    // Enable globals (describe, it, expect, …) without explicit imports.
    globals: true,

    // Node environment (tests run in Node.js, not jsdom).
    environment: "node",

    // Set up an isolated home directory before each test file loads app code.
    setupFiles: ["./tests/setup/home-isolation.ts"],

    // Test file glob patterns.
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "openspec/**/*.test.js",
      "openspec/**/*.test.ts",
    ],

    // Force mock mode in all test runs.
    env: {
      AI_MOCK: "true",
      NO_COLOR: "1",
    },

    // Coverage configuration.
    //
    // Scope: testable source files only.
    //   • cli/**        — tested via subprocess (spawnSync); coverage not captured here.
    //   • web/**        — browser-only bundle; cannot run in Node test environment.
    //   • plugins/**    — not in scope for vid-cntrl feature set.
    //   • templates/index.ts — not in scope for vid-cntrl feature set.
    //   • providers/{openai,venice,xai,custom}.ts — require live API keys; no-network
    //                    constructor/capability tests only; not meaningful for thresholds.
    //
    // Thresholds reflect realistic coverage over the testable subset (server routes,
    // mock provider, core types/utils, compat layer, resilience, LumaAI provider).
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        // Browser-only bundle — no Node test env.
        "src/**/web/**",
        // CLI entry point is tested via subprocess (spawnSync); no coverage capture.
        "src/**/cli/**",
        // Plugin framework not in scope for vid-cntrl.
        "src/**/plugins/**",
        // Template registry not in scope for vid-cntrl.
        "src/**/templates/index.ts",
        // Providers that require real API keys for meaningful coverage.
        "src/**/providers/openai.ts",
        "src/**/providers/venice.ts",
        "src/**/providers/xai.ts",
        "src/**/providers/custom.ts",
      ],
      thresholds: {
        lines: 65,
        functions: 75,
        branches: 55,
        statements: 65,
      },
    },

    // Timeout for async tests (10 seconds).
    testTimeout: 10_000,

    // Concurrency: run test files in parallel.
    pool: "forks",
  },
});
