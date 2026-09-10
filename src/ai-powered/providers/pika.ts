/**
 * @file src/ai-powered/providers/pika.ts
 *
 * Pika video provider using the current official REST API.
 *
 * Pika's API is asynchronous: submit to /v1/media/{model}, poll the returned
 * job, then download the completed video server-side. The API key is sent only
 * from this provider and is never exposed to browser callers.
 */

import pikaCatalog from "./configs/pika.json" with { type: "json" };
import type { AiConfig, Modality } from "../core.js";
import type {
  InputModality,
  ModelDescriptor,
  ModelInputRequirement,
  ModelOptionDescriptor,
  VideoResult,
} from "../types.js";
import { ProviderError } from "../types.js";
import { calculateCost, getLogger, maskApiKey } from "../utils.js";
import { LimitsValidator, type ModelConfig } from "../limits-validator.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

const PIKA_BASE_URL = "https://api.dev.pika.art";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 300_000;
const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as const;

type PikaConfig = { models: ModelConfig[] };
type PikaJob = {
  id?: string;
  request_id?: string;
  status?: string;
  error?: unknown;
  output?: { video?: { url?: string } | string };
};

const CATALOG = pikaCatalog as unknown as PikaConfig;
const PIKA_MEDIA_MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  webm: "video/webm",
  webp: "image/webp",
};

function descriptorFor(config: ModelConfig): ModelDescriptor {
  const inputRequirements = (config.inputRequirements ?? []) as ModelInputRequirement[];
  const inputCapabilities = [...new Set(inputRequirements.map((entry) => entry.modality))];
  const options = (config.options ?? []) as ModelOptionDescriptor[];
  const { resolutions: rawResolutions, ...rest } = config;
  return {
    ...rest,
    id: config.id,
    name: config.id
      .split("/")
      .slice(1)
      .join(" ")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
    capabilities: ["video"],
    ...(rawResolutions ? { resolutions: rawResolutions.map((entry) => entry.label) } : {}),
    ...(config.maxDurationSecs !== undefined
      ? { durationRange: { min: 5, max: config.maxDurationSecs, default: 5 } }
      : {}),
    ...(inputCapabilities.length ? { inputCapabilities } : {}),
    ...(options.length ? { options } : {}),
    ...(inputRequirements.length ? { inputRequirements } : {}),
  };
}

function inferMimeType(url: string): string | null {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url.split(/[?#]/)[0] ?? url;
    }
  })();
  const extension = pathname.slice(pathname.lastIndexOf(".") + 1).toLowerCase();
  return PIKA_MEDIA_MIME_TYPES[extension] ?? null;
}

function asPikaMedia(options?: ProviderCallOptions): Array<{ url: string; mimeType: string }> {
  if (options?.inputMedia?.length) return options.inputMedia;
  return (options?.images ?? []).map((url) => {
    const mimeType = inferMimeType(url);
    if (!mimeType) {
      throw new ProviderError(
        "pika",
        `Unable to infer MIME type from URL "${url}". Provide inputMedia.mimeType or use a supported image/video file extension.`,
        422,
        false,
      );
    }
    return { url, mimeType };
  });
}

function isVideoInput(media: { mimeType: string }): boolean {
  return media.mimeType.startsWith("video/");
}

function compactError(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "detail", "error"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "Unknown Pika error";
    }
  }
  return "Unknown Pika error";
}

/** Pika video generation provider. */
export class PikaProvider extends BaseProvider {
  readonly name = "pika" as const;
  readonly supportedModalities: Modality[] = ["video"];

  private readonly apiKey: string;

  constructor(config: AiConfig) {
    super(config);
    this.apiKey = config.apiKey ?? process.env["PIKA_API_KEY"] ?? "";
    getLogger().debug({ apiKey: maskApiKey(this.apiKey) }, "PikaProvider: initialised");
  }

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    if (modality && modality !== "video") return [];
    return CATALOG.models
      .map(descriptorFor)
      .filter((model) => !accepts || model.inputCapabilities?.includes(accepts));
  }

  override async generateVideo(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<VideoResult> {
    this.assertCapability("video");
    const model = options?.model ?? this.config.model ?? "pika/pika-2.5/text-to-video";
    const modelConfig = CATALOG.models.find((entry) => entry.id === model);
    if (!modelConfig) {
      throw new ProviderError("pika", `Unknown model "${model}"`, 422, false);
    }

    const media = asPikaMedia(options);
    const optionValues: Record<string, unknown> = {
      ...(options?.resolution !== undefined ? { resolution: options.resolution } : {}),
      ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      ...(options?.duration !== undefined ? { duration: options.duration } : {}),
      ...(options?.negativePrompt !== undefined ? { negativePrompt: options.negativePrompt } : {}),
      ...(options?.transitionDuration !== undefined
        ? { transitionDuration: options.transitionDuration }
        : {}),
      ...(options?.pikaffect !== undefined ? { pikaffect: options.pikaffect } : {}),
      ...(options?.modifyRegionRoi !== undefined
        ? { modifyRegionRoi: options.modifyRegionRoi }
        : {}),
      ...(options?.modifyRegionMask !== undefined
        ? { modifyRegionMask: options.modifyRegionMask }
        : {}),
    };
    if (
      model === "pika/pikaframes/image-to-video" &&
      options?.transitionDuration !== undefined &&
      options.transitionDuration > 5 &&
      media.filter((entry) => !isVideoInput(entry)).length !== 2
    ) {
      throw new ProviderError(
        "pika",
        "pika/pikaframes/image-to-video: transitions longer than 5 seconds require exactly 2 images",
        422,
        false,
      );
    }
    LimitsValidator.validateVideo("pika", model, {
      options: optionValues,
      inputMedia: media.map((entry) => ({
        modality: isVideoInput(entry) ? "video" : "image",
        url: entry.url,
        mimeType: entry.mimeType,
      })),
    });

    if (
      [
        "pika/pika-2.5/text-to-video",
        "pika/pikadditions/video-to-video",
        "pika/pikaswaps/video-to-video",
      ].includes(model) &&
      !prompt.trim()
    ) {
      throw new ProviderError("pika", `${model}: prompt is required`, 422, false);
    }
    if (
      model === "pika/pikaswaps/video-to-video" &&
      !options?.modifyRegionRoi &&
      !options?.modifyRegionMask
    ) {
      getLogger().debug(
        { model },
        "PikaProvider: using full-frame swap because no region was supplied",
      );
    }

    const body: Record<string, unknown> = {
      ...(prompt.trim() ? { prompt } : {}),
      ...(options?.resolution !== undefined ? { resolution: options.resolution } : {}),
      ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      ...(options?.duration !== undefined ? { duration_s: options.duration } : {}),
      ...(options?.negativePrompt !== undefined ? { negative_prompt: options.negativePrompt } : {}),
      ...(options?.transitionDuration !== undefined
        ? { transition_duration_s: options.transitionDuration }
        : {}),
      ...(options?.pikaffect !== undefined ? { pikaffect: options.pikaffect } : {}),
      ...(options?.modifyRegionRoi !== undefined
        ? { modify_region_roi: options.modifyRegionRoi }
        : {}),
      ...(options?.modifyRegionMask !== undefined
        ? { modify_region_mask: options.modifyRegionMask }
        : {}),
    };

    const videoInput = media.find(isVideoInput);
    const imageInputs = media.filter((entry) => !isVideoInput(entry));
    if (model.includes("pikaframes")) {
      body["images"] = imageInputs.map((entry) => entry.url);
    } else if (model.includes("video-to-video")) {
      if (videoInput) body["video"] = videoInput.url;
      if (imageInputs[0]) body["image"] = imageInputs[0].url;
    } else if (imageInputs[0]) {
      body["image"] = imageInputs[0].url;
    }

    const start = Date.now();
    const submitted = await this.request<PikaJob>(`/v1/media/${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal ?? null,
    });
    const requestId = submitted.request_id ?? submitted.id;
    if (!requestId)
      throw new ProviderError("pika", "Pika response did not include a request id", 502, true);

    const completed = await this.poll(requestId, options?.signal);
    const videoUrl = await this.resolveVideoUrl(requestId, completed, options?.signal);
    const downloaded = await fetch(videoUrl, { signal: options?.signal ?? null });
    if (!downloaded.ok) {
      throw new ProviderError(
        "pika",
        `Unable to download completed video (HTTP ${downloaded.status})`,
        downloaded.status,
        downloaded.status >= 500,
      );
    }
    const buffer = Buffer.from(await downloaded.arrayBuffer());
    const contentType = downloaded.headers.get("content-type")?.split(";")[0];
    const mimeType = contentType?.startsWith("video/") ? contentType : "video/mp4";
    return {
      modality: "video",
      provider: "pika",
      model,
      data: `data:${mimeType};base64,${buffer.toString("base64")}`,
      mimeType,
      cost: calculateCost(model, { ...ZERO_USAGE }),
      latencyMs: Date.now() - start,
      usage: { ...ZERO_USAGE },
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.apiKey) {
      throw new ProviderError(
        "pika",
        "Pika API key is required. Set PIKA_API_KEY or config.apiKey.",
        401,
        false,
      );
    }
    const response = await fetch(`${PIKA_BASE_URL}${path}`, {
      ...init,
      headers: { "X-API-Key": this.apiKey, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      throw new ProviderError(
        "pika",
        compactError(payload),
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    return payload as T;
  }

  private async poll(requestId: string, signal?: AbortSignal): Promise<PikaJob> {
    const started = Date.now();
    while (Date.now() - started < POLL_TIMEOUT_MS) {
      if (signal?.aborted)
        throw new ProviderError("pika", "Request aborted by caller", undefined, false);
      const job = await this.request<PikaJob>(`/v1/media/jobs/${encodeURIComponent(requestId)}`, {
        method: "GET",
        signal: signal ?? null,
      });
      if (job.status === "completed") return job;
      if (job.status === "failed" || job.error) {
        throw new ProviderError("pika", compactError(job.error ?? "Pika job failed"), 422, false);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new ProviderError("pika", "Pika generation timed out", 504, true);
  }

  private async resolveVideoUrl(
    requestId: string,
    job: PikaJob,
    signal?: AbortSignal,
  ): Promise<string> {
    const output = job.output?.video;
    if (typeof output === "string") return output;
    if (output?.url) return output.url;
    const content = await this.request<{ url?: string; video?: { url?: string } }>(
      `/v1/media/jobs/${encodeURIComponent(requestId)}/content`,
      { method: "GET", signal: signal ?? null },
    );
    const url = content.url ?? content.video?.url;
    if (!url)
      throw new ProviderError("pika", "Completed Pika job did not include a video URL", 502, true);
    return url;
  }
}
