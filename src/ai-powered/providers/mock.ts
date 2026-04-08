/**
 * @file src/ai-powered/providers/mock.ts
 *
 * MockProvider — deterministic fixture provider for CI and unit tests.
 *
 * Activated automatically when config.mock is true or AI_MOCK=true.
 * Returns plausible, stable fixture values for every modality so that
 * downstream budget arithmetic, cost calculation, and plugin pipelines
 * exercise real code paths rather than no-op stubs.
 *
 * This file was extracted from providers/index.ts (bd-1ie9) so that
 * index.ts can remain a lean registry/re-export file.
 */

import { z } from "zod";
import type { AiConfig, Modality } from "../core.js";
import type {
  TextResult,
  ImageResult,
  TranscriptionResult,
  AudioResult,
  VideoResult,
  StructuredResult,
  ModelDescriptor,
  TokenUsage,
  InputModality,
} from "../types.js";
import { calculateCost } from "../utils.js";
import { BaseProvider } from "./base.js";
import type { ProviderCallOptions } from "./base.js";

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/**
 * Plausible fixture token counts for mock text/structured calls.
 * Values are realistic for a short single-turn exchange (~40-token prompt,
 * ~120-token completion) — not artificially small, so budget arithmetic
 * exercises real code paths in tests.
 */
const MOCK_TEXT_USAGE: TokenUsage = { promptTokens: 42, completionTokens: 118, totalTokens: 160 };

/** Zeroed usage placeholder for modalities that are not token-based. */
const MOCK_ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Plausible audio duration used for transcription cost calculation (30 s clip). */
const MOCK_AUDIO_DURATION_SECONDS = 30;

/** Plausible character count used for TTS pricing (token-based per character). */
const MOCK_TTS_CHARS = 120;

/**
 * Simulated per-video generation delay (ms) so the batch UI feels realistic.
 * Automatically set to 0 inside Vitest / test environments to keep CI fast.
 */
const MOCK_VIDEO_DELAY_MS = process.env["VITEST"] || process.env["NODE_ENV"] === "test" ? 0 : 1800;

// ---------------------------------------------------------------------------
// Schema-aware mock value generator
// ---------------------------------------------------------------------------

/**
 * Recursively generates a valid default value for any Zod schema type.
 *
 * Used by MockProvider.generateStructured so that schemas with required fields
 * (e.g. `z.object({ answer: z.string() })`) always produce a conforming fixture
 * rather than a ZodError from `schema.parse({})`.
 */
function generateMockValue<T>(schema: z.ZodType<T>): T {
  // Unwrap optional/nullable/default wrappers first.
  if (schema instanceof z.ZodOptional) return undefined as T;
  if (schema instanceof z.ZodNullable) return null as T;
  if (schema instanceof z.ZodDefault) return (schema._def as { defaultValue(): T }).defaultValue();

  if (schema instanceof z.ZodString) return "mock-string" as T;
  if (schema instanceof z.ZodNumber) return 0 as T;
  if (schema instanceof z.ZodBoolean) return false as T;
  if (schema instanceof z.ZodBigInt) return BigInt(0) as T;
  if (schema instanceof z.ZodDate) return new Date(0) as T;
  if (schema instanceof z.ZodLiteral) return (schema._def as { value: T }).value;
  if (schema instanceof z.ZodArray) return [] as T;
  if (schema instanceof z.ZodTuple) return [] as T;
  if (schema instanceof z.ZodRecord) return {} as T;
  if (schema instanceof z.ZodMap) return new Map() as T;
  if (schema instanceof z.ZodSet) return new Set() as T;

  if (schema instanceof z.ZodEnum) {
    const opts = (schema._def as { values: T[] }).values;
    return opts[0] as T;
  }

  if (schema instanceof z.ZodNativeEnum) {
    const enumValues = Object.values((schema._def as { values: Record<string, unknown> }).values);
    return enumValues[0] as T;
  }

  if (schema instanceof z.ZodUnion) {
    const options = (schema._def as { options: z.ZodTypeAny[] }).options;
    return generateMockValue(options[0]!) as T;
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = [
      ...(schema._def as { optionsMap: Map<unknown, z.ZodTypeAny> }).optionsMap.values(),
    ];
    return generateMockValue(options[0]!) as T;
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const result: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(shape)) {
      result[key] = generateMockValue(fieldSchema);
    }
    return result as T;
  }

  if (schema instanceof z.ZodIntersection) {
    const def = schema._def as { left: z.ZodTypeAny; right: z.ZodTypeAny };
    return {
      ...(generateMockValue(def.left) as object),
      ...(generateMockValue(def.right) as object),
    } as T;
  }

  // Fallback: return an empty object for unknown types.
  return {} as T;
}

// ---------------------------------------------------------------------------
// MockProvider
// ---------------------------------------------------------------------------

export class MockProvider extends BaseProvider {
  readonly name = "mock" as const;
  readonly supportedModalities: Modality[] = ["text", "image", "audio", "video", "structured"];

  constructor(config: AiConfig) {
    super(config);
  }

  override async generateText(prompt: string, options?: ProviderCallOptions): Promise<TextResult> {
    this.assertCapability("text");
    void prompt;
    void options;
    const usage = { ...MOCK_TEXT_USAGE };
    return {
      modality: "text",
      provider: "mock",
      model: "mock-text-v1",
      content: "[mock response]",
      usage,
      cost: calculateCost("mock-text-v1", usage),
      latencyMs: 1,
      finishReason: "stop",
    };
  }

  override async generateImage(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<ImageResult> {
    this.assertCapability("image");
    void prompt;
    const width = options?.width ?? 1024;
    const height = options?.height ?? 1024;
    return {
      modality: "image",
      provider: "mock",
      model: "mock-image-v1",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=",
      mimeType: "image/png",
      width,
      height,
      usage: MOCK_ZERO_USAGE,
      cost: calculateCost("mock-image-v1", MOCK_ZERO_USAGE),
      latencyMs: 1,
    };
  }

  override async transcribeAudio(
    buffer: Buffer,
    options?: ProviderCallOptions,
  ): Promise<TranscriptionResult> {
    this.assertCapability("audio");
    void buffer;
    void options;
    return {
      modality: "audio",
      provider: "mock",
      model: "mock-whisper-v1",
      text: "[mock transcription]",
      language: "en",
      durationSeconds: MOCK_AUDIO_DURATION_SECONDS,
      usage: MOCK_ZERO_USAGE,
      cost: calculateCost("mock-whisper-v1", MOCK_ZERO_USAGE, MOCK_AUDIO_DURATION_SECONDS),
      latencyMs: 1,
    };
  }

  override async synthesizeSpeech(
    text: string,
    options?: ProviderCallOptions,
  ): Promise<AudioResult> {
    this.assertCapability("audio");
    void options;
    const charCount = text.length || MOCK_TTS_CHARS;
    const ttsUsage: TokenUsage = {
      promptTokens: Math.ceil(charCount / 4),
      completionTokens: 0,
      totalTokens: Math.ceil(charCount / 4),
    };
    return {
      modality: "audio",
      provider: "mock",
      model: "mock-tts-v1",
      audio: Buffer.alloc(0),
      mimeType: "audio/mpeg",
      usage: ttsUsage,
      cost: calculateCost("mock-tts-v1", ttsUsage),
      latencyMs: 1,
    };
  }

  override async generateVideo(
    prompt: string,
    options?: ProviderCallOptions,
  ): Promise<VideoResult> {
    this.assertCapability("video");
    void prompt;
    const aspectRatio = options?.aspectRatio ?? "1:1";
    const t0 = Date.now();
    if (MOCK_VIDEO_DELAY_MS > 0) {
      await new Promise<void>((r) => setTimeout(r, MOCK_VIDEO_DELAY_MS));
    }
    return {
      modality: "video",
      provider: "mock",
      model: "mock-video-v1",
      // 4-byte stub — the web client replaces this with a Canvas-generated preview
      data: "data:video/mp4;base64,AAAAAA==",
      mimeType: "video/mp4",
      aspectRatio,
      usage: MOCK_ZERO_USAGE,
      cost: calculateCost("mock-video-v1", MOCK_ZERO_USAGE),
      latencyMs: Date.now() - t0,
    };
  }

  override async *streamText(prompt: string, options?: ProviderCallOptions): AsyncIterable<string> {
    this.assertCapability("text");
    void options;
    const words = `[mock response to: ${prompt}]`.split(" ");
    for (const word of words) {
      yield word + " ";
    }
  }

  override async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: ProviderCallOptions,
  ): Promise<StructuredResult<T>> {
    this.assertCapability("structured");
    void prompt;
    void options;
    // Generate a schema-aware fixture so required fields are always satisfied.
    const data = generateMockValue(schema);
    const usage = { ...MOCK_TEXT_USAGE };
    return {
      modality: "structured",
      provider: "mock",
      model: "mock-structured-v1",
      data,
      usage,
      cost: calculateCost("mock-structured-v1", usage),
      latencyMs: 1,
    };
  }

  override async listModels(
    modality?: Modality,
    accepts?: InputModality,
  ): Promise<ModelDescriptor[]> {
    const ALL_MOCK_MODELS: ModelDescriptor[] = [
      {
        id: "mock-text-v1",
        name: "Mock Text v1",
        capabilities: ["text", "structured"],
        inputCapabilities: ["image"],
      },
      {
        id: "mock-image-v1",
        name: "Mock Image v1",
        capabilities: ["image"],
        inputCapabilities: ["image"],
      },
      {
        id: "mock-whisper-v1",
        name: "Mock Whisper v1",
        capabilities: ["audio"],
        inputCapabilities: ["audio"],
      },
      { id: "mock-tts-v1", name: "Mock TTS v1", capabilities: ["audio"] },
      {
        id: "mock-video-v1",
        name: "Mock Video v1",
        capabilities: ["video"],
        inputCapabilities: ["image", "video"],
      },
      { id: "mock-structured-v1", name: "Mock Structured v1", capabilities: ["structured"] },
    ];
    let models = ALL_MOCK_MODELS;
    if (modality) models = models.filter((m) => m.capabilities.includes(modality));
    if (accepts) models = models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false);
    return models;
  }

  static override imageCapabilities(): import("./base.js").ImageCapability[] {
    return [{ modality: "video", maxImages: 999, fieldName: "mock" }];
  }
}
