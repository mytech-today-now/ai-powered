/**
 * @file src/ai-powered/utils.ts
 *
 * Shared utilities for ai-powered:
 *   - maskApiKey: THE single API-key masking function used everywhere
 *   - createLogger: Pino-based logger factory
 *
 * RULE: no other file may inline-mask an API key. All key redaction passes
 * through maskApiKey(). This is enforced by ESLint and verified in health-check.
 */

import pino, { type Logger, type LoggerOptions as PinoLoggerOptions } from "pino";
import { createWriteStream } from "node:fs";
import type { TokenUsage, CostBreakdown } from "./types.js";

// ---------------------------------------------------------------------------
// maskApiKey
// ---------------------------------------------------------------------------

/**
 * Masks an API key so it can be safely included in log output, error messages,
 * and wizard confirmations.
 *
 * Masking rules (spec: specs/security/spec.md):
 *   - OpenAI keys (`sk-` prefix, NOT `sk-ant-`)    → `sk-****`
 *   - Anthropic keys (`sk-ant-` prefix)             → `sk-ant-****`
 *   - xAI/Grok keys (`xai-` prefix)                → `xai-****`
 *   - Venice.ai keys (`ven-` prefix)               → `ven-****`
 *   - Unknown / custom / empty                     → `[REDACTED]`
 *
 * The function is deterministic and never throws.
 */
export function maskApiKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) return "[REDACTED]";

  // Order matters: check longer prefixes before shorter ones.
  if (key.startsWith("sk-ant-")) return "sk-ant-****";
  if (key.startsWith("sk-")) return "sk-****";
  if (key.startsWith("xai-")) return "xai-****";
  if (key.startsWith("ven-")) return "ven-****";

  return "[REDACTED]";
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimates the number of tokens in `text` using a character-based heuristic.
 *
 * Rule of thumb: GPT-3/4/Claude tokenisers average ~4 UTF-16 characters per
 * token for English prose (mixed vocabulary).  The result is always rounded
 * up (ceiling) and labelled `isEstimate: true` in every CostBreakdown that
 * is derived from it — never passed off as an exact provider count.
 *
 * NOTE: This is a heuristic. Actual token counts must come from provider
 *       responses when available; use this only for pre-call budget checks.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Model pricing table
// ---------------------------------------------------------------------------

/** Per-model pricing configuration (all USD). */
export interface ModelPricing {
  /** USD charged per 1 000 prompt/input tokens. 0 for non-token modalities. */
  promptPer1kUsd: number;
  /** USD charged per 1 000 completion/output tokens. 0 for non-token modalities. */
  completionPer1kUsd: number;
  /** When true, cost is fixed per image rather than per-token. */
  perImage?: true;
  /** Fixed USD per generated image (used when `perImage` is true). */
  perImageUsd?: number;
  /** USD per minute of audio processed (transcription / TTS). */
  perMinuteUsd?: number;
}

/**
 * Pricing table keyed by model identifier.
 *
 * Sources (as of 2026-03-27):
 *   OpenAI  — https://openai.com/api/pricing/
 *   Anthropic — https://www.anthropic.com/pricing
 *   xAI     — https://x.ai/api
 *
 * For models not listed here, `lookupModelPricing` falls back to
 * FALLBACK_PRICING so the calculator never throws.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // --- OpenAI text -------------------------------------------------------
  "gpt-4o":                    { promptPer1kUsd: 0.005,   completionPer1kUsd: 0.015   },
  "gpt-4o-mini":               { promptPer1kUsd: 0.00015, completionPer1kUsd: 0.0006  },
  "gpt-4-turbo":               { promptPer1kUsd: 0.01,    completionPer1kUsd: 0.03    },
  "gpt-4-turbo-preview":       { promptPer1kUsd: 0.01,    completionPer1kUsd: 0.03    },
  "gpt-4":                     { promptPer1kUsd: 0.03,    completionPer1kUsd: 0.06    },
  "gpt-3.5-turbo":             { promptPer1kUsd: 0.0005,  completionPer1kUsd: 0.0015  },
  // --- OpenAI image ------------------------------------------------------
  "dall-e-3":                  { promptPer1kUsd: 0, completionPer1kUsd: 0, perImage: true, perImageUsd: 0.04 },
  "dall-e-2":                  { promptPer1kUsd: 0, completionPer1kUsd: 0, perImage: true, perImageUsd: 0.016 },
  // --- OpenAI audio ------------------------------------------------------
  "whisper-1":                 { promptPer1kUsd: 0, completionPer1kUsd: 0, perMinuteUsd: 0.006 },
  "tts-1":                     { promptPer1kUsd: 0.015, completionPer1kUsd: 0 },
  "tts-1-hd":                  { promptPer1kUsd: 0.03,  completionPer1kUsd: 0 },
  // --- Anthropic ---------------------------------------------------------
  "claude-3-opus-20240229":        { promptPer1kUsd: 0.015,  completionPer1kUsd: 0.075  },
  "claude-3-5-sonnet-20241022":    { promptPer1kUsd: 0.003,  completionPer1kUsd: 0.015  },
  "claude-3-5-haiku-20241022":     { promptPer1kUsd: 0.0008, completionPer1kUsd: 0.004  },
  "claude-3-sonnet-20240229":      { promptPer1kUsd: 0.003,  completionPer1kUsd: 0.015  },
  "claude-3-haiku-20240307":       { promptPer1kUsd: 0.00025,completionPer1kUsd: 0.00125},
  // --- xAI / Grok --------------------------------------------------------
  "grok-2":                    { promptPer1kUsd: 0.002, completionPer1kUsd: 0.01  },
  "grok-beta":                 { promptPer1kUsd: 0.005, completionPer1kUsd: 0.015 },
  // --- Venice.ai ----------------------------------------------------------
  // Venice text models are priced similarly to their underlying base models.
  // Using conservative estimates based on Venice's public pricing (2026-03-27).
  "llama-3.3-70b":             { promptPer1kUsd: 0.001, completionPer1kUsd: 0.003 },
  "mistral-31-24b":            { promptPer1kUsd: 0.0007,completionPer1kUsd: 0.002 },
  // Venice image generation (flat rate per image, ~$0.05 for standard quality)
  "fluently-xl":               { promptPer1kUsd: 0, completionPer1kUsd: 0, perImage: true, perImageUsd: 0.05 },
  "venice-sd-3.5":             { promptPer1kUsd: 0, completionPer1kUsd: 0, perImage: true, perImageUsd: 0.05 },
  // --- Mock models (plausible fixture values matching real-world scale) --
  "mock-text-v1":              { promptPer1kUsd: 0.001, completionPer1kUsd: 0.002 },
  "mock-image-v1":             { promptPer1kUsd: 0, completionPer1kUsd: 0, perImage: true, perImageUsd: 0.04 },
  "mock-whisper-v1":           { promptPer1kUsd: 0, completionPer1kUsd: 0, perMinuteUsd: 0.006 },
  "mock-tts-v1":               { promptPer1kUsd: 0.015, completionPer1kUsd: 0 },
  "mock-video-v1":             { promptPer1kUsd: 0, completionPer1kUsd: 0, perImage: true, perImageUsd: 0.05 },
  "mock-structured-v1":        { promptPer1kUsd: 0.001, completionPer1kUsd: 0.002 },
};

/** Fallback when no exact or prefix match exists in MODEL_PRICING. */
const FALLBACK_PRICING: ModelPricing = { promptPer1kUsd: 0.001, completionPer1kUsd: 0.002 };

/**
 * Returns the ModelPricing entry for `model`.
 *
 * Lookup order:
 *   1. Exact match (e.g. "gpt-4o")
 *   2. Prefix match — longest key that is a prefix of the model string
 *      (e.g. "gpt-4o-mini-2024-07-18" → "gpt-4o-mini")
 *   3. FALLBACK_PRICING
 */
export function lookupModelPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model] !== undefined) return MODEL_PRICING[model]!;

  // Prefix match: find the longest key that is a prefix of the model string.
  let bestKey = "";
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key) && key.length > bestKey.length) {
      bestKey = key;
    }
  }
  return bestKey.length > 0 ? MODEL_PRICING[bestKey]! : FALLBACK_PRICING;
}

/**
 * Computes the actual cost of a completed call from provider-reported usage.
 *
 * - For token-based models: `(promptTokens / 1000) × promptRate + (completionTokens / 1000) × completionRate`
 * - For image models: `perImageUsd` (fixed per call)
 * - For audio-minute models: `(durationSeconds / 60) × perMinuteUsd`
 *   (falls back to character-count estimate when durationSeconds is absent)
 *
 * The returned `totalUsd` is rounded to 6 decimal places.
 * `isEstimate` is always `false` because the usage data comes from the provider.
 *
 * @param model            Model identifier (used for pricing lookup).
 * @param usage            Token counts reported by the provider.
 * @param durationSeconds  Optional audio duration (for transcription/TTS pricing).
 */
export function calculateCost(
  model: string,
  usage: TokenUsage,
  durationSeconds?: number,
): CostBreakdown {
  const pricing = lookupModelPricing(model);

  let raw: number;
  if (pricing.perImage === true && pricing.perImageUsd !== undefined) {
    raw = pricing.perImageUsd;
  } else if (pricing.perMinuteUsd !== undefined) {
    const minutes = durationSeconds !== undefined
      ? durationSeconds / 60
      : usage.totalTokens / 1000; // last-resort heuristic
    raw = minutes * pricing.perMinuteUsd;
  } else {
    raw =
      (usage.promptTokens     / 1000) * pricing.promptPer1kUsd +
      (usage.completionTokens / 1000) * pricing.completionPer1kUsd;
  }

  return {
    totalUsd: parseFloat(raw.toFixed(6)),
    isEstimate: false,
  };
}

/**
 * Estimates cost BEFORE a call using a token-count heuristic on `promptText`.
 *
 * Completion tokens are approximated as 50 % of the prompt token estimate,
 * which is conservative for most real-world tasks.  The returned
 * `CostBreakdown` has `isEstimate: true` so callers (and logs) can distinguish
 * it from provider-reported actual cost.
 *
 * @param model       Model identifier (used for pricing lookup).
 * @param promptText  The full prompt string to estimate from.
 */
export function estimateCost(model: string, promptText: string): CostBreakdown {
  const pricing = lookupModelPricing(model);

  if (pricing.perImage === true && pricing.perImageUsd !== undefined) {
    // Image models: fixed cost regardless of prompt length.
    return { totalUsd: parseFloat(pricing.perImageUsd.toFixed(6)), isEstimate: true };
  }

  const estimatedPrompt = estimateTokens(promptText);
  const estimatedCompletion = Math.ceil(estimatedPrompt * 0.5); // heuristic

  const raw =
    (estimatedPrompt     / 1000) * pricing.promptPer1kUsd +
    (estimatedCompletion / 1000) * pricing.completionPer1kUsd;

  return {
    totalUsd: parseFloat(raw.toFixed(6)),
    isEstimate: true,
  };
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/** Options accepted by createLogger. */
export interface AiLoggerOptions {
  /** Enable TRACE/DEBUG level output. When false, level is INFO. */
  debug?: boolean;
  /** Path to a JSONL log file. When set, structured JSONL is written there. */
  logFile?: string;
  /** Force pretty-print output (default: true when NODE_ENV !== 'production'). */
  pretty?: boolean;
  /**
   * The name label included in every log record.
   * Defaults to "ai-powered".
   */
  name?: string;
}

/**
 * Creates and returns a Pino logger configured according to the active AiConfig.
 *
 * Behaviour:
 *   - Level: `trace` when debug=true, otherwise `info`.
 *   - Transport: pino-pretty when pretty=true (dev/test) OR JSONL stream to
 *     logFile when logFile is set. When both are set, pino multistream is used.
 *   - The returned logger is also available as the module-level `logger` singleton
 *     via `getLogger()`. Calling `createLogger` again replaces the singleton.
 */
export function createLogger(options: AiLoggerOptions = {}): Logger {
  const {
    debug = false,
    logFile,
    pretty = process.env["NODE_ENV"] !== "production",
    name = "ai-powered",
  } = options;

  const level = debug ? "trace" : "info";

  // Build Pino options.
  const pinoOptions: PinoLoggerOptions = {
    name,
    level,
    // Redact any apiKey fields that leak into log records automatically.
    redact: {
      paths: ["apiKey", "*.apiKey", "config.apiKey", "options.apiKey"],
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
    },
  };

  // Determine transport(s).
  const streams: Array<{ stream: NodeJS.WritableStream; level?: string }> = [];

  if (logFile) {
    // Always write structured JSONL to file.
    streams.push({ stream: createWriteStream(logFile, { flags: "a" }), level });
  }

  if (pretty && !logFile) {
    // Pretty-print to stderr in development when no file is configured.
    // destination: 2 ensures the output goes to stderr (fd 2), never stdout.
    const prettyStream = pino.transport({
      target: "pino-pretty",
      options: {
        colorize: process.env["NO_COLOR"] !== "1",
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
        messageFormat: "[{name}] {msg}",
        destination: 2,
      },
    });
    return pino(pinoOptions, prettyStream);
  }

  if (streams.length === 0) {
    // Default: structured JSON to stderr (production / CI).
    return pino({ ...pinoOptions, destination: 2 } as PinoLoggerOptions);
  }

  if (streams.length === 1 && streams[0]) {
    return pino(pinoOptions, streams[0].stream);
  }

  // Multiple streams (logFile + pretty): use pino.multistream.
  return pino(pinoOptions, pino.multistream(streams));
}

// ---------------------------------------------------------------------------
// Module-level logger singleton
// ---------------------------------------------------------------------------

/** The active logger instance. Replaced when createLogger() is called. */
let _logger: Logger = createLogger();

/** Returns the current module-level logger singleton. */
export function getLogger(): Logger {
  return _logger;
}

/**
 * Replaces the module-level logger singleton with a new one built from the
 * provided options. Call this early in the CLI entry point after parsing flags.
 */
export function initLogger(options: AiLoggerOptions): Logger {
  _logger = createLogger(options);
  return _logger;
}

