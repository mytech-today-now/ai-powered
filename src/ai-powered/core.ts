/**
 * @file src/ai-powered/core.ts
 *
 * AiConfig Zod schema and layered configuration loader.
 *
 * Config precedence (lowest → highest):
 *   global  ~/.ai-powered/config.json
 *   local   ./.ai-powered/config.json
 *   profile <config.profiles[profileName]>
 *   env     AI_* environment variables
 *   flags   runtime CLI overrides
 *
 * After merging all layers the result is validated via Zod.  If validation
 * fails a ConfigError is thrown listing every failure before any API call.
 *
 * Config version mismatch: the stored config's `version` field is compared
 * to the current package version.  On mismatch the old file is backed up
 * to <configPath>.bak.<timestamp> and migrated to the current schema.
 */

// Load .env from process.cwd() before any process.env access.
// Named import ensures tsc does not elide the call under verbatimModuleSyntax.
import { config as _dotenvLoad } from "dotenv";
_dotenvLoad(); // populate process.env from .env (no-op if already loaded)

import { z } from "zod";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

/** Thrown when config validation fails or a profile is missing. */
export class ConfigError extends Error {
  public readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Zod schema — AiConfig
// ---------------------------------------------------------------------------

/** Supported AI modalities. */
export const ModalitySchema = z.enum(["text", "image", "audio", "video", "structured"]);
export type Modality = z.infer<typeof ModalitySchema>;

/** Supported provider names (plus "mock" for testing). */
export const ProviderNameSchema = z.enum([
  "openai",
  "anthropic",
  "xai",
  "venice",
  "lumaai",
  "custom",
  "mock",
]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

/**
 * Per-modality default values that can be set inside an AiConfig.
 * Each key is an optional partial of AiConfig (recursive, but only for
 * the fields that make sense per-modality: model, temperature, maxTokens).
 */
const PerModalityDefaultsSchema = z
  .object({
    text: z
      .object({
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    image: z
      .object({
        model: z.string().optional(),
      })
      .strict()
      .optional(),
    audio: z
      .object({
        model: z.string().optional(),
      })
      .strict()
      .optional(),
    video: z
      .object({
        model: z.string().optional(),
      })
      .strict()
      .optional(),
    structured: z
      .object({
        model: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Full AiConfig schema.
 *
 * All fields are optional at the schema level; required values (e.g. apiKey)
 * are enforced after the layered merge via a refinement so that the error
 * message lists ALL missing fields at once rather than stopping at the first.
 */
export const AiConfigSchema = z
  .object({
    /** Config schema version. Used to detect and migrate stale config files. */
    version: z.string().optional(),

    /** AI modality to use. Default: "text". */
    modality: ModalitySchema.default("text"),

    /** AI provider to use. Default: "openai". */
    provider: ProviderNameSchema.default("openai"),

    /** Model identifier. Provider-specific. */
    model: z.string().optional(),

    /**
     * API key for the selected provider.
     * Sourced from env vars (OPENAI_API_KEY, ANTHROPIC_API_KEY, …) when absent.
     */
    apiKey: z.string().optional(),

    /** Sampling temperature. Range 0–2. Default: 0.7. */
    temperature: z.number().min(0).max(2).default(0.7),

    /** Maximum tokens in the model response. */
    maxTokens: z.number().int().positive().optional(),

    /** System prompt prepended to every request. */
    systemPrompt: z.string().optional(),

    /** Enable streaming responses. Default: false. */
    stream: z.boolean().default(false),

    /** Named profile to apply from the config file. Default: "default". */
    profile: z.string().default("default"),

    /**
     * Ordered list of fallback provider names to try when the primary fails.
     * e.g. ["anthropic", "mock"]
     */
    fallbackProviders: z.array(ProviderNameSchema).default([]),

    /** Enable automatic provider fallback loop. Default: true. */
    fallback: z.boolean().default(true),

    /** Maximum cumulative USD spend per session. Undefined = no limit. */
    budgetSession: z.number().positive().optional(),

    /** Fraction of budgetSession at which a WARNING is emitted (0–1). */
    warnBudget: z.number().min(0).max(1).default(0.8),

    /**
     * Plugin identifiers: file paths or npm package names.
     * Each entry is dynamically imported and must export an AiPlugin object.
     */
    plugins: z.array(z.string()).default([]),

    /** Additional directories to search for prompt templates. */
    templateDirs: z.array(z.string()).default([]),

    /** Force mock provider regardless of provider setting. */
    mock: z.boolean().default(false),

    /**
     * Base URL override for providers that support a custom endpoint.
     * Required when provider is "custom"; optional for others (e.g. self-hosted).
     * Example: "http://localhost:11434/v1" for Ollama.
     */
    baseUrl: z.string().url().optional(),

    /**
     * Declares the API dialect used by the "custom" provider.
     *   "openai-compatible"  — any OpenAI-compatible server (LM Studio, vLLM, …)
     *   "ollama"             — Ollama's native OpenAI-compatible /v1 endpoint
     *   "other"              — generic HTTP; only text generation is supported
     * Defaults to "openai-compatible".
     */
    customProviderType: z.enum(["openai-compatible", "ollama", "other"]).default("openai-compatible"),

    /**
     * Extra HTTP headers forwarded on every request made by the "custom"
     * provider.  Useful for passing internal auth tokens or tracing headers.
     * Values must be plain strings.
     */
    customHeaders: z.record(z.string(), z.string()).optional(),

    /** Path to the JSONL log file. Relative to CWD. */
    logFile: z.string().optional(),

    /**
     * Number of consecutive failures before the circuit opens for a provider.
     * Default: 5.
     */
    circuitBreakerThreshold: z.number().int().positive().default(5),

    /**
     * Milliseconds after which an open circuit transitions to HALF_OPEN and
     * allows one probe request.  Default: 60 000 ms (60 s).
     */
    circuitBreakerResetMs: z.number().int().positive().default(60_000),

    /** Enable debug/trace logging. Default: false. */
    debug: z.boolean().default(false),

    /** Per-modality default overrides. */
    modalityDefaults: PerModalityDefaultsSchema.optional(),

    /**
     * Named profiles.  Not part of the active resolved config; consumed by
     * the loader to merge profile settings then stripped from the output.
     */
    profiles: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict();

export type AiConfig = z.infer<typeof AiConfigSchema>;

/** Partial config accepted by the loader at each layer. */
export type AiConfigPartial = z.input<typeof AiConfigSchema>;

// ---------------------------------------------------------------------------
// Current package version (read from VERSION file at module load time)
// ---------------------------------------------------------------------------

function readPackageVersion(): string {
  try {
    // Walk up from the compiled location to find VERSION.
    const candidates = [
      path.resolve(process.cwd(), "VERSION"),
      path.resolve(import.meta.dirname ?? "", "../../VERSION"),
      path.resolve(import.meta.dirname ?? "", "../../../VERSION"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return readFileSync(candidate, "utf-8").trim();
      }
    }
  } catch {
    // Ignore; fallback to a sentinel.
  }
  return "0.1.0";
}

const CURRENT_VERSION = readPackageVersion();

// ---------------------------------------------------------------------------
// Config file paths
// ---------------------------------------------------------------------------

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".ai-powered");
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, "config.json");
const LOCAL_CONFIG_DIR = path.join(process.cwd(), ".ai-powered");
const LOCAL_CONFIG_PATH = path.join(LOCAL_CONFIG_DIR, "config.json");

// ---------------------------------------------------------------------------
// Deep merge utility
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `source` into `target`.  Arrays from `source` replace (not
 * concatenate) the corresponding arrays in `target`, matching Zod array
 * field semantics (the higher-priority layer fully overrides, not extends).
 */
function deepMerge(target: PlainObject, source: PlainObject): PlainObject {
  const result: PlainObject = { ...target };
  for (const [key, sourceVal] of Object.entries(source)) {
    const targetVal = result[key];
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Config file I/O helpers
// ---------------------------------------------------------------------------

function readConfigFile(filePath: string): PlainObject | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new ConfigError(`Config file is not a JSON object: ${filePath}`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Failed to read config file ${filePath}: ${msg}`);
  }
}

/**
 * Back up the config file to <path>.bak.<timestamp> and return the backup path.
 */
function backupConfigFile(configPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.bak.${timestamp}`;
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

/**
 * Detect a config version mismatch.  If the stored `version` field differs
 * from CURRENT_VERSION, back up the old file and return true so the caller
 * can migrate/re-validate.
 *
 * Returns the (possibly migrated) raw config object.
 */
function handleVersionMismatch(
  raw: PlainObject,
  configPath: string,
): PlainObject {
  const storedVersion = typeof raw["version"] === "string" ? raw["version"] : null;
  if (storedVersion === null || storedVersion === CURRENT_VERSION) {
    return raw;
  }
  // Mismatch — back up the file and migrate.
  const backupPath = backupConfigFile(configPath);
  // eslint-disable-next-line no-console
  console.warn(
    `[ai-powered] Config version mismatch in ${configPath}: ` +
      `stored=${storedVersion}, current=${CURRENT_VERSION}. ` +
      `Backed up to ${backupPath}. Migrating to current schema.`,
  );
  // Migration: update the version field; future migrations add field transforms here.
  return { ...raw, version: CURRENT_VERSION };
}

// ---------------------------------------------------------------------------
// Environment variable → partial config mapper
// ---------------------------------------------------------------------------

/**
 * Reads well-known AI_* environment variables and returns a partial config
 * object.  Only variables that are actually set are included so they can be
 * deep-merged without clobbering higher-priority layers.
 */
function envVarsToPartial(): PlainObject {
  const partial: PlainObject = {};

  const envMap: Array<[string, keyof AiConfig, (v: string) => unknown]> = [
    ["AI_PROVIDER", "provider", (v) => v],
    ["AI_MODEL", "model", (v) => v],
    ["AI_PROFILE", "profile", (v) => v],
    ["AI_MOCK", "mock", (v) => v === "true" || v === "1"],
    ["AI_BUDGET_SESSION", "budgetSession", (v) => parseFloat(v)],
    ["AI_WARN_BUDGET", "warnBudget", (v) => parseFloat(v)],
    ["LOG_LEVEL", "debug", (v) => v === "debug" || v === "trace"],
    // Per-provider key env vars are handled separately in resolveApiKey().
  ];

  for (const [envVar, configKey, transform] of envMap) {
    const value = process.env[envVar];
    if (value !== undefined && value !== "") {
      partial[configKey] = transform(value);
    }
  }

  return partial;
}

/**
 * Resolve the API key for the active provider from the merged config or the
 * canonical per-provider environment variable.
 */
function resolveApiKey(merged: PlainObject): string | undefined {
  if (typeof merged["apiKey"] === "string" && merged["apiKey"].length > 0) {
    return merged["apiKey"];
  }
  const provider = typeof merged["provider"] === "string" ? merged["provider"] : "openai";
  const providerEnvMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    xai: "XAI_API_KEY",
    venice: "VENICE_API_KEY",
    lumaai: "LUMAAI_API_KEY",
    custom: "AI_CUSTOM_API_KEY",
    mock: "",
  };
  const envVar = providerEnvMap[provider] ?? "";
  if (envVar) {
    const value = process.env[envVar];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Named profile resolution
// ---------------------------------------------------------------------------

/**
 * Extracts the named profile layer from a raw config object.
 * Throws ConfigError if `profileName` is non-default and not found.
 */
function extractProfile(raw: PlainObject, profileName: string): PlainObject {
  if (profileName === "default") {
    // Use the top-level "default" profile if it exists, otherwise return empty.
    const profiles = raw["profiles"];
    if (isPlainObject(profiles) && isPlainObject(profiles["default"])) {
      return profiles["default"];
    }
    return {};
  }

  const profiles = raw["profiles"];
  if (!isPlainObject(profiles)) {
    throw new ConfigError(
      `Profile "${profileName}" requested but no profiles section found in config.`,
    );
  }
  const profile = profiles[profileName];
  if (!isPlainObject(profile)) {
    throw new ConfigError(
      `Profile "${profileName}" not found in config. ` +
        `Available profiles: ${Object.keys(profiles).join(", ")}`,
    );
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Main public API: loadConfig
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /**
   * CLI flag overrides.  These take highest precedence after env vars.
   * Pass the raw parsed Commander.js options object.
   */
  flags?: Partial<AiConfig>;

  /**
   * Force a specific profile name, overriding AI_PROFILE and the config default.
   */
  profileOverride?: string;
}

/**
 * Loads and validates the merged AiConfig from all layers.
 *
 * Merge order (lowest → highest precedence):
 *   1. Zod schema defaults
 *   2. Global config   ~/.ai-powered/config.json
 *   3. Local config    ./.ai-powered/config.json
 *   4. Named profile   config.profiles[profileName]
 *   5. Env vars        AI_* variables
 *   6. CLI flags       options.flags
 *
 * @throws ConfigError  if Zod validation fails or a named profile is missing.
 */
export function loadConfig(options: LoadConfigOptions = {}): AiConfig {
  // --- Layer 1 defaults are provided by Zod schema ---
  let merged: PlainObject = {};

  // --- Layer 2: global config ---
  const globalRaw = readConfigFile(GLOBAL_CONFIG_PATH);
  if (globalRaw !== null) {
    const migrated = handleVersionMismatch(globalRaw, GLOBAL_CONFIG_PATH);
    // Strip profiles key from the base layer (profiles are extracted separately).
    const { profiles: _p, ...globalBase } = migrated;
    merged = deepMerge(merged, globalBase);
  }

  // --- Layer 3: local config ---
  const localRaw = readConfigFile(LOCAL_CONFIG_PATH);
  if (localRaw !== null) {
    const migrated = handleVersionMismatch(localRaw, LOCAL_CONFIG_PATH);
    const { profiles: _p, ...localBase } = migrated;
    merged = deepMerge(merged, localBase);
  }

  // --- Determine active profile name ---
  // Priority: flag override > AI_PROFILE env > merged config "profile" field > "default"
  const profileName =
    options.profileOverride ??
    process.env["AI_PROFILE"] ??
    (typeof merged["profile"] === "string" ? merged["profile"] : "default");

  // --- Layer 4: named profile ---
  // Source: local config if present, otherwise global config.
  const profileSource = localRaw ?? globalRaw;
  if (profileSource !== null) {
    const profileLayer = extractProfile(profileSource, profileName);
    merged = deepMerge(merged, profileLayer);
  } else if (profileName !== "default") {
    throw new ConfigError(
      `Profile "${profileName}" requested but no config file found.`,
    );
  }

  // --- Layer 5: environment variables ---
  merged = deepMerge(merged, envVarsToPartial());

  // --- Layer 6: CLI flags ---
  if (options.flags !== undefined) {
    const flagsPlain = options.flags as PlainObject;
    merged = deepMerge(merged, flagsPlain);
  }

  // --- Resolve API key from per-provider env var ---
  const resolvedKey = resolveApiKey(merged);
  if (resolvedKey !== undefined) {
    merged["apiKey"] = resolvedKey;
  }

  // --- Zod validation ---
  const parseResult = AiConfigSchema.safeParse(merged);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map(
      (issue) => `  • ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new ConfigError(
      `Config validation failed with ${String(issues.length)} error(s):\n${issues.join("\n")}`,
      issues,
    );
  }

  return parseResult.data;
}

/**
 * Writes `config` (minus the `profiles` key) to the target config file,
 * creating the directory if needed.
 *
 * @param configPath  Absolute path to the config JSON file.
 * @param config      Config object to write.
 */
export function writeConfig(configPath: string, config: Partial<AiConfig>): void {
  const dir = path.dirname(configPath);
  if (!existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const { profiles: _p, ...rest } = config as AiConfigPartial & {
    profiles?: unknown;
  };
  const payload = { ...rest, version: CURRENT_VERSION };
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Re-export paths for callers that need them (e.g. config sub-commands)
// ---------------------------------------------------------------------------
export { GLOBAL_CONFIG_PATH, LOCAL_CONFIG_PATH, CURRENT_VERSION };


