import type { Modality } from "../core.js";
import type { InputModality, ModelDescriptor, VideoResult } from "../types.js";
import { lookupModelPricing } from "../shared/cost.js";
import { OpenAiProvider } from "./openai.js";

const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_PROVIDER_NAME = "OpenRouter";
const OPENROUTER_VIDEO_POLL_MS = 2_000;
const OPENROUTER_VIDEO_TIMEOUT_MS = 5 * 60 * 1000;

type AnyRecord = any;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(value: unknown): string | undefined {
  const url = asString(value);
  if (!url) {
    return undefined;
  }
  return url.replace(/\/+$/, "");
}

function resolveApiKey(provider: AnyRecord): string | undefined {
  return (
    asString(provider?.apiKey) ??
    asString(provider?.config?.apiKey) ??
    asString(provider?.options?.apiKey) ??
    asString(provider?.credentials?.apiKey) ??
    asString(process.env["OPENROUTER_API_KEY"])
  );
}

function resolveBaseUrl(config: AnyRecord): string {
  return (
    normalizeBaseUrl(config.baseUrl) ??
    normalizeBaseUrl(config.apiBaseUrl) ??
    normalizeBaseUrl(config.endpoint) ??
    OPENROUTER_API_BASE_URL
  );
}

function resolveModelId(options: AnyRecord): string {
  return asString(options.model) ?? asString(options.modelId) ?? "openrouter/auto";
}

function resolveModelName(model: AnyRecord): string {
  return (
    asString(model.display_name) ?? asString(model.name) ?? asString(model.id) ?? "OpenRouter model"
  );
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => toArray(item));
  }
  const single = asString(value);
  return single ? [single] : [];
}

function inferCapabilities(model: AnyRecord): Modality[] {
  const capabilities = new Set<Modality>();
  for (const modality of toArray(
    model.output_modalities ?? model.modalities ?? model.capabilities,
  )) {
    const normalized = modality.toLowerCase();
    if (normalized === "text" || normalized === "chat") {
      capabilities.add("text");
    } else if (normalized === "image") {
      capabilities.add("image");
    } else if (normalized === "audio") {
      capabilities.add("audio");
    } else if (normalized === "video") {
      capabilities.add("video");
    } else if (normalized === "structured") {
      capabilities.add("structured");
    }
  }

  const supportedParameters = toArray(model.supported_parameters);
  if (
    supportedParameters.some((value) =>
      ["response_format", "structured_outputs", "json_schema", "json_object", "json_mode"].includes(
        value.toLowerCase(),
      ),
    )
  ) {
    capabilities.add("structured");
  }

  if (capabilities.size === 0) {
    capabilities.add("text");
  }

  return [...capabilities];
}

function inferInputCapabilities(model: AnyRecord): InputModality[] | undefined {
  const capabilities = new Set<InputModality>();
  for (const modality of toArray(
    model.input_modalities ?? model.inputCapabilities ?? model.accepts,
  )) {
    const normalized = modality.toLowerCase();
    if (normalized === "image" || normalized === "images") {
      capabilities.add("image");
    } else if (normalized === "audio" || normalized === "voice") {
      capabilities.add("audio");
    } else if (normalized === "video" || normalized === "frames") {
      capabilities.add("video");
    }
  }

  const supportedParameters = model.supported_parameters;
  const hasImageInputs =
    Array.isArray(supportedParameters) &&
    supportedParameters.some((value) => asString(value)?.toLowerCase() === "input_references");
  if (hasImageInputs || model.supported_frame_images) {
    capabilities.add("image");
  }

  return capabilities.size > 0 ? [...capabilities] : undefined;
}

function resolveCostPerUnit(model: AnyRecord): number | null {
  const pricing =
    model.pricing ?? model.price ?? model.cost ?? lookupModelPricing(asString(model.id) ?? "");
  const candidates = [
    pricing?.costPerUnit,
    pricing?.pricePerUnit,
    pricing?.perVideoUsd,
    pricing?.perUnitUsd,
    pricing?.input,
    pricing?.prompt,
    pricing?.output,
    model.costPerUnit,
    model.pricePerUnit,
    model.perVideoUsd,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? Number(candidate) : candidate;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function normalizeModel(model: AnyRecord): ModelDescriptor {
  const id = asString(model.id) ?? asString(model.slug) ?? asString(model.name);
  if (!id) {
    return { id: "", name: "", capabilities: ["text"] as Modality[] };
  }

  const capabilities = inferCapabilities(model);
  const inputCapabilities = inferInputCapabilities(model);
  const name = resolveModelName(model);
  const costPerUnit = resolveCostPerUnit(model);

  return {
    ...model,
    id,
    name,
    capabilities,
    inputCapabilities,
    costPerUnit,
  };
}

function matchesModality(model: ModelDescriptor, modality?: Modality): boolean {
  const normalized = asString(modality)?.toLowerCase();
  if (!normalized) {
    return true;
  }
  const capabilities = new Set(toArray(model.capabilities).map((value) => value.toLowerCase()));
  const inputCapabilities = new Set(
    toArray(model.inputCapabilities).map((value) => value.toLowerCase()),
  );

  if (normalized === "structured") {
    return capabilities.has("structured") || capabilities.has("text");
  }

  if (capabilities.has(normalized)) {
    return true;
  }

  return inputCapabilities.has(normalized);
}

function matchesAccepts(model: ModelDescriptor, accepts?: InputModality): boolean {
  const requested = Array.isArray(accepts)
    ? accepts
    : asString(accepts)
      ? [asString(accepts)!]
      : [];
  if (requested.length === 0) {
    return true;
  }

  const capabilities = new Set(toArray(model.capabilities).map((value) => value.toLowerCase()));
  const inputCapabilities = new Set(
    toArray(model.inputCapabilities).map((value) => value.toLowerCase()),
  );
  return requested.every(
    (value) => capabilities.has(value.toLowerCase()) || inputCapabilities.has(value.toLowerCase()),
  );
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") {
    return fallback;
  }
  const record = data as AnyRecord;
  return (
    asString(record.error?.message) ??
    asString(record.message) ??
    asString(record.detail) ??
    asString(record.error) ??
    fallback
  );
}

function buildHeaders(apiKey: string, title?: string): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env["OPENROUTER_HTTP_REFERER"]?.trim() || "http://localhost",
    "X-Title": title?.trim() || process.env["npm_package_name"]?.trim() || "ai-powered",
  };
  return headers;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractVideoJobId(data: AnyRecord): string | undefined {
  return (
    asString(data.id) ??
    asString(data.video_id) ??
    asString(data.job_id) ??
    asString(data.request_id) ??
    asString(data.data?.id)
  );
}

function extractVideoStatus(data: AnyRecord): string | undefined {
  return (
    asString(data.status) ??
    asString(data.state) ??
    asString(data.progress?.status) ??
    asString(data.data?.status)
  );
}

function isVideoTerminalStatus(status?: string): boolean {
  const normalized = status?.toLowerCase();
  return (
    normalized === "completed" ||
    normalized === "succeeded" ||
    normalized === "success" ||
    normalized === "done" ||
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  );
}

function extractVideoUrl(data: AnyRecord): string | undefined {
  return (
    asString(data.video_url) ??
    asString(data.url) ??
    asString(data.result_url) ??
    asString(data.output_url) ??
    asString(data.output?.url) ??
    asString(data.content?.[0]?.url) ??
    asString(data.data?.url) ??
    asString(data.data?.[0]?.url)
  );
}

function extractVideoMimeType(data: AnyRecord): string | undefined {
  return (
    asString(data.mime_type) ??
    asString(data.mimeType) ??
    asString(data.content_type) ??
    asString(data.output?.mime_type) ??
    asString(data.output?.mimeType)
  );
}

function normalizePrompt(options: AnyRecord): string {
  return (
    asString(options.prompt) ??
    asString(options.text) ??
    asString(options.input) ??
    asString(options.message) ??
    asString(options.messages?.at?.(-1)?.content) ??
    ""
  );
}

async function fetchBufferFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenRouter video fetch failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get("content-type") ?? "video/mp4",
  };
}

async function fetchBufferFromDataUri(
  dataUri: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUri);
  if (!match) {
    throw new Error("Invalid data URI");
  }
  const mimeType = match[1] || "video/mp4";
  const payload = match[2] ?? "";
  const buffer = Buffer.from(payload, "base64");
  return { buffer, mimeType };
}

function extractVideoPayload(data: AnyRecord): string | undefined {
  return (
    asString(data.data_uri) ??
    asString(data.video_data_uri) ??
    asString(data.output?.data_uri) ??
    asString(data.output?.video_data_uri) ??
    asString(data.video) ??
    asString(data.data)
  );
}

export class OpenRouterProvider extends OpenAiProvider {
  static readonly id = "openrouter";

  constructor(config: AnyRecord = {}) {
    const baseUrl = resolveBaseUrl(config);
    super({
      ...config,
      provider: "openrouter",
      name: OPENROUTER_PROVIDER_NAME,
      providerName: OPENROUTER_PROVIDER_NAME,
      baseUrl,
      apiBaseUrl: baseUrl,
      endpoint: baseUrl,
      url: baseUrl,
    } as any);

    Object.assign(this as AnyRecord, {
      id: OpenRouterProvider.id,
      name: OPENROUTER_PROVIDER_NAME,
      provider: "openrouter",
      providerName: OPENROUTER_PROVIDER_NAME,
      baseUrl,
      apiBaseUrl: baseUrl,
    });
  }

  static override imageCapabilities() {
    return OpenAiProvider.imageCapabilities();
  }

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    const apiKey = resolveApiKey(this as AnyRecord);
    const baseUrl = resolveBaseUrl(this as AnyRecord);
    if (!apiKey) {
      return [];
    }

    const url = new URL("/models", baseUrl);
    if (asString(modality)) {
      url.searchParams.set("modality", asString(modality)!);
    }
    if (asString(accepts)) {
      url.searchParams.set("accepts", asString(accepts)!);
    }

    const response = await fetch(url, {
      headers: buildHeaders(apiKey),
    });
    if (!response.ok) {
      return [];
    }

    const payload = (await parseJson(response)) as AnyRecord;
    const models = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload)
          ? payload
          : [];

    return models
      .map(normalizeModel)
      .filter((model: ModelDescriptor) => Object.keys(model).length > 0)
      .filter((model: ModelDescriptor) => matchesModality(model, modality))
      .filter((model: ModelDescriptor) => matchesAccepts(model, accepts));
  }

  override async generateVideo(prompt: string, options?: AnyRecord): Promise<VideoResult> {
    const apiKey = resolveApiKey(this as AnyRecord);
    const baseUrl = resolveBaseUrl(this as AnyRecord);
    if (!apiKey) {
      throw new Error("OpenRouter API key is required for video generation.");
    }

    const startedAt = Date.now();
    const model = resolveModelId(options ?? {});
    const promptText = asString(prompt) ?? normalizePrompt(options ?? {});
    const submitPayload = {
      model,
      prompt: promptText,
      duration: options?.duration ?? options?.durationSeconds ?? options?.seconds,
      aspect_ratio: options?.aspectRatio ?? options?.aspect_ratio,
      resolution: options?.resolution,
      fps: options?.fps,
      input_images: options?.inputImages ?? options?.images,
      input_media: options?.inputMedia,
      reference_images: options?.referenceImages ?? options?.images,
      seed: options?.seed,
    };

    const submitResponse = await fetch(new URL("/videos", baseUrl), {
      method: "POST",
      headers: buildHeaders(apiKey, asString(options?.title)),
      body: JSON.stringify(submitPayload),
    });
    const submitData = (await parseJson(submitResponse)) as AnyRecord;

    if (!submitResponse.ok) {
      throw new Error(
        `OpenRouter video generation failed: ${extractErrorMessage(submitData, `HTTP ${submitResponse.status}`)}`,
      );
    }

    let current = submitData;
    let jobId = extractVideoJobId(current);
    const deadline = startedAt + OPENROUTER_VIDEO_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = extractVideoStatus(current);
      if (isVideoTerminalStatus(status)) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, OPENROUTER_VIDEO_POLL_MS));

      if (!jobId) {
        jobId = extractVideoJobId(current);
      }
      if (!jobId) {
        break;
      }

      const pollResponse = await fetch(new URL(`/videos/${encodeURIComponent(jobId)}`, baseUrl), {
        headers: buildHeaders(apiKey),
      });
      current = (await parseJson(pollResponse)) as AnyRecord;
      if (!pollResponse.ok) {
        throw new Error(
          `OpenRouter video polling failed: ${extractErrorMessage(current, `HTTP ${pollResponse.status}`)}`,
        );
      }
    }

    const payload = extractVideoPayload(current) ?? extractVideoUrl(current);
    if (!payload) {
      throw new Error("OpenRouter video generation did not return a video payload.");
    }

    let buffer: Buffer;
    let mimeType = extractVideoMimeType(current) ?? "video/mp4";
    if (payload.startsWith("data:")) {
      const decoded = await fetchBufferFromDataUri(payload);
      buffer = decoded.buffer;
      mimeType = decoded.mimeType || mimeType;
    } else if (/^https?:\/\//i.test(payload)) {
      const fetched = await fetchBufferFromUrl(payload);
      buffer = fetched.buffer;
      mimeType = fetched.mimeType || mimeType;
    } else {
      buffer = Buffer.from(payload, payload.match(/^[A-Za-z0-9+/=]+$/) ? "base64" : "utf8");
    }

    const durationSeconds =
      typeof options?.duration === "number"
        ? options.duration
        : typeof current.durationSeconds === "number"
          ? current.durationSeconds
          : undefined;
    const aspectRatio =
      asString(options?.aspectRatio) ??
      asString(options?.aspect_ratio) ??
      asString(current.aspectRatio);
    const data =
      payload.startsWith("data:") || /^https?:\/\//i.test(payload)
        ? payload
        : `data:${mimeType};base64,${buffer.toString("base64")}`;

    return {
      ...current,
      provider: "openrouter",
      model,
      modality: "video",
      data,
      mimeType,
      durationSeconds,
      aspectRatio,
      cost: current.cost ?? current.usage?.cost ?? resolveCostPerUnit(current),
      latencyMs: Date.now() - startedAt,
    };
  }
}

export default OpenRouterProvider;
