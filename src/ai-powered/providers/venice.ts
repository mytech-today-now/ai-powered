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
  VideoResult,
  StructuredResult,
  ModelDescriptor,
  TokenUsage,
  InputModality,
} from "../types.js";
import { ProviderError, ProviderCapabilityError } from "../types.js";
import { calculateCost, maskApiKey, getLogger } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";
import { AspectRatioService } from "../aspect-ratio.js";
import { LimitsValidator } from "../limits-validator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENICE_BASE_URL = "https://api.venice.ai/api/v1";
const MAX_TOKENS_DEFAULT = 4096;

/** Static fallback model list used when the /models endpoint is unavailable. */
const VENICE_STATIC_MODELS: ModelDescriptor[] = [
  { id: "llama-3.3-70b", name: "Llama 3.3 70B", capabilities: ["text", "structured"] },
  { id: "mistral-31-24b", name: "Mistral 3.1 24B", capabilities: ["text", "structured"] },
  // Qwen 2.5 VL is a vision-language model that accepts image input for text/structured tasks.
  // inputCapabilities annotated here so the static fallback list surfaces it when the
  // /models endpoint is unavailable and the UI requests &accepts=image (spec R-004, delta 6).
  {
    id: "qwen-2.5-vl",
    name: "Qwen 2.5 VL",
    capabilities: ["text", "structured"],
    inputCapabilities: ["image"],
  },
  { id: "venice-sd-3.5", name: "Venice SD 3.5", capabilities: ["image"] },
  { id: "fluently-xl", name: "Fluently XL", capabilities: ["image"] },
  {
    id: "wan-2.5-preview-image-to-video",
    name: "Wan 2.5 Image-to-Video",
    capabilities: ["video"],
    inputCapabilities: ["image"],
  },
];

const DEFAULT_TEXT_MODEL = "llama-3.3-70b";
const DEFAULT_IMAGE_MODEL = "fluently-xl";
const DEFAULT_VIDEO_MODEL = "wan-2.5-preview-image-to-video";

/** Poll interval for Venice video queue (ms). */
const VIDEO_POLL_INTERVAL_MS = 3_000;
/** Maximum total wait time for Venice video generation (ms). */
const VIDEO_POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

// ---------------------------------------------------------------------------
// VeniceProvider
// ---------------------------------------------------------------------------

export class VeniceProvider extends BaseProvider {
  readonly name = "venice" as const;
  readonly supportedModalities: Modality[] = ["text", "image", "structured"];

  private readonly _client: OpenAI | null;
  private readonly _apiKey: string;

  constructor(config: AiConfig) {
    super(config);
    const apiKey = config.apiKey ?? "";
    this._apiKey = apiKey;
    if (apiKey) {
      getLogger().debug({ apiKey: maskApiKey(apiKey) }, "VeniceProvider: initialised");
      this._client = new OpenAI({ apiKey, baseURL: VENICE_BASE_URL });
    } else {
      getLogger().debug(
        "VeniceProvider: no API key configured — model listing will use static fallback list",
      );
      this._client = null;
    }
  }

  /**
   * Throws a descriptive error when a generation method is called without an
   * API key.  `listModels()` deliberately does NOT call this so that the proxy
   * `/models` endpoint can return the static model list even when no key is set.
   */
  private _requireKey(): void {
    if (!this._apiKey || !this._client) {
      throw new Error("Venice API key is required. Set VENICE_API_KEY or config.apiKey.");
    }
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  override async generateText(prompt: string, options?: ProviderCallOptions): Promise<TextResult> {
    this._requireKey();
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
      const response = await this._client!.chat.completions.create({
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
        provider: "venice",
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
    this._requireKey();
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
      const stream = await this._client!.chat.completions.create({
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
  // Image generation — POST /image/generate  (Venice-specific endpoint)
  // -------------------------------------------------------------------------

  override async generateImage(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<ImageResult> {
    this._requireKey();
    this.assertCapability("image");
    const model = this.resolveModel(DEFAULT_IMAGE_MODEL, options);
    const start = Date.now();
    const zeroUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // -------------------------------------------------------------------------
    // Resolve width/height from options (aspectRatio → snap, or direct w/h).
    // Falls back to 1024×1024 when no size option is supplied.
    // -------------------------------------------------------------------------
    let width = 1024;
    let height = 1024;

    if (options?.width !== undefined && options.height !== undefined) {
      width = options.width;
      height = options.height;
    } else if (options?.aspectRatio !== undefined && options.aspectRatio !== "auto") {
      try {
        const ratio = AspectRatioService.parse(options.aspectRatio);
        // Derive dimensions from a 1024 base width; snap to the nearest valid resolution.
        const computed = AspectRatioService.calculate(ratio, 1024);
        width = computed.width;
        height = computed.height;
      } catch {
        // Invalid ratio — fall back to default 1024×1024 and continue.
        getLogger().warn(
          { aspectRatio: options.aspectRatio },
          "VeniceProvider: invalid aspectRatio, using default",
        );
      }
    }

    // Snap to the nearest supported resolution and validate limits in one step.
    // validateImage snaps when the model config defines a resolutions list,
    // preventing Venice from receiving arbitrary pairs it rejects with HTTP 404.
    ({ width, height } = LimitsValidator.validateImage("venice", model, width, height));

    const endpoint = `${VENICE_BASE_URL}/image/generate`;
    let resp: Response;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this._apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, prompt, width, height }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError("venice", `Image request failed: ${msg}`, undefined, true);
    }

    if (!resp.ok) {
      const retryable = resp.status === 429 || resp.status >= 500;
      throw new ProviderError(
        "venice",
        `Image generation HTTP ${resp.status}`,
        resp.status,
        retryable,
      );
    }

    // Venice image response (current): { images: string[], request: { data: { format: string } } }
    // Each element in `images` is a raw base64 string (no data-URI prefix).
    // Older Venice docs described objects with b64_json/url; handle both shapes.
    const body = (await resp.json()) as {
      images?: Array<string | { b64_json?: string; url?: string }>;
      request?: { data?: { format?: string } };
    };
    const first = body.images?.[0];
    const format = body.request?.data?.format ?? "webp";
    const mimeType = format === "png" ? "image/png" : "image/webp";
    let data = "";
    if (typeof first === "string" && first.length > 0) {
      data = `data:${mimeType};base64,${first}`;
    } else if (first && typeof first === "object") {
      data = first.b64_json ? `data:${mimeType};base64,${first.b64_json}` : (first.url ?? "");
    }

    return {
      modality: "image",
      provider: "venice",
      model,
      data,
      mimeType,
      width,
      height,
      usage: zeroUsage,
      cost: calculateCost(model, zeroUsage),
      latencyMs: Date.now() - start,
    };
  }

  // -------------------------------------------------------------------------
  // Video generation — async queue (bd-9bsw)
  // -------------------------------------------------------------------------

  /**
   * Generate a video from a single reference image using Venice's async queue API.
   *
   * Venice's WAN model accepts exactly one seed frame (`init_image`).  If more
   * than one image is supplied in `options.images`, a ProviderCapabilityError is
   * thrown (design deviation D2).
   *
   * Flow: POST /video/queue → poll GET /video/{jobId} → GET /video/complete/{jobId}
   * → fetch video bytes → return base64 data URI.
   *
   * @param imageUrl  Public URL of the seed frame.
   * @param prompt    Text prompt guiding the generated motion.
   * @param options   Call options; set options.signal to cancel in-flight polling.
   * @throws ProviderCapabilityError when more than one image is supplied.
   * @throws ProviderError on API or network failures.
   */
  async generateVideoFromImage(
    imageUrl: string,
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<VideoResult> {
    this._requireKey();

    // Venice WAN model supports exactly one seed frame (deviation D2).
    // No assertCapability("video") here — venice does not expose video through
    // the standard generateVideo interface (text-to-video unsupported).
    if ((options?.images?.length ?? 0) > 1) {
      throw new ProviderCapabilityError("venice", "video");
    }

    const model = this.resolveModel(DEFAULT_VIDEO_MODEL, options);
    const start = Date.now();
    const logger = getLogger();
    const signal = options?.signal;

    logger.info({ model, event: "video_queue_submit" }, "VeniceProvider: submitting I2V job");

    // Step 1 — submit the job to the video queue.
    const queueResp = await this._venicePost(
      "/video/queue",
      { model, init_image: imageUrl, prompt },
      signal,
    );
    const jobId = (queueResp as { jobId?: string }).jobId;
    if (!jobId) {
      throw new ProviderError("venice", "Video queue response missing jobId", undefined, false);
    }

    logger.info({ jobId, event: "video_queue_accepted" }, "VeniceProvider: I2V job queued");

    // Step 2 — poll until the job is complete.
    await this._pollVideoJob(jobId, signal);

    // Step 3 — retrieve the completed video URL.
    const completeResp = await this._venicePost(`/video/complete/${jobId}`, {}, signal);
    const videoUrl = (completeResp as { videoUrl?: string }).videoUrl;
    if (!videoUrl) {
      throw new ProviderError(
        "venice",
        "Video complete response missing videoUrl",
        undefined,
        false,
      );
    }

    // Step 4 — fetch video bytes and convert to base64 data URI.
    const videoResp = await fetch(videoUrl, { ...(signal !== undefined ? { signal } : {}) });
    if (!videoResp.ok) {
      throw new ProviderError(
        "venice",
        `Video download HTTP ${videoResp.status}`,
        videoResp.status,
        true,
      );
    }
    const bytes = await videoResp.arrayBuffer();
    const b64 = Buffer.from(bytes).toString("base64");
    const latencyMs = Date.now() - start;

    logger.info(
      { jobId, latencyMs, event: "video_complete" },
      "VeniceProvider: I2V generation complete",
    );

    const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    return {
      modality: "video",
      provider: "venice",
      model,
      data: `data:video/mp4;base64,${b64}`,
      mimeType: "video/mp4",
      usage: zeroUsage,
      cost: calculateCost(model, zeroUsage),
      latencyMs,
    };
  }

  /**
   * POST to a Venice API endpoint (non-OpenAI-compatible paths).
   * @internal
   */
  private async _venicePost(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let resp: Response;
    try {
      resp = await fetch(`${VENICE_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this._apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError("venice", `Venice POST ${path} failed: ${msg}`, undefined, true);
    }
    if (!resp.ok) {
      const retryable = resp.status === 429 || resp.status >= 500;
      throw new ProviderError(
        "venice",
        `Venice POST ${path} HTTP ${resp.status}`,
        resp.status,
        retryable,
      );
    }
    return resp.json();
  }

  /**
   * Poll the Venice video job status until it is complete or the timeout elapses.
   * @internal
   */
  private async _pollVideoJob(jobId: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    const logger = getLogger();

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new ProviderError("venice", "Video generation aborted", undefined, false);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));

      let resp: Response;
      try {
        resp = await fetch(`${VENICE_BASE_URL}/video/${jobId}`, {
          headers: { Authorization: `Bearer ${this._apiKey}` },
          ...(signal !== undefined ? { signal } : {}),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ProviderError("venice", `Video poll failed: ${msg}`, undefined, true);
      }

      if (!resp.ok) {
        const retryable = resp.status === 429 || resp.status >= 500;
        throw new ProviderError("venice", `Video poll HTTP ${resp.status}`, resp.status, retryable);
      }

      const status = (await resp.json()) as { status?: string };
      logger.debug({ jobId, status: status.status }, "VeniceProvider: poll tick");

      if (status.status === "complete" || status.status === "completed") return;
      if (status.status === "failed" || status.status === "error") {
        throw new ProviderError("venice", `Venice video job ${jobId} failed`, undefined, false);
      }
      // Any other status (queued, processing, etc.) — keep polling.
    }

    throw new ProviderError(
      "venice",
      `Venice video job ${jobId} timed out after 5 minutes`,
      undefined,
      true,
    );
  }

  // -------------------------------------------------------------------------
  // Structured output (JSON mode + Zod)
  // -------------------------------------------------------------------------

  override async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderCallOptions,
  ): Promise<StructuredResult<T>> {
    this._requireKey();
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
      const response = await this._client!.chat.completions.create({
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
        provider: "venice",
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
  // listModels — dynamic discovery via GET /models with capability filtering
  // -------------------------------------------------------------------------

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    // No API key — skip the live fetch and use the built-in static list so that
    // the proxy /models endpoint can still populate the UI even without a key.
    if (!this._apiKey) {
      return this._filteredStatic(modality, accepts);
    }
    try {
      // Venice uses ?type=image to return only image-capable models.
      // Without this filter the endpoint returns mostly text models,
      // so the image modality dropdown would remain empty.
      const typeParam = modality === "image" ? "?type=image" : "";
      const resp = await fetch(`${VENICE_BASE_URL}/models${typeParam}`, {
        headers: { Authorization: `Bearer ${this._apiKey}` },
      });
      if (!resp.ok) return this._filteredStatic(modality, accepts);

      // Venice /models returns an OpenAI-compatible list with a `type` field:
      //   "text" | "image" | "code" | "embedding" …
      const body = (await resp.json()) as {
        data?: Array<{ id: string; object?: string; [k: string]: unknown }>;
      };
      const raw = body.data ?? [];

      const descriptors: ModelDescriptor[] = raw.map((m) => {
        // When ?type=image is used every returned model is an image model.
        // Otherwise fall back to the `type` field on each entry.
        const caps: Modality[] =
          modality === "image"
            ? ["image"]
            : (() => {
                const type = typeof m["type"] === "string" ? (m["type"] as string) : "text";
                return type === "image" ? ["image"] : (["text", "structured"] as Modality[]);
              })();
        return { id: m.id, name: m.id, capabilities: caps };
      });

      let filtered = modality
        ? descriptors.filter((d) => d.capabilities.includes(modality))
        : descriptors;
      if (accepts)
        filtered = filtered.filter((d) => d.inputCapabilities?.includes(accepts) ?? false);
      return filtered;
    } catch {
      return this._filteredStatic(modality, accepts);
    }
  }

  static override imageCapabilities(): import("./base.js").ImageCapability[] {
    return [{ modality: "video", maxImages: 1, fieldName: "init_image" }];
  }

  private _filteredStatic(modality?: Modality, accepts?: InputModality): ModelDescriptor[] {
    let models = VENICE_STATIC_MODELS;
    if (modality) models = models.filter((m) => m.capabilities.includes(modality));
    if (accepts) models = models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false);
    return models;
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
