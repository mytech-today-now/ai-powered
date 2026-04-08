/**
 * @file src/ai-powered/types.ts
 *
 * Shared TypeScript types, interfaces, and error classes for ai-powered.
 * These are the public-facing contracts used by callers and provider implementors.
 */

import type { AiConfig, Modality, ProviderName } from "./core.js";

// ---------------------------------------------------------------------------
// Token usage and cost
// ---------------------------------------------------------------------------

/** Raw token counts returned by provider responses. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Cost breakdown in USD. */
export interface CostBreakdown {
  /** Total cost of this call in USD. */
  totalUsd: number;
  /** Whether the value is an estimate (pre-call) or actual (from provider). */
  isEstimate: boolean;
}

// ---------------------------------------------------------------------------
// Result types (one per modality)
// ---------------------------------------------------------------------------

/** Base fields shared by all result types. */
export interface BaseResult {
  modality: Modality;
  provider: ProviderName;
  model: string;
  cost: CostBreakdown;
  /** Wall-clock latency in milliseconds. */
  latencyMs: number;
  /**
   * Token usage for this call.
   * Required on text/structured results; present (possibly zeroed) on all others.
   */
  usage?: TokenUsage;
}

/** Result of a text-generation call. */
export interface TextResult extends BaseResult {
  modality: "text";
  content: string;
  usage: TokenUsage;
  /** Finish reason from the provider (e.g. "stop", "length", "content_filter"). */
  finishReason: string;
}

/** Result of an image-generation call. */
export interface ImageResult extends BaseResult {
  modality: "image";
  /** URL or base64-encoded image data, depending on provider response format. */
  data: string;
  /** MIME type of the image (e.g. "image/png"). */
  mimeType: string;
  width?: number;
  height?: number;
}

/** Result of an audio transcription call. */
export interface TranscriptionResult extends BaseResult {
  modality: "audio";
  text: string;
  /** Detected language, if provided by the provider. */
  language?: string;
  /** Duration of the audio in seconds, if provided. */
  durationSeconds?: number;
}

/** Result of a text-to-speech synthesis call. */
export interface AudioResult extends BaseResult {
  modality: "audio";
  audio: Buffer;
  mimeType: string;
}

/** Result of a video generation call. */
export interface VideoResult extends BaseResult {
  modality: "video";
  /** URL or base64-encoded video data. */
  data: string;
  mimeType: string;
  durationSeconds?: number;
  /** Aspect ratio used for generation (e.g. "16:9", "1:1"). */
  aspectRatio?: string;
}

/** Result of a structured-output generation call. */
export interface StructuredResult<T = unknown> extends BaseResult {
  modality: "structured";
  data: T;
  usage: TokenUsage;
}

// ---------------------------------------------------------------------------
// Model descriptor
// ---------------------------------------------------------------------------

/**
 * Modalities a model can receive as structured input beyond plain text prompts.
 *
 * `"text"` is deliberately excluded — every model accepts plain text by default.
 * `InputModality` only declares *extra* structured input types that must be
 * explicitly supported (e.g. an attached image, audio file, video clip, or
 * document). Use `inputCapabilities` on `ModelDescriptor` to annotate models.
 */
export type InputModality = "image" | "audio" | "video" | "document";

/** Resolution label exposed to the UI (e.g. "480p", "720p", "1080p"). */
export type ResolutionLabel = string;

export interface ModelDescriptor {
  id: string;
  name: string;
  capabilities: Modality[];
  contextWindow?: number;
  /**
   * Non-text input modalities this model can receive as structured input.
   * `"text"` is implicit and therefore excluded from this list.
   * When absent or undefined the model accepts plain text only.
   */
  inputCapabilities?: InputModality[];
  /** Whether this model is deprecated by the provider. */
  deprecated?: boolean;
  /** Aspect ratios accepted by this model in "W:H" notation (e.g. "16:9"). */
  aspectRatios?: string[];
  /** Resolution labels accepted by this model (e.g. ["480p", "720p"]). */
  resolutions?: ResolutionLabel[];
  /** Minimum and maximum clip duration in seconds. */
  durationRange?: { min: number; max: number; default?: number };
  /** Supported frames-per-second values (e.g. [24, 30]). */
  fpsOptions?: number[];
  /** Supported quality tier strings (e.g. ["standard", "high"]). */
  qualityOptions?: string[];
}

// ---------------------------------------------------------------------------
// Request/Response context (for plugin pipeline)
// ---------------------------------------------------------------------------

export interface RequestContext {
  config: Readonly<AiConfig>;
  modality: Modality;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  options: Record<string, unknown>;
}

export interface ResponseContext {
  config: Readonly<AiConfig>;
  modality: Modality;
  result: BaseResult;
  rawResponse?: unknown;
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

/**
 * Plugin lifecycle hooks for the ai-powered pipeline.
 *
 * - `onRequest` hooks execute in registration order BEFORE the provider call.
 *   Each hook receives the (potentially mutated) context from the previous
 *   hook and MUST return the context (modified or as-is).
 * - `onResponse` hooks execute in REVERSE registration order AFTER the call.
 *   Each hook receives and returns the accumulated `ResponseContext`.
 * - `onError` is called for every plugin when an `AiPoweredError` is thrown;
 *   plugins MUST NOT re-throw from `onError`.
 *
 * Plugins MUST NOT mutate `ctx.config` directly — it is frozen by the client.
 */
export interface AiPlugin {
  /** Unique plugin identifier. */
  name: string;
  /** Semantic version string, e.g. "1.0.0". */
  version: string;
  /** Human-readable description shown in diagnostics. */
  description?: string;
  onRequest?(ctx: RequestContext): Promise<RequestContext>;
  onResponse?(ctx: ResponseContext): Promise<ResponseContext>;
  onError?(error: AiPoweredError): Promise<void>;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Base class for all ai-powered errors. */
export class AiPoweredError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AiPoweredError";
  }
}

/** Thrown when a provider does not support the requested modality. */
export class ProviderCapabilityError extends AiPoweredError {
  constructor(
    public readonly provider: ProviderName,
    public readonly modality: Modality,
  ) {
    super(
      `Provider "${provider}" does not support modality "${modality}".`,
      "PROVIDER_CAPABILITY_ERROR",
    );
    this.name = "ProviderCapabilityError";
  }
}

/** Thrown on provider API errors (HTTP errors, auth failures, rate limits, etc.). */
export class ProviderError extends AiPoweredError {
  constructor(
    public readonly provider: ProviderName,
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(`[${provider}] ${message}`, "PROVIDER_ERROR");
    this.name = "ProviderError";
  }
}

/** Thrown when the session or cumulative budget is exceeded. */
export class BudgetExceededError extends AiPoweredError {
  constructor(
    public readonly spentUsd: number,
    public readonly budgetUsd: number,
  ) {
    super(
      `Budget exceeded: spent $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(4)} limit.`,
      "BUDGET_EXCEEDED",
    );
    this.name = "BudgetExceededError";
  }
}

/** Thrown when a plugin throws an unhandled error. The plugin is bypassed. */
export class PluginError extends AiPoweredError {
  constructor(
    public readonly pluginName: string,
    cause: Error,
  ) {
    super(`Plugin "${pluginName}" failed: ${cause.message}`, "PLUGIN_ERROR");
    this.name = "PluginError";
    this.cause = cause;
  }
}

/** Thrown when a provider's circuit breaker is open and calls are fast-failing. */
export class CircuitOpenError extends AiPoweredError {
  constructor(
    public readonly provider: string,
    /** Estimated time at which the circuit will attempt a probe request. */
    public readonly estimatedRecovery: Date,
  ) {
    super(
      `Circuit open for provider "${provider}". ` +
        `Estimated recovery: ${estimatedRecovery.toISOString()}.`,
      "CIRCUIT_OPEN",
    );
    this.name = "CircuitOpenError";
  }
}

/** Failure record for a single provider attempt in the failover loop. */
export interface ProviderFailure {
  provider: string;
  reason: string;
}

/** Thrown when all providers in the failover chain have been exhausted. */
export class AllProvidersExhaustedError extends AiPoweredError {
  constructor(public readonly failures: ProviderFailure[]) {
    const summary = failures.map((f) => `${f.provider}: ${f.reason}`).join("; ");
    super(`All providers exhausted. Failures — ${summary}`, "ALL_PROVIDERS_EXHAUSTED");
    this.name = "AllProvidersExhaustedError";
  }
}

/**
 * Thrown when structured-output schema validation fails after all retries.
 * Exit code MUST be 2 (EXIT_FAIL) when caught by the CLI.
 */
export class ValidationError extends AiPoweredError {
  constructor(
    /** Zod/schema validation issue messages from the final failed attempt. */
    public readonly validationIssues: string[],
    /** The raw response data that failed validation. */
    public readonly rawResponse: unknown,
  ) {
    super(
      `Structured output validation failed after all retries: ${validationIssues.join("; ")}`,
      "VALIDATION_ERROR",
    );
    this.name = "ValidationError";
  }
}
