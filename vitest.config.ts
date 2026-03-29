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

    // Test file glob patterns.
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],

    // Force mock mode in all test runs.
    env: {
      AI_MOCK: "true",
      NO_COLOR: "1",
    },

    // Coverage configuration.
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/web/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },

    // Timeout for async tests (10 seconds).
    testTimeout: 10_000,

    // Concurrency: run test files in parallel.
    pool: "forks",
  },
});

