/**
 * @file src/ai-powered/index.ts
 *
 * Primary library entry point for ai-powered.
 *
 * Re-exports all public types and implements the top-level factory:
 *   getAiClient(toolName?, overrides?) → AiClient
 *
 * Consumers should import exclusively from this file:
 *   import { getAiClient, AiClient, maskApiKey } from 'ai-powered';
 */

import { LRUCache } from "lru-cache";
import { loadConfig } from "./core.js";
import type { AiConfig, Modality } from "./core.js";
import { createProvider } from "./providers/index.js";
import { AiClient } from "./client.js";
import { initLogger, maskApiKey, getLogger } from "./utils.js";
import type { AiPlugin, ModelDescriptor } from "./types.js";
import { createAuditLogPlugin } from "./plugins/audit-log.js";
import { createRateLimiterPlugin } from "./plugins/rate-limiter.js";
import { createPromptShieldPlugin } from "./plugins/prompt-shield.js";

// ---------------------------------------------------------------------------
// Re-exports — public API surface
// ---------------------------------------------------------------------------

export { loadConfig, writeConfig } from "./core.js";
export type {
  AiConfig,
  AiConfigPartial,
  LoadConfigOptions,
  Modality,
  ProviderName,
} from "./core.js";
export { AiConfigSchema, ModalitySchema, ProviderNameSchema, ConfigError } from "./core.js";

export { AiClient, ConversationSession } from "./client.js";
export type { CallOptions } from "./client.js";

export {
  maskApiKey,
  createLogger,
  initLogger,
  getLogger,
  estimateTokens,
  lookupModelPricing,
  calculateCost,
  estimateCost,
  listPricing,
} from "./utils.js";
export type { AiLoggerOptions, ModelPricing, PricingEntry } from "./utils.js";

export { withRetry, CircuitBreaker } from "./resilience.js";
export type { RetryOptions, CircuitState } from "./resilience.js";

export {
  BaseProvider,
  MockProvider,
  OpenAiProvider,
  AnthropicProvider,
  GrokProvider,
  VeniceProvider,
  CustomProvider,
  createProvider,
  registerProvider,
} from "./providers/index.js";
export type { ProviderCallOptions } from "./providers/index.js";

export type {
  TokenUsage,
  CostBreakdown,
  BaseResult,
  TextResult,
  ImageResult,
  TranscriptionResult,
  AudioResult,
  VideoResult,
  StructuredResult,
  ModelDescriptor,
  RequestContext,
  ResponseContext,
  AiPlugin,
} from "./types.js";
export {
  AiPoweredError,
  ProviderCapabilityError,
  ProviderError,
  BudgetExceededError,
  PluginError,
  CircuitOpenError,
  AllProvidersExhaustedError,
  ValidationError,
} from "./types.js";
export type { ProviderFailure } from "./types.js";

// ---------------------------------------------------------------------------
// Template system re-exports
// ---------------------------------------------------------------------------
export {
  TemplateSchema,
  BUILT_INS,
  BUILT_IN_REGISTRY,
  listBuiltInTemplates,
  getBuiltInTemplate,
  listTemplates,
  getTemplate,
  renderTemplate,
} from "./templates/index.js";
export type { Template } from "./templates/index.js";

// ---------------------------------------------------------------------------
// Built-in plugin factories re-exports
// ---------------------------------------------------------------------------
export { createAuditLogPlugin } from "./plugins/audit-log.js";
export { createRateLimiterPlugin } from "./plugins/rate-limiter.js";
export { createPromptShieldPlugin } from "./plugins/prompt-shield.js";

// ---------------------------------------------------------------------------
// Plugin loader
// ---------------------------------------------------------------------------

/**
 * Registry of built-in plugin names to their factory functions.
 * Resolved before attempting a dynamic `import()` so that short names like
 * `"audit-log"` work without a file-path or package specifier.
 */
const BUILT_IN_PLUGINS: Readonly<Record<string, () => AiPlugin>> = {
  "audit-log":    () => createAuditLogPlugin(),
  "rate-limiter": () => createRateLimiterPlugin(),
  "prompt-shield": () => createPromptShieldPlugin(),
};

/**
 * Dynamically imports plugins listed in config.plugins.
 * Built-in names (`"audit-log"`, `"rate-limiter"`, `"prompt-shield"`) are
 * resolved directly without a file-system or npm lookup.
 * External entries must be file paths or npm package names that export an
 * `AiPlugin` object as their `default` or named `plugin` export.
 *
 * Failures are logged as warnings; the offending plugin is skipped rather than
 * crashing the entire client initialization.
 */
async function loadPlugins(pluginIds: string[]): Promise<AiPlugin[]> {
  const logger = getLogger();
  const loaded: AiPlugin[] = [];
  for (const id of pluginIds) {
    // 1. Resolve built-in plugin names without dynamic import.
    if (Object.prototype.hasOwnProperty.call(BUILT_IN_PLUGINS, id)) {
      const plugin = BUILT_IN_PLUGINS[id]!();
      loaded.push(plugin);
      logger.debug({ pluginId: id, pluginName: plugin.name }, "Built-in plugin loaded");
      continue;
    }

    // 2. Dynamic import for external file paths or npm package names.
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(id);
      // Accept default export or named `plugin` export.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const plugin = (mod.default ?? mod.plugin) as AiPlugin | undefined;
      if (!plugin || typeof plugin.name !== "string") {
        logger.warn({ pluginId: id }, "Plugin module does not export a valid AiPlugin; skipping.");
        continue;
      }
      loaded.push(plugin);
      logger.debug({ pluginId: id, pluginName: plugin.name }, "Plugin loaded");
    } catch (err) {
      logger.warn({ pluginId: id, err }, "Failed to load plugin; skipping.");
    }
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// getAiClient factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a fully configured `AiClient`.
 *
 * Config layers (lowest → highest precedence):
 *   global config → local config → named profile → AI_* env vars → overrides
 *
 * @param toolName   Optional label for this client (used in log records).
 * @param overrides  Deep-merged on top of the resolved config with highest precedence.
 *
 * @throws ConfigError  if the merged config fails Zod validation.
 * @throws Error        if the resolved provider is not registered.
 */
export async function getAiClient(
  toolName?: string,
  overrides?: Partial<AiConfig>,
): Promise<AiClient> {
  // Load and validate the layered config. overrides act as CLI flags.
  const config = loadConfig(overrides !== undefined ? { flags: overrides } : {});

  // Initialise the module-level logger from the resolved config.
  initLogger({
    debug: config.debug,
    ...(config.logFile !== undefined ? { logFile: config.logFile } : {}),
    name: toolName ?? "ai-powered",
  });

  const logger = getLogger();
  logger.debug(
    {
      provider: config.provider,
      model: config.model,
      apiKey: maskApiKey(config.apiKey ?? ""),
      mock: config.mock,
    },
    "getAiClient: config resolved",
  );

  // Load plugins listed in config.
  const plugins = await loadPlugins(config.plugins);

  // Instantiate the provider (or MockProvider if AI_MOCK / config.mock).
  const provider = createProvider(config);
  logger.debug({ provider: provider.name }, "Provider instantiated");

  return new AiClient(config, provider, plugins);
}

// ---------------------------------------------------------------------------
// listAvailableModels  (with TTL cache)
// ---------------------------------------------------------------------------

interface CachedModels {
  models: ModelDescriptor[];
  expiresAt: number;
}

// Default TTL: 5 minutes.
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

const _modelCache = new LRUCache<string, CachedModels>({ max: 50 });

/**
 * Returns the list of models available for the given provider and modality.
 * Results are cached for `ttlMs` milliseconds (default 5 minutes).
 *
 * @param provider   Provider name (e.g. "openai").
 * @param modality   Optional modality filter (e.g. "text").
 * @param ttlMs      Cache TTL in milliseconds. Pass 0 to bypass cache.
 */
export async function listAvailableModels(
  provider: string,
  modality?: Modality,
  ttlMs = MODEL_CACHE_TTL_MS,
): Promise<ModelDescriptor[]> {
  const cacheKey = `${provider}:${modality ?? "*"}`;
  const now = Date.now();

  if (ttlMs > 0) {
    const cached = _modelCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      getLogger().debug({ cacheKey }, "listAvailableModels: cache hit");
      return cached.models;
    }
  }

  // Build a temporary client scoped to the target provider.
  const client = await getAiClient("list-models", { provider: provider as AiConfig["provider"] });
  const models = await client.listModels(modality);

  if (ttlMs > 0) {
    _modelCache.set(cacheKey, { models, expiresAt: now + ttlMs });
  }

  return models;
}

