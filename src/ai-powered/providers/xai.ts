/**
 * @file src/ai-powered/providers/xai.ts
 *
 * GrokProvider — xAI/Grok integration.
 *
 * xAI's API is fully OpenAI-compatible; this provider uses the `openai` npm
 * package pointed at https://api.x.ai/v1 (no separate xAI SDK required).
 *
 * Design note (Q3 from design.md): The xAI API is OpenAI-compatible by design,
 * so the `openai` npm package is the correct dependency — no additional SDK
 * package needed.
 *
 * Supported modalities:
 *   text        grok-2, grok-2-latest, grok-beta (chat completions)
 *   structured  JSON mode + Zod parsing
 *   streaming   AsyncIterable<string> via streaming chat completions
 *
 * Unsupported modalities (image, audio, video) throw ProviderCapabilityError.
 *
 * API key: read from config.apiKey or XAI_API_KEY env var.
 * Key is always masked as "xai-****" in all log output.
 */

import OpenAI from "openai";
import { z } from "zod";
import type { AiConfig, Modality } from "../core.js";
import type { TextResult, StructuredResult, ModelDescriptor, TokenUsage } from "../types.js";
import { ProviderError } from "../types.js";
import { calculateCost, maskApiKey, getLogger } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const XAI_BASE_URL = "https://api.x.ai/v1";
const MAX_TOKENS_DEFAULT = 4096;

const GROK_MODELS: ModelDescriptor[] = [
  { id: "grok-2",           name: "Grok 2",          capabilities: ["text", "structured"], contextWindow: 131072 },
  { id: "grok-2-latest",    name: "Grok 2 Latest",   capabilities: ["text", "structured"], contextWindow: 131072 },
  { id: "grok-2-mini",      name: "Grok 2 Mini",     capabilities: ["text", "structured"], contextWindow: 131072 },
  { id: "grok-beta",        name: "Grok Beta",       capabilities: ["text", "structured"], contextWindow: 131072 },
  { id: "grok-vision-beta", name: "Grok Vision Beta", capabilities: ["text", "structured"], contextWindow: 8192  },
];

const DEFAULT_TEXT_MODEL = "grok-2";

// ---------------------------------------------------------------------------
// GrokProvider
// ---------------------------------------------------------------------------

export class GrokProvider extends BaseProvider {
  readonly name = "xai" as const;
  readonly supportedModalities: Modality[] = ["text", "structured"];

  private readonly _client: OpenAI;

  constructor(config: AiConfig) {
    super(config);
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error("xAI API key is required. Set XAI_API_KEY or config.apiKey.");
    }
    getLogger().debug({ apiKey: maskApiKey(apiKey) }, "GrokProvider: initialised");
    this._client = new OpenAI({ apiKey, baseURL: XAI_BASE_URL });
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
        provider: "xai",
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
        provider: "xai",
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
  // listModels
  // -------------------------------------------------------------------------

  override async listModels(modality?: Modality): Promise<ModelDescriptor[]> {
    if (!modality) return GROK_MODELS;
    return GROK_MODELS.filter((m) => m.capabilities.includes(modality));
  }

  // -------------------------------------------------------------------------
  // Error wrapping
  // -------------------------------------------------------------------------

  private _wrapError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      return new ProviderError("xai", err.message, err.status, retryable);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new ProviderError("xai", msg);
  }
}

