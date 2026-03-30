/**
 * @file src/ai-powered/providers/openai.ts
 *
 * OpenAiProvider — production OpenAI integration.
 *
 * Supported modalities:
 *   text        GPT-4o, o1, gpt-4-turbo, gpt-3.5-turbo (chat completions)
 *   image       DALL-E 3 (image generation)
 *   audio       Whisper (transcription) + tts-1 (speech synthesis)
 *   structured  GPT-4o with JSON mode + Zod parsing
 *   streaming   AsyncIterable<string> via OpenAI streaming API
 *
 * Unsupported modalities (video) throw ProviderCapabilityError.
 *
 * API key: read from config.apiKey or OPENAI_API_KEY env var.
 * Key is always masked as "sk-****" in all log output.
 */

import OpenAI, { toFile } from "openai";
import type { AiConfig, Modality } from "../core.js";
import type {
  TextResult,
  ImageResult,
  TranscriptionResult,
  AudioResult,
  StructuredResult,
  ModelDescriptor,
  TokenUsage,
} from "../types.js";
import { ProviderError } from "../types.js";
import { calculateCost, maskApiKey, getLogger } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Model lists
// ---------------------------------------------------------------------------

const TEXT_MODELS: ModelDescriptor[] = [
  { id: "gpt-4o",             name: "GPT-4o",             capabilities: ["text", "structured"], contextWindow: 128000 },
  { id: "gpt-4o-mini",        name: "GPT-4o Mini",        capabilities: ["text", "structured"], contextWindow: 128000 },
  { id: "o1",                 name: "o1",                 capabilities: ["text"],               contextWindow: 200000 },
  { id: "o1-mini",            name: "o1 Mini",            capabilities: ["text"],               contextWindow: 128000 },
  { id: "gpt-4-turbo",        name: "GPT-4 Turbo",        capabilities: ["text", "structured"], contextWindow: 128000 },
  { id: "gpt-3.5-turbo",      name: "GPT-3.5 Turbo",      capabilities: ["text", "structured"], contextWindow: 16385  },
];

const IMAGE_MODELS: ModelDescriptor[] = [
  { id: "dall-e-3", name: "DALL-E 3", capabilities: ["image"] },
  { id: "dall-e-2", name: "DALL-E 2", capabilities: ["image"] },
];

const AUDIO_MODELS: ModelDescriptor[] = [
  { id: "whisper-1", name: "Whisper",   capabilities: ["audio"] },
  { id: "tts-1",     name: "TTS-1",    capabilities: ["audio"] },
  { id: "tts-1-hd",  name: "TTS-1 HD", capabilities: ["audio"] },
];

const ALL_OPENAI_MODELS: ModelDescriptor[] = [...TEXT_MODELS, ...IMAGE_MODELS, ...AUDIO_MODELS];

// ---------------------------------------------------------------------------
// Default model IDs per modality
// ---------------------------------------------------------------------------

const DEFAULT_TEXT_MODEL  = "gpt-4o";
const DEFAULT_IMAGE_MODEL = "dall-e-3";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
const DEFAULT_TTS_MODEL   = "tts-1";

const IMAGE_MODEL_IDS = new Set(IMAGE_MODELS.map((m) => m.id));

/** Return the configured model only if it is image-capable; else the image default. */
function resolveImageModel(configModel: string | undefined): string {
  if (configModel && IMAGE_MODEL_IDS.has(configModel)) return configModel;
  return DEFAULT_IMAGE_MODEL;
}

// ---------------------------------------------------------------------------
// OpenAiProvider
// ---------------------------------------------------------------------------

export class OpenAiProvider extends BaseProvider {
  readonly name = "openai" as const;
  readonly supportedModalities: Modality[] = ["text", "image", "audio", "structured"];

  private readonly _client: OpenAI;

  constructor(config: AiConfig) {
    super(config);
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY or config.apiKey.',
      );
    }
    getLogger().debug({ apiKey: maskApiKey(apiKey) }, "OpenAiProvider: initialised");
    this._client = new OpenAI({ apiKey });
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  override async generateText(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<TextResult> {
    this.assertCapability("text");
    const model  = this.config.model ?? DEFAULT_TEXT_MODEL;
    const start  = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    try {
      const response = await this._client.chat.completions.create({
        model,
        messages,
        temperature:  options?.temperature ?? this.config.temperature,
        ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      });

      const choice   = response.choices[0];
      const content  = choice?.message.content ?? "";
      const finish   = choice?.finish_reason ?? "stop";
      const usage: TokenUsage = {
        promptTokens:     response.usage?.prompt_tokens     ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens:      response.usage?.total_tokens      ?? 0,
      };
      return {
        modality: "text",
        provider: "openai",
        model,
        content,
        usage,
        cost: calculateCost(model, usage),
        latencyMs: Date.now() - start,
        finishReason: finish,
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Streaming text
  // -------------------------------------------------------------------------

  override async *streamText(
    prompt: string,
    options?: ProviderCallOptions,
  ): AsyncIterable<string> {
    this.assertCapability("text");
    const model = this.config.model ?? DEFAULT_TEXT_MODEL;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    try {
      const stream = await this._client.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        stream: true,
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
  // Image generation (DALL-E 3)
  // -------------------------------------------------------------------------

  override async generateImage(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<ImageResult> {
    this.assertCapability("image");
    void options;
    const model = resolveImageModel(this.config.model);
    const start = Date.now();
    const zeroUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      const response = await this._client.images.generate({
        model,
        prompt,
        n: 1,
        size: "1024x1024",
      });

      const imageData = response.data?.[0];
      // Newer models (gpt-image-1) return b64_json; dall-e-3 returns url by default.
      const data: string = imageData?.url ?? imageData?.b64_json ?? "";
      const mimeType = imageData?.b64_json ? "image/png" : "image/png";

      return {
        modality: "image",
        provider: "openai",
        model,
        data,
        mimeType,
        width: 1024,
        height: 1024,
        usage: zeroUsage,
        cost: calculateCost(model, zeroUsage),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Audio transcription (Whisper)
  // -------------------------------------------------------------------------

  override async transcribeAudio(
    buffer: Buffer,
    options?: ProviderCallOptions,
  ): Promise<TranscriptionResult> {
    this.assertCapability("audio");
    void options;
    const model = DEFAULT_TRANSCRIPTION_MODEL;
    const start = Date.now();
    const zeroUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      const file = await toFile(buffer, "audio.webm", { type: "audio/webm" });
      const response = await this._client.audio.transcriptions.create({
        model,
        file,
        response_format: "verbose_json",
      });

      // The verbose_json format includes `duration` and `language` fields.
      // Cast via `unknown` to satisfy strict index-signature rules — the SDK
      // type for TranscriptionVerbose does not carry an index signature even
      // though the fields are present at runtime when response_format is
      // "verbose_json".
      const raw = response as unknown as { text: string; language?: string; duration?: number };
      const durationSeconds = typeof raw.duration === "number" ? raw.duration : undefined;
      const language: string | undefined = typeof raw.language === "string" ? raw.language : undefined;

      return {
        modality: "audio",
        provider: "openai",
        model,
        text: raw.text,
        ...(language !== undefined ? { language } : {}),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        usage: zeroUsage,
        cost: calculateCost(model, zeroUsage, durationSeconds),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Speech synthesis (TTS)
  // -------------------------------------------------------------------------

  override async synthesizeSpeech(
    text: string,
    options?: ProviderCallOptions,
  ): Promise<AudioResult> {
    this.assertCapability("audio");
    void options;
    const model = DEFAULT_TTS_MODEL;
    const start = Date.now();
    // TTS pricing: per 1k characters treated as prompt tokens
    const charTokens = Math.ceil(text.length / 4);
    const ttsUsage: TokenUsage = {
      promptTokens: charTokens,
      completionTokens: 0,
      totalTokens: charTokens,
    };

    try {
      const mp3 = await this._client.audio.speech.create({
        model,
        input: text,
        voice: "alloy",
        response_format: "mp3",
      });
      const audioBuffer = Buffer.from(await mp3.arrayBuffer());

      return {
        modality: "audio",
        provider: "openai",
        model,
        audio: audioBuffer,
        mimeType: "audio/mpeg",
        usage: ttsUsage,
        cost: calculateCost(model, ttsUsage),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Structured output (JSON mode + Zod parsing)
  // -------------------------------------------------------------------------

  override async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderCallOptions,
  ): Promise<StructuredResult<T>> {
    this.assertCapability("structured");
    const model = this.config.model ?? DEFAULT_TEXT_MODEL;
    const start = Date.now();
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
        temperature: options?.temperature ?? this.config.temperature,
        response_format: { type: "json_object" },
        ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      });

      const raw = response.choices[0]?.message.content ?? "{}";
      const parsed: unknown = JSON.parse(raw);
      const data = schema.parse(parsed);

      const usage: TokenUsage = {
        promptTokens:     response.usage?.prompt_tokens     ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens:      response.usage?.total_tokens      ?? 0,
      };

      return {
        modality: "structured",
        provider: "openai",
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

  override async listModels(modality?: Modality): Promise<ModelDescriptor[]> {
    if (!modality) return ALL_OPENAI_MODELS;
    return ALL_OPENAI_MODELS.filter((m) => m.capabilities.includes(modality));
  }

  // -------------------------------------------------------------------------
  // Error wrapping
  // -------------------------------------------------------------------------

  private _wrapError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      return new ProviderError("openai", err.message, err.status, retryable);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new ProviderError("openai", msg);
  }
}

