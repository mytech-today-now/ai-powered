/**
 * @file src/ai-powered/providers/lumaai.ts
 *
 * Luma AI provider — text-to-video and image-to-video generation via Ray-2.
 *
 * Supported modalities:
 *   video   Ray-2 / Ray-Flash-2 text-to-video and image-to-video
 *
 * Async polling: generations.create() submits a job; this provider polls
 * generations.get() at POLL_INTERVAL_MS intervals until state is 'completed'
 * or 'failed', until pollTimeoutMs elapses, or until options.signal fires.
 *
 * Transport: the completed video URL is fetched server-side and returned as a
 * data:video/mp4;base64,… data URI for self-contained binary transport,
 * consistent with ImageResult and AudioResult conventions in this framework.
 *
 * API key: LUMAAI_API_KEY environment variable or config.apiKey.
 * Keys are always masked via maskApiKey() in all log output.
 */

import LumaAI from "lumaai";
import type { AiConfig, Modality } from "../core.js";
import type { VideoResult, ModelDescriptor } from "../types.js";
import { ProviderError } from "../types.js";
import { maskApiKey, getLogger, calculateCost } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default polling interval between generation status checks. */
const POLL_INTERVAL_MS = 3_000;

/** Maximum total polling duration before a timeout ProviderError is thrown. */
const POLL_TIMEOUT_MS = 300_000;

/** Default Ray model; overridden by config.model. */
const DEFAULT_VIDEO_MODEL = "ray-2" as const;

/** Zero token usage (Luma AI is credit-based, not token-based). */
const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;

// ---------------------------------------------------------------------------
// Static model list
// ---------------------------------------------------------------------------

const LUMAAI_MODELS: ModelDescriptor[] = [
  { id: "ray-2",           name: "Luma Ray-2",          capabilities: ["video"] },
  { id: "ray-2-720p",      name: "Luma Ray-2 720p",     capabilities: ["video"] },
  { id: "ray-flash-2",     name: "Luma Ray-Flash-2",    capabilities: ["video"] },
  { id: "ray-flash-2-720p", name: "Luma Ray-Flash-2 720p", capabilities: ["video"] },
];

// ---------------------------------------------------------------------------
// LumaAIProvider
// ---------------------------------------------------------------------------

/**
 * Luma AI provider — text-to-video and image-to-video generation via Ray-2.
 *
 * Configure via:
 *   provider: "lumaai"
 *   apiKey:   <LUMAAI_API_KEY>  (or set the LUMAAI_API_KEY env var)
 *   model:    "ray-2" | "ray-flash-2"   (default: "ray-2")
 */
export class LumaAIProvider extends BaseProvider {
  readonly name = "lumaai" as const;
  readonly supportedModalities: Modality[] = ["video"];

  private _client: LumaAI;

  constructor(config: AiConfig) {
    super(config);
    const apiKey = config.apiKey ?? process.env["LUMAAI_API_KEY"] ?? "";
    if (!apiKey) {
      throw new Error(
        "Luma AI API key is required. Set LUMAAI_API_KEY or config.apiKey.",
      );
    }
    getLogger().debug({ apiKey: maskApiKey(apiKey) }, "LumaAIProvider: initialised");
    // Disable SDK-level retries; the framework resilience layer handles them.
    this._client = new LumaAI({ authToken: apiKey, maxRetries: 0 });
  }

  /**
   * Generate a video from a text prompt using Luma Ray-2.
   *
   * Submits a text-to-video job, polls until completion, fetches the video
   * binary, and returns it as a base64 data URI.
   *
   * @param prompt  Text description of the video to generate.
   * @param options Call options; set options.signal to cancel in-flight requests.
   * @throws ProviderError if the job fails, times out, or is aborted.
   */
  override async generateVideo(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<VideoResult> {
    this.assertCapability("video");
    const model = this._resolveModel();
    const start = Date.now();

    const gen = await this._submit({ model, prompt, aspect_ratio: "16:9" }, options?.signal);
    const completed = await this._poll(gen.id!, options?.signal);
    const dataUri = await this._fetchAsDataUri(completed.assets?.video, options?.signal);
    const latencyMs = Date.now() - start;

    getLogger().info(
      { provider: "lumaai", model, generationId: completed.id, latencyMs },
      "LumaAIProvider: video generation complete",
    );

    return {
      modality:  "video",
      provider:  "lumaai",
      model,
      data:      dataUri,
      mimeType:  "video/mp4",
      cost:      calculateCost(model, { ...ZERO_USAGE }),
      latencyMs,
      usage:     { ...ZERO_USAGE },
    };
  }

  /**
   * Generate a video anchored to a starting image (image-to-video).
   *
   * Passes the image URL as `keyframes.frame0` to the Luma API, optionally
   * combined with a text prompt to guide the motion.
   *
   * @param imageUrl Public URL or data URI of the starting frame.
   * @param prompt   Optional text guidance for the generated motion.
   * @param options  Call options; set options.signal to cancel in-flight requests.
   * @throws ProviderError if the job fails, times out, or is aborted.
   */
  async generateVideoFromImage(
    imageUrl: string,
    prompt?: string,
    options?: ProviderCallOptions,
  ): Promise<VideoResult> {
    this.assertCapability("video");
    const model = this._resolveModel();
    const start = Date.now();

    const gen = await this._submit(
      {
        model,
        ...(prompt !== undefined ? { prompt } : {}),
        aspect_ratio: "16:9",
        keyframes: { frame0: { type: "image", url: imageUrl } },
      },
      options?.signal,
    );
    const completed = await this._poll(gen.id!, options?.signal);
    const dataUri = await this._fetchAsDataUri(completed.assets?.video, options?.signal);
    const latencyMs = Date.now() - start;

    getLogger().info(
      { provider: "lumaai", model, generationId: completed.id, latencyMs },
      "LumaAIProvider: image-to-video generation complete",
    );

    return {
      modality:  "video",
      provider:  "lumaai",
      model,
      data:      dataUri,
      mimeType:  "video/mp4",
      cost:      calculateCost(model, { ...ZERO_USAGE }),
      latencyMs,
      usage:     { ...ZERO_USAGE },
    };
  }

  /**
   * Returns static model descriptors for all Luma AI video models,
   * optionally filtered to those supporting the requested modality.
   */
  override async listModels(modality?: Modality): Promise<ModelDescriptor[]> {
    if (!modality) return LUMAAI_MODELS;
    return LUMAAI_MODELS.filter((m) => m.capabilities.includes(modality));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolves which Luma model to use for generation. */
  private _resolveModel(): "ray-2" | "ray-flash-2" {
    const m = this.config.model;
    if (m === "ray-flash-2") return "ray-flash-2";
    return DEFAULT_VIDEO_MODEL;
  }

  /**
   * Submits a new generation job to the Luma API.
   * Wraps SDK errors into ProviderError before re-throwing.
   */
  private async _submit(
    params: LumaAI.GenerationCreateParams,
    signal?: AbortSignal,
  ): Promise<LumaAI.Generation> {
    getLogger().debug({ provider: "lumaai", model: params.model }, "LumaAIProvider: submitting job");
    try {
      return await this._client.generations.create(params, { signal } as LumaAI.RequestOptions);
    } catch (err) {
      throw this._wrapError(err);
    }
  }

  /**
   * Polls `generations.get(id)` at POLL_INTERVAL_MS intervals until the
   * generation reaches a terminal state ('completed' or 'failed'), or until
   * POLL_TIMEOUT_MS elapses, or until the AbortSignal fires.
   */
  private async _poll(
    id: string,
    signal?: AbortSignal,
  ): Promise<LumaAI.Generation> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (true) {
      if (signal?.aborted) {
        throw new ProviderError("lumaai", "Request aborted by caller", undefined, false);
      }
      if (Date.now() >= deadline) {
        throw new ProviderError(
          "lumaai",
          `Generation ${id} did not complete within ${POLL_TIMEOUT_MS / 1000}s`,
          undefined,
          true,
        );
      }

      let gen: LumaAI.Generation;
      try {
        gen = await this._client.generations.get(id, { signal } as LumaAI.RequestOptions);
      } catch (err) {
        throw this._wrapError(err);
      }

      getLogger().trace(
        { provider: "lumaai", generationId: id, state: gen.state },
        "LumaAIProvider: poll tick",
      );

      if (gen.state === "completed") return gen;

      if (gen.state === "failed") {
        throw new ProviderError(
          "lumaai",
          `Generation ${id} failed: ${gen.failure_reason ?? "unknown reason"}`,
          undefined,
          false,
        );
      }

      // state is 'queued' or 'dreaming' — wait before next poll
      await this._sleep(POLL_INTERVAL_MS, signal);
    }
  }

  /**
   * Fetches a video from the given URL and returns it as a base64 data URI.
   * Throws ProviderError if the URL is missing or the fetch fails.
   */
  private async _fetchAsDataUri(
    url: string | undefined,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!url) {
      throw new ProviderError("lumaai", "Completed generation has no video asset URL", undefined, false);
    }
    let response: Response;
    try {
      response = await fetch(url, signal ? { signal } : undefined);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ProviderError("lumaai", "Video download aborted by caller", undefined, false);
      }
      throw new ProviderError("lumaai", `Failed to fetch video asset: ${String(err)}`, undefined, true);
    }
    if (!response.ok) {
      throw new ProviderError(
        "lumaai",
        `Video asset fetch failed with HTTP ${response.status}`,
        response.status,
        response.status >= 500,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:video/mp4;base64,${buffer.toString("base64")}`;
  }

  /**
   * Awaitable sleep that rejects early when the AbortSignal fires.
   */
  private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new ProviderError("lumaai", "Request aborted by caller", undefined, false));
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new ProviderError("lumaai", "Request aborted by caller", undefined, false));
      }, { once: true });
    });
  }

  /**
   * Converts any thrown value from the Luma SDK into a typed ProviderError.
   * Preserves retryability hints for 429 and 5xx responses.
   */
  private _wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    if (err instanceof LumaAI.APIError) {
      const status = err.status ?? 0;
      const retryable = status === 429 || status >= 500;
      return new ProviderError("lumaai", err.message, status || undefined, retryable);
    }
    if (err instanceof Error && err.name === "AbortError") {
      return new ProviderError("lumaai", "Request aborted by caller", undefined, false);
    }
    return new ProviderError("lumaai", String(err), undefined, false);
  }
}
