/**
 * @file src/ai-powered/server/compat/model-router.ts
 *
 * Model-to-provider inference for the /v1/ compatibility layer.
 *
 * Exports:
 *   inferProviderFromModel() – resolve a ProviderName from a model string
 */

import type { ProviderName } from "../../index.js";

/**
 * Infer the `ai-powered` provider name from a model string.
 *
 * Rules (first match wins):
 *   claude-*             → "anthropic"
 *   gpt-* | o[0-9]* | dall-e-* | whisper-* | tts-* → "openai"
 *   grok-*               → "xai"
 *   venice-* | llama*venice* → "venice"
 *   dream-shaper* | fluently* | flux* → "venice"  (Venice image models)
 *   ray-* | photon-*     → "lumaai"
 *   (no match)           → undefined  (fall through to configured default)
 *
 * This function is intentionally side-effect-free: it performs only regex
 * matching and has no I/O or external dependencies.
 */
export function inferProviderFromModel(model: string): ProviderName | undefined {
  if (/^claude-/.test(model))                               return "anthropic";
  if (/^gpt-|^o[0-9]|^dall-e|^whisper|^tts-/.test(model)) return "openai";
  if (/^grok-/.test(model))                                 return "xai";
  if (/^venice-|^llama.*venice/.test(model))                return "venice";
  if (/^dream-shaper|^fluently|^flux/.test(model))          return "venice";
  if (/^ray-|^photon-/.test(model))                         return "lumaai";
  return undefined;
}

