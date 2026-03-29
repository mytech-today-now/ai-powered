/**
 * @file src/ai-powered/cli/wizard.ts
 *
 * Interactive setup wizard for ai-powered.
 * Uses @inquirer/prompts to guide users through provider, API key, model,
 * and save-target selection. Supports --template mode for creating custom
 * prompt templates.
 */

import { select, input, password, confirm, checkbox } from "@inquirer/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { maskApiKey } from "../utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".ai-powered");
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, "config.json");

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  venice: "VENICE_API_KEY",
  custom: "AI_API_KEY",
  mock: "",
};

/** Modalities supported by each provider. Used to disable incompatible choices. */
const MODALITY_SUPPORT: Record<string, string[]> = {
  openai: ["text", "image", "audio", "video", "structured"],
  anthropic: ["text", "structured"],
  venice: ["text", "image", "structured"],
  xai: ["text", "structured"],
  custom: ["text", "image", "audio", "video", "structured"],
  mock: ["text", "image", "audio", "video", "structured"],
};

/** Sensible default model IDs per provider and modality. */
const MODEL_DEFAULTS: Record<string, Partial<Record<string, string>>> = {
  openai: { text: "gpt-4o", image: "dall-e-3", audio: "whisper-1", structured: "gpt-4o" },
  anthropic: { text: "claude-opus-4-5", structured: "claude-3-5-sonnet-20241022" },
  venice: { text: "llama-3.3-70b", image: "fluently-xl", structured: "llama-3.3-70b" },
  xai: { text: "grok-2-1212", structured: "grok-2-1212" },
  custom: {},
  mock: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeEnvLine(envPath: string, key: string, value: string): void {
  const content = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8")
    : "";
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  fs.writeFileSync(envPath, lines.filter((l) => l !== "").join("\n") + "\n", "utf-8");
}

function writeGlobalConfig(data: Record<string, unknown>): void {
  if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  const existing = fs.existsSync(GLOBAL_CONFIG_PATH)
    ? (JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, "utf-8")) as Record<string, unknown>)
    : {};
  const merged = { ...existing, ...data };
  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Live API key validation
// ---------------------------------------------------------------------------

/**
 * Validates the API key by making a lightweight live call to the provider.
 * Venice and OpenAI-compatible providers: GET /models.
 * Anthropic: GET /v1/models (requires x-api-key + anthropic-version headers).
 * Custom: GET {baseUrl}/health (non-fatal if unreachable).
 */
async function validateApiKey(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; message: string }> {
  try {
    switch (provider) {
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { valid: true, message: "✓ OpenAI API key is valid." };
        const body = await res.text().catch(() => "");
        return { valid: false, message: `✗ HTTP ${res.status}: ${body.slice(0, 120)}` };
      }
      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { valid: true, message: "✓ Anthropic API key is valid." };
        const body = await res.text().catch(() => "");
        return { valid: false, message: `✗ HTTP ${res.status}: ${body.slice(0, 120)}` };
      }
      case "venice": {
        const res = await fetch("https://api.venice.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { valid: true, message: "✓ Venice.ai API key is valid." };
        const body = await res.text().catch(() => "");
        return { valid: false, message: `✗ HTTP ${res.status}: ${body.slice(0, 120)}` };
      }
      case "xai": {
        const res = await fetch("https://api.x.ai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { valid: true, message: "✓ xAI API key is valid." };
        const body = await res.text().catch(() => "");
        return { valid: false, message: `✗ HTTP ${res.status}: ${body.slice(0, 120)}` };
      }
      case "custom": {
        if (!baseUrl) return { valid: true, message: "⚠ No base URL — skipping validation." };
        const testUrl = new URL("/health", baseUrl).toString();
        const res = await fetch(testUrl, { signal: AbortSignal.timeout(10_000) }).catch(
          () => null,
        );
        if (res?.ok) return { valid: true, message: "✓ Custom endpoint is reachable." };
        return { valid: false, message: "✗ Custom endpoint not reachable — check the URL." };
      }
      default:
        return { valid: true, message: "" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, message: `✗ Validation error: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Template creation mode
// ---------------------------------------------------------------------------

async function runTemplateWizard(): Promise<void> {
  console.log("\n✨ Template creation wizard\n");
  const name = await input({ message: "Template name (e.g. code-review):" });
  const description = await input({ message: "Short description:" });
  const modality = await select({
    message: "Modality:",
    choices: [
      { value: "text" }, { value: "image" },
      { value: "audio" }, { value: "video" }, { value: "structured" },
    ],
  });
  const userPrompt = await input({
    message: "Prompt template (use {{variable}} for placeholders):",
  });
  const defaultsRaw = await input({
    message: "Default variable values as JSON object (or leave blank):",
    default: "{}",
  });
  let defaults: Record<string, string> = {};
  try { defaults = JSON.parse(defaultsRaw) as Record<string, string>; } catch { /* ignore */ }

  const template = { name, description, modality, userPrompt, defaults };
  const outDir = await input({
    message: "Save directory:",
    default: path.join(GLOBAL_CONFIG_DIR, "templates"),
  });
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(template, null, 2) + "\n", "utf-8");
  console.log(`\n✅ Template saved to ${outPath}`);
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export async function runWizard(opts: { templateMode?: boolean } = {}): Promise<void> {
  if (opts.templateMode) {
    await runTemplateWizard();
    return;
  }

  console.log("\n🚀 ai-powered setup wizard\n");

  // --- Step 1: Choose modality ---
  const modality = await select({
    message: "Step 1 — Which modality will you primarily use?",
    choices: [
      { name: "Text generation (chat, completion)", value: "text" },
      { name: "Image generation", value: "image" },
      { name: "Audio (transcription / text-to-speech)", value: "audio" },
      { name: "Video generation", value: "video" },
      { name: "Structured output (JSON schema)", value: "structured" },
    ],
  });

  // --- Step 2: Choose provider (filter by modality) ---
  const notSupported = (p: string): boolean | string => {
    const supported = MODALITY_SUPPORT[p] ?? [];
    return supported.includes(modality) ? false : `No ${modality} support`;
  };

  const provider = await select<string>({
    message: "Step 2 — Choose an AI provider:",
    choices: [
      { name: "OpenAI  (GPT-4o, DALL-E 3, Whisper, TTS)", value: "openai" },
      {
        name: "Anthropic (Claude) — text & structured only",
        value: "anthropic",
        disabled: notSupported("anthropic"),
      },
      {
        name: "Venice.ai (private, on-chain) — text, image & structured",
        value: "venice",
        disabled: notSupported("venice"),
      },
      {
        name: "xAI (Grok) — text & structured only",
        value: "xai",
        disabled: notSupported("xai"),
      },
      { name: "Custom / Self-hosted", value: "custom" },
      { name: "Mock (no API calls — for testing)", value: "mock" },
    ],
  });

  let apiKey = "";
  let baseUrl = "";
  const envKey = PROVIDER_ENV_KEYS[provider] ?? "";

  if (provider !== "mock") {
    // Custom providers need a base URL before we can validate.
    if (provider === "custom") {
      baseUrl = await input({
        message: "Custom base URL (e.g. http://localhost:11434/v1):",
      });
    }

    // --- Step 3: API key + live validation (up to 3 attempts) ---
    const MAX_ATTEMPTS = 3;
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
      apiKey = await password({
        message:
          attempts === 0
            ? `Step 3 — Enter your ${envKey} (input hidden):`
            : `Re-enter your ${envKey} (attempt ${attempts + 1}/${MAX_ATTEMPTS}):`,
        mask: "*",
      });

      if (!apiKey) {
        const skip = await confirm({
          message: "No API key entered. Skip validation and continue anyway?",
          default: false,
        });
        if (skip) break;
        attempts++;
        continue;
      }

      console.log("  Validating key with the provider…");
      const { valid, message } = await validateApiKey(provider, apiKey, baseUrl);
      if (message) console.log(`  ${message}`);
      if (valid) break;

      attempts++;
      if (attempts < MAX_ATTEMPTS) {
        const retry = await confirm({
          message: `Validation failed. Try again? (${MAX_ATTEMPTS - attempts} attempt(s) left)`,
          default: true,
        });
        if (!retry) break;
      } else {
        const force = await confirm({
          message: "Maximum attempts reached. Save config anyway?",
          default: false,
        });
        if (!force) {
          console.log("\n❌ Setup cancelled.\n");
          return;
        }
      }
    }
  }

  // --- Step 4: Model defaults ---
  const suggestedModel = MODEL_DEFAULTS[provider]?.[modality] ?? "";
  const model = await input({
    message: `Step 4 — Default model for ${modality} (leave blank for provider default):`,
    default: suggestedModel,
  });

  // --- Step 5: Save targets ---
  const saveTargets = await checkbox({
    message: "Step 5 — Where should the settings be saved?",
    choices: [
      { name: `Global config (${GLOBAL_CONFIG_PATH})`, value: "global", checked: true },
      { name: "Local .env file (./.env)", value: "env" },
    ],
  });

  // --- Step 6: Persist ---
  if (saveTargets.includes("global")) {
    const cfg: Record<string, unknown> = { provider, modality };
    if (model) cfg["model"] = model;
    if (provider === "mock") cfg["mock"] = true;
    if (baseUrl) cfg["baseUrl"] = baseUrl;
    // Record the per-modality model default so it survives profile switching.
    if (model) cfg["modalityDefaults"] = { [modality]: { model } };
    writeGlobalConfig(cfg);
    console.log(`\n✅ Global config updated: ${GLOBAL_CONFIG_PATH}`);
  }

  if (saveTargets.includes("env") && apiKey && envKey) {
    writeEnvLine(path.join(process.cwd(), ".env"), envKey, apiKey);
    console.log(`✅ API key written to .env (${maskApiKey(apiKey)})`);
  }

  // --- Step 7: Next steps ---
  const exampleCmd =
    modality === "text"
      ? 'ai-powered text "Hello, AI!"'
      : `ai-powered ${modality} --help`;

  console.log("\n🎉 Setup complete! Next steps:");
  console.log(`  ai-powered health-check`);
  console.log(`  ${exampleCmd}`);
  console.log(`  ai-powered list-models\n`);
}

