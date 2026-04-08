#!/usr/bin/env node
/**
 * @file src/ai-powered/cli/index.ts
 *
 * ai-powered CLI — single binary entry point (bd-wdod).
 *
 * Uses Commander.js for command/flag parsing.  Global flags are defined on the
 * root program and propagated via `cmd.optsWithGlobals()` in each handler.
 *
 * Lifecycle flags handled on the root program:
 *   --status   print resolved config and provider health
 *   --update   check npm for a newer version, update, migrate config
 *   --uninstall remove local .ai-powered/ directory and hooks
 *   --install  alias for the `init` subcommand
 *   --log      print the tail of the log file
 *   --debug    enable verbose debug output globally
 *
 * Subcommands include `init` (scaffold .ai-powered/ config directory) and
 * core commands registered below that delegate to getAiClient().
 */

import { Command, Option } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { loadConfig, writeConfig, CURRENT_VERSION } from "../core.js";
import { getAiClient } from "../index.js";
import type { ProviderCallOptions } from "../index.js";
import { maskApiKey, estimateCost, estimateTokens, initLogger } from "../utils.js";
import { ValidationError } from "../types.js";
import { listTemplates, getTemplate, renderTemplate } from "../templates/index.js";
import { runWizard } from "./wizard.js";
import { startServer } from "../server/index.js";

// ---------------------------------------------------------------------------
// Exit-code constants
// ---------------------------------------------------------------------------
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_FAIL = 2; // validation / health-check failure

// Honour NO_COLOR env var (https://no-color.org/)
if (process.env["NO_COLOR"]) process.env["FORCE_COLOR"] = "0";

// ---------------------------------------------------------------------------
// Global flags helper: applied to root program; Commander propagates via
// optsWithGlobals() to every subcommand handler.
// ---------------------------------------------------------------------------
function addGlobalFlags(cmd: Command): Command {
  return cmd
    .addOption(new Option("--provider <name>", "AI provider to use"))
    .addOption(new Option("--model <id>", "Model identifier"))
    .addOption(new Option("--api-key <key>", "API key (overrides env var)"))
    .addOption(
      new Option("--temperature <n>", "Sampling temperature (0-2)").argParser((v) => parseFloat(v)),
    )
    .addOption(
      new Option("--max-tokens <n>", "Maximum response tokens").argParser((v) => parseInt(v, 10)),
    )
    .addOption(new Option("--json", "Emit JSON output on stdout"))
    .addOption(new Option("--modality <m>", "AI modality (text|image|audio|video|structured)"))
    .addOption(new Option("--stream", "Enable streaming output"))
    .addOption(new Option("--profile <name>", "Named config profile"))
    .addOption(new Option("--mock", "Use mock provider (no API calls)"))
    .addOption(new Option("--dry-run", "Validate and estimate cost; skip API call"))
    .addOption(new Option("--quiet", "Suppress decorative output; raw result only"))
    .addOption(new Option("--no-color", "Disable ANSI colour codes"))
    .addOption(new Option("--no-fallback", "Disable provider failover loop"))
    .addOption(
      new Option("--budget-session <n>", "Session spend ceiling in USD").argParser((v) =>
        parseFloat(v),
      ),
    )
    .addOption(
      new Option("--warn-budget <n>", "Warn-budget fraction (0-1)").argParser((v) => parseFloat(v)),
    )
    .addOption(new Option("--log", "Print log file tail"))
    .addOption(new Option("--debug", "Enable debug-level logging"));
}

// ---------------------------------------------------------------------------
// Build root program
// ---------------------------------------------------------------------------
const program = new Command()
  .name("ai-powered")
  .description("Unified multi-modal AI CLI")
  .version(CURRENT_VERSION, "-v, --version", "Print version and exit")
  .helpOption("-h, --help", "Show help")
  .addOption(new Option("--status", "Print resolved config and provider health"))
  .addOption(new Option("--install", "Alias for the init subcommand"))
  .addOption(new Option("--update", "Check for a newer npm version and update"))
  .addOption(new Option("--uninstall", "Remove local .ai-powered/ directory and hooks"));

// Attach global flags to root so subcommands can access them via optsWithGlobals().
addGlobalFlags(program);

// ---------------------------------------------------------------------------
// Lifecycle flag handlers (executed in the root action hook)
// ---------------------------------------------------------------------------
const LOCAL_CONFIG_DIR = path.join(process.cwd(), ".ai-powered");
const LOCAL_CONFIG_PATH = path.join(LOCAL_CONFIG_DIR, "config.json");
const GITIGNORE_PATH = path.join(process.cwd(), ".gitignore");
const LOCAL_LOGS_DIR = path.join(process.cwd(), "logs");
const LOG_FILE_PATH = path.join(LOCAL_LOGS_DIR, "ai-powered.jsonl");

/** Sensitive files that must never be tracked by git. */
const SENSITIVE_FILES = [".env", ".env.local", ".env.production", ".ai-powered/config.json"];

/**
 * Checks whether any sensitive credential files are currently tracked by git.
 * Returns an array of paths that are tracked (should be empty in a secure repo).
 * Returns an empty array if git is unavailable or we are not in a git repo.
 */
function checkGitTrackedCredentials(): string[] {
  try {
    const gitCheck = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd: process.cwd(),
    });
    if (gitCheck.status !== 0) return []; // Not a git repo

    const tracked: string[] = [];
    for (const file of SENSITIVE_FILES) {
      const result = spawnSync("git", ["ls-files", "--error-unmatch", file], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        cwd: process.cwd(),
      });
      if (result.status === 0) tracked.push(file);
    }
    return tracked;
  } catch {
    return [];
  }
}

function handleStatus(): void {
  try {
    const config = loadConfig();
    const display = { ...config, apiKey: maskApiKey(config.apiKey ?? "") };

    console.log(JSON.stringify(display, null, 2));
  } catch (err) {
    console.error("Config error:", err instanceof Error ? err.message : String(err));
    process.exit(EXIT_FAIL);
  }
}

function handleInit(): void {
  // --- Scaffold .ai-powered/ config dir ---
  if (!fs.existsSync(LOCAL_CONFIG_DIR)) {
    fs.mkdirSync(LOCAL_CONFIG_DIR, { recursive: true });

    console.log(`Created ${LOCAL_CONFIG_DIR}`);
  }
  if (!fs.existsSync(LOCAL_CONFIG_PATH)) {
    const scaffold = { version: CURRENT_VERSION, provider: "openai", modality: "text" };
    fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(scaffold, null, 2) + "\n", "utf-8");

    console.log(`Created ${LOCAL_CONFIG_PATH}`);
  }

  // --- Scaffold logs/ directory ---
  if (!fs.existsSync(LOCAL_LOGS_DIR)) {
    fs.mkdirSync(LOCAL_LOGS_DIR, { recursive: true });

    console.log(`Created ${LOCAL_LOGS_DIR}`);
  }

  // --- Update .gitignore ---
  if (fs.existsSync(GITIGNORE_PATH)) {
    const content = fs.readFileSync(GITIGNORE_PATH, "utf-8");
    const additions: string[] = [];
    if (!content.includes(".ai-powered/")) additions.push(".ai-powered/");
    if (!content.includes("logs/")) additions.push("logs/");
    if (additions.length > 0) {
      fs.appendFileSync(
        GITIGNORE_PATH,
        `\n# ai-powered local config and logs\n${additions.join("\n")}\n`,
      );

      console.log(`Added to .gitignore: ${additions.join(", ")}`);
    }
  }

  console.log(
    '\nNext steps:\n  1. Edit .ai-powered/config.json\n  2. Run: ai-powered text "Hello!"',
  );
}

function handleUninstall(): void {
  if (fs.existsSync(LOCAL_CONFIG_DIR)) {
    fs.rmSync(LOCAL_CONFIG_DIR, { recursive: true, force: true });

    console.log(`Removed ${LOCAL_CONFIG_DIR}`);
  } else {
    console.log("Nothing to uninstall.");
  }
}

async function handleUpdate(): Promise<void> {
  const { execSync } = await import("node:child_process");
  try {
    const latest = execSync("npm show ai-powered version", { encoding: "utf-8" }).trim();

    console.log(`Current: ${CURRENT_VERSION}  Latest: ${latest}`);
    if (latest !== CURRENT_VERSION) {
      execSync("npm install -g ai-powered@latest", { stdio: "inherit" });

      console.log("Updated successfully. Run 'ai-powered --status' to verify.");
    } else {
      console.log("Already up to date.");
    }
  } catch {
    console.error("Update failed. Ensure npm is in PATH and you have network access.");
    process.exit(EXIT_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Helper: merge global opts into AiConfig overrides
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toConfigOverrides(opts: Record<string, any>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (opts["provider"]) overrides["provider"] = opts["provider"];
  if (opts["model"]) overrides["model"] = opts["model"];
  if (opts["apiKey"]) overrides["apiKey"] = opts["apiKey"];
  if (opts["temperature"] !== undefined) overrides["temperature"] = opts["temperature"];
  if (opts["maxTokens"] !== undefined) overrides["maxTokens"] = opts["maxTokens"];
  if (opts["mock"]) overrides["mock"] = true;
  if (opts["fallback"] === false) overrides["fallback"] = false;
  if (opts["budgetSession"] !== undefined) overrides["budgetSession"] = opts["budgetSession"];
  if (opts["warnBudget"] !== undefined) overrides["warnBudget"] = opts["warnBudget"];
  if (opts["debug"]) overrides["debug"] = true;
  if (opts["profile"]) overrides["profile"] = opts["profile"];
  return overrides;
}

/** Read full stdin into a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

/**
 * Serialise `obj` to a JSON line and write it to `stream`.
 * Used by the batch command for NDJSON output (stdout or file).
 */
function writeLine(obj: object, stream: NodeJS.WritableStream): void {
  stream.write(JSON.stringify(obj) + "\n");
}

// ---------------------------------------------------------------------------
// Session persistence helpers
// ---------------------------------------------------------------------------
const SESSION_DIR = path.join(os.homedir(), ".ai-powered", "sessions");

type Message = { role: "user" | "assistant" | "system"; content: string };

function loadSession(id: string): Message[] {
  const file = path.join(SESSION_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Message[];
  } catch {
    return [];
  }
}

function saveSession(id: string, messages: Message[]): void {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SESSION_DIR, `${id}.json`),
    JSON.stringify(messages, null, 2) + "\n",
    "utf-8",
  );
}

/** Format prior messages as conversation history prepended to the prompt. */
function buildSessionPrompt(history: Message[], userPrompt: string): string {
  if (history.length === 0) return userPrompt;
  const lines = history.map((m) => `${m.role.toUpperCase()}: ${m.content}`);
  return `${lines.join("\n")}\nUSER: ${userPrompt}`;
}

// ---------------------------------------------------------------------------
// KV collector: --var key=value
// ---------------------------------------------------------------------------

function collectKv(val: string, acc: Record<string, string>): Record<string, string> {
  const sep = val.indexOf("=");
  if (sep < 0) throw new Error(`--var must be in key=value format, got: ${val}`);
  acc[val.slice(0, sep)] = val.slice(sep + 1);
  return acc;
}

// ---------------------------------------------------------------------------
// JSON Schema → Zod converter (subset: string/number/integer/boolean/object/array/enum)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonSchemaToZod(schema: Record<string, any>): z.ZodTypeAny {
  if (schema["enum"]) {
    const vals = schema["enum"] as [string, ...string[]];
    return z.enum(vals);
  }
  const type: string = Array.isArray(schema["type"])
    ? ((schema["type"] as string[]).find((t) => t !== "null") ?? "string")
    : ((schema["type"] as string | undefined) ?? "string");

  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array": {
      const items = schema["items"]
        ? jsonSchemaToZod(schema["items"] as Record<string, unknown>)
        : z.unknown();
      return z.array(items);
    }
    case "object": {
      const props = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
      if (!props) return z.record(z.unknown());
      const shape: Record<string, z.ZodTypeAny> = {};
      const required = (schema["required"] as string[] | undefined) ?? [];
      for (const [k, v] of Object.entries(props)) {
        const field = jsonSchemaToZod(v);
        shape[k] = required.includes(k) ? field : field.optional();
      }
      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}

/** Load a Zod schema from --schema value: inline JSON, .ts/.js file, or JSON Schema file. */
async function loadSchema(schemaArg: string): Promise<z.ZodTypeAny> {
  // Inline JSON string
  if (schemaArg.trimStart().startsWith("{") || schemaArg.trimStart().startsWith("[")) {
    return jsonSchemaToZod(JSON.parse(schemaArg) as Record<string, unknown>);
  }
  // File
  const ext = path.extname(schemaArg).toLowerCase();
  if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
    const mod = (await import(path.resolve(schemaArg))) as Record<string, unknown>;
    const s = (mod["default"] ?? mod["schema"]) as z.ZodTypeAny | undefined;
    if (!s || typeof s.parse !== "function") {
      throw new Error(
        `Schema file ${schemaArg} must export a Zod schema as default or named 'schema'`,
      );
    }
    return s;
  }
  // JSON Schema file
  const raw = JSON.parse(fs.readFileSync(schemaArg, "utf-8")) as Record<string, unknown>;
  return jsonSchemaToZod(raw);
}

// ---------------------------------------------------------------------------
// text command
// ---------------------------------------------------------------------------
const textCmd = new Command("text")
  .description("Generate text from a prompt")
  .argument("[prompt]", "Prompt text (reads stdin if omitted)")
  .addOption(new Option("--template <name>", "Named prompt template to use"))
  .addOption(
    new Option("--var <key=value>", "Template variable (repeatable)")
      .argParser(collectKv)
      .default({}),
  )
  .addOption(new Option("--session <id>", "Session ID for multi-turn conversation"))
  .action(async (promptArg: string | undefined, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const templateName = opts["template"] as string | undefined;
    const vars = opts["var"] as Record<string, string>;
    const sessionId = opts["session"] as string | undefined;

    let prompt: string;
    if (templateName) {
      const config = loadConfig(toConfigOverrides(opts) as never);
      const tpl = getTemplate(templateName, (config.templateDirs ?? []) as string[]);
      prompt = renderTemplate(tpl, vars);
    } else {
      prompt = promptArg ?? (await readStdin());
    }
    if (!prompt) {
      process.stderr.write("Error: prompt required\n");
      process.exit(EXIT_ERROR);
    }

    if (opts["dryRun"]) {
      const dryConfig = loadConfig(toConfigOverrides(opts) as never);
      const dryModel = (dryConfig.model as string | undefined) ?? "gpt-4o";
      const estTokens = estimateTokens(prompt);
      const estCost = estimateCost(dryModel, prompt);

      console.log(
        JSON.stringify({
          dryRun: true,
          prompt,
          model: dryModel,
          estimatedTokens: estTokens,
          estimatedCostUsd: estCost.totalUsd,
          isEstimate: true,
        }),
      );
      return;
    }

    // Session: load prior history and build augmented prompt
    const history = sessionId ? loadSession(sessionId) : [];
    const fullPrompt = sessionId ? buildSessionPrompt(history, prompt) : prompt;

    const client = await getAiClient("cli-text", toConfigOverrides(opts) as never);
    if (opts["stream"]) {
      for await (const chunk of client.streamText(fullPrompt)) {
        if (!opts["quiet"]) process.stdout.write(chunk);
      }
      process.stdout.write("\n");
    } else {
      const result = await client.generateText(fullPrompt);
      // Persist session
      if (sessionId) {
        history.push({ role: "user", content: prompt });
        history.push({ role: "assistant", content: result.content });
        saveSession(sessionId, history);
      }
      if (opts["json"]) {
        console.log(
          JSON.stringify({
            content: result.content,
            usage: result.usage,
            model: result.model,
            cost: result.cost,
            modality: result.modality,
          }),
        );
      } else {
        process.stdout.write(result.content + "\n");
      }
    }
  });
addGlobalFlags(textCmd);

// ---------------------------------------------------------------------------
// image command
// ---------------------------------------------------------------------------
const imageCmd = new Command("image")
  .description("Generate an image from a prompt")
  .argument("[prompt]", "Prompt text (reads stdin if omitted)")
  .addOption(new Option("--output <file>", "Write binary output to file"))
  .addOption(new Option("--template <name>", "Named prompt template to use"))
  .addOption(
    new Option("--var <key=value>", "Template variable (repeatable)")
      .argParser(collectKv)
      .default({}),
  )
  .addOption(new Option("--aspect-ratio <ratio>", "Desired aspect ratio (e.g. 16:9, 1:1)"))
  .addOption(new Option("--width <px>", "Output width in pixels").argParser((v) => parseInt(v, 10)))
  .addOption(
    new Option("--height <px>", "Output height in pixels").argParser((v) => parseInt(v, 10)),
  )
  .addOption(new Option("--resolution <preset>", "Resolution preset (e.g. 1k, 2k, 720p, 1080p)"))
  .action(async (promptArg: string | undefined, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const templateName = opts["template"] as string | undefined;
    const vars = opts["var"] as Record<string, string>;

    let prompt: string;
    if (templateName) {
      const config = loadConfig(toConfigOverrides(opts) as never);
      const tpl = getTemplate(templateName, (config.templateDirs ?? []) as string[]);
      prompt = renderTemplate(tpl, vars);
    } else {
      prompt = promptArg ?? (await readStdin());
    }
    if (!prompt) {
      process.stderr.write("Error: prompt required\n");
      process.exit(EXIT_ERROR);
    }

    // Build per-call generation options from flags.
    const imageCallOpts: ProviderCallOptions = {};
    const ar = opts["aspectRatio"] as string | undefined;
    const w = opts["width"] as number | undefined;
    const h = opts["height"] as number | undefined;
    const res = opts["resolution"] as string | undefined;
    if (ar) imageCallOpts.aspectRatio = ar;
    if (w !== undefined) imageCallOpts.width = w;
    if (h !== undefined) imageCallOpts.height = h;
    if (res) imageCallOpts.resolution = res;

    const client = await getAiClient("cli-image", toConfigOverrides(opts) as never);
    const result = await client.generateImage(prompt, imageCallOpts);
    const outFile = opts["output"] as string | undefined;
    if (outFile) {
      const data = Buffer.from(result.data.replace(/^data:[^,]+,/, ""), "base64");
      fs.writeFileSync(outFile, data);
      process.stderr.write(`Saved to ${outFile}\n`);
    } else if (opts["json"]) {
      console.log(
        JSON.stringify({ data: result.data, mimeType: result.mimeType, cost: result.cost }),
      );
    } else {
      process.stderr.write(
        "Warning: use --output <file> to save the image or --json for base64.\n",
      );
    }
  });
addGlobalFlags(imageCmd);

// ---------------------------------------------------------------------------
// audio command (sub-commands: transcribe, speak)
// ---------------------------------------------------------------------------
const audioCmd = new Command("audio").description("Audio transcription and speech synthesis");

const transcribeCmd = new Command("transcribe")
  .description("Transcribe audio from a file")
  .argument("<file>", "Path to audio file")
  .action(async (file: string, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const buffer = fs.readFileSync(file);
    const client = await getAiClient("cli-transcribe", toConfigOverrides(opts) as never);
    const result = await client.transcribeAudio(buffer);
    if (opts["json"]) {
      console.log(
        JSON.stringify({ text: result.text, language: result.language, cost: result.cost }),
      );
    } else {
      process.stdout.write(result.text + "\n");
    }
  });
addGlobalFlags(transcribeCmd);

const speakCmd = new Command("speak")
  .description("Synthesize speech from text")
  .argument("[text]", "Text to synthesize (reads stdin if omitted)")
  .addOption(new Option("--output <file>", "Write audio to file"))
  .addOption(new Option("--template <name>", "Named prompt template to use"))
  .addOption(
    new Option("--var <key=value>", "Template variable (repeatable)")
      .argParser(collectKv)
      .default({}),
  )
  .action(async (textArg: string | undefined, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const templateName = opts["template"] as string | undefined;
    const vars = opts["var"] as Record<string, string>;

    let text: string;
    if (templateName) {
      const config = loadConfig(toConfigOverrides(opts) as never);
      const tpl = getTemplate(templateName, (config.templateDirs ?? []) as string[]);
      text = renderTemplate(tpl, vars);
    } else {
      text = textArg ?? (await readStdin());
    }
    if (!text) {
      process.stderr.write("Error: text required\n");
      process.exit(EXIT_ERROR);
    }
    const client = await getAiClient("cli-speak", toConfigOverrides(opts) as never);
    const result = await client.synthesizeSpeech(text);
    const outFile = opts["output"] as string | undefined;
    if (outFile) {
      fs.writeFileSync(outFile, result.audio);
      process.stderr.write(`Saved to ${outFile}\n`);
    } else if (opts["json"]) {
      console.log(
        JSON.stringify({
          audio: result.audio.toString("base64"),
          mimeType: result.mimeType,
          cost: result.cost,
        }),
      );
    } else {
      process.stderr.write("Warning: use --output <file> or --json to retrieve audio.\n");
    }
  });
addGlobalFlags(speakCmd);

audioCmd.addCommand(transcribeCmd).addCommand(speakCmd);

// ---------------------------------------------------------------------------
// video command
// ---------------------------------------------------------------------------
const videoCmd = new Command("video")
  .description("Generate a video from a prompt")
  .argument("[prompt]", "Prompt text (reads stdin if omitted)")
  .addOption(new Option("--output <file>", "Write video output to file"))
  .addOption(new Option("--aspect-ratio <ratio>", "Desired aspect ratio (e.g. 16:9)"))
  .addOption(new Option("--resolution <preset>", "Resolution preset (e.g. 720p, 1080p)"))
  .addOption(
    new Option("--duration <secs>", "Video duration in seconds").argParser((v) => parseInt(v, 10)),
  )
  .addOption(new Option("--fps <n>", "Frames per second").argParser((v) => parseInt(v, 10)))
  .addOption(new Option("--quality <level>", "Quality hint: draft | standard | high"))
  .action(async (promptArg: string | undefined, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const prompt = promptArg ?? (await readStdin());
    if (!prompt) {
      process.stderr.write("Error: prompt required\n");
      process.exit(EXIT_ERROR);
    }

    // Build per-call generation options from flags.
    const videoCallOpts: ProviderCallOptions = {};
    const ar = opts["aspectRatio"] as string | undefined;
    const res = opts["resolution"] as string | undefined;
    const dur = opts["duration"] as number | undefined;
    const fps = opts["fps"] as number | undefined;
    const quality = opts["quality"] as "draft" | "standard" | "high" | undefined;
    if (ar) videoCallOpts.aspectRatio = ar;
    if (res) videoCallOpts.resolution = res;
    if (dur !== undefined) videoCallOpts.duration = dur;
    if (fps !== undefined) videoCallOpts.fps = fps;
    if (quality) videoCallOpts.quality = quality;

    const client = await getAiClient("cli-video", toConfigOverrides(opts) as never);
    const result = await client.generateVideo(prompt, videoCallOpts);
    const outFile = opts["output"] as string | undefined;
    if (outFile) {
      const data = Buffer.from((result.data as string).replace(/^data:[^,]+,/, ""), "base64");
      fs.writeFileSync(outFile, data);
      process.stderr.write(`Saved to ${outFile}\n`);
    } else if (opts["json"]) {
      console.log(JSON.stringify(result));
    } else {
      process.stderr.write(
        "Warning: use --output <file> to save the video or --json for base64.\n",
      );
    }
  });
addGlobalFlags(videoCmd);

// ---------------------------------------------------------------------------
// structured command
// ---------------------------------------------------------------------------
const structuredCmd = new Command("structured")
  .description("Generate structured JSON output validated against a schema")
  .argument("[prompt]", "Prompt text (reads stdin if omitted)")
  .addOption(new Option("--schema <spec>", "JSON Schema file, Zod schema file, or inline JSON"))
  .addOption(
    new Option("--max-retries <n>", "Max validation retries (default 2)")
      .argParser((v) => parseInt(v, 10))
      .default(2),
  )
  .addOption(new Option("--template <name>", "Named prompt template"))
  .addOption(
    new Option("--var <key=value>", "Template variable (repeatable)")
      .argParser(collectKv)
      .default({}),
  )
  .action(async (promptArg: string | undefined, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const schemaArg = opts["schema"] as string | undefined;
    const maxRetries = opts["maxRetries"] as number;
    const templateName = opts["template"] as string | undefined;
    const vars = opts["var"] as Record<string, string>;

    let prompt: string;
    if (templateName) {
      const config = loadConfig(toConfigOverrides(opts) as never);
      const tpl = getTemplate(templateName, (config.templateDirs ?? []) as string[]);
      prompt = renderTemplate(tpl, vars);
    } else {
      prompt = promptArg ?? (await readStdin());
    }
    if (!prompt) {
      process.stderr.write("Error: prompt required\n");
      process.exit(EXIT_ERROR);
    }

    const schema: z.ZodTypeAny = schemaArg ? await loadSchema(schemaArg) : z.record(z.unknown());

    const client = await getAiClient("cli-structured", toConfigOverrides(opts) as never);

    let lastIssues: string[] = [];
    let lastRaw: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await client.generateStructured(prompt, schema);
        if (opts["json"]) {
          console.log(JSON.stringify(result));
        } else {
          process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
        }
        return;
      } catch (err) {
        lastRaw = err;
        lastIssues = err instanceof Error ? [err.message] : [String(err)];
        if (attempt < maxRetries) {
          process.stderr.write(
            `Validation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying…\n`,
          );
        }
      }
    }
    throw new ValidationError(lastIssues, lastRaw);
  });
addGlobalFlags(structuredCmd);

// ---------------------------------------------------------------------------
// wizard command (alias: setup)
// ---------------------------------------------------------------------------
const wizardCmd = new Command("wizard")
  .alias("setup")
  .description("Interactive setup wizard for provider, API key, and model configuration")
  .addOption(
    new Option("--template", "Create a custom prompt template instead of configuring a provider"),
  )
  .action(async (_opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    await runWizard(opts["template"] ? { templateMode: true } : {});
  });

// ---------------------------------------------------------------------------
// list-templates command
// ---------------------------------------------------------------------------
const listTemplatesCmd = new Command("list-templates")
  .description("List available prompt templates (built-in and user-defined)")
  .action((_opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const config = loadConfig(toConfigOverrides(opts) as never);
    const templates = listTemplates((config.templateDirs ?? []) as string[]);
    if (opts["json"]) {
      console.log(JSON.stringify(templates, null, 2));
    } else {
      for (const t of templates) {
        process.stdout.write(`${t.name.padEnd(20)} [${t.modality}]  ${t.description}\n`);
      }
    }
  });
addGlobalFlags(listTemplatesCmd);

// ---------------------------------------------------------------------------
// list-models command
// ---------------------------------------------------------------------------
const listModelsCmd = new Command("list-models")
  .description("List models available from the active provider")
  .argument("[modality]", "Filter by modality (text|image|audio|video|structured)")
  .action(async (modalityArg: string | undefined, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const client = await getAiClient("cli-list-models", toConfigOverrides(opts) as never);
    const models = await client.listModels(modalityArg as never);

    console.log(JSON.stringify(models, null, 2));
  });
addGlobalFlags(listModelsCmd);

// ---------------------------------------------------------------------------
// config command (get / set / list / delete / reset / path / validate)
// ---------------------------------------------------------------------------
const GLOBAL_CONFIG_PATH_CLI = path.join(os.homedir(), ".ai-powered", "config.json");

const configCmd = new Command("config").description("Manage ai-powered configuration");

configCmd
  .command("get <key>")
  .description("Get a config value (API keys are masked)")
  .action((_key: string, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const config = loadConfig(toConfigOverrides(opts) as never) as Record<string, unknown>;
    const val = config[_key];
    const display =
      _key.toLowerCase().includes("key") && typeof val === "string" ? maskApiKey(val) : val;
    if (opts["json"]) {
      console.log(JSON.stringify({ [_key]: display }));
    } else {
      process.stdout.write(`${_key}: ${JSON.stringify(display)}\n`);
    }
  });

configCmd
  .command("set <key> <value>")
  .description("Set a config value in the global config file")
  .action((_key: string, _value: string, _opts, _cmd: Command) => {
    writeConfig(GLOBAL_CONFIG_PATH_CLI, { [_key]: _value } as never);
    process.stdout.write(`Set ${_key}\n`);
  });

configCmd
  .command("list")
  .description("List all resolved config values (API keys masked)")
  .action((_opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const config = loadConfig(toConfigOverrides(opts) as never) as Record<string, unknown>;
    const display = Object.fromEntries(
      Object.entries(config).map(([k, v]) => [
        k,
        k.toLowerCase().includes("key") && typeof v === "string" ? maskApiKey(v) : v,
      ]),
    );
    if (opts["json"]) {
      console.log(JSON.stringify(display, null, 2));
    } else {
      for (const [k, v] of Object.entries(display)) {
        process.stdout.write(`${k}: ${JSON.stringify(v)}\n`);
      }
    }
  });

configCmd
  .command("delete <key>")
  .description("Remove a key from the global config file")
  .action((_key: string) => {
    if (!fs.existsSync(GLOBAL_CONFIG_PATH_CLI)) {
      process.stderr.write("No global config file found.\n");
      return;
    }
    const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH_CLI, "utf-8")) as Record<
      string,
      unknown
    >;
    delete cfg[_key];
    fs.writeFileSync(GLOBAL_CONFIG_PATH_CLI, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    process.stdout.write(`Deleted ${_key}\n`);
  });

configCmd
  .command("reset")
  .description("Reset the global config to defaults (prompts for confirmation)")
  .action(async () => {
    const { confirm } = await import("@inquirer/prompts");
    const ok = await confirm({
      message: "Reset global config? This cannot be undone.",
      default: false,
    });
    if (!ok) {
      process.stdout.write("Cancelled.\n");
      return;
    }
    const scaffold = { version: CURRENT_VERSION, provider: "openai", modality: "text" };
    if (!fs.existsSync(path.dirname(GLOBAL_CONFIG_PATH_CLI))) {
      fs.mkdirSync(path.dirname(GLOBAL_CONFIG_PATH_CLI), { recursive: true });
    }
    fs.writeFileSync(GLOBAL_CONFIG_PATH_CLI, JSON.stringify(scaffold, null, 2) + "\n", "utf-8");
    process.stdout.write(`Config reset to defaults: ${GLOBAL_CONFIG_PATH_CLI}\n`);
  });

configCmd
  .command("path")
  .description("Print the path to the active global config file")
  .action(() => {
    process.stdout.write(GLOBAL_CONFIG_PATH_CLI + "\n");
  });

configCmd
  .command("validate")
  .description("Validate the active config against the Zod schema")
  .action((_opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    try {
      loadConfig(toConfigOverrides(opts) as never);
      process.stdout.write("Config is valid.\n");
    } catch (err) {
      process.stderr.write(`Config invalid: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT_FAIL);
    }
  });

addGlobalFlags(configCmd);

// ---------------------------------------------------------------------------
// health-check command
// ---------------------------------------------------------------------------
const healthCmd = new Command("health-check")
  .description("Validate config, check API keys, probe provider connectivity")
  .action(async (_opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const checks: Array<{ check: string; status: "pass" | "fail"; message: string }> = [];
    let allPass = true;

    // 1. Config valid?
    try {
      const overrides = toConfigOverrides(opts);
      const config = loadConfig(Object.keys(overrides).length ? { flags: overrides } : {});
      checks.push({ check: "config", status: "pass", message: `provider=${config.provider}` });

      // 2. API key present?
      const key = config.apiKey ?? "";
      if (config.mock || key.length > 0) {
        checks.push({ check: "api-key", status: "pass", message: maskApiKey(key || "mock") });
      } else {
        allPass = false;
        checks.push({ check: "api-key", status: "fail", message: "API key missing or empty" });
      }
    } catch (err) {
      allPass = false;
      checks.push({
        check: "config",
        status: "fail",
        message: err instanceof Error ? err.message : String(err),
      });
      checks.push({ check: "api-key", status: "fail", message: "skipped (config invalid)" });
    }

    // 3. Git-tracked credential files?
    const gitTracked = checkGitTrackedCredentials();
    if (gitTracked.length === 0) {
      checks.push({
        check: "git-credentials",
        status: "pass",
        message: "No sensitive files tracked by git",
      });
    } else {
      allPass = false;
      checks.push({
        check: "git-credentials",
        status: "fail",
        message: `Sensitive files tracked by git: ${gitTracked.join(", ")} — run: git rm --cached <file>`,
      });
    }

    if (opts["json"]) {
      console.log(JSON.stringify(checks, null, 2));
    } else {
      for (const c of checks) {
        const icon = c.status === "pass" ? "✓" : "✗";
        process.stdout.write(`${icon} ${c.check}: ${c.message}\n`);
      }
    }
    process.exit(allPass ? EXIT_OK : EXIT_FAIL);
  });
addGlobalFlags(healthCmd);

// ---------------------------------------------------------------------------
// batch command
// ---------------------------------------------------------------------------
const batchCmd = new Command("batch")
  .description("Process multiple prompts from a JSONL file")
  .argument("<mode>", "Modality mode (text|image|audio|video|structured)")
  .addOption(new Option("--input <file>", "Input JSONL file, or - to read from stdin"))
  .addOption(new Option("--output <file>", "Output JSONL file, or - to write to stdout"))
  .addOption(
    new Option("--concurrency <n>", "Max parallel requests (default 3)")
      .argParser((v) => parseInt(v, 10))
      .default(3),
  )
  .action(async (mode: string, _opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    const inputFile = opts["input"] as string | undefined;
    const outputFile = opts["output"] as string | undefined;
    const concurrency = opts["concurrency"] as number;
    if (!inputFile) {
      process.stderr.write("Error: --input is required for batch\n");
      process.exit(EXIT_ERROR);
    }
    if (!outputFile) {
      process.stderr.write("Error: --output is required for batch\n");
      process.exit(EXIT_ERROR);
    }

    // Read all rows — from stdin when --input is '-'
    const rows: Array<Record<string, unknown>> = [];
    if (inputFile === "-") {
      const raw = await readStdin();
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          rows.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          process.stderr.write(`Skipping invalid JSON line: ${trimmed}\n`);
        }
      }
      if (rows.length === 0) {
        process.stderr.write("No batch items read from stdin\n");
        process.exit(EXIT_ERROR);
      }
    } else {
      const rl = readline.createInterface({ input: fs.createReadStream(inputFile) });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          rows.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          process.stderr.write(`Skipping invalid JSON line: ${trimmed}\n`);
        }
      }
    }

    // Write output — to stdout when --output is '-'
    const toStdout = outputFile === "-";
    const outStream = toStdout ? null : fs.createWriteStream(outputFile, { flags: "w" });
    // targetStream is the active NDJSON output destination used by writeLine().
    const targetStream: NodeJS.WritableStream = toStdout ? process.stdout : outStream!;

    const batchConfig = loadConfig(toConfigOverrides(opts) as never);
    // MODE_DEFAULT_MODELS: per-modality sensible defaults so --dry-run uses the
    // correct pricing path for each mode (e.g. video → luma, not gpt-4o).
    // Add a new entry here whenever a new modality is added to the batch command.
    const MODE_DEFAULT_MODELS: Record<string, string> = {
      video: "luma-ray-flash-2-720p",
      image: "dall-e-3",
      audio: "tts-1",
      structured: "gpt-4o",
      text: "gpt-4o",
    };
    const batchModel =
      (opts["model"] as string | undefined) ??
      (batchConfig.model as string | undefined) ??
      MODE_DEFAULT_MODELS[mode] ??
      "gpt-4o";
    const client = await getAiClient("cli-batch", toConfigOverrides(opts) as never);
    let idx = 0;

    // Process rows in sliding-window concurrency
    async function processRow(row: Record<string, unknown>): Promise<void> {
      const prompt = String(row["prompt"] ?? "");
      try {
        let response: unknown;
        if (opts["dryRun"]) {
          const estTokens = estimateTokens(prompt);
          const estCost = estimateCost(batchModel, prompt);
          response = {
            dryRun: true,
            model: batchModel,
            estimatedTokens: estTokens,
            estimatedCostUsd: estCost.totalUsd,
            isEstimate: true,
          };
        } else if (mode === "text") {
          const r = await client.generateText(prompt);
          response = { content: r.content, usage: r.usage, cost: r.cost };
        } else if (mode === "image") {
          const r = await client.generateImage(prompt);
          response = { data: r.data, mimeType: r.mimeType, cost: r.cost };
        } else if (mode === "video") {
          const videoOpts: Record<string, unknown> = {};
          if (row["duration"] !== undefined) videoOpts["duration"] = Number(row["duration"]);
          if (row["fps"] !== undefined) videoOpts["fps"] = Number(row["fps"]);
          if (row["aspectRatio"] !== undefined)
            videoOpts["aspectRatio"] = String(row["aspectRatio"]);
          if (row["resolution"] !== undefined) videoOpts["resolution"] = String(row["resolution"]);
          if (row["quality"] !== undefined) videoOpts["quality"] = String(row["quality"]);
          if (row["width"] !== undefined) videoOpts["width"] = Number(row["width"]);
          if (row["height"] !== undefined) videoOpts["height"] = Number(row["height"]);
          const r = await client.generateVideo(
            prompt,
            Object.keys(videoOpts).length ? (videoOpts as ProviderCallOptions) : undefined,
          );
          response = r;
        } else {
          const r = await client.generateText(prompt);
          response = { content: r.content, cost: r.cost };
        }
        writeLine({ prompt, response }, targetStream);
      } catch (err) {
        writeLine(
          { prompt, error: err instanceof Error ? err.message : String(err) },
          targetStream,
        );
      }
    }

    // Sliding window
    const running: Promise<void>[] = [];
    for (const row of rows) {
      if (running.length >= concurrency) await running.shift();
      running.push(processRow(row));
      if (!opts["quiet"] && !toStdout)
        process.stderr.write(`Processing row ${++idx}/${rows.length}\r`);
    }
    await Promise.all(running);
    if (!toStdout) {
      outStream?.end();
      if (!opts["quiet"])
        process.stderr.write(`\nBatch complete: ${rows.length} rows → ${outputFile}\n`);
    }
  });
addGlobalFlags(batchCmd);

// ---------------------------------------------------------------------------
// serve command
// ---------------------------------------------------------------------------
const serveCmd = new Command("serve")
  .description("Start a local HTTP proxy server for all ai-powered modalities")
  .addOption(
    new Option("--port <n>", "Port to listen on (default 3001)")
      .argParser((v) => parseInt(v, 10))
      .default(3001),
  )
  .addOption(
    new Option("--host <addr>", "Host to bind to (default 127.0.0.1)").default("127.0.0.1"),
  )
  .addOption(
    new Option(
      "--cors-origin <o>",
      "Allowed CORS origin or glob pattern, e.g. https://*.ngrok-free.dev (env: CORS_ORIGIN)",
    ).default(process.env["CORS_ORIGIN"] ?? "http://localhost:5173"),
  )
  .addOption(
    new Option("--rate-limit <n>", "Max requests per minute (default 60)")
      .argParser((v) => parseInt(v, 10))
      .default(60),
  )
  .addOption(new Option("--log-file <path>", "Append structured JSONL logs to this file"))
  .action(async (_opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    // Resolve the log file path: prefer the explicit --log-file flag, but fall
    // back to the standard log path when the global --log flag is present.
    const logFile: string | undefined =
      (opts["logFile"] as string | undefined) ?? (opts["log"] ? LOG_FILE_PATH : undefined);
    if (logFile && !fs.existsSync(LOCAL_LOGS_DIR)) {
      fs.mkdirSync(LOCAL_LOGS_DIR, { recursive: true });
    }
    const profile = opts["profile"] as string | undefined;
    await startServer({
      port: opts["port"] as number,
      host: opts["host"] as string,
      corsOrigin: opts["corsOrigin"] as string,
      rateLimit: opts["rateLimit"] as number,
      mock: Boolean(opts["mock"]),
      ...(profile !== undefined ? { profile } : {}),
      debug: Boolean(opts["debug"]),
      ...(logFile !== undefined ? { logFile } : {}),
      configOverrides: toConfigOverrides(opts) as never,
    });
    // Keep process alive until SIGINT/SIGTERM.
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  });
addGlobalFlags(serveCmd);

// ---------------------------------------------------------------------------
// session command (session list / session clear <id>)
// ---------------------------------------------------------------------------
const sessionCmd = new Command("session").description("Manage conversation sessions");

sessionCmd
  .command("list")
  .description("List active sessions with creation timestamps")
  .action((_opts, cmd: Command) => {
    const opts = cmd.optsWithGlobals<Record<string, unknown>>();
    if (!fs.existsSync(SESSION_DIR)) {
      process.stdout.write("No sessions found.\n");
      return;
    }
    const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      process.stdout.write("No sessions found.\n");
      return;
    }
    const sessions = files.map((f) => {
      const id = f.replace(/\.json$/, "");
      const stat = fs.statSync(path.join(SESSION_DIR, f));
      return { id, created: stat.birthtime.toISOString() };
    });
    if (opts["json"]) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      for (const s of sessions) process.stdout.write(`${s.id}  ${s.created}\n`);
    }
  });

sessionCmd
  .command("clear <id>")
  .description("Delete a session file")
  .action((id: string) => {
    const file = path.join(SESSION_DIR, `${id}.json`);
    if (!fs.existsSync(file)) {
      process.stderr.write(`Session not found: ${id}\n`);
      process.exit(EXIT_ERROR);
    }
    fs.unlinkSync(file);
    process.stdout.write(`Session cleared: ${id}\n`);
  });

addGlobalFlags(sessionCmd);

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------
const initCmd = new Command("init")
  .description("Scaffold .ai-powered/ config directory")
  .action(() => {
    handleInit();
  });

// ---------------------------------------------------------------------------
// Register all commands on root program
// ---------------------------------------------------------------------------
program
  .addCommand(initCmd)
  .addCommand(textCmd)
  .addCommand(imageCmd)
  .addCommand(audioCmd)
  .addCommand(videoCmd)
  .addCommand(structuredCmd)
  .addCommand(wizardCmd)
  .addCommand(listTemplatesCmd)
  .addCommand(listModelsCmd)
  .addCommand(configCmd)
  .addCommand(healthCmd)
  .addCommand(batchCmd)
  .addCommand(serveCmd)
  .addCommand(sessionCmd);

// ---------------------------------------------------------------------------
// preAction hook: propagate global flags before any subcommand runs
// ---------------------------------------------------------------------------
program.hook("preAction", (_thisCommand, actionCommand) => {
  const opts = actionCommand.optsWithGlobals<Record<string, unknown>>();

  // --no-color: Commander parses "--no-color" as opts.color === false
  if (opts["color"] === false) {
    process.env["NO_COLOR"] = "1";
    process.env["FORCE_COLOR"] = "0";
  }

  // --debug / --log: initialise structured logger for subcommands.
  // Root-program --log (no subcommand) prints the tail in program.action().
  const isSubcommand = actionCommand !== program;
  if (isSubcommand) {
    if (opts["log"]) {
      // Ensure the logs directory exists before opening the write stream.
      if (!fs.existsSync(LOCAL_LOGS_DIR)) {
        fs.mkdirSync(LOCAL_LOGS_DIR, { recursive: true });
      }
      initLogger({ debug: Boolean(opts["debug"]), logFile: LOG_FILE_PATH });
    } else {
      initLogger({ debug: Boolean(opts["debug"]) });
    }
  }
});

// ---------------------------------------------------------------------------
// Root action: handle lifecycle flags when no subcommand is given
// ---------------------------------------------------------------------------
program.action(async (opts: Record<string, unknown>) => {
  if (opts["status"]) {
    handleStatus();
    return;
  }
  if (opts["install"]) {
    handleInit();
    return;
  }
  if (opts["uninstall"]) {
    handleUninstall();
    return;
  }
  if (opts["update"]) {
    await handleUpdate();
    return;
  }
  if (opts["log"]) {
    const logPath = path.join(os.homedir(), ".ai-powered", "ai-powered.log");
    if (fs.existsSync(logPath)) {
      process.stdout.write(
        fs.readFileSync(logPath, "utf-8").split("\n").slice(-50).join("\n") + "\n",
      );
    } else {
      process.stderr.write(`No log file found at ${logPath}\n`);
    }
    return;
  }
  // No flag or subcommand — print help.
  program.help();
});

// ---------------------------------------------------------------------------
// Parse and run (ValidationError → exit code 2)
// ---------------------------------------------------------------------------
program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof ValidationError) {
    process.stderr.write(`Validation error: ${err.message}\n`);
    process.exit(EXIT_FAIL);
  }
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT_ERROR);
});
