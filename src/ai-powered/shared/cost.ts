/**
 * @file src/ai-powered/shared/cost.ts
 *
 * Browser-safe pricing helpers shared by the Node client, browser client,
 * CLI dry-run path, and providers.
 *
 * This module intentionally avoids Node built-ins so it can be imported from
 * the web bundle without pulling in server-only dependencies.
 */

import type { CostBreakdown, TokenUsage } from "../types.js";

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimates the number of tokens in `text` using a character-based heuristic.
 *
 * Rule of thumb: tokenisers average roughly 4 UTF-16 characters per token for
 * English prose. The result is rounded up and used only for pre-call checks.
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
  /** USD charged per 1 000 prompt/input tokens. */
  promptPer1kUsd?: number;
  /** USD charged per 1 000 completion/output tokens. */
  completionPer1kUsd?: number;
  /** When true, cost is fixed per image rather than per token. */
  perImage?: true;
  /** Fixed USD per generated image (used when `perImage` is true). */
  perImageUsd?: number;
  /** USD per minute of audio processed (transcription / TTS). */
  perMinuteUsd?: number;
  /** Fixed USD per generated video clip (used for video models). */
  perVideoUsd?: number;
}

/**
 * Pricing table keyed by model identifier.
 *
 * Sources (as of 2026-03-30):
 *   OpenAI    - https://openai.com/api/pricing/
 *   Anthropic - https://www.anthropic.com/pricing
 *   xAI       - https://x.ai/api
 *   Venice    - https://venice.ai/pricing
 *   Luma AI   - https://lumalabs.ai/dream-machine/api/pricing
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI text
  "gpt-4o": { promptPer1kUsd: 0.005, completionPer1kUsd: 0.015 },
  "gpt-4o-mini": { promptPer1kUsd: 0.00015, completionPer1kUsd: 0.0006 },
  o1: { promptPer1kUsd: 0.015, completionPer1kUsd: 0.06 },
  "o1-mini": { promptPer1kUsd: 0.003, completionPer1kUsd: 0.012 },
  "gpt-4-turbo": { promptPer1kUsd: 0.01, completionPer1kUsd: 0.03 },
  "gpt-4-turbo-preview": { promptPer1kUsd: 0.01, completionPer1kUsd: 0.03 },
  "gpt-4": { promptPer1kUsd: 0.03, completionPer1kUsd: 0.06 },
  "gpt-3.5-turbo": { promptPer1kUsd: 0.0005, completionPer1kUsd: 0.0015 },
  // OpenAI image
  "dall-e-3": { perImage: true, perImageUsd: 0.04 },
  "dall-e-2": { perImage: true, perImageUsd: 0.016 },
  // OpenAI audio
  "whisper-1": { perMinuteUsd: 0.006 },
  "tts-1": { promptPer1kUsd: 0.015 },
  "tts-1-hd": { promptPer1kUsd: 0.03 },
  // Anthropic
  "claude-3-opus-20240229": { promptPer1kUsd: 0.015, completionPer1kUsd: 0.075 },
  "claude-3-5-sonnet-20241022": { promptPer1kUsd: 0.003, completionPer1kUsd: 0.015 },
  "claude-3-5-haiku-20241022": { promptPer1kUsd: 0.0008, completionPer1kUsd: 0.004 },
  "claude-3-sonnet-20240229": { promptPer1kUsd: 0.003, completionPer1kUsd: 0.015 },
  "claude-3-haiku-20240307": { promptPer1kUsd: 0.00025, completionPer1kUsd: 0.00125 },
  // xAI / Grok
  "grok-2": { promptPer1kUsd: 0.002, completionPer1kUsd: 0.01 },
  "grok-2-latest": { promptPer1kUsd: 0.002, completionPer1kUsd: 0.01 },
  "grok-2-mini": { promptPer1kUsd: 0.0002, completionPer1kUsd: 0.0005 },
  "grok-beta": { promptPer1kUsd: 0.005, completionPer1kUsd: 0.015 },
  "grok-vision-beta": { promptPer1kUsd: 0.005, completionPer1kUsd: 0.015 },
  "grok-imagine-video": { perVideoUsd: 0.05 },
  // Venice.ai
  "llama-3.3-70b": { promptPer1kUsd: 0.001, completionPer1kUsd: 0.003 },
  "mistral-31-24b": { promptPer1kUsd: 0.0007, completionPer1kUsd: 0.002 },
  "qwen-2.5-vl": { promptPer1kUsd: 0.001, completionPer1kUsd: 0.003 },
  "fluently-xl": { perImage: true, perImageUsd: 0.05 },
  "venice-sd-3.5": { perImage: true, perImageUsd: 0.05 },
  // Luma AI video
  "ray-2": { perVideoUsd: 0.14 },
  "ray-flash-2": { perVideoUsd: 0.04 },
  "ray-2-720p": { perVideoUsd: 0.14 },
  "ray-flash-2-720p": { perVideoUsd: 0.04 },
  "dream-machine": { perVideoUsd: 0.14 },
  // Runway video
  "gen4.5": { perVideoUsd: 0.6 },
  // Mock models
  "mock-text-v1": { promptPer1kUsd: 0.001, completionPer1kUsd: 0.002 },
  "mock-image-v1": { perImage: true, perImageUsd: 0.04 },
  "mock-whisper-v1": { perMinuteUsd: 0.006 },
  "mock-tts-v1": { promptPer1kUsd: 0.015 },
  "mock-video-v1": { perVideoUsd: 0.05 },
  "mock-structured-v1": { promptPer1kUsd: 0.001, completionPer1kUsd: 0.002 },
};

/** Fallback when no exact or prefix match exists in MODEL_PRICING. */
const FALLBACK_PRICING: ModelPricing = { promptPer1kUsd: 0.001, completionPer1kUsd: 0.002 };

/**
 * A single entry returned by `listPricing()`.
 */
export interface PricingEntry extends ModelPricing {
  model: string;
  primaryUsd: number;
  modality: "text" | "image" | "audio" | "video";
}

/**
 * Returns the complete pricing table as an array of `PricingEntry` objects,
 * sorted alphabetically by model identifier.
 */
export function listPricing(filter?: {
  modality?: "text" | "image" | "audio" | "video";
  model?: string;
}): PricingEntry[] {
  const entries: PricingEntry[] = Object.entries(MODEL_PRICING)
    .map(([id, pricing]) => {
      let modality: PricingEntry["modality"];
      let primaryUsd: number;

      if (pricing.perVideoUsd !== undefined) {
        modality = "video";
        primaryUsd = pricing.perVideoUsd;
      } else if (pricing.perImage === true && pricing.perImageUsd !== undefined) {
        modality = "image";
        primaryUsd = pricing.perImageUsd;
      } else if (pricing.perMinuteUsd !== undefined) {
        modality = "audio";
        primaryUsd = pricing.perMinuteUsd;
      } else {
        modality = "text";
        primaryUsd = pricing.promptPer1kUsd ?? 0;
      }

      return { model: id, ...pricing, primaryUsd, modality };
    })
    .sort((a, b) => a.model.localeCompare(b.model));

  if (!filter) return entries;

  return entries.filter((entry) => {
    if (filter.modality && entry.modality !== filter.modality) return false;
    if (filter.model && !entry.model.includes(filter.model)) return false;
    return true;
  });
}

/**
 * Returns the ModelPricing entry for `model`.
 */
export function lookupModelPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model] !== undefined) return MODEL_PRICING[model]!;

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
 */
export function calculateCost(
  model: string,
  usage: TokenUsage,
  durationSeconds?: number,
): CostBreakdown {
  const pricing = lookupModelPricing(model);

  let raw: number;
  if (pricing.perVideoUsd !== undefined) {
    raw = pricing.perVideoUsd;
  } else if (pricing.perImage === true && pricing.perImageUsd !== undefined) {
    raw = pricing.perImageUsd;
  } else if (pricing.perMinuteUsd !== undefined) {
    const minutes = durationSeconds !== undefined ? durationSeconds / 60 : usage.totalTokens / 1000;
    raw = minutes * pricing.perMinuteUsd;
  } else {
    raw =
      (usage.promptTokens / 1000) * (pricing.promptPer1kUsd ?? 0) +
      (usage.completionTokens / 1000) * (pricing.completionPer1kUsd ?? 0);
  }

  return {
    totalUsd: Math.round(raw * 1e6) / 1e6,
    isEstimate: false,
  };
}

/**
 * Estimates cost BEFORE a call using a token-count heuristic on `promptText`.
 */
export function estimateCost(model: string, promptText: string): CostBreakdown {
  const pricing = lookupModelPricing(model);

  if (pricing.perVideoUsd !== undefined) {
    return { totalUsd: Math.round(pricing.perVideoUsd * 1e6) / 1e6, isEstimate: true };
  }

  if (pricing.perImage === true && pricing.perImageUsd !== undefined) {
    return { totalUsd: Math.round(pricing.perImageUsd * 1e6) / 1e6, isEstimate: true };
  }

  const estimatedPrompt = estimateTokens(promptText);
  const estimatedCompletion = Math.ceil(estimatedPrompt * 0.5);

  const raw =
    (estimatedPrompt / 1000) * (pricing.promptPer1kUsd ?? 0) +
    (estimatedCompletion / 1000) * (pricing.completionPer1kUsd ?? 0);

  return {
    totalUsd: Math.round(raw * 1e6) / 1e6,
    isEstimate: true,
  };
}
