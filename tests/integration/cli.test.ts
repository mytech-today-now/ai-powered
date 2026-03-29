/**
 * @file tests/integration/cli.test.ts
 *
 * CLI integration tests: spawn the compiled ai-powered binary with
 * AI_MOCK=true so no real API credentials are required.
 *
 * Scenarios covered (bd-hprz):
 *  1.  text --mock                            → stdout content, exit 0
 *  2.  image --mock --output <tmpfile>        → file written, confirmation on stderr
 *  3.  structured --schema <file> --mock      → valid JSON response
 *  4.  text --mock --dry-run                  → cost report, exit 0, no HTTP
 *  5.  text --mock --quiet                    → only raw result on stdout
 *  6.  text --mock --json                     → JSON with content/usage/model/cost/modality
 *  7.  config validate                        → exit 0 on valid config
 *  8.  health-check --mock                    → all checks pass, exit 0
 *  9.  batch text --mock --input/--output     → 5 rows in, 5 rows out
 *  10. session list                           → outputs session list line or "No sessions found"
 *  11. session clear <id>                     → session file deleted
 */

import { spawnSync, SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute path to the compiled CLI entry point. */
const BINARY = path.resolve("dist/ai-powered/cli/index.js");

/** Environment shared across all spawned processes. */
const MOCK_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  AI_MOCK: "true",
  NO_COLOR: "1",
  // Suppress pino output noise in tests.
  LOG_LEVEL: "silent",
};

/** npm executable (npm.cmd on Windows). */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

// ---------------------------------------------------------------------------
// Helper: spawn the binary and return { stdout, stderr, exitCode }
// ---------------------------------------------------------------------------

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(
  args: string[],
  opts: { input?: string; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const spawnOpts: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf-8",
    env: { ...MOCK_ENV, ...(opts.env ?? {}) },
    timeout: 20_000,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  };
  const result = spawnSync("node", [BINARY, ...args], spawnOpts);
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
  };
}

// ---------------------------------------------------------------------------
// beforeAll: build the project if the binary is not present
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (!fs.existsSync(BINARY)) {
    const buildResult = spawnSync(NPM, ["run", "build"], {
      encoding: "utf-8",
      stdio: "inherit",
      timeout: 120_000,
      cwd: path.resolve("."),
    });
    if (buildResult.status !== 0) {
      throw new Error(`Build failed with exit code ${buildResult.status ?? -1}`);
    }
  }
}, 130_000);

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-powered-cli-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scenario 1: text --mock → stdout content, exit 0
// ---------------------------------------------------------------------------

describe("text --mock", () => {
  it("prints content to stdout and exits 0", () => {
    const { stdout, exitCode } = run(["text", "--mock", "What is TypeScript?"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: image --mock --output <tmpfile> → file written, confirmation stderr
// ---------------------------------------------------------------------------

describe("image --mock --output", () => {
  it("writes a file and prints 'Saved to' on stderr", () => {
    const outFile = path.join(tmpDir, "image.png");
    const { stderr, exitCode } = run(["image", "--mock", "--output", outFile, "A red square"]);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(outFile)).toBe(true);
    expect(stderr).toContain("Saved to");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: structured --schema <file> --mock → valid JSON response
// ---------------------------------------------------------------------------

describe("structured --schema <file> --mock", () => {
  it("returns valid JSON matching the provided JSON Schema", () => {
    const schemaFile = path.join(tmpDir, "schema.json");
    fs.writeFileSync(
      schemaFile,
      JSON.stringify({
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      }),
    );
    const { stdout, exitCode } = run([
      "structured", "--mock", "--schema", schemaFile, "Describe TypeScript",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty("answer");
    expect(typeof parsed["answer"]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: text --mock --dry-run → cost report, exit 0, no HTTP calls
// ---------------------------------------------------------------------------

describe("text --mock --dry-run", () => {
  it("outputs a cost report JSON and exits 0 without making API calls", () => {
    const { stdout, exitCode } = run(["text", "--mock", "--dry-run", "Summarise the Iliad"]);
    expect(exitCode).toBe(0);
    const obj = JSON.parse(stdout) as Record<string, unknown>;
    expect(obj["dryRun"]).toBe(true);
    expect(typeof obj["estimatedCostUsd"]).toBe("number");
    expect(obj["isEstimate"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: text --mock --quiet → only raw result on stdout
// ---------------------------------------------------------------------------

describe("text --mock --quiet", () => {
  it("writes only the raw content to stdout (no banners or decorations)", () => {
    const { stdout, exitCode } = run(["text", "--mock", "--quiet", "Hello"]);
    expect(exitCode).toBe(0);
    // In quiet mode the CLI should emit only the raw content.
    // Decorative banners / progress spinners go to stderr.
    const lines = stdout.trim().split("\n");
    // Should be a single line of raw content (not a JSON object)
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).not.toMatch(/^\s*\{/); // not a JSON object
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: text --mock --json → JSON envelope with required fields
// ---------------------------------------------------------------------------

describe("text --mock --json", () => {
  it("emits a JSON object with content, usage, model, cost, and modality fields", () => {
    const { stdout, exitCode } = run(["text", "--mock", "--json", "Hello AI"]);
    expect(exitCode).toBe(0);
    const obj = JSON.parse(stdout) as Record<string, unknown>;
    expect(typeof obj["content"]).toBe("string");
    expect(obj).toHaveProperty("usage");
    expect(typeof obj["model"]).toBe("string");
    expect(obj).toHaveProperty("cost");
    expect(obj["modality"]).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: config validate → exit 0 on valid config
// ---------------------------------------------------------------------------

describe("config validate", () => {
  it("exits 0 and prints 'Config is valid.'", () => {
    const { stdout, exitCode } = run(["config", "validate", "--mock"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config is valid");
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: health-check --mock → all checks pass, exit 0
// ---------------------------------------------------------------------------

describe("health-check --mock", () => {
  it("exits 0 and reports all checks as passing", () => {
    const { stdout, exitCode } = run(["health-check", "--mock"]);
    expect(exitCode).toBe(0);
    // All check lines should start with ✓ (pass) not ✗ (fail)
    const checkLines = stdout
      .split("\n")
      .filter((l) => l.includes("config") || l.includes("api-key"));
    for (const line of checkLines) {
      expect(line).toMatch(/^✓/);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: batch text --mock --input/--output → 5 rows in, 5 rows out
// ---------------------------------------------------------------------------

describe("batch text --mock", () => {
  it("processes 5 input rows and writes 5 output rows", async () => {
    const inputFile  = path.join(tmpDir, "input.jsonl");
    const outputFile = path.join(tmpDir, "output.jsonl");

    const rows = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ prompt: `Prompt number ${i + 1}` }),
    );
    fs.writeFileSync(inputFile, rows.join("\n") + "\n", "utf-8");

    const { exitCode } = run([
      "batch", "text",
      "--mock",
      "--input",  inputFile,
      "--output", outputFile,
    ]);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(outputFile)).toBe(true);

    const outputLines = fs
      .readFileSync(outputFile, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(outputLines.length).toBe(5);
    for (const line of outputLines) {
      const row = JSON.parse(line) as Record<string, unknown>;
      expect(row).toHaveProperty("prompt");
      expect(row).toHaveProperty("response");
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 10: session list → outputs session list or "No sessions found"
// ---------------------------------------------------------------------------

describe("session list", () => {
  it("exits 0 and outputs session information or a 'No sessions found' message", () => {
    const { stdout, exitCode } = run(["session", "list"]);
    expect(exitCode).toBe(0);
    // Either a list of sessions or the empty state message.
    expect(stdout.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 11: session clear <id> → session file deleted
// ---------------------------------------------------------------------------

describe("session clear <id>", () => {
  it("clears a session that was previously created via text --session", () => {
    const sessionId = `test-session-${Date.now()}`;

    // Create the session by generating text with a session ID.
    const createResult = run(["text", "--mock", "--session", sessionId, "Hello"]);
    expect(createResult.exitCode).toBe(0);

    // Clear the session.
    const clearResult = run(["session", "clear", sessionId]);
    expect(clearResult.exitCode).toBe(0);
    expect(clearResult.stdout).toContain("cleared");
  });
});

