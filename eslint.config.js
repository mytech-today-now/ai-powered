// @ts-check
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // Base JS recommended (no-undef etc.) — but we override no-undef below
  // because TypeScript already validates undefined identifiers and globals.
  {
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript validates global access; ESLint's no-undef would need
      // every Node.js / browser global enumerated. Let tsc own this.
      "no-undef": "off",
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // Do NOT set `project` — tests/tsconfig excluded from tsconfig.json.
        // Type-aware rules are skipped; tsc --noEmit handles type safety.
        sourceType: "module",
        ecmaVersion: 2022,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Delegate undefined-variable checking to TypeScript (tsc --noEmit).
      "no-undef": "off",
      // Disable base rule in favour of TS-aware version.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow console — pino handles structured logging in library code;
      // CLI commands intentionally use console for user-facing output.
      "no-console": "off",
      // Unused eslint-disable comments that no longer match any rule.
      "no-unused-disable": "off",
      "reportUnusedDisableDirectives": "off",
    },
  },
  {
    // Ignore built artifacts and dependency tree.
    ignores: ["dist/**", "dist-web/**", "node_modules/**"],
  },
];

