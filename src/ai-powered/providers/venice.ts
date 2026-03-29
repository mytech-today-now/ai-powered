/**
 * @file src/ai-powered/providers/venice.ts
 *
 * VeniceProvider — Venice.ai integration.
 *
 * Venice.ai exposes an OpenAI-compatible API at https://api.venice.ai/api/v1.
 * The `openai` npm package is used for text/chat/streaming/structured calls.
 *
 * Image generation (Design Q2 resolution): Venice uses POST /image/generate
 * (not the OpenAI-standard /images/generations path).  This is called via
 * native fetch so the endpoint can be configured independently of the OpenAI
 * SDK's fixed path.
 *
 * Supported modalities:
 *   text        chat completions with temperature, max_tokens, system prompt
 *   image       POST /image/generate  (1024×1024 PNG, base64 response)
 *   structured  JSON mode + Zod parsing
 *   streaming   AsyncIterable<string>
 *
 * Unsupported modalities (audio, video) throw ProviderCapabilityError.
 *
 * API key: read from config.apiKey or VENICE_API_KEY env var.
 * Key is always masked as "ven-****" in all log output.
 *
 * Model discovery: GET /models with capability filtering via the model's
 * `type` field returned by the Venice API.
 */

import OpenAI from "openai";
import { z } from "zod";
import type { AiConfig, Modality } from "../core.js";
import type {
  TextResult,
  ImageResult,
  StructuredResult,
  ModelDescriptor,
  TokenUsage,
} from "../types.js";
import { ProviderError } from "../types.js";
import { calculateCost, maskApiKey, getLogger } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENICE_BASE_URL  = "https://api.venice.ai/api/v1";
const MAX_TOKENS_DEFAULT = 4096;

/** Static fallback model list used when the /models endpoint is unavailable. */
const VENICE_STATIC_MODELS: ModelDescriptor[] = [
  { id: "llama-3.3-70b",       name: "Llama 3.3 70B",       capabilities: ["text", "structured"] },
  { id: "mistral-31-24b",      name: "Mistral 3.1 24B",      capabilities: ["text", "structured"] },
  { id: "venice-sd-3.5",       name: "Venice SD 3.5",        capabilities: ["image"] },
  { id: "fluently-xl",         name: "Fluently XL",          capabilities: ["image"] },
];

const DEFAULT_TEXT_MODEL  = "llama-3.3-70b";
const DEFAULT_IMAGE_MODEL = "fluently-xl";

// ---------------------------------------------------------------------------
// VeniceProvider
// ---------------------------------------------------------------------------

export class VeniceProvider extends BaseProvider {
  readonly name = "venice" as const;
  readonly supportedModalities: Modality[] = ["text", "image", "structured"];

  private readonly _client: OpenAI;
  private readonly _apiKey: string;

  constructor(config: AiConfig) {
    super(config);
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error("Venice API key is required. Set VENICE_API_KEY or config.apiKey.");
    }
    this._apiKey = apiKey;
    getLogger().debug({ apiKey: maskApiKey(apiKey) }, "VeniceProvider: initialised");
    this._client = new OpenAI({ apiKey, baseURL: VENICE_BASE_URL });
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  override async generateText(prompt: string, options?: ProviderCallOptions): Promise<TextResult> {
    this.assertCapability("text");
    const model = this.config.model ?? DEFAULT_TEXT_MODEL;
    const start = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    try {
      const response = await this._client.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      });
      const choice = response.choices[0];
      const usage: TokenUsage = {
        promptTokens:     response.usage?.prompt_tokens     ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens:      response.usage?.total_tokens      ?? 0,
      };
      return {
        modality: "text",
        provider: "venice",
        model,
        content:      choice?.message.content ?? "",
        usage,
        cost:         calculateCost(model, usage),
        latencyMs:    Date.now() - start,
        finishReason: choice?.finish_reason ?? "stop",
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Streaming text
  // -------------------------------------------------------------------------

  override async *streamText(prompt: string, options?: ProviderCallOptions): AsyncIterable<string> {
    this.assertCapability("text");
    const model = this.config.model ?? DEFAULT_TEXT_MODEL;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    try {
      const stream = await this._client.chat.completions.create({
        model, messages, stream: true,
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
  // Image generation — POST /image/generate  (Venice-specific endpoint)
  // -------------------------------------------------------------------------

  override async generateImage(prompt: string, options?: ProviderCallOptions): Promise<ImageResult> {
    this.assertCapability("image");
    void options;
    const model = this.config.model ?? DEFAULT_IMAGE_MODEL;
    const start = Date.now();
    const zeroUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const endpoint = `${VENICE_BASE_URL}/image/generate`;
    let resp: Response;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${this._apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, prompt, width: 1024, height: 1024 }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError("venice", `Image request failed: ${msg}`, undefined, true);
    }

    if (!resp.ok) {
      const retryable = resp.status === 429 || resp.status >= 500;
      throw new ProviderError("venice", `Image generation HTTP ${resp.status}`, resp.status, retryable);
    }

    // Venice image response: { images: [{ b64_json?: string, url?: string }] }
    const body = await resp.json() as { images?: Array<{ b64_json?: string; url?: string }> };
    const first = body.images?.[0];
    const data  = first?.b64_json
      ? `data:image/png;base64,${first.b64_json}`
      : (first?.url ?? "");

    return {
      modality: "image",
      provider: "venice",
      model,
      data,
      mimeType:  "image/png",
      width:     1024,
      height:    1024,
      usage:     zeroUsage,
      cost:      calculateCost(model, zeroUsage),
      latencyMs: Date.now() - start,
    };
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
    const model  = this.config.model ?? DEFAULT_TEXT_MODEL;
    const start  = Date.now();
    const maxTok = options?.maxTokens ?? this.config.maxTokens ?? MAX_TOKENS_DEFAULT;
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({
      role: "user",
      content: `${prompt}\n\nRespond with valid JSON only. No markdown fences.`,
    });

    try {
      const response = await this._client.chat.completions.create({
        model,
        messages,
        temperature:     options?.temperature ?? this.config.temperature,
        response_format: { type: "json_object" },
        max_tokens:      maxTok,
      });
      const raw     = response.choices[0]?.message.content ?? "{}";
      const parsed: unknown = JSON.parse(raw);
      const data    = schema.parse(parsed);
      const usage: TokenUsage = {
        promptTokens:     response.usage?.prompt_tokens     ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens:      response.usage?.total_tokens      ?? 0,
      };
      return {
        modality: "structured",
        provider: "venice",
        model,
        data,
        usage,
        cost:      calculateCost(model, usage),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // listModels — dynamic discovery via GET /models with capability filtering
  // -------------------------------------------------------------------------

  override async listModels(modality?: Modality): Promise<ModelDescriptor[]> {
    try {
      const resp = await fetch(`${VENICE_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${this._apiKey}` },
      });
      if (!resp.ok) return this._filteredStatic(modality);

      // Venice /models returns an OpenAI-compatible list with a `type` field:
      //   "text" | "image" | "code" | "embedding" …
      const body = await resp.json() as {
        data?: Array<{ id: string; object?: string; [k: string]: unknown }>;
      };
      const raw = body.data ?? [];

      const descriptors: ModelDescriptor[] = raw.map((m) => {
        const type = typeof m["type"] === "string" ? (m["type"] as string) : "text";
        const caps: Modality[] = type === "image" ? ["image"] : ["text", "structured"];
        return { id: m.id, name: m.id, capabilities: caps };
      });

      return modality ? descriptors.filter((d) => d.capabilities.includes(modality)) : descriptors;
    } catch {
      return this._filteredStatic(modality);
    }
  }

  private _filteredStatic(modality?: Modality): ModelDescriptor[] {
    if (!modality) return VENICE_STATIC_MODELS;
    return VENICE_STATIC_MODELS.filter((m) => m.capabilities.includes(modality));
  }

  // -------------------------------------------------------------------------
  // Error wrapping
  // -------------------------------------------------------------------------

  private _wrapError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      return new ProviderError("venice", err.message, err.status, retryable);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new ProviderError("venice", msg);
  }
}

