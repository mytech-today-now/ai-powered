/**
 * @file src/ai-powered/providers/base.ts
 *
 * BaseProvider abstract class and ProviderCallOptions interface.
 *
 * Every concrete provider MUST:
 *   1. Extend BaseProvider
 *   2. Declare `readonly name: ProviderName`
 *   3. Declare `readonly supportedModalities: Modality[]`
 *   4. Override every modality it supports
 *   5. Register itself via registerProvider() in providers/index.ts
 *
 * Default implementations throw ProviderCapabilityError so un-overridden
 * modality calls fail loudly rather than silently.
 */

import { z } from "zod";
import type { AiConfig, Modality, ProviderName } from "../core.js";
import type {
  TextResult,
  ImageResult,
  TranscriptionResult,
  AudioResult,
  VideoResult,
  StructuredResult,
  ModelDescriptor,
  InputModality,
} from "../types.js";
import { ProviderCapabilityError } from "../types.js";

// ---------------------------------------------------------------------------
// ProviderCallOptions
// ---------------------------------------------------------------------------

/** Options that may be passed to any provider method call. */
export interface ProviderCallOptions {
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
  /** Sampling temperature (0–2). Overrides config default for this call. */
  temperature?: number;
  /** Maximum tokens in the response. Overrides config default for this call. */
  maxTokens?: number;
  /** System prompt for this call. Overrides config default for this call. */
  systemPrompt?: string;
  /** Whether to stream the response. */
  stream?: boolean;
  /**
   * Pre-built multimodal message array.  When present, providers that support
   * multimodal content (e.g. OpenAI vision, Anthropic vision) SHOULD use this
   * array instead of constructing a plain-text user message from the prompt.
   * Each `content` element may be a plain string or an array of typed content
   * blocks (text, image_url, file, etc.) in the provider's native format.
   * Providers that do not support multimodal content ignore this field.
   */
  messages?: Array<{
    role: "system" | "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }>;

  // ── Image / Video generation controls ──────────────────────────────────
  /**
   * Desired aspect ratio as a colon-separated string (e.g. "16:9", "1:1").
   * Providers that accept aspect ratio natively (xAI aurora, Luma Ray) use
   * this value directly. Providers that accept pixel dimensions (Venice,
   * DALL-E 3) derive width/height from this ratio when explicit dimensions
   * are not supplied.
   */
  aspectRatio?: string;
  /**
   * Output width in pixels. When provided together with `height`, takes
   * precedence over `aspectRatio` for providers that accept pixel dimensions.
   */
  width?: number;
  /**
   * Output height in pixels. When provided together with `width`, takes
   * precedence over `aspectRatio` for providers that accept pixel dimensions.
   */
  height?: number;
  /**
   * Named resolution preset (e.g. "720p", "1080p", "4k", "1k", "2k").
   * Providers that accept a resolution string (xAI aurora) use this value
   * directly; others may map it to pixel dimensions.
   */
  resolution?: string;
  /**
   * Requested video duration in seconds.
   * Ignored for image-only providers.
   */
  duration?: number;
  /**
   * Requested frames per second for video output.
   * Ignored for image-only providers.
   */
  fps?: number;
  /**
   * Generation quality hint: "draft" | "standard" | "high".
   * Maps to provider-specific quality/style parameters where supported.
   */
  quality?: "draft" | "standard" | "high";
  /**
   * Pre-built provider-native content block for a file attachment.
   * Built by `buildFileContentBlock()` from a resolved `fileRef` UUID token.
   * Providers that support multimodal content inject this into the user message;
   * providers that do not support file attachments ignore this field.
   */
  fileContentBlock?: Record<string, unknown>;
  /**
   * Optional array of public image URLs to pass along with the prompt.
   * Providers that accept image input (e.g. image-to-video, img2img) may use
   * the first URL as a starting frame or reference image. Providers that do
   * not support image input ignore this field.
   */
  images?: string[];
}

// ---------------------------------------------------------------------------
// ImageCapability
// ---------------------------------------------------------------------------

/**
 * Describes a provider's image-input capability for a specific output modality.
 *
 * Exported so that routing logic and UI code can import it without pulling in
 * provider-specific files.
 */
export interface ImageCapability {
  /** Output modality this capability applies to (e.g. "video" or "vision"). */
  modality: string;
  /** Maximum number of input images accepted in a single request. */
  maxImages: number;
  /** Provider-native field name used to pass the image URL(s). */
  fieldName: string;
  /** Optional human-readable notes. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// BaseProvider abstract class
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all AI providers.
 *
 * Concrete implementations MUST override every capability they support and
 * MUST list that capability in `supportedModalities`.
 */
export abstract class BaseProvider {
  /** Unique provider identifier (must match the ProviderName enum). */
  abstract readonly name: ProviderName;

  /**
   * Modalities this provider supports.
   * Used by `assertCapability()` to fail fast on unsupported calls.
   */
  abstract readonly supportedModalities: Modality[];

  /** Active resolved configuration. */
  protected readonly config: AiConfig;

  constructor(config: AiConfig) {
    this.config = config;
  }

  /** Throws ProviderCapabilityError if this provider does not support `modality`. */
  protected assertCapability(modality: Modality): void {
    if (!this.supportedModalities.includes(modality)) {
      throw new ProviderCapabilityError(this.name, modality);
    }
  }

  generateText(_prompt: string, _options?: ProviderCallOptions): Promise<TextResult> {
    throw new ProviderCapabilityError(this.name, "text");
  }

  generateImage(_prompt: string, _options?: ProviderCallOptions): Promise<ImageResult> {
    throw new ProviderCapabilityError(this.name, "image");
  }

  transcribeAudio(_buffer: Buffer, _options?: ProviderCallOptions): Promise<TranscriptionResult> {
    throw new ProviderCapabilityError(this.name, "audio");
  }

  synthesizeSpeech(_text: string, _options?: ProviderCallOptions): Promise<AudioResult> {
    throw new ProviderCapabilityError(this.name, "audio");
  }

  generateVideo(_prompt: string, _options?: ProviderCallOptions): Promise<VideoResult> {
    throw new ProviderCapabilityError(this.name, "video");
  }

  streamText(_prompt: string, _options?: ProviderCallOptions): AsyncIterable<string> {
    throw new ProviderCapabilityError(this.name, "text");
  }

  generateStructured<T>(
    _prompt: string,
    _schema: z.ZodType<T>,
    _options?: ProviderCallOptions,
  ): Promise<StructuredResult<T>> {
    throw new ProviderCapabilityError(this.name, "structured");
  }

  /**
   * Returns the list of models available from this provider.
   * Optionally filtered by output modality and/or input capability.
   *
   * @param modality  Output modality filter (e.g. "text", "image").
   * @param accepts   Input modality filter — only models whose
   *                  `inputCapabilities` contains this value are returned.
   */
  abstract listModels(modality?: Modality, accepts?: InputModality): Promise<ModelDescriptor[]>;

  /**
   * Returns this provider's image-input capabilities.
   *
   * Override in concrete providers that accept image input; the default
   * returns an empty array (no image-input capability).
   */
  static imageCapabilities(): ImageCapability[] {
    return [];
  }
}
