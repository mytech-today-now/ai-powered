/**
 * @file src/ai-powered/providers/custom.ts
 *
 * CustomProvider — supports self-hosted and local AI servers.
 *
 * Three API dialects are supported via config.customProviderType:
 *
 *   "openai-compatible"  Any server that exposes the OpenAI chat completions
 *                        API (LM Studio, vLLM, Tabby, …).  Supports text,
 *                        structured output (JSON mode), and streaming.
 *
 *   "ollama"             Ollama's built-in OpenAI-compatible /v1 layer.
 *                        Default base URL: http://localhost:11434/v1.
 *                        Model discovery uses GET /api/tags.
 *                        Supports text, structured output, and streaming.
 *
 *   "other"              Generic HTTP endpoint.  Only generateText is
 *                        supported.  Sends a POST with { model, prompt }
 *                        and reads { text } (or { response }) from the body.
 *
 * Configuration:
 *   config.baseUrl            Required for all types (except "ollama" where
 *                             http://localhost:11434 is used as default).
 *   config.apiKey             Optional bearer token; omitted when empty.
 *   config.customHeaders      Optional extra HTTP headers forwarded verbatim
 *                             to provider requests; server-side only.
 *   config.customProviderType Defaults to "openai-compatible".
 *   config.model              Required; no global default can be inferred.
 */

import OpenAI from "openai";
import { z } from "zod";
import type { AiConfig, Modality } from "../core.js";
import type {
  TextResult,
  StructuredResult,
  ModelDescriptor,
  TokenUsage,
  InputModality,
} from "../types.js";
import { ProviderError } from "../types.js";
import { calculateCost, maskApiKey, getLogger } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OLLAMA_DEFAULT_BASE = "http://localhost:11434";
const OLLAMA_OPENAI_SUFFIX = "/v1";
const MAX_TOKENS_DEFAULT = 4096;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the base URL for the OpenAI SDK. */
function resolveBaseUrl(config: AiConfig): string {
  const type = config.customProviderType ?? "openai-compatible";
  if (type === "ollama") {
    const root = config.baseUrl ?? OLLAMA_DEFAULT_BASE;
    return root.endsWith("/v1") ? root : `${root.replace(/\/$/, "")}${OLLAMA_OPENAI_SUFFIX}`;
  }
  const url = config.baseUrl;
  if (!url) throw new Error("config.baseUrl is required for the 'custom' provider.");
  return url;
}

/** Build the Authorization header value when an API key is supplied. */
function authHeader(apiKey: string | undefined): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

// ---------------------------------------------------------------------------
// CustomProvider
// ---------------------------------------------------------------------------

export class CustomProvider extends BaseProvider {
  readonly name = "custom" as const;
  readonly supportedModalities: Modality[];

  private readonly _client: OpenAI | null;
  private readonly _type: "openai-compatible" | "ollama" | "other";
  private readonly _baseUrl: string;
  private readonly _extraHeaders: Record<string, string>;

  constructor(config: AiConfig) {
    super(config);
    this._type = config.customProviderType ?? "openai-compatible";

    if (config.apiKey) {
      getLogger().debug({ apiKey: maskApiKey(config.apiKey) }, "CustomProvider: initialised");
    } else {
      getLogger().debug({ type: this._type }, "CustomProvider: initialised (no API key)");
    }

    this._extraHeaders = config.customHeaders ?? {};

    if (this._type === "other") {
      const url = config.baseUrl;
      if (!url) throw new Error("config.baseUrl is required for customProviderType 'other'.");
      this._baseUrl = url;
      this._client = null;
      this.supportedModalities = ["text"];
    } else {
      this._baseUrl = resolveBaseUrl(config);
      this._client = new OpenAI({
        apiKey: config.apiKey ?? "no-key",
        baseURL: this._baseUrl,
        defaultHeaders: {
          ...authHeader(config.apiKey),
          ...this._extraHeaders,
        },
      });
      this.supportedModalities = ["text", "structured"];
    }
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  override async generateText(prompt: string, options?: ProviderCallOptions): Promise<TextResult> {
    this.assertCapability("text");
    const model = this.config.model ?? "default";
    const start = Date.now();

    if (this._type === "other") {
      return this._generateTextOther(prompt, model, start, options);
    }

    const client = this._client!;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      });
      const choice = response.choices[0];
      const usage: TokenUsage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };
      return {
        modality: "text",
        provider: "custom",
        model,
        content: choice?.message.content ?? "",
        usage,
        cost: calculateCost(model, usage),
        latencyMs: Date.now() - start,
        finishReason: choice?.finish_reason ?? "stop",
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  /** Generic HTTP handler for customProviderType === "other". */
  private async _generateTextOther(
    prompt: string,
    model: string,
    start: number,
    options?: ProviderCallOptions,
  ): Promise<TextResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeader(this.config.apiKey),
      ...this._extraHeaders,
    };
    let resp: Response;
    try {
      resp = await fetch(this._baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, prompt }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError("custom", `HTTP request failed: ${msg}`, undefined, true);
    }
    if (!resp.ok) {
      const retryable = resp.status === 429 || resp.status >= 500;
      throw new ProviderError("custom", `HTTP ${resp.status}`, resp.status, retryable);
    }
    const body = (await resp.json()) as Record<string, unknown>;
    const content =
      typeof body["text"] === "string"
        ? body["text"]
        : typeof body["response"] === "string"
          ? body["response"]
          : JSON.stringify(body);
    const zeroUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    return {
      modality: "text",
      provider: "custom",
      model,
      content,
      usage: zeroUsage,
      cost: calculateCost(model, zeroUsage),
      latencyMs: Date.now() - start,
      finishReason: "stop",
    };
  }

  // -------------------------------------------------------------------------
  // Streaming text
  // -------------------------------------------------------------------------

  override async *streamText(prompt: string, options?: ProviderCallOptions): AsyncIterable<string> {
    this.assertCapability("text");
    const model = this.config.model ?? "default";
    const client = this._client!;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
        temperature: options?.temperature ?? this.config.temperature,
        ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta.content;
        if (delta) yield delta;
      }
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Structured output (JSON mode + Zod)
  // -------------------------------------------------------------------------

  override async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderCallOptions,
  ): Promise<StructuredResult<T>> {
    this.assertCapability("structured");
    const model = this.config.model ?? "default";
    const start = Date.now();
    const maxTok = options?.maxTokens ?? this.config.maxTokens ?? MAX_TOKENS_DEFAULT;
    const client = this._client!;
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({
      role: "user",
      content: `${prompt}\n\nRespond with valid JSON only. No markdown fences.`,
    });

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        response_format: { type: "json_object" },
        max_tokens: maxTok,
      });
      const raw = response.choices[0]?.message.content ?? "{}";
      const parsed: unknown = JSON.parse(raw);
      const data = schema.parse(parsed);
      const usage: TokenUsage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };
      return {
        modality: "structured",
        provider: "custom",
        model,
        data,
        usage,
        cost: calculateCost(model, usage),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // listModels — Ollama uses /api/tags; others return a minimal stub
  // -------------------------------------------------------------------------

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    if (this._type === "ollama") {
      return this._listOllamaModels(modality, accepts);
    }
    // For openai-compatible servers, attempt the standard /models endpoint.
    if (this._client) {
      try {
        const list = await this._client.models.list();
        const descriptors: ModelDescriptor[] = list.data.map((m) => ({
          id: m.id,
          name: m.id,
          capabilities: ["text", "structured"] as Modality[],
        }));
        let filtered = modality
          ? descriptors.filter((d) => d.capabilities.includes(modality))
          : descriptors;
        if (accepts)
          filtered = filtered.filter((d) => d.inputCapabilities?.includes(accepts) ?? false);
        return filtered;
      } catch {
        // Fall through to single-model stub.
      }
    }
    const model = this.config.model ?? "custom-model";
    const stub: ModelDescriptor = { id: model, name: model, capabilities: ["text", "structured"] };
    if (modality && !stub.capabilities.includes(modality)) return [];
    if (accepts && !(stub.inputCapabilities?.includes(accepts) ?? false)) return [];
    return [stub];
  }

  /** Discover models via Ollama's GET /api/tags endpoint. */
  private async _listOllamaModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    // Ollama tags endpoint lives at the root, not under /v1.
    const root = (this.config.baseUrl ?? OLLAMA_DEFAULT_BASE).replace(/\/v1\/?$/, "");
    const tagsUrl = `${root}/api/tags`;
    try {
      const resp = await fetch(tagsUrl, {
        headers: { ...authHeader(this.config.apiKey), ...this._extraHeaders },
      });
      if (!resp.ok) return [];
      const body = (await resp.json()) as { models?: Array<{ name: string }> };
      const items = body.models ?? [];
      const descriptors: ModelDescriptor[] = items.map((m) => ({
        id: m.name,
        name: m.name,
        capabilities: ["text", "structured"] as Modality[],
      }));
      let filtered = modality
        ? descriptors.filter((d) => d.capabilities.includes(modality))
        : descriptors;
      if (accepts)
        filtered = filtered.filter((d) => d.inputCapabilities?.includes(accepts) ?? false);
      return filtered;
    } catch {
      const model = this.config.model ?? "llama3";
      return [{ id: model, name: model, capabilities: ["text", "structured"] }];
    }
  }

  // -------------------------------------------------------------------------
  // Error wrapping
  // -------------------------------------------------------------------------

  private _wrapError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      return new ProviderError("custom", err.message, err.status, retryable);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new ProviderError("custom", msg);
  }
}
