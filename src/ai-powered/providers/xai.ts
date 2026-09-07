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
 *   image       aurora, grok-2-image (images/generations endpoint)
 *   video       grok-imagine-video (async polling via /v1/videos/generations)
 *
 * Unsupported modalities (audio) throw ProviderCapabilityError.
 *
 * API key: read from config.apiKey or XAI_API_KEY env var.
 * Key is always masked as "xai-****" in all log output.
 */

import OpenAI from "openai";
import { z } from "zod";
import type { AiConfig, Modality } from "../core.js";
import type {
  TextResult,
  ImageResult,
  VideoResult,
  StructuredResult,
  ModelDescriptor,
  TokenUsage,
  InputModality,
} from "../types.js";
import { ProviderError } from "../types.js";
import { calculateCost, maskApiKey, getLogger } from "../utils.js";
import { LimitsValidator } from "../limits-validator.js";
import { AspectRatioService } from "../aspect-ratio.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const XAI_BASE_URL = "https://api.x.ai/v1";
const MAX_TOKENS_DEFAULT = 4096;

/** Video generation polling constants. */
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 600_000; // 10 minutes
const DEFAULT_VIDEO_MODEL = "grok-imagine-video";

/** Aspect ratios natively supported by xAI image models (from xai.json). */
const XAI_SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "auto",
]);

const GROK_MODELS: ModelDescriptor[] = [
  { id: "grok-2", name: "Grok 2", capabilities: ["text", "structured"], contextWindow: 131072 },
  {
    id: "grok-2-latest",
    name: "Grok 2 Latest",
    capabilities: ["text", "structured"],
    contextWindow: 131072,
  },
  {
    id: "grok-2-mini",
    name: "Grok 2 Mini",
    capabilities: ["text", "structured"],
    contextWindow: 131072,
  },
  {
    id: "grok-beta",
    name: "Grok Beta",
    capabilities: ["text", "structured"],
    contextWindow: 131072,
  },
  {
    id: "grok-vision-beta",
    name: "Grok Vision Beta",
    capabilities: ["text", "structured"],
    contextWindow: 8192,
    inputCapabilities: ["image"],
  },
  { id: "aurora", name: "Aurora", capabilities: ["image"], contextWindow: 0 },
  { id: "grok-2-image", name: "Grok 2 Image", capabilities: ["image"], contextWindow: 0 },
  {
    id: "grok-imagine-video",
    name: "Grok Imagine Video",
    capabilities: ["video"],
    contextWindow: 0,
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    resolutions: ["480p", "720p"],
    durationRange: { min: 1, max: 15, default: 8 },
    inputCapabilities: ["image"],
  },
];

const DEFAULT_TEXT_MODEL = "grok-2";
const DEFAULT_IMAGE_MODEL = "aurora";

// ---------------------------------------------------------------------------
// GrokProvider
// ---------------------------------------------------------------------------

/** Zero token usage (video is billed per-clip, not per-token). */
const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;

/**
 * Scan a multimodal messages array for the first `image_url` content block
 * whose `url` is a data URI and return the full data URI string.
 *
 * xAI's video generation API accepts a base64 data URI directly in the
 * `image.url` field, so we return the URI as-is rather than decoding it.
 *
 * Returns `null` when no suitable image block is found.
 */
function extractImageDataUri(messages: ProviderCallOptions["messages"] | undefined): string | null {
  if (!messages) return null;
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block["type"] !== "image_url") continue;
      const imgUrl = block["image_url"] as { url?: string } | undefined;
      const url = imgUrl?.url ?? "";
      if (/^data:[^;]+;base64,/.test(url)) return url;
    }
  }
  return null;
}

export class GrokProvider extends BaseProvider {
  readonly name = "xai" as const;
  readonly supportedModalities: Modality[] = ["text", "structured", "image", "video"];

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
    const model = this.resolveModel(DEFAULT_TEXT_MODEL, options);
    const start = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    if (options?.fileContentBlock) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: prompt }, options.fileContentBlock],
      } as unknown as OpenAI.Chat.ChatCompletionMessageParam);
    } else {
      messages.push({ role: "user", content: prompt });
    }

    try {
      const response = await this._client.chat.completions.create({
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
        provider: "xai",
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

  // -------------------------------------------------------------------------
  // Streaming text
  // -------------------------------------------------------------------------

  override async *streamText(prompt: string, options?: ProviderCallOptions): AsyncIterable<string> {
    this.assertCapability("text");
    const model = this.resolveModel(DEFAULT_TEXT_MODEL, options);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = options?.systemPrompt ?? this.config.systemPrompt;
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    if (options?.fileContentBlock) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: prompt }, options.fileContentBlock],
      } as unknown as OpenAI.Chat.ChatCompletionMessageParam);
    } else {
      messages.push({ role: "user", content: prompt });
    }

    try {
      const stream = await this._client.chat.completions.create({
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
  // Image generation (Aurora / Grok 2 Image)
  // -------------------------------------------------------------------------

  override async generateImage(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<ImageResult> {
    this.assertCapability("image");
    const model = this.resolveModel(DEFAULT_IMAGE_MODEL, options);
    const start = Date.now();
    const zeroUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Resolve aspect ratio — use as-is if supported, fall back to "1:1".
    const reqRatio = options?.aspectRatio ?? "1:1";
    const aspect_ratio = XAI_SUPPORTED_ASPECT_RATIOS.has(reqRatio) ? reqRatio : "1:1";

    // Resolve resolution — normalise to "1k" | "2k", default "1k".
    const rawRes = options?.resolution?.toLowerCase() ?? "1k";
    const resolution = rawRes === "2k" ? "2k" : "1k";
    const basePx = resolution === "2k" ? 2048 : 1024;

    // Compute output pixel dimensions from aspect ratio and base resolution.
    let width = basePx;
    let height = basePx;
    if (aspect_ratio !== "auto" && aspect_ratio !== "1:1") {
      const parsed = AspectRatioService.parse(aspect_ratio);
      if (parsed.widthRatio >= parsed.heightRatio) {
        width = basePx;
        height = Math.round(basePx * (parsed.heightRatio / parsed.widthRatio));
      } else {
        height = basePx;
        width = Math.round(basePx * (parsed.widthRatio / parsed.heightRatio));
      }
    }

    // Validate limits before calling the API (fail-fast).
    LimitsValidator.validateImage("xai", model, width, height);

    try {
      // extra_body is a valid OpenAI-SDK escape hatch for non-standard params;
      // the TypeScript types do not include it, so we cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = (await (this._client.images.generate as any)({
        model,
        prompt,
        n: 1,
        extra_body: { aspect_ratio, resolution },
      })) as { data: Array<{ url?: string; b64_json?: string }> };

      const imageData = response.data?.[0];
      const data: string = imageData?.url ?? imageData?.b64_json ?? "";

      getLogger().info(
        { provider: "xai", model, aspect_ratio, resolution, width, height },
        "GrokProvider: image generation complete",
      );

      return {
        modality: "image",
        provider: "xai",
        model,
        data,
        mimeType: "image/png",
        width,
        height,
        usage: zeroUsage,
        cost: calculateCost(model, zeroUsage),
        latencyMs: Date.now() - start,
      };
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
    const model = this.resolveModel(DEFAULT_TEXT_MODEL, options);
    const start = Date.now();
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
        provider: "xai",
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
  // generateVideo
  // -------------------------------------------------------------------------

  override async generateVideo(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<VideoResult> {
    const model = this.resolveModel(DEFAULT_VIDEO_MODEL, options);
    const apiKey = this.config.apiKey ?? process.env["XAI_API_KEY"] ?? "";
    const opts = options as (ProviderCallOptions & Record<string, unknown>) | undefined;
    const duration = opts?.["duration"] as number | undefined;
    const aspectRatio = opts?.["aspectRatio"] as string | undefined;
    const resolution = opts?.["resolution"] as string | undefined;
    const logger = getLogger();
    const start = Date.now();

    logger.info(`[xai] generateVideo model=${model} prompt="${prompt.slice(0, 80)}…"`);

    // Extract a reference image from the multimodal messages, if any.
    // When present the xAI API performs image-to-video (I2V) generation using
    // the `image.url` field; without it, the model defaults to text-to-video.
    const imageDataUri = extractImageDataUri(opts?.["messages"] as ProviderCallOptions["messages"]);
    if (imageDataUri) {
      logger.info("[xai] generateVideo: reference image detected — using image-to-video mode");
    }

    // Step 1 — submit the generation job
    const body: Record<string, unknown> = { model, prompt };
    if (imageDataUri) body["image"] = { url: imageDataUri };
    if (duration !== undefined) body["duration"] = duration;
    if (aspectRatio !== undefined) body["aspect_ratio"] = aspectRatio;
    if (resolution !== undefined) body["resolution"] = resolution;

    const submitRes = await fetch(`${XAI_BASE_URL}/videos/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: options?.signal ?? null,
    });
    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => submitRes.statusText);
      throw new ProviderError(
        "xai",
        `Video submit failed (${submitRes.status}): ${errText}`,
        submitRes.status,
      );
    }
    const submitData = (await submitRes.json()) as { request_id?: string; id?: string };
    const requestId = submitData.request_id ?? submitData.id;
    if (!requestId) {
      throw new ProviderError("xai", "Video submit response missing request_id");
    }
    logger.info(`[xai] video job submitted request_id=${requestId}`);

    // Step 2 — poll until done
    const videoUrl = await this._pollVideo(requestId, apiKey, options?.signal);

    // Step 3 — fetch and convert to base64 data URI
    const { dataUri, mimeType } = await this._fetchVideoAsDataUri(videoUrl);

    return {
      modality: "video",
      provider: "xai",
      model,
      data: dataUri,
      mimeType,
      usage: ZERO_USAGE,
      cost: calculateCost(model, ZERO_USAGE),
      latencyMs: Date.now() - start,
    };
  }

  private async _pollVideo(
    requestId: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    const logger = getLogger();

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new ProviderError("xai", "Video generation aborted");

      await new Promise<void>((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));

      const pollRes = await fetch(`${XAI_BASE_URL}/videos/${requestId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: signal ?? null,
      });
      if (!pollRes.ok) {
        const errText = await pollRes.text().catch(() => pollRes.statusText);
        throw new ProviderError(
          "xai",
          `Video poll failed (${pollRes.status}): ${errText}`,
          pollRes.status,
        );
      }

      const data = (await pollRes.json()) as {
        status?: string;
        video?: { url?: string };
        url?: string;
        error?: string;
      };
      logger.info(`[xai] poll request_id=${requestId} status=${data.status}`);

      if (data.status === "done" || data.status === "succeeded") {
        const url = data.video?.url ?? data.url;
        if (!url) throw new ProviderError("xai", "Video done but no URL in response");
        return url;
      }
      if (data.status === "failed" || data.status === "error") {
        throw new ProviderError("xai", `Video generation failed: ${data.error ?? data.status}`);
      }
      // status: "pending" | "processing" → keep polling
    }
    throw new ProviderError(
      "xai",
      `Video generation timed out after ${VIDEO_POLL_TIMEOUT_MS / 1000}s`,
    );
  }

  private async _fetchVideoAsDataUri(url: string): Promise<{ dataUri: string; mimeType: string }> {
    const res = await fetch(url);
    if (!res.ok) throw new ProviderError("xai", `Failed to fetch video from URL: ${res.status}`);
    const mimeType = res.headers.get("content-type") ?? "video/mp4";
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { dataUri: `data:${mimeType};base64,${base64}`, mimeType };
  }

  // -------------------------------------------------------------------------
  // listModels
  // -------------------------------------------------------------------------

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    let models = GROK_MODELS;
    if (modality) models = models.filter((m) => m.capabilities.includes(modality));
    if (accepts) models = models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false);
    return models;
  }

  static override imageCapabilities(): import("./base.js").ImageCapability[] {
    return [{ modality: "video", maxImages: 1, fieldName: "image_url" }];
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

/** Alias for consumers that prefer the `XAIProvider` name. */
export { GrokProvider as XAIProvider };
