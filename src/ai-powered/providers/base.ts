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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
   * Optionally filtered to those supporting the requested modality.
   */
  abstract listModels(modality?: Modality): Promise<ModelDescriptor[]>;
}

