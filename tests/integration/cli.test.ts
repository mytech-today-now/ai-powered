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
  opts: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): RunResult {
  const spawnOpts: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf-8",
    env: { ...MOCK_ENV, ...(opts.env ?? {}) },
    cwd: opts.cwd ?? process.cwd(),
    // 30 s: first spawn in a parallel test-fork incurs cold-start JIT overhead.
    timeout: 30_000,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  };
  const result = spawnSync(process.execPath, [BINARY, ...args], spawnOpts);
  // dotenv v17 prints an informational banner to stdout (e.g. "[dotenv@17.x]
  // injecting env…"). Strip those lines so JSON-parsing tests are not broken.
  const rawStdout = result.stdout ?? "";
  const cleanStdout = rawStdout
    .split("\n")
    .filter((line) => !line.startsWith("[dotenv"))
    .join("\n");
  return {
    stdout: cleanStdout,
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
  };
}

function initGitRepo(cwd: string): void {
  const result = spawnSync("git", ["init", "--quiet"], {
    cwd,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error(`git init failed with exit code ${result.status ?? -1}`);
  }
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
  // 30 s: first spawn in a parallel test-fork incurs cold-start JIT overhead
  it("prints content to stdout and exits 0", () => {
    const { stdout, exitCode } = run(["text", "--mock", "What is TypeScript?"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  }, 30_000);
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
    expect(stderr).not.toContain("MaxListenersExceededWarning");
  }, 35_000);
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
      "structured",
      "--mock",
      "--schema",
      schemaFile,
      "Describe TypeScript",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty("answer");
    expect(typeof parsed["answer"]).toBe("string");
    // 30 s: subprocess spawn incurs cold-start JIT overhead under parallel load.
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Scenario 4: text --mock --dry-run → cost report, exit 0, no HTTP calls
// ---------------------------------------------------------------------------

describe("text --mock --dry-run", () => {
  it("outputs a cost report JSON and exits 0 without making API calls", () => {
    const { stdout, stderr, exitCode } = run([
      "text",
      "--mock",
      "--dry-run",
      "Summarise the Iliad",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    const obj = JSON.parse(stdout) as Record<string, unknown>;
    expect(obj).toEqual(
      expect.objectContaining({
        dryRun: true,
        prompt: "Summarise the Iliad",
        model: "gpt-4o",
        estimatedTokens: expect.any(Number),
        estimatedCostUsd: expect.any(Number),
        isEstimate: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: text --mock --quiet → only raw result on stdout
// ---------------------------------------------------------------------------

describe("text --mock --quiet", () => {
  it("writes a single raw line to stdout", () => {
    const { stdout, exitCode } = run(["text", "--mock", "--quiet", "Hello"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim().split(/\r?\n/)).toEqual(["[mock response]"]);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: text --mock --json → JSON envelope with required fields
// ---------------------------------------------------------------------------

describe("text --mock --json", () => {
  it("emits a JSON object with content, usage, model, cost, and modality fields", () => {
    const { stdout, exitCode } = run(["text", "--mock", "--json", "Hello AI"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim().split(/\r?\n/)).toHaveLength(1);
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
// Scenario 7b: config path → resolves inside isolated home
// ---------------------------------------------------------------------------

describe("config path", () => {
  it("prints the isolated global config path inside spawned CLI processes", () => {
    const { stdout, exitCode } = run(["config", "path"]);
    expect(exitCode).toBe(0);

    const home = process.env["HOME"];
    expect(home).toBeDefined();
    expect(stdout.trim()).toBe(path.join(home!, ".ai-powered", "config.json"));
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

  it("reports unable to verify when git is unavailable", () => {
    const emptyPath = path.join(tmpDir, "no-git");
    fs.mkdirSync(emptyPath);
    const env = { ...process.env };
    delete env["PATH"];
    delete env["Path"];
    env["PATH"] = emptyPath;

    const { stdout, exitCode } = run(["health-check", "--mock", "--json"], { env });
    const checks = JSON.parse(stdout) as Array<{ check: string; status: string; message: string }>;
    const gitCheck = checks.find((check) => check.check === "git-credentials");

    expect(exitCode).toBe(2);
    expect(gitCheck).toEqual({
      check: "git-credentials",
      status: "unavailable",
      message: "Unable to verify tracked sensitive files: git unavailable or not a repository",
    });
    expect(stdout).not.toContain("No sensitive files tracked by git");
  });

  it("reports unable to verify when the cwd is not a git repository", () => {
    const { stdout, exitCode } = run(["health-check", "--mock"], { cwd: tmpDir });
    expect(exitCode).toBe(2);
    expect(stdout).toContain(
      "Unable to verify tracked sensitive files: git unavailable or not a repository",
    );
    expect(stdout).not.toContain("No sensitive files tracked by git");
  });

  it("reports a clean tracked-file scan for a git repository", () => {
    initGitRepo(tmpDir);
    const { stdout, exitCode } = run(["health-check", "--mock", "--json"], { cwd: tmpDir });
    const checks = JSON.parse(stdout) as Array<{ check: string; status: string; message: string }>;
    const gitCheck = checks.find((check) => check.check === "git-credentials");

    expect(exitCode).toBe(0);
    expect(gitCheck).toEqual({
      check: "git-credentials",
      status: "pass",
      message: "No sensitive files tracked by git",
    });
  });

  it("reports tracked sensitive filenames without exposing file contents", () => {
    initGitRepo(tmpDir);
    const secret = "sk-test-secret-value";
    fs.writeFileSync(path.join(tmpDir, ".env"), `OPENAI_API_KEY=${secret}\n`, "utf-8");
    const addResult = spawnSync("git", ["add", ".env"], { cwd: tmpDir, stdio: "ignore" });
    expect(addResult.status).toBe(0);

    const { stdout, exitCode } = run(["health-check", "--mock", "--json"], { cwd: tmpDir });
    const checks = JSON.parse(stdout) as Array<{ check: string; status: string; message: string }>;
    const gitCheck = checks.find((check) => check.check === "git-credentials");

    expect(exitCode).toBe(2);
    expect(gitCheck).toEqual({
      check: "git-credentials",
      status: "fail",
      message: expect.stringContaining("Sensitive files tracked by git: .env"),
    });
    expect(stdout).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: batch text --mock --input/--output → 5 rows in, 5 rows out
// ---------------------------------------------------------------------------

describe("batch text --mock", () => {
  it("processes 5 input rows and writes 5 output rows", async () => {
    const inputFile = path.join(tmpDir, "input.jsonl");
    const outputFile = path.join(tmpDir, "output.jsonl");

    const rows = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ prompt: `Prompt number ${i + 1}` }),
    );
    fs.writeFileSync(inputFile, rows.join("\n") + "\n", "utf-8");

    const { exitCode } = run([
      "batch",
      "text",
      "--mock",
      "--input",
      inputFile,
      "--output",
      outputFile,
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

  it("fails when the input file contains no valid JSONL rows", async () => {
    const inputFile = path.join(tmpDir, "invalid-input.jsonl");
    const outputFile = path.join(tmpDir, "output.jsonl");

    fs.writeFileSync(inputFile, "not-json\n", "utf-8");

    const { exitCode, stderr } = run([
      "batch",
      "text",
      "--mock",
      "--input",
      inputFile,
      "--output",
      outputFile,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Skipping invalid JSON line");
    expect(stderr).toContain("No valid batch items read from input file");
    expect(fs.existsSync(outputFile)).toBe(false);
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
  // 30 s: two sequential subprocess spawns under parallel fork load.
  it("clears a session that was previously created via text --session", () => {
    const sessionId = `test-session-${Date.now()}`;

    // Create the session by generating text with a session ID.
    const createResult = run(["text", "--mock", "--session", sessionId, "Hello"]);
    expect(createResult.exitCode).toBe(0);

    // Clear the session.
    const clearResult = run(["session", "clear", sessionId]);
    expect(clearResult.exitCode).toBe(0);
    expect(clearResult.stdout).toContain("cleared");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Scenario 12: mistyped commands / flags → syntax guidance
// ---------------------------------------------------------------------------

describe("syntax guidance", () => {
  it("suggests the correct lifecycle flag when update is entered as a command", () => {
    const { stderr, exitCode } = run(["update"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid invocation");
    expect(stderr).toContain("Use `ai-powered --update`.");
  });

  it("suggests the correct command when text is entered with --", () => {
    const { stderr, exitCode } = run(["--text"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid invocation");
    expect(stderr).toContain("Use `ai-powered text");
  });

  it("suggests the correct nested command when config validate is entered with --", () => {
    const { stderr, exitCode } = run(["config", "--validate"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid invocation");
    expect(stderr).toContain("Use `ai-powered config validate`.");
  });
});
