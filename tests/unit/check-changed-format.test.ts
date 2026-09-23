import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/check-changed-format.mjs", import.meta.url),
);
const PACKAGE_PATH = fileURLToPath(new URL("../../package.json", import.meta.url));

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout || result.error?.message || "unknown error"}`,
    );
  }

  return result.stdout.trim();
}

function writeFixtureFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function commitFixture(root: string, message: string): string {
  runGit(root, ["add", "--all"]);
  runGit(root, [
    "-c",
    "user.name=formatter-test",
    "-c",
    "user.email=formatter-test@example.com",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

function createFixture(): { root: string; base: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "ai-powered-format-check-"));
  runGit(root, ["init", "--quiet"]);
  writeFixtureFile(root, "src/baseline.ts", "const baseline=1\n");
  writeFixtureFile(root, "src/good.ts", "const value = 1;\n");
  writeFixtureFile(root, "src/rename-old.ts", "const renamed=1\n");
  writeFixtureFile(root, "src/deleted.ts", "const deleted=1\n");
  writeFixtureFile(root, "README.md", "fixture\n");

  return { root, base: commitFixture(root, "baseline") };
}

function runChecker(root: string, args: string[], event?: Record<string, string>): CommandResult {
  const env = { ...process.env };
  delete env.GITHUB_EVENT_NAME;
  delete env.GITHUB_EVENT_PATH;
  delete env.GITHUB_SHA;
  Object.assign(env, event);

  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function writeEvent(root: string, eventName: string, payload: unknown): string {
  const eventPath = path.join(root, `${eventName}-event.json`);
  writeFileSync(eventPath, JSON.stringify(payload), "utf8");
  return eventPath;
}

describe("changed-file Prettier check", () => {
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("passes a correctly formatted changed TypeScript file", () => {
    writeFixtureFile(fixture.root, "src/good.ts", "const value = 2;\n");
    const head = commitFixture(fixture.root, "formatted change");

    const result = runChecker(fixture.root, ["--base", fixture.base, "--head", head]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("All changed TypeScript files are formatted");
  });

  it("fails a changed TypeScript file with a Prettier violation", () => {
    writeFixtureFile(fixture.root, "src/good.ts", "const value=2\n");
    const head = commitFixture(fixture.root, "unformatted change");

    const result = runChecker(fixture.root, ["--base", fixture.base, "--head", head]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("src/good.ts");
    expect(`${result.stdout}${result.stderr}`).toContain("Prettier violation");
  });

  it("resolves a pull request event range", () => {
    writeFixtureFile(fixture.root, "src/good.ts", "const value = 2;\n");
    const head = commitFixture(fixture.root, "pull request change");
    const eventPath = writeEvent(fixture.root, "pull-request", {
      pull_request: { base: { sha: fixture.base }, head: { sha: head } },
    });

    const result = runChecker(fixture.root, [], {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 TypeScript file(s)");
  });

  it("resolves a push range across multiple commits", () => {
    writeFixtureFile(fixture.root, "src/good.ts", "const value = 2;\n");
    const firstHead = commitFixture(fixture.root, "first push commit");
    writeFixtureFile(fixture.root, "tests/second.ts", "const second = 2;\n");
    const head = commitFixture(fixture.root, "second push commit");
    const eventPath = writeEvent(fixture.root, "push", {
      before: fixture.base,
      after: head,
    });

    const result = runChecker(fixture.root, [], {
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_PATH: eventPath,
    });

    expect(firstHead).not.toBe(fixture.base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 TypeScript file(s)");
  });

  it("checks added and renamed files, skips deleted files, and preserves spaces", () => {
    renameSync(
      path.join(fixture.root, "src/rename-old.ts"),
      path.join(fixture.root, "src/renamed file.ts"),
    );
    rmSync(path.join(fixture.root, "src/deleted.ts"));
    writeFixtureFile(fixture.root, "tests/with space.ts", "const spaced=1\n");
    const head = commitFixture(fixture.root, "rename add and delete");

    const result = runChecker(fixture.root, ["--base", fixture.base, "--head", head]);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("src/renamed file.ts");
    expect(output).toContain("tests/with space.ts");
    expect(output).not.toContain("src/deleted.ts");
  });

  it("ignores unrelated dirty files and an unchanged baseline debt", () => {
    writeFixtureFile(fixture.root, "docs/note.md", "changed\n");
    const head = commitFixture(fixture.root, "documentation change");
    writeFixtureFile(fixture.root, "tests/dirty.ts", "const dirty=1\n");

    const result = runChecker(fixture.root, ["--base", fixture.base, "--head", head]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No supported TypeScript files changed");
    expect(result.stdout).not.toContain("baseline.ts");
    expect(existsSync(path.join(fixture.root, "tests/dirty.ts"))).toBe(true);
  });

  it("fails clearly for an unavailable base revision and an all-zero push base", () => {
    const invalidBase = runChecker(fixture.root, [
      "--base",
      "not-a-real-revision",
      "--head",
      fixture.base,
    ]);
    expect(invalidBase.status).toBe(1);
    expect(`${invalidBase.stdout}${invalidBase.stderr}`).toContain("base revision");

    const eventPath = writeEvent(fixture.root, "push", {
      before: "0000000000000000000000000000000000000000",
      after: fixture.base,
    });
    const zeroBase = runChecker(fixture.root, [], {
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_PATH: eventPath,
    });
    expect(zeroBase.status).toBe(1);
    expect(`${zeroBase.stdout}${zeroBase.stderr}`).toContain("all zeroes");
  });

  it("keeps lint-staged TypeScript formatting behavior unchanged", () => {
    const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, "utf8")) as {
      "lint-staged": Record<string, string[]>;
    };

    expect(packageJson["lint-staged"]["*.ts"]).toEqual(["eslint --fix", "prettier --write"]);
  });
});
