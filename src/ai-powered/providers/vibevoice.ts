/**
 * @file src/ai-powered/providers/vibevoice.ts
 *
 * VibevoiceProvider — local VibeVoice ASR/TTS server integration.
 *
 * Supports: transcribeAudio (POST /transcribe) and synthesizeSpeech (POST /synthesize).
 * Does NOT support: generateText, generateImage, generateVideo.
 *
 * baseUrl resolution order (highest wins):
 *   1. config.baseUrl
 *   2. process.env["VIBEVOICE_API_URL"]
 *   3. "http://localhost:8080"
 *
 * Trailing slashes are stripped from the resolved baseUrl.
 */

import type { AiConfig, Modality } from "../core.js";
import type { TranscriptionResult, AudioResult, ModelDescriptor, InputModality } from "../types.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";
import { calculateCost } from "../utils.js";

// ---------------------------------------------------------------------------
// Static model catalogue
// ---------------------------------------------------------------------------

const VIBEVOICE_MODELS: ModelDescriptor[] = [
  { id: "vibevoice-asr-7b", name: "VibeVoice ASR 7B", capabilities: ["audio"] },
  { id: "vibevoice-realtime-0.5b", name: "VibeVoice Realtime 0.5B", capabilities: ["audio"] },
  { id: "vibevoice-tts-1.5b", name: "VibeVoice TTS 1.5B", capabilities: ["audio"] },
];

const DEFAULT_ASR_MODEL = "vibevoice-asr-7b";
const DEFAULT_TTS_MODEL = "vibevoice-tts-1.5b";
const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

// ---------------------------------------------------------------------------
// VibevoiceProvider
// ---------------------------------------------------------------------------

export class VibevoiceProvider extends BaseProvider {
  override readonly name = "vibevoice" as const;
  override readonly supportedModalities: Modality[] = ["audio"];

  private readonly _baseUrl: string;

  constructor(config: AiConfig) {
    super(config);
    const raw = config.baseUrl ?? process.env["VIBEVOICE_API_URL"] ?? "http://localhost:8080";
    // Strip trailing slashes so endpoint URLs never double-up.
    this._baseUrl = raw.replace(/\/+$/, "");
  }

  // ---------------------------------------------------------------------------
  // listModels
  // ---------------------------------------------------------------------------

  override async listModels(
    modality?: Modality,
    _accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    if (!modality) return VIBEVOICE_MODELS;
    return VIBEVOICE_MODELS.filter((m) => m.capabilities.includes(modality));
  }

  // ---------------------------------------------------------------------------
  // generateText — not supported
  // ---------------------------------------------------------------------------

  override generateText(_prompt: string): Promise<never> {
    throw new Error("VibevoiceProvider does not support text generation");
  }

  // ---------------------------------------------------------------------------
  // transcribeAudio
  // ---------------------------------------------------------------------------

  override async transcribeAudio(
    audio: Blob | Buffer,
    options?: ProviderCallOptions,
  ): Promise<TranscriptionResult> {
    const model = this.resolveModel(DEFAULT_ASR_MODEL, options);

    // Accept both Blob (browser MediaRecorder output) and Buffer (Node.js).
    const audioBase64 =
      audio instanceof Blob
        ? Buffer.from(await audio.arrayBuffer()).toString("base64")
        : audio.toString("base64");

    const start = Date.now();

    // Build request body; include optional language / hotwords when present.
    const cfg = this.config as AiConfig & { language?: string; hotwords?: string[] };
    const body: Record<string, unknown> = { audio_base64: audioBase64, model };
    if (cfg.language) body["language"] = cfg.language;
    if (cfg.hotwords) body["hotwords"] = cfg.hotwords;

    const res = await fetch(`${this._baseUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(String(res.status));
    }

    const data = (await res.json()) as { text?: string; error?: string };
    if (data.error) {
      throw new Error(data.error);
    }

    return {
      modality: "audio",
      provider: "vibevoice",
      model,
      text: data.text ?? "",
      usage: ZERO_USAGE,
      cost: calculateCost(model, ZERO_USAGE),
      latencyMs: Date.now() - start,
    };
  }

  // ---------------------------------------------------------------------------
  // synthesizeSpeech
  // ---------------------------------------------------------------------------

  override async synthesizeSpeech(
    text: string,
    options?: ProviderCallOptions,
  ): Promise<AudioResult> {
    const model = this.resolveModel(DEFAULT_TTS_MODEL, options);
    const start = Date.now();

    const res = await fetch(`${this._baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, model }),
    });

    if (!res.ok) {
      throw new Error(`VibevoiceProvider synthesizeSpeech failed with status ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();

    return {
      modality: "audio",
      provider: "vibevoice",
      model,
      audio: Buffer.from(arrayBuffer),
      mimeType: "audio/wav",
      usage: ZERO_USAGE,
      cost: calculateCost(model, ZERO_USAGE),
      latencyMs: Date.now() - start,
    };
  }
}
