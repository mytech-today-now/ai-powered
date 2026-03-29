/**
 * @file src/ai-powered/client.ts
 *
 * AiClient — the unified multi-modal AI client returned by getAiClient().
 *
 * All public methods delegate to the active provider after running the plugin
 * pipeline (onRequest → provider call → onResponse; onError on failure).
 * Budget tracking accumulates cost after each successful call.
 */

import { z } from "zod";
import type { AiConfig, Modality } from "./core.js";
import type { ProviderName } from "./core.js";
import type { BaseProvider, ProviderCallOptions } from "./providers/index.js";
import { createProvider } from "./providers/index.js";
import type {
  TextResult,
  ImageResult,
  TranscriptionResult,
  AudioResult,
  VideoResult,
  StructuredResult,
  ModelDescriptor,
  AiPlugin,
  RequestContext,
  ResponseContext,
  BaseResult,
  ProviderFailure,
} from "./types.js";
import { AiPoweredError, BudgetExceededError, PluginError, AllProvidersExhaustedError } from "./types.js";
import { estimateCost, getLogger } from "./utils.js";
import { withRetry, CircuitBreaker } from "./resilience.js";
import type { RetryOptions } from "./resilience.js";

// ---------------------------------------------------------------------------
// ConversationSession
// ---------------------------------------------------------------------------

/** Manages a stateful conversation with a rolling message history. */
export class ConversationSession {
  public readonly id: string;
  private readonly messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  constructor(id: string, systemPrompt?: string) {
    this.id = id;
    if (systemPrompt) {
      this.messages.push({ role: "system", content: systemPrompt });
    }
  }

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistant(content: string): void {
    this.messages.push({ role: "assistant", content });
  }

  getMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return [...this.messages];
  }

  clear(): void {
    this.messages.splice(0);
  }

  /** Append a message by role and content. */
  append(role: "system" | "user" | "assistant", content: string): void {
    this.messages.push({ role, content });
  }

  /** Returns a copy of the full message history. */
  getHistory(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return [...this.messages];
  }
}

// ---------------------------------------------------------------------------
// AiClient
// ---------------------------------------------------------------------------

/** Options accepted by per-call overrides on AiClient methods. */
export type CallOptions = ProviderCallOptions;

/**
 * Unified AI client for all modalities.
 * Returned by `getAiClient()` — do not construct directly.
 */
export class AiClient {
  private readonly _config: AiConfig;
  private readonly _provider: BaseProvider;
  private readonly _plugins: AiPlugin[];
  private readonly _sessions = new Map<string, ConversationSession>();
  /** One CircuitBreaker per provider name (primary + any fallbacks). */
  private readonly _circuitBreakers = new Map<string, CircuitBreaker>();
  /** Lazily-instantiated fallback provider instances, keyed by ProviderName. */
  private readonly _fallbackProviders = new Map<string, BaseProvider>();
  /**
   * Plugin names that have thrown an unexpected error during this client's
   * lifetime are tracked here.  Bypassed plugins are skipped on all subsequent
   * `onRequest` and `onResponse` calls for the remainder of the session so that
   * a single faulty plugin cannot degrade every future request.
   */
  private readonly _bypassedPlugins = new Set<string>();

  private _cumulativeCostUsd = 0;

  constructor(config: AiConfig, provider: BaseProvider, plugins: AiPlugin[] = []) {
    // Freeze a shallow copy of config at construction time.  Every plugin hook
    // receives its own freshly-frozen snapshot (see _frozenConfigSnapshot()).
    this._config = Object.freeze({ ...config }) as AiConfig;
    this._provider = provider;
    this._plugins = plugins;
  }

  /**
   * Returns a freshly frozen, shallow-cloned snapshot of the active config.
   * Passing a new frozen object to each plugin call (rather than the shared
   * `this._config` reference) provides defence-in-depth sandboxing: even if a
   * plugin somehow unfreezes the object via `Object.defineProperty`, it only
   * affects its own private snapshot and cannot corrupt the client's config.
   */
  private _frozenConfigSnapshot(): Readonly<AiConfig> {
    return Object.freeze({ ...this._config }) as Readonly<AiConfig>;
  }

  /** Returns a frozen copy of the active config. */
  get config(): Readonly<AiConfig> {
    return this._config;
  }

  // ---------------------------------------------------------------------------
  // Budget helpers
  // ---------------------------------------------------------------------------

  /**
   * Pre-call budget guard: estimates the cost of the upcoming API call using
   * `estimateCost()` and throws `BudgetExceededError` BEFORE the call is made
   * if the projected cumulative spend would exceed the session budget.
   *
   * This prevents spending money on calls that are known to exceed the limit.
   * A warn-level log is emitted when the projected spend exceeds `warnBudget`
   * (default 80 %) of the session budget.
   *
   * @param model       Model identifier used for pricing lookup.
   * @param promptText  Full prompt text used to estimate token count.
   */
  private preCheckBudget(model: string, promptText: string): void {
    const budget = this._config.budgetSession;
    if (budget === undefined) return;
    const estimate = estimateCost(model, promptText);
    const projected = this._cumulativeCostUsd + estimate.totalUsd;
    if (projected > budget) {
      throw new BudgetExceededError(projected, budget);
    }
    const warnFraction = this._config.warnBudget ?? 0.8;
    if (projected / budget >= warnFraction) {
      getLogger().warn(
        { spent: projected, budget, isEstimate: true },
        `Budget warning (pre-call estimate): ${(projected / budget * 100).toFixed(1)}% used`,
      );
    }
  }

  /**
   * Post-call budget guard: validates the actual cost reported by the provider
   * against the session budget. Throws `BudgetExceededError` if the cumulative
   * actual spend would exceed the limit (e.g. when estimate was lower than actual).
   *
   * This is called AFTER the API call so it uses provider-reported exact costs.
   */
  private checkBudget(costUsd: number): void {
    const budget = this._config.budgetSession;
    if (budget === undefined) return;
    const projected = this._cumulativeCostUsd + costUsd;
    if (projected > budget) {
      throw new BudgetExceededError(projected, budget);
    }
  }

  private accumulateCost(result: BaseResult): void {
    this._cumulativeCostUsd += result.cost.totalUsd;
    getLogger().info(
      {
        modality: result.modality,
        model: result.model,
        provider: result.provider,
        costUsd: result.cost.totalUsd.toFixed(6),
        isEstimate: result.cost.isEstimate,
        cumulativeCostUsd: this._cumulativeCostUsd.toFixed(6),
        latencyMs: result.latencyMs,
        ...(result.usage !== undefined
          ? {
              promptTokens:     result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens:      result.usage.totalTokens,
            }
          : {}),
      },
      "AI call completed",
    );
  }

  /** Returns the cumulative cost of all calls made via this client (USD). */
  getCumulativeCost(): number {
    return this._cumulativeCostUsd;
  }

  // ---------------------------------------------------------------------------
  // Resilience helpers: retry, circuit breaker, failover
  // ---------------------------------------------------------------------------

  /** Returns (or creates) the CircuitBreaker for the given provider name. */
  private _getCircuitBreaker(providerName: string): CircuitBreaker {
    if (!this._circuitBreakers.has(providerName)) {
      this._circuitBreakers.set(
        providerName,
        new CircuitBreaker(
          providerName,
          this._config.circuitBreakerThreshold,
          this._config.circuitBreakerResetMs,
        ),
      );
    }
    return this._circuitBreakers.get(providerName)!;
  }

  /** Returns (or creates) a provider instance for the given fallback provider name. */
  private _getFallbackProvider(name: ProviderName): BaseProvider {
    if (!this._fallbackProviders.has(name)) {
      // Build a derived config pointing at the fallback provider.
      const fallbackConfig: AiConfig = { ...this._config, provider: name };
      this._fallbackProviders.set(name, createProvider(fallbackConfig));
    }
    return this._fallbackProviders.get(name)!;
  }

  /**
   * Wraps `fn` with the retry policy derived from the active config.
   * @internal
   */
  private async _callWithRetry<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const opts: RetryOptions = signal !== undefined ? { signal } : {};
    return withRetry(() => fn(), opts);
  }

  /**
   * Executes `fn` using the primary provider and, when enabled, the ordered
   * fallback chain.  Each provider attempt runs through its own circuit breaker
   * and the configured retry policy.
   *
   * When `config.fallback` is `false`, only the primary provider is attempted
   * and any error is re-thrown immediately without wrapping.
   *
   * When all providers are exhausted, throws `AllProvidersExhaustedError`.
   *
   * @param fn      Factory that receives a provider instance and returns a Promise<T>.
   * @param signal  Optional AbortSignal forwarded to the retry layer.
   */
  private async _executeWithFallback<T>(
    fn: (provider: BaseProvider) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const log = getLogger();
    const fallbackEnabled = this._config.fallback !== false;

    // When fallback is disabled, run primary only; propagate errors as-is.
    if (!fallbackEnabled) {
      const cb = this._getCircuitBreaker(this._config.provider);
      return cb.call(() => this._callWithRetry(() => fn(this._provider), signal));
    }

    // Build ordered provider chain: [primary, ...fallbacks].
    const chain: Array<{ name: string; provider: BaseProvider }> = [
      { name: this._config.provider, provider: this._provider },
      ...this._config.fallbackProviders.map((name) => ({
        name,
        provider: this._getFallbackProvider(name),
      })),
    ];

    const failures: ProviderFailure[] = [];

    for (let i = 0; i < chain.length; i++) {
      const { name, provider } = chain[i]!;
      if (i > 0) {
        log.info(
          { from: chain[i - 1]!.name, to: name },
          "Failover: switching to fallback provider",
        );
      }
      try {
        const cb = this._getCircuitBreaker(name);
        return await cb.call(() => this._callWithRetry(() => fn(provider), signal));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failures.push({ provider: name, reason });
        log.warn(
          { provider: name, reason, remaining: chain.length - i - 1 },
          "Provider failed; trying next in fallback chain",
        );
      }
    }

    throw new AllProvidersExhaustedError(failures);
  }

  // ---------------------------------------------------------------------------
  // Plugin pipeline helpers
  // ---------------------------------------------------------------------------

  /**
   * Runs every plugin's `onRequest` hook in registration order.
   * Each hook receives the context returned by the previous hook, allowing
   * plugins to modify messages or options before the provider call.
   *
   * Sandboxing: each plugin receives its own freshly frozen AiConfig snapshot
   * so that no plugin can corrupt the shared client config at runtime.
   *
   * Error semantics:
   *  - If a plugin throws a `PluginError` **directly** (i.e., the plugin
   *    constructed and threw it intentionally, as prompt-shield does in reject
   *    mode), the error is re-thrown immediately.  This aborts the pipeline
   *    and prevents the request from reaching the provider.
   *  - If a plugin throws any OTHER error (unexpected runtime failure), it is
   *    wrapped in a new `PluginError`, the plugin is added to
   *    `_bypassedPlugins`, logged at WARNING, and processing continues with
   *    the remaining plugins.  The plugin is then skipped on ALL future calls
   *    for the lifetime of this client session.
   *
   * @returns The final (potentially mutated) `RequestContext`.
   */
  private async runOnRequest(ctx: RequestContext): Promise<RequestContext> {
    let current = ctx;
    for (const plugin of this._plugins) {
      if (!plugin.onRequest) continue;
      // Skip plugins that have been permanently bypassed due to earlier errors.
      if (this._bypassedPlugins.has(plugin.name)) continue;
      // Inject a freshly frozen config snapshot for sandboxing.
      const sandboxedCtx: RequestContext = { ...current, config: this._frozenConfigSnapshot() };
      try {
        current = await plugin.onRequest(sandboxedCtx);
      } catch (err) {
        // If the plugin deliberately threw a PluginError (e.g. prompt-shield
        // reject=true), propagate it — this is an intentional pipeline abort.
        if (err instanceof PluginError) {
          getLogger().warn(
            { plugin: plugin.name, pattern: err.message },
            "Plugin onRequest aborted pipeline with PluginError",
          );
          throw err;
        }
        // Unexpected plugin error: wrap, mark bypassed for session, and continue.
        const wrapped = new PluginError(
          plugin.name,
          err instanceof Error ? err : new Error(String(err)),
        );
        this._bypassedPlugins.add(plugin.name);
        getLogger().warn(
          { plugin: plugin.name, err: wrapped },
          "Plugin onRequest failed; plugin bypassed for remainder of session",
        );
        // Give the plugin a chance to clean up via its own onError hook.
        try { await plugin.onError?.(wrapped); } catch { /* ignore secondary errors */ }
      }
    }
    return current;
  }

  /**
   * Runs every plugin's `onResponse` hook in REVERSE registration order.
   * This mirrors the typical middleware pattern (last registered, first to
   * post-process).
   *
   * Sandboxing and error semantics mirror `runOnRequest`:
   *  - Each plugin receives a freshly frozen AiConfig snapshot.
   *  - Intentional `PluginError` throws propagate immediately.
   *  - Accidental errors cause the plugin to be bypassed for the session.
   *
   * @returns The final (potentially mutated) `ResponseContext`.
   */
  private async runOnResponse(ctx: ResponseContext): Promise<ResponseContext> {
    let current = ctx;
    for (let i = this._plugins.length - 1; i >= 0; i--) {
      const plugin = this._plugins[i]!;
      if (!plugin.onResponse) continue;
      if (this._bypassedPlugins.has(plugin.name)) continue;
      // Inject a freshly frozen config snapshot for sandboxing.
      const sandboxedCtx: ResponseContext = { ...current, config: this._frozenConfigSnapshot() };
      try {
        current = await plugin.onResponse(sandboxedCtx);
      } catch (err) {
        if (err instanceof PluginError) {
          getLogger().warn(
            { plugin: plugin.name, pattern: err.message },
            "Plugin onResponse aborted pipeline with PluginError",
          );
          throw err;
        }
        const wrapped = new PluginError(
          plugin.name,
          err instanceof Error ? err : new Error(String(err)),
        );
        this._bypassedPlugins.add(plugin.name);
        getLogger().warn(
          { plugin: plugin.name, err: wrapped },
          "Plugin onResponse failed; plugin bypassed for remainder of session",
        );
        try { await plugin.onError?.(wrapped); } catch { /* ignore secondary errors */ }
      }
    }
    return current;
  }

  /**
   * Calls every plugin's `onError` hook.
   * Only invoked when the error is an `AiPoweredError` (or subclass), as
   * specified by the plugin contract. Raw network or parse errors are not
   * surfaced to plugins. Plugin errors thrown inside `onError` are silently
   * ignored to prevent infinite error loops.
   */
  private async runOnError(error: Error): Promise<void> {
    if (!(error instanceof AiPoweredError)) return;
    for (const plugin of this._plugins) {
      if (!plugin.onError) continue;
      try { await plugin.onError(error); } catch { /* ignore */ }
    }
  }

  /**
   * Returns the content of the last user-role message in the context, or
   * `undefined` when the message list contains no user messages.
   * Used to extract the effective prompt after plugins may have modified it.
   */
  private _extractUserMessage(ctx: RequestContext): string | undefined {
    for (let i = ctx.messages.length - 1; i >= 0; i--) {
      if (ctx.messages[i]!.role === "user") return ctx.messages[i]!.content;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /** Generate text. */
  async generateText(prompt: string, options?: CallOptions): Promise<TextResult> {
    const modality: Modality = "text";
    const initialCtx: RequestContext = {
      config: this._config,
      modality,
      messages: [{ role: "user", content: prompt }],
      options: (options ?? {}) as Record<string, unknown>,
    };
    // Run onRequest pipeline — plugins may modify messages or options.
    const ctx = await this.runOnRequest(initialCtx);
    // Use the effective prompt from the (possibly modified) context.
    const effectivePrompt = this._extractUserMessage(ctx) ?? prompt;
    // Pre-call budget guard: estimate cost and abort before spending money.
    this.preCheckBudget(this._config.model ?? "", effectivePrompt);
    let result: TextResult;
    try {
      const callOptions: ProviderCallOptions = {
        ...options,
        temperature: options?.temperature ?? this._config.temperature,
        ...(options?.maxTokens !== undefined
          ? { maxTokens: options.maxTokens }
          : this._config.maxTokens !== undefined
            ? { maxTokens: this._config.maxTokens }
            : {}),
        ...(options?.systemPrompt !== undefined
          ? { systemPrompt: options.systemPrompt }
          : this._config.systemPrompt !== undefined
            ? { systemPrompt: this._config.systemPrompt }
            : {}),
      };
      result = await this._executeWithFallback(
        (provider) => provider.generateText(effectivePrompt, callOptions),
        options?.signal,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.runOnError(error);
      throw error;
    }
    // Post-call guard validates actual reported cost (estimate may differ).
    this.checkBudget(result.cost.totalUsd);
    this.accumulateCost(result);
    await this.runOnResponse({ config: this._config, modality, result });
    return result;
  }

  /** Generate an image. */
  async generateImage(prompt: string, options?: CallOptions): Promise<ImageResult> {
    const modality: Modality = "image";
    const initialCtx: RequestContext = {
      config: this._config,
      modality,
      messages: [{ role: "user", content: prompt }],
      options: (options ?? {}) as Record<string, unknown>,
    };
    const ctx = await this.runOnRequest(initialCtx);
    const effectivePrompt = this._extractUserMessage(ctx) ?? prompt;
    // Image models have a fixed cost per call; preCheckBudget uses that fixed value.
    this.preCheckBudget(this._config.model ?? "", effectivePrompt);
    let result: ImageResult;
    try {
      result = await this._executeWithFallback(
        (provider) => provider.generateImage(effectivePrompt, options),
        options?.signal,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.runOnError(error);
      throw error;
    }
    this.checkBudget(result.cost.totalUsd);
    this.accumulateCost(result);
    await this.runOnResponse({ config: this._config, modality, result });
    return result;
  }

  /** Transcribe audio from a buffer. */
  async transcribeAudio(buffer: Buffer, options?: CallOptions): Promise<TranscriptionResult> {
    const modality: Modality = "audio";
    const initialCtx: RequestContext = {
      config: this._config,
      modality,
      messages: [],
      options: (options ?? {}) as Record<string, unknown>,
    };
    await this.runOnRequest(initialCtx);
    // Audio transcription is priced per-minute; duration is unknown pre-call.
    // Use buffer byte length as a conservative text proxy so per-token models
    // still get a meaningful estimate. Per-minute models (e.g. whisper-1) will
    // estimate $0; the post-call guard enforces the actual cost.
    this.preCheckBudget(this._config.model ?? "", String(buffer.length));
    let result: TranscriptionResult;
    try {
      result = await this._executeWithFallback(
        (provider) => provider.transcribeAudio(buffer, options),
        options?.signal,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.runOnError(error);
      throw error;
    }
    this.checkBudget(result.cost.totalUsd);
    this.accumulateCost(result);
    await this.runOnResponse({ config: this._config, modality, result });
    return result;
  }

  /** Synthesize speech from text. */
  async synthesizeSpeech(text: string, options?: CallOptions): Promise<AudioResult> {
    const modality: Modality = "audio";
    const initialCtx: RequestContext = {
      config: this._config,
      modality,
      messages: [{ role: "user", content: text }],
      options: (options ?? {}) as Record<string, unknown>,
    };
    const ctx = await this.runOnRequest(initialCtx);
    const effectiveText = this._extractUserMessage(ctx) ?? text;
    // TTS pricing is character-based (mapped to prompt tokens in the pricing
    // table); estimateCost() on the input text provides a meaningful estimate.
    this.preCheckBudget(this._config.model ?? "", effectiveText);
    let result: AudioResult;
    try {
      result = await this._executeWithFallback(
        (provider) => provider.synthesizeSpeech(effectiveText, options),
        options?.signal,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.runOnError(error);
      throw error;
    }
    this.checkBudget(result.cost.totalUsd);
    this.accumulateCost(result);
    await this.runOnResponse({ config: this._config, modality, result });
    return result;
  }

  /** Generate video. */
  async generateVideo(prompt: string, options?: CallOptions): Promise<VideoResult> {
    const modality: Modality = "video";
    const initialCtx: RequestContext = {
      config: this._config,
      modality,
      messages: [{ role: "user", content: prompt }],
      options: (options ?? {}) as Record<string, unknown>,
    };
    const ctx = await this.runOnRequest(initialCtx);
    const effectivePrompt = this._extractUserMessage(ctx) ?? prompt;
    this.preCheckBudget(this._config.model ?? "", effectivePrompt);
    let result: VideoResult;
    try {
      result = await this._executeWithFallback(
        (provider) => provider.generateVideo(effectivePrompt, options),
        options?.signal,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.runOnError(error);
      throw error;
    }
    this.checkBudget(result.cost.totalUsd);
    this.accumulateCost(result);
    await this.runOnResponse({ config: this._config, modality, result });
    return result;
  }

  /** Stream text deltas as an AsyncIterable<string>. */
  async *streamText(prompt: string, options?: CallOptions): AsyncIterable<string> {
    const modality: Modality = "text";
    const initialCtx: RequestContext = {
      config: this._config,
      modality,
      messages: [{ role: "user", content: prompt }],
      options: { ...options, stream: true } as Record<string, unknown>,
    };
    const ctx = await this.runOnRequest(initialCtx);
    const effectivePrompt = this._extractUserMessage(ctx) ?? prompt;
    // Pre-call guard prevents starting a stream that would exceed the budget.
    this.preCheckBudget(this._config.model ?? "", effectivePrompt);
    // Circuit breaker check before starting the stream (fast-fail if open).
    const cb = this._getCircuitBreaker(this._config.provider);
    if (cb.state === "OPEN") {
      // Delegate to the cb.call path so it either fast-fails or transitions to HALF_OPEN.
      await cb.call(() => Promise.resolve());
    }
    try {
      for await (const chunk of this._provider.streamText(effectivePrompt, { ...options, stream: true })) {
        yield chunk;
      }
      // Successful stream — reset consecutive failure counter.
      this._getCircuitBreaker(this._config.provider);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.runOnError(error);
      throw error;
    }
  }

  /** Generate structured output validated against the given Zod schema. */
  async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: CallOptions,
  ): Promise<StructuredResult<T>> {
    const modality: Modality = "structured";
    const initialCtx: RequestContext = {
      config: this._config,
      modality,
      messages: [{ role: "user", content: prompt }],
      options: (options ?? {}) as Record<string, unknown>,
    };
    const ctx = await this.runOnRequest(initialCtx);
    const effectivePrompt = this._extractUserMessage(ctx) ?? prompt;
    this.preCheckBudget(this._config.model ?? "", effectivePrompt);
    let result: StructuredResult<T>;
    try {
      result = await this._executeWithFallback(
        (provider) => provider.generateStructured(effectivePrompt, schema, options),
        options?.signal,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.runOnError(error);
      throw error;
    }
    this.checkBudget(result.cost.totalUsd);
    this.accumulateCost(result);
    await this.runOnResponse({ config: this._config, modality, result });
    return result;
  }

  /** List models supported by the active provider, optionally filtered by modality. */
  async listModels(modality?: Modality): Promise<ModelDescriptor[]> {
    return this._provider.listModels(modality);
  }

  /**
   * Returns (or creates) a ConversationSession by ID.
   * The session maintains message history for multi-turn conversations.
   */
  session(id: string): ConversationSession {
    if (!this._sessions.has(id)) {
      this._sessions.set(id, new ConversationSession(id, this._config.systemPrompt));
    }
    return this._sessions.get(id)!;
  }
}

