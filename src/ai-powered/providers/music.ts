/**
 * Music provider adapters.
 *
 * The adapters keep provider names and model aliases explicit while sharing
 * result normalization and bounded polling. Credentials are read only from
 * resolved server configuration or request options.
 */

import type { AiConfig, Modality, ProviderName } from "../core.js";
import { getProviderCredentialFields } from "../core.js";
import type { InputModality, ModelDescriptor, MusicResult, TokenUsage } from "../types.js";
import { ProviderError } from "../types.js";
import { calculateCost } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

interface MusicCatalogEntry {
  id: string;
  name: string;
  aliases?: string[];
  duration?: { min: number; max: number; default?: number };
}

const CATALOGS: Record<string, MusicCatalogEntry[]> = {
  "google-lyria": [
    {
      id: "lyria-3-clip-preview",
      name: "Lyria 3 Clip Preview",
      duration: { min: 1, max: 30, default: 30 },
    },
    { id: "lyria-3.5", name: "Lyria 3.5", duration: { min: 1, max: 180, default: 30 } },
  ],
  "elevenlabs-music": [{ id: "music_v1", name: "Eleven Music v1", duration: { min: 3, max: 600 } }],
  mureka: [
    { id: "auto", name: "Mureka Auto" },
    { id: "mureka-v7.5", name: "Mureka V7.5" },
    { id: "mureka-o1", name: "Mureka O1" },
  ],
  "stability-audio": [
    { id: "stable-audio-2.5", name: "Stable Audio 2.5", duration: { min: 1, max: 190 } },
  ],
  mubert: [{ id: "mubert-public", name: "Mubert Public Tracks", duration: { min: 1, max: 600 } }],
  apiframe: [
    { id: "suno", name: "Suno via Apiframe" },
    { id: "udio", name: "Udio via Apiframe" },
    { id: "producer", name: "Producer via Apiframe" },
    { id: "mureka", name: "Mureka via Apiframe" },
    { id: "elevenlabs-music", name: "ElevenLabs Music via Apiframe" },
    { id: "lyria-3-pro", name: "Lyria 3 Pro via Apiframe" },
    { id: "lyria-3-clip", name: "Lyria 3 Clip via Apiframe" },
  ],
  "kie-suno": [{ id: "suno-v5.5", name: "Suno v5.5 via Kie" }],
  "ace-suno": [{ id: "suno", name: "Suno via Ace Data Cloud" }],
  musicapi: [
    { id: "sonic-v5", name: "Sonic v5" },
    { id: "producer", name: "Producer" },
    { id: "studio", name: "Studio" },
    { id: "riffusion", name: "Riffusion" },
  ],
  udioapi: [
    { id: "chirp-v5-5", name: "Udio Chirp v5.5", aliases: ["chirp-v6"] },
    { id: "chirp-v6-mini", name: "Udio Chirp v6 Mini" },
    { id: "chirp-v6-wild", name: "Udio Chirp v6 Wild" },
  ],
  "apipass-suno": [
    { id: "V6", name: "Suno V6" },
    { id: "V6_MINI", name: "Suno V6 Mini" },
    { id: "V6_WILD", name: "Suno V6 Wild" },
  ],
  sunor: [
    { id: "suno", name: "Suno via Sunor" },
    { id: "udio", name: "Udio via Sunor" },
  ],
};

const SUPPORTED_NAMES = new Set(Object.keys(CATALOGS) as ProviderName[]);
const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

type MusicPollRequest = (
  id: string,
  headers: Record<string, string>,
) => { url: string; init: RequestInit };

const MUSIC_POLL_REQUESTS: Partial<Record<ProviderName, MusicPollRequest>> = {
  mubert: (id, headers) => ({
    url: `https://music-api.mubert.com/api/v3/public/tracks/${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
  mureka: (id, headers) => ({
    url: `https://api.mureka.ai/v1/song/query/${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
  apiframe: (id, headers) => ({
    url: `https://api.apiframe.ai/v2/jobs/${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
  "kie-suno": (id, headers) => ({
    url: `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
  "ace-suno": (id, headers) => ({
    url: "https://api.acedata.cloud/suno/tasks",
    init: { method: "POST", headers, body: JSON.stringify({ id, action: "retrieve" }) },
  }),
  musicapi: (id, headers) => ({
    url: `https://api.musicapi.ai/api/v1/sonic/task/${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
  udioapi: (id, headers) => ({
    url: `https://udioapi.pro/api/v2/feed?workId=${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
  "apipass-suno": (id, headers) => ({
    url: `https://api.apipass.dev/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
  sunor: (id, headers) => ({
    url: `https://sunor.cc/api/v1/task/${encodeURIComponent(id)}`,
    init: { method: "GET", headers },
  }),
};

function isUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function findAudio(
  value: unknown,
): { data: string; title?: string; trackId?: string; durationSeconds?: number } | undefined {
  if (typeof value === "string") {
    const text = value;
    if (/^https?:\/\//i.test(text) || text.startsWith("data:audio/")) return { data: text };
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return findAudio(JSON.parse(text));
      } catch {
        // A non-JSON string is not an audio result.
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["audioUrl", "audio_url", "url", "audio", "fileUrl", "file_url"]) {
    const found = findAudio(record[key]);
    if (found) {
      const result: { data: string; title?: string; trackId?: string; durationSeconds?: number } = {
        data: found.data,
      };
      if (typeof record["title"] === "string") result.title = record["title"];
      else if (found.title !== undefined) result.title = found.title;
      if (typeof record["id"] === "string") result.trackId = record["id"];
      else if (found.trackId !== undefined) result.trackId = found.trackId;
      if (typeof record["duration"] === "number") result.durationSeconds = record["duration"];
      else if (found.durationSeconds !== undefined) result.durationSeconds = found.durationSeconds;
      return result;
    }
  }
  for (const key of ["b64_json", "base64", "data"]) {
    if (typeof record[key] === "string" && !isUrl(record[key])) {
      const raw = record[key] as string;
      if (raw.length > 32) return { data: `data:audio/mpeg;base64,${raw}` };
    }
  }
  for (const child of Object.values(record)) {
    const found = findAudio(child);
    if (found) return found;
  }
  return undefined;
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) return response.json();
  const bytes = Buffer.from(await response.arrayBuffer());
  return { binary: `data:${contentType || "audio/mpeg"};base64,${bytes.toString("base64")}` };
}

function taskId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const data = record["data"];
  for (const key of ["task_id", "taskId", "workId", "jobId", "id"]) {
    if (typeof record[key] === "string") return record[key];
  }
  if (data && typeof data === "object") return taskId(data);
  return undefined;
}

function providerApiKey(config: AiConfig, options: ProviderCallOptions): string {
  return (
    getProviderCredentialFields(options.providerCredentials, config.provider, config.provider)?.[
      "apiKey"
    ] ??
    getProviderCredentialFields(config.providerCredentials, config.provider, config.provider)?.[
      "apiKey"
    ] ??
    config.apiKey ??
    ""
  );
}

export class MusicProvider extends BaseProvider {
  readonly name: ProviderName;
  readonly supportedModalities: Modality[] = ["music"];

  constructor(config: AiConfig) {
    super(config);
    this.name = config.provider;
    if (!SUPPORTED_NAMES.has(this.name))
      throw new Error(`Unsupported music provider: ${this.name}`);
  }

  override async generateMusic(
    prompt: string,
    options: ProviderCallOptions = {},
  ): Promise<MusicResult> {
    this.assertCapability("music");
    const model = options.model ?? CATALOGS[this.name]![0]!.id;
    const started = Date.now();
    const result = await this.dispatch(prompt, model, options);
    return {
      modality: "music",
      provider: this.name,
      model,
      data: result.data,
      mimeType: result.data.startsWith("data:audio/wav") ? "audio/wav" : "audio/mpeg",
      ...(result.title ? { title: result.title } : {}),
      ...(result.trackId ? { trackId: result.trackId } : {}),
      ...(result.durationSeconds ? { durationSeconds: result.durationSeconds } : {}),
      ...(options.lyrics ? { lyrics: options.lyrics } : {}),
      status: "completed",
      usage: ZERO_USAGE,
      cost: calculateCost(model, ZERO_USAGE),
      latencyMs: Date.now() - started,
    };
  }

  private async dispatch(
    prompt: string,
    model: string,
    options: ProviderCallOptions,
  ): Promise<{ data: string; title?: string; trackId?: string; durationSeconds?: number }> {
    const key = providerApiKey(this.config, options);
    if (!key && this.name !== "mubert")
      throw new ProviderError(this.name, "API key is required", 401);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const credentials = {
      ...(getProviderCredentialFields(this.config.providerCredentials, this.name, this.name) ?? {}),
      ...(getProviderCredentialFields(options.providerCredentials, this.name, this.name) ?? {}),
    };
    let url: string;
    let body: Record<string, unknown>;

    if (this.name === "google-lyria") {
      url = "https://generativelanguage.googleapis.com/v1beta/interactions";
      headers["x-goog-api-key"] = key;
      body = {
        model,
        input: options.lyrics ? `${prompt}\nLyrics:\n${options.lyrics}` : prompt,
        response_format: { type: "audio" },
      };
    } else if (this.name === "elevenlabs-music") {
      url = "https://api.elevenlabs.io/v1/music";
      headers["xi-api-key"] = key;
      body = {
        prompt,
        model_id: model,
        ...(options.musicDurationSeconds
          ? { music_length_ms: Math.round(options.musicDurationSeconds * 1000) }
          : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
      };
    } else if (this.name === "mureka") {
      url = "https://api.mureka.ai/v1/song/generate";
      headers["Authorization"] = `Bearer ${key}`;
      body = {
        prompt,
        model,
        ...(options.lyrics ? { lyrics: options.lyrics } : {}),
      };
    } else if (this.name === "stability-audio") {
      url = "https://api.stability.ai/v2beta/audio/stable-audio-2.5/text-to-audio";
      headers["Authorization"] = `Bearer ${key}`;
      body = {
        prompt,
        ...(options.musicDurationSeconds ? { duration: options.musicDurationSeconds } : {}),
      };
    } else if (this.name === "mubert") {
      url = "https://music-api.mubert.com/api/v3/public/tracks";
      headers["customer-id"] = credentials["customerId"] ?? credentials["customer-id"] ?? "";
      headers["access-token"] = credentials["accessToken"] ?? credentials["access-token"] ?? key;
      body = {
        text: prompt,
        duration: options.musicDurationSeconds ?? 30,
        format: "mp3",
        mode: "track",
        ...(options.musicOptions ?? {}),
      };
    } else if (this.name === "apiframe") {
      url = "https://api.apiframe.ai/v2/music/generate";
      headers["X-API-Key"] = key;
      body = {
        model,
        prompt,
        ...(options.lyrics ? { lyrics: options.lyrics } : {}),
        ...(options.musicDurationSeconds ? { duration: options.musicDurationSeconds } : {}),
      };
    } else if (this.name === "musicapi") {
      url = "https://api.musicapi.ai/api/v1/sonic/create";
      headers["Authorization"] = `Bearer ${key}`;
      body = {
        prompt,
        mv: model,
        ...(options.lyrics ? { lyrics: options.lyrics } : {}),
        ...(options.instrumental !== undefined ? { instrumental: options.instrumental } : {}),
      };
    } else if (this.name === "udioapi") {
      url = "https://udioapi.pro/api/v2/generate";
      headers["Authorization"] = `Bearer ${key}`;
      body = options.lyrics
        ? {
            model,
            prompt: options.lyrics,
            gpt_description_prompt: prompt,
            make_instrumental: Boolean(options.instrumental),
          }
        : {
            model,
            gpt_description_prompt: prompt,
            make_instrumental: Boolean(options.instrumental),
          };
    } else if (this.name === "apipass-suno") {
      url = "https://api.apipass.dev/api/v1/jobs/createTask";
      headers["Authorization"] = `Bearer ${key}`;
      body = {
        model: "suno_generate",
        input: {
          model_version: model,
          prompt,
          ...(options.lyrics ? { lyrics: options.lyrics } : {}),
          instrumental: Boolean(options.instrumental),
        },
      };
    } else if (this.name === "kie-suno") {
      url = "https://api.kie.ai/api/v1/generate";
      headers["Authorization"] = `Bearer ${key}`;
      body = {
        model,
        prompt,
        ...(options.lyrics ? { lyrics: options.lyrics } : {}),
        instrumental: Boolean(options.instrumental),
      };
    } else if (this.name === "ace-suno") {
      url = "https://api.acedata.cloud/suno/audios";
      headers["Authorization"] = `Bearer ${key}`;
      body = {
        prompt,
        model,
        ...(options.lyrics ? { lyrics: options.lyrics } : {}),
        instrumental: Boolean(options.instrumental),
      };
    } else {
      url = `https://api.sunor.cc/v1/${model === "udio" ? "udio" : "suno"}/generate`;
      headers["x-api-key"] = key;
      body = {
        prompt,
        ...(options.lyrics ? { lyrics: options.lyrics } : {}),
        instrumental: Boolean(options.instrumental),
      };
    }

    const request: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };
    if (options.signal) request.signal = options.signal;
    const response = await fetch(url, request);
    const payload = await responsePayload(response);
    if (!response.ok)
      throw new ProviderError(
        this.name,
        `Music request failed with HTTP ${response.status}`,
        response.status,
        response.status >= 500,
      );
    const immediate =
      findAudio(payload) ??
      (typeof payload === "object" && payload !== null && "binary" in payload
        ? { data: (payload as { binary: string }).binary }
        : undefined);
    if (immediate) return immediate;

    const id = taskId(payload);
    if (!id)
      throw new ProviderError(
        this.name,
        "Provider response did not contain playable audio or a task id",
        502,
      );
    return this.poll(id, headers, options.signal);
  }

  private async poll(
    id: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{ data: string; title?: string; trackId?: string; durationSeconds?: number }> {
    const pollRequestFactory = MUSIC_POLL_REQUESTS[this.name];
    if (!pollRequestFactory)
      throw new ProviderError(
        this.name,
        "Provider returned an asynchronous task without an explicit polling contract",
        502,
      );
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (signal?.aborted)
        throw new ProviderError(this.name, "Music generation was cancelled", 499);
      const pollRequest = pollRequestFactory(id, headers);
      const request: RequestInit = { ...pollRequest.init };
      if (signal) request.signal = signal;
      const response = await fetch(pollRequest.url, request);
      const payload = await responsePayload(response);
      if (!response.ok)
        throw new ProviderError(
          this.name,
          `Music status request failed with HTTP ${response.status}`,
          response.status,
          response.status >= 500,
        );
      const audio = findAudio(payload);
      if (audio) return audio;
      const status = JSON.stringify(payload).toLowerCase();
      if (status.includes("failed") || status.includes("error"))
        throw new ProviderError(this.name, "Music generation failed", 502);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
    throw new ProviderError(this.name, "Music generation timed out", 504, true);
  }

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    if (accepts) return [];
    if (modality && modality !== "music") return [];
    return CATALOGS[this.name]!.map((entry) => ({
      id: entry.id,
      name: entry.name,
      capabilities: ["music"],
      ...(entry.duration ? { durationRange: entry.duration } : {}),
    }));
  }
}

export { CATALOGS as MUSIC_MODEL_CATALOGS };
