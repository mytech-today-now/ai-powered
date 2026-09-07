/**
 * @file src/ai-powered/providers/runway.ts
 *
 * Runway AI provider — text-to-video generation.
 *
 * Supported models:
 *   gen4.5        — text-to-video (12 credits/sec)
 *
 * Turbo variants are intentionally omitted from the public model list until
 * a real keyframe-backed image-to-video path exists in this provider.
 *
 * Async polling: textToVideo.create() submits a job returning a task id; this
 * provider polls tasks.retrieve(id) at POLL_INTERVAL_MS intervals until status
 * is SUCCEEDED or FAILED, until POLL_TIMEOUT_MS elapses, or until options.signal
 * fires.
 *
 * Transport: the completed video URL is fetched server-side and returned as a
 * data:video/mp4;base64,… data URI consistent with the framework convention.
 *
 * API key: RUNWAYML_API_SECRET environment variable or config.apiKey.
 * Keys are always masked via maskApiKey() in all log output.
 * Pricing (1 credit = $0.01):
 *   gen4.5      — 12 credits/sec → $0.12/sec (5s = $0.60, 10s = $1.20)
 */

import RunwayML from "@runwayml/sdk";
import type { AiConfig, Modality } from "../core.js";
import type { VideoResult, ModelDescriptor, InputModality } from "../types.js";
import { ProviderError } from "../types.js";
import { maskApiKey, getLogger, calculateCost } from "../utils.js";
import { LimitsValidator } from "../limits-validator.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 600_000; // 10 minutes — Runway jobs can be slow
const DEFAULT_VIDEO_MODEL = "gen4.5" as const;

/** Zero token usage (Runway is credit-based, not token-based). */
const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;

// ---------------------------------------------------------------------------
// Static model list
// ---------------------------------------------------------------------------

const RUNWAY_MODELS: ModelDescriptor[] = [
  {
    id: "gen4.5",
    name: "Runway Gen-4.5",
    capabilities: ["video"],
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["720p"],
    durationRange: { min: 5, max: 10 },
    fpsOptions: [24],
    qualityOptions: ["standard"],
  },
];

// ---------------------------------------------------------------------------
// RunwayProvider
// ---------------------------------------------------------------------------

/**
 * Runway AI provider — text-to-video generation.
 *
 * Configure via:
 *   provider: "runway"
 *   apiKey:   <RUNWAYML_API_SECRET>  (or set RUNWAYML_API_SECRET env var)
 *   model:    "gen4.5"  (default: "gen4.5")
 */
export class RunwayProvider extends BaseProvider {
  readonly name = "runway" as const;
  readonly supportedModalities: Modality[] = ["video"];

  private _client: RunwayML;

  constructor(config: AiConfig) {
    super(config);
    const apiKey = config.apiKey ?? process.env["RUNWAYML_API_SECRET"] ?? "";
    if (!apiKey) {
      throw new Error("Runway API key is required. Set RUNWAYML_API_SECRET or config.apiKey.");
    }
    getLogger().debug({ apiKey: maskApiKey(apiKey) }, "RunwayProvider: initialised");
    this._client = new RunwayML({ apiKey, maxRetries: 0 });
  }

  /**
   * Generate a video from a text prompt using Runway gen4.5.
   *
   * Unsupported model IDs are rejected with a stable ProviderError so the
   * public model list and the runtime stay in sync.
   */
  override async generateVideo(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<VideoResult> {
    this.assertCapability("video");
    const requestedModel = options?.model ?? this.config.model;
    if (requestedModel !== undefined && requestedModel !== "gen4.5") {
      throw new ProviderError(
        "runway",
        `Model "${requestedModel}" is not currently exposed by RunwayProvider. ` +
          `Use "gen4.5" for supported text-to-video generation.`,
        422,
        false,
      );
    }
    const model = DEFAULT_VIDEO_MODEL;
    const start = Date.now();

    // Runway ratio format: "1280:720" (width:height) — model-specific
    const ratio = this._resolveRatio(model, options?.aspectRatio);
    const duration = this._resolveDuration(options?.duration);

    LimitsValidator.validateVideo("runway", model, {
      aspectRatio: ratio,
      duration,
    });

    getLogger().debug(
      { provider: "runway", model, ratio, duration },
      "RunwayProvider: submitting text-to-video job",
    );

    let taskId: string;
    try {
      const task = await this._client.textToVideo.create({
        model: "gen4.5",
        promptText: prompt,
        ratio: ratio as "1280:720" | "720:1280",
        duration: duration as 5 | 10,
      });
      taskId = task.id;
    } catch (err) {
      throw this._wrapError(err);
    }

    const output = await this._poll(taskId, options?.signal);
    const dataUri = await this._fetchAsDataUri(output, options?.signal);
    const latencyMs = Date.now() - start;

    getLogger().info(
      { provider: "runway", model, taskId, latencyMs },
      "RunwayProvider: video generation complete",
    );

    return {
      modality: "video",
      provider: "runway",
      model,
      data: dataUri,
      mimeType: "video/mp4",
      cost: calculateCost(model, { ...ZERO_USAGE }),
      latencyMs,
      usage: { ...ZERO_USAGE },
    };
  }

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    let models = RUNWAY_MODELS;
    if (modality) models = models.filter((m) => m.capabilities.includes(modality));
    if (accepts) models = models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false);
    return models;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Maps a colon-separated aspect ratio (e.g. "16:9") to Runway's WIDTHxHEIGHT
   * ratio string for the supported public model:
   *   gen4.5        → landscape "1280:720" / portrait "720:1280"
   *
   * The fallback branch remains only as a defensive compatibility path.
   *
   * Any recognisable landscape input (16:9, 1280:720) is mapped to the
   * landscape default; portrait inputs map similarly.
   * Falls back to the landscape default for unknown values.
   */
  private _resolveRatio(_model: string, aspectRatio?: string): string {
    // Gen4.5 canonical strings. The provider rejects other model IDs before
    // reaching this helper.
    const landscape = "1280:720";
    const portrait = "720:1280";

    const AR_MAP: Record<string, string> = {
      // friendly names → model-correct string
      "16:9": landscape,
      "9:16": portrait,
      "3:4": portrait,
      "4:3": landscape,
      // all possible exact pass-throughs → snap to this model's value
      "1280:720": landscape,
      "720:1280": portrait,
    };

    if (!aspectRatio || aspectRatio === "auto") return landscape;
    return AR_MAP[aspectRatio] ?? landscape;
  }

  /** Clamp requested duration to Runway's supported values (5 or 10 seconds). */
  private _resolveDuration(duration?: number): 5 | 10 {
    if (duration === undefined) return 5;
    return duration > 5 ? 10 : 5;
  }

  /**
   * Polls `tasks.retrieve(id)` at POLL_INTERVAL_MS intervals until the task
   * reaches SUCCEEDED or FAILED, POLL_TIMEOUT_MS elapses, or signal fires.
   * Returns the first output URL on success.
   */
  private async _poll(id: string, signal?: AbortSignal): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (true) {
      if (signal?.aborted) {
        throw new ProviderError("runway", "Request aborted by caller", undefined, false);
      }
      if (Date.now() >= deadline) {
        throw new ProviderError(
          "runway",
          `Task ${id} did not complete within ${POLL_TIMEOUT_MS / 1000}s`,
          undefined,
          true,
        );
      }

      let task: Awaited<ReturnType<typeof this._client.tasks.retrieve>>;
      try {
        task = await this._client.tasks.retrieve(id);
      } catch (err) {
        throw this._wrapError(err);
      }

      getLogger().trace(
        { provider: "runway", taskId: id, status: task.status },
        "RunwayProvider: poll tick",
      );

      if (task.status === "SUCCEEDED") {
        const url = (task.output as string[] | undefined)?.[0];
        if (!url) {
          throw new ProviderError(
            "runway",
            `Task ${id} succeeded but has no output URL`,
            undefined,
            false,
          );
        }
        return url;
      }

      if (task.status === "FAILED" || task.status === "CANCELLED") {
        const reason = (task as { failure?: string }).failure ?? task.status;
        throw new ProviderError("runway", `Task ${id} ${task.status}: ${reason}`, undefined, false);
      }

      // PENDING or RUNNING — wait before next poll
      await this._sleep(POLL_INTERVAL_MS, signal);
    }
  }

  private async _fetchAsDataUri(url: string, signal?: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url, signal ? { signal } : undefined);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ProviderError("runway", "Video download aborted by caller", undefined, false);
      }
      throw new ProviderError(
        "runway",
        `Failed to fetch video asset: ${String(err)}`,
        undefined,
        true,
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        "runway",
        `Video asset fetch failed with HTTP ${response.status}`,
        response.status,
        response.status >= 500,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:video/mp4;base64,${buffer.toString("base64")}`;
  }

  private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new ProviderError("runway", "Request aborted by caller", undefined, false));
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new ProviderError("runway", "Request aborted by caller", undefined, false));
        },
        { once: true },
      );
    });
  }

  private _wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    if (err instanceof RunwayML.APIError) {
      const status = err.status ?? 0;
      const retryable = status === 429 || status >= 500;
      return new ProviderError("runway", err.message, status || undefined, retryable);
    }
    if (err instanceof Error && err.name === "AbortError") {
      return new ProviderError("runway", "Request aborted by caller", undefined, false);
    }
    return new ProviderError("runway", String(err), undefined, false);
  }
}
