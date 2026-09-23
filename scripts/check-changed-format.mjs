import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });

  if (result.error) {
    throw new Error(`Git could not run: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`Git command failed (${result.status}): ${detail || args.join(" ")}`);
  }

  return result.stdout;
}

function parseArguments(argv) {
  let base;
  let head;
  let files;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--base") {
      base = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--head") {
      head = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--files") {
      files = argv.slice(index + 1);
      break;
    }

    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (files && files.length === 0) {
    throw new Error("--files requires at least one path");
  }

  if (files && (base || head)) {
    throw new Error("--files cannot be combined with --base or --head");
  }

  if (base && !head) {
    head = "HEAD";
  }

  if (head && !base && !files) {
    throw new Error("--head requires --base");
  }

  return { base, head, files };
}

function printUsage() {
  console.log(`Usage:
  node scripts/check-changed-format.mjs
  node scripts/check-changed-format.mjs --base <revision> --head <revision>
  node scripts/check-changed-format.mjs --files <path> [<path> ...]

With no arguments, GitHub Actions pull_request, push, and release event metadata
is used. Local callers should provide an explicit base and head revision.`);
}

function readEventPayload(env) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required when no explicit revisions were provided");
  }

  try {
    return JSON.parse(readFileSync(eventPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read GITHUB_EVENT_PATH: ${message}`);
  }
}

function requireRevision(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("-")) {
    throw new Error(`GitHub event did not provide a usable ${label} revision`);
  }

  if (/^0+$/.test(value)) {
    throw new Error(`The ${label} revision is all zeroes and is unavailable`);
  }

  return value;
}

function resolveEventRange(repoRoot, env) {
  const eventName = env.GITHUB_EVENT_NAME;
  const payload = readEventPayload(env);

  if (eventName === "pull_request") {
    return {
      base: requireRevision(payload.pull_request?.base?.sha, "pull request base"),
      head: requireRevision(payload.pull_request?.head?.sha, "pull request head"),
    };
  }

  if (eventName === "push") {
    return {
      base: requireRevision(payload.before, "push before"),
      head: requireRevision(payload.after, "push after"),
    };
  }

  if (eventName === "release") {
    const head = requireRevision(env.GITHUB_SHA || "HEAD", "release head");
    const parents = runGit(repoRoot, ["rev-list", "--parents", "-n", "1", head])
      .trim()
      .split(/\s+/);

    if (parents.length < 2) {
      throw new Error("The release head has no parent revision to use as a formatting base");
    }

    return { base: parents[1], head };
  }

  throw new Error(
    `Unsupported or missing GitHub event name: ${eventName || "<missing>"}. Provide --base and --head for local use.`,
  );
}

function verifyRevision(repoRoot, revision, label) {
  try {
    runGit(repoRoot, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${revision}^{commit}`,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The ${label} revision '${revision}' is unavailable: ${message}`);
  }
}

function parseNameStatus(output) {
  const records = output.split("\0");
  const changedPaths = [];

  for (let index = 0; index < records.length;) {
    const record = records[index];
    index += 1;

    if (!record) {
      continue;
    }

    const tabIndex = record.indexOf("\t");
    let status;
    let sourcePath;

    if (tabIndex === -1) {
      status = record;
      sourcePath = records[index];
      index += 1;
    } else {
      status = record.slice(0, tabIndex);
      sourcePath = record.slice(tabIndex + 1);
    }

    if (!sourcePath) {
      throw new Error(`Malformed Git name-status output near '${record}'`);
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const destinationPath = records[index];
      index += 1;
      if (!destinationPath) {
        throw new Error(`Malformed ${status} name-status record for '${sourcePath}'`);
      }
      changedPaths.push(destinationPath);
    } else {
      changedPaths.push(sourcePath);
    }
  }

  return changedPaths;
}

function toRepoRelativePath(repoRoot, candidate) {
  const absolutePath = path.resolve(repoRoot, candidate);
  const relativePath = path.relative(repoRoot, absolutePath);

  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return relativePath.split(path.sep).join("/");
}

function isSupportedTypeScriptPath(relativePath) {
  return (
    (relativePath.startsWith("src/") || relativePath.startsWith("tests/")) &&
    relativePath.endsWith(".ts")
  );
}

function collectChangedPaths(repoRoot, base, head) {
  verifyRevision(repoRoot, base, "base");
  verifyRevision(repoRoot, head, "head");

  const output = runGit(repoRoot, [
    "diff",
    "--name-status",
    "--find-renames=50%",
    "--diff-filter=ACMR",
    "-z",
    base,
    head,
  ]);

  return parseNameStatus(output)
    .map((candidate) => toRepoRelativePath(repoRoot, candidate))
    .filter((candidate) => candidate && isSupportedTypeScriptPath(candidate));
}

async function existingSupportedFiles(repoRoot, candidates) {
  const uniquePaths = [...new Set(candidates)].sort((left, right) => left.localeCompare(right));
  const existingPaths = [];

  for (const relativePath of uniquePaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    try {
      const fileStat = await stat(absolutePath);
      if (fileStat.isFile()) {
        existingPaths.push({ absolutePath, relativePath });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return existingPaths;
}

async function checkFiles(files) {
  const violations = [];

  for (const { absolutePath, relativePath } of files) {
    const source = await readFile(absolutePath, "utf8");
    const resolvedConfig = (await prettier.resolveConfig(absolutePath)) || {};
    const result = await prettier.check(source, {
      ...resolvedConfig,
      filepath: absolutePath,
    });

    if (typeof result !== "boolean") {
      throw new Error(`Prettier returned a malformed result for ${relativePath}`);
    }

    if (!result) {
      violations.push(relativePath);
    }
  }

  return violations;
}

async function findRepoRoot() {
  return runGit(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const argumentsValue = parseArguments(argv);
  if (argumentsValue.help) {
    printUsage();
    return 0;
  }

  const repoRoot = await findRepoRoot();
  const range = argumentsValue.files
    ? { files: argumentsValue.files }
    : argumentsValue.base && argumentsValue.head
      ? { base: argumentsValue.base, head: argumentsValue.head }
      : resolveEventRange(repoRoot, env);

  const candidates = range.files
    ? range.files
        .map((candidate) => toRepoRelativePath(repoRoot, candidate))
        .filter((candidate) => candidate && isSupportedTypeScriptPath(candidate))
    : collectChangedPaths(repoRoot, range.base, range.head);
  const files = await existingSupportedFiles(repoRoot, candidates);

  if (files.length === 0) {
    console.log("[format-check] No supported TypeScript files changed; nothing to check.");
    return 0;
  }

  const rangeLabel = range.files ? "the explicit file list" : `${range.base}..${range.head}`;
  console.log(`[format-check] Checking ${files.length} TypeScript file(s) from ${rangeLabel}.`);

  const violations = await checkFiles(files);
  if (violations.length > 0) {
    for (const relativePath of violations) {
      console.error(`[format-check] Prettier violation: ${relativePath}`);
    }
    console.error(`[format-check] Found ${violations.length} unformatted changed file(s).`);
    return 1;
  }

  console.log("[format-check] All changed TypeScript files are formatted.");
  return 0;
}

if (path.resolve(process.argv[1] || "") === path.resolve(SCRIPT_PATH)) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[format-check] ERROR: ${message}`);
      process.exitCode = 1;
    },
  );
}
