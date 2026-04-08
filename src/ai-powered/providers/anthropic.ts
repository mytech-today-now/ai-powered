/**
 * @file src/ai-powered/providers/anthropic.ts
 *
 * AnthropicProvider — production Anthropic integration.
 *
 * Supported modalities:
 *   text        Claude 3 family (claude-3-5-sonnet, claude-3-opus, etc.)
 *   structured  Claude with JSON instruction + Zod parsing
 *   streaming   AsyncIterable<string> via Anthropic streaming API
 *
 * Unsupported modalities (image, audio, video) throw ProviderCapabilityError.
 *
 * API key: read from config.apiKey or ANTHROPIC_API_KEY env var.
 * Key is always masked as "sk-ant-****" in all log output.
 */

import Anthropic from "@anthropic-ai/sdk";
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
import { z } from "zod";

// ---------------------------------------------------------------------------
// Model list
// ---------------------------------------------------------------------------

const ANTHROPIC_MODELS: ModelDescriptor[] = [
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
    inputCapabilities: ["image"],
  },
  {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
    inputCapabilities: ["image"],
  },
  {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
    inputCapabilities: ["image"],
  },
  {
    id: "claude-3-sonnet-20240229",
    name: "Claude 3 Sonnet",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
    inputCapabilities: ["image"],
  },
  {
    id: "claude-3-haiku-20240307",
    name: "Claude 3 Haiku",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
    inputCapabilities: ["image"],
  },
];

const DEFAULT_TEXT_MODEL = "claude-3-5-sonnet-20241022";
const MAX_TOKENS_DEFAULT = 4096;

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider extends BaseProvider {
  readonly name = "anthropic" as const;
  readonly supportedModalities: Modality[] = ["text", "structured"];

  private readonly _client: Anthropic;

  constructor(config: AiConfig) {
    super(config);
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error("Anthropic API key is required. Set ANTHROPIC_API_KEY or config.apiKey.");
    }
    getLogger().debug({ apiKey: maskApiKey(apiKey) }, "AnthropicProvider: initialised");
    this._client = new Anthropic({ apiKey });
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  override async generateText(prompt: string, options?: ProviderCallOptions): Promise<TextResult> {
    this.assertCapability("text");
    const model = this.config.model ?? DEFAULT_TEXT_MODEL;
    const start = Date.now();
    const maxTok = options?.maxTokens ?? this.config.maxTokens ?? MAX_TOKENS_DEFAULT;
    const system = options?.systemPrompt ?? this.config.systemPrompt;

    // When a pre-built messages array is provided (e.g. multimodal content blocks
    // from POST /upload), use it directly.  Otherwise construct a plain user message.
    const messages: Anthropic.MessageParam[] = options?.messages
      ? (options.messages as Anthropic.MessageParam[])
      : [{ role: "user", content: prompt }];

    try {
      const response = await this._client.messages.create({
        model,
        max_tokens: maxTok,
        ...(system ? { system } : {}),
        messages,
        temperature: options?.temperature ?? this.config.temperature,
      });

      const content = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const finishReason = response.stop_reason ?? "end_turn";
      const usage: TokenUsage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

      return {
        modality: "text",
        provider: "anthropic",
        model,
        content,
        usage,
        cost: calculateCost(model, usage),
        latencyMs: Date.now() - start,
        finishReason,
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
    const maxTok = options?.maxTokens ?? this.config.maxTokens ?? MAX_TOKENS_DEFAULT;
    const system = options?.systemPrompt ?? this.config.systemPrompt;

    // When a pre-built messages array is provided (e.g. multimodal content blocks
    // from POST /upload), use it directly.  Otherwise construct a plain user message.
    const messages: Anthropic.MessageParam[] = options?.messages
      ? (options.messages as Anthropic.MessageParam[])
      : [{ role: "user", content: prompt }];

    try {
      const stream = this._client.messages.stream({
        model,
        max_tokens: maxTok,
        ...(system ? { system } : {}),
        messages,
        temperature: options?.temperature ?? this.config.temperature,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Structured output (JSON instruction + Zod)
  // -------------------------------------------------------------------------

  override async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderCallOptions,
  ): Promise<StructuredResult<T>> {
    this.assertCapability("structured");
    const model = this.config.model ?? DEFAULT_TEXT_MODEL;
    const start = Date.now();
    const maxTok = options?.maxTokens ?? this.config.maxTokens ?? MAX_TOKENS_DEFAULT;
    const system = options?.systemPrompt ?? this.config.systemPrompt;

    const jsonPrompt = `${prompt}\n\nRespond with valid JSON only. No markdown fences, no explanation.`;

    try {
      const response = await this._client.messages.create({
        model,
        max_tokens: maxTok,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: jsonPrompt }],
        temperature: options?.temperature ?? this.config.temperature,
      });

      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const parsed: unknown = JSON.parse(raw);
      const data = schema.parse(parsed);

      const usage: TokenUsage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

      return {
        modality: "structured",
        provider: "anthropic",
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
  // listModels
  // -------------------------------------------------------------------------

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    let models = ANTHROPIC_MODELS;
    if (modality) models = models.filter((m) => m.capabilities.includes(modality));
    if (accepts) models = models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false);
    return models;
  }

  static override imageCapabilities(): import("./base.js").ImageCapability[] {
    return [{ modality: "vision", maxImages: 20, fieldName: "source" }];
  }

  // -------------------------------------------------------------------------
  // Error wrapping
  // -------------------------------------------------------------------------

  private _wrapError(err: unknown): ProviderError {
    if (err instanceof Anthropic.APIError) {
      const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      return new ProviderError("anthropic", err.message, err.status, retryable);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new ProviderError("anthropic", msg);
  }
}
