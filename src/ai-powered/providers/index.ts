/**
 * @file src/ai-powered/providers/index.ts
 *
 * Provider registry and re-exports.
 *
 * BaseProvider is defined in ./base.ts.
 * Concrete providers:
 *   bd-744e  OpenAI + Anthropic       → ./openai.ts, ./anthropic.ts
 *   bd-zr19  xAI/Grok + Venice.ai     → ./xai.ts, ./venice.ts
 *   bd-1ie9  Custom/Ollama + Mock     → ./custom.ts, ./mock.ts
 */

import type { AiConfig, ProviderName } from "../core.js";
import { BaseProvider } from "./base.js";
import { MockProvider } from "./mock.js";

export { BaseProvider } from "./base.js";
export type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Concrete provider imports and re-exports
// ---------------------------------------------------------------------------

import { OpenAiProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GrokProvider } from "./xai.js";
import { VeniceProvider } from "./venice.js";
import { CustomProvider } from "./custom.js";
import { LumaAIProvider } from "./lumaai.js";

export { MockProvider } from "./mock.js";
export { OpenAiProvider } from "./openai.js";
export { AnthropicProvider } from "./anthropic.js";
export { GrokProvider } from "./xai.js";
export { VeniceProvider } from "./venice.js";
export { CustomProvider } from "./custom.js";
export { LumaAIProvider } from "./lumaai.js";

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

type ProviderConstructor = new (config: AiConfig) => BaseProvider;

const REGISTRY = new Map<ProviderName, ProviderConstructor>([
  ["mock",      MockProvider],
  ["openai",    OpenAiProvider],
  ["anthropic", AnthropicProvider],
  ["xai",       GrokProvider],
  ["venice",    VeniceProvider],
  ["custom",    CustomProvider],
  ["lumaai",    LumaAIProvider],
]);

/**
 * Registers a provider constructor under a given name.
 * Called by concrete provider modules at import time.
 */
export function registerProvider(name: ProviderName, ctor: ProviderConstructor): void {
  REGISTRY.set(name, ctor);
}

/**
 * Instantiates the correct provider for the given config.
 * Falls back to MockProvider when config.mock is true or AI_MOCK=true.
 *
 * @throws Error if the requested provider is not registered.
 */
export function createProvider(config: AiConfig): BaseProvider {
  // Always mock when flag or env var says so.
  if (config.mock || process.env["AI_MOCK"] === "true") {
    return new MockProvider(config);
  }

  const ProviderClass = REGISTRY.get(config.provider);
  if (!ProviderClass) {
    throw new Error(
      `Provider "${config.provider}" is not registered. ` +
        `Available providers: ${[...REGISTRY.keys()].join(", ")}`,
    );
  }
  return new ProviderClass(config);
}

