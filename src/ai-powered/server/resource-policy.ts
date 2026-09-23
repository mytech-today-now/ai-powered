/**
 * Resource budgets for buffered JSON and native media processing.
 *
 * The defaults are intentionally conservative for a hosted proxy. Local users
 * can opt into a larger envelope through ServeOptions.resourceLimits or the
 * corresponding AI_PROXY_* environment variables.
 */

const MIB = 1024 * 1024;

export interface ResourceLimitOptions {
  maxJsonBodyBytes?: number;
  maxBatchItems?: number;
  maxBatchDurationSeconds?: number;
  maxStitchClips?: number;
  maxStitchClipBytes?: number;
  maxStitchDecodedBytes?: number;
  maxStitchOutputBytes?: number;
  maxFfmpegTimeoutMs?: number;
  maxConcurrentStitches?: number;
}

export interface ResourceLimits {
  maxJsonBodyBytes: number;
  maxBatchItems: number;
  maxBatchDurationSeconds: number;
  maxStitchClips: number;
  maxStitchClipBytes: number;
  maxStitchDecodedBytes: number;
  maxStitchOutputBytes: number;
  maxFfmpegTimeoutMs: number;
  maxConcurrentStitches: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = Object.freeze({
  // This remains large enough for the documented local 24-clip Luma batch,
  // while removing the previous 200 MB parser allocation ceiling.
  maxJsonBodyBytes: 100 * MIB,
  maxBatchItems: 100,
  maxBatchDurationSeconds: 600,
  maxStitchClips: 20,
  maxStitchClipBytes: 25 * MIB,
  maxStitchDecodedBytes: 75 * MIB,
  maxStitchOutputBytes: 100 * MIB,
  maxFfmpegTimeoutMs: 120_000,
  maxConcurrentStitches: 2,
});

const ENV_KEYS: Record<keyof ResourceLimits, string> = {
  maxJsonBodyBytes: "AI_PROXY_MAX_JSON_BODY_BYTES",
  maxBatchItems: "AI_PROXY_MAX_BATCH_ITEMS",
  maxBatchDurationSeconds: "AI_PROXY_MAX_BATCH_DURATION_SECONDS",
  maxStitchClips: "AI_PROXY_MAX_STITCH_CLIPS",
  maxStitchClipBytes: "AI_PROXY_MAX_STITCH_CLIP_BYTES",
  maxStitchDecodedBytes: "AI_PROXY_MAX_STITCH_DECODED_BYTES",
  maxStitchOutputBytes: "AI_PROXY_MAX_STITCH_OUTPUT_BYTES",
  maxFfmpegTimeoutMs: "AI_PROXY_FFMPEG_TIMEOUT_MS",
  maxConcurrentStitches: "AI_PROXY_MAX_CONCURRENT_STITCHES",
};

function validateLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid resource limit ${name}: expected a positive integer.`);
  }
  return value;
}

function configuredLimit<K extends keyof ResourceLimits>(
  key: K,
  options: ResourceLimitOptions,
  env: NodeJS.ProcessEnv,
): number {
  const explicit = options[key];
  if (explicit !== undefined) return validateLimit(key, explicit);

  const envKey = ENV_KEYS[key];
  const raw = env[envKey];
  if (raw === undefined || raw.trim() === "") return DEFAULT_RESOURCE_LIMITS[key];
  const parsed = Number(raw);
  return validateLimit(envKey, parsed);
}

export function resolveResourceLimits(
  options: ResourceLimitOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ResourceLimits {
  return {
    maxJsonBodyBytes: configuredLimit("maxJsonBodyBytes", options, env),
    maxBatchItems: configuredLimit("maxBatchItems", options, env),
    maxBatchDurationSeconds: configuredLimit("maxBatchDurationSeconds", options, env),
    maxStitchClips: configuredLimit("maxStitchClips", options, env),
    maxStitchClipBytes: configuredLimit("maxStitchClipBytes", options, env),
    maxStitchDecodedBytes: configuredLimit("maxStitchDecodedBytes", options, env),
    maxStitchOutputBytes: configuredLimit("maxStitchOutputBytes", options, env),
    maxFfmpegTimeoutMs: configuredLimit("maxFfmpegTimeoutMs", options, env),
    maxConcurrentStitches: configuredLimit("maxConcurrentStitches", options, env),
  };
}

export type ResourcePolicyErrorCode =
  | "RESOURCE_LIMIT_EXCEEDED"
  | "RESOURCE_CONCURRENCY_LIMIT"
  | "RESOURCE_TIMEOUT"
  | "INVALID_STITCH_CLIP"
  | "REQUEST_ABORTED";

export class ResourcePolicyError extends Error {
  readonly statusCode: number;
  readonly code: ResourcePolicyErrorCode;
  readonly limit: string;

  constructor(
    message: string,
    options: {
      statusCode: number;
      code: ResourcePolicyErrorCode;
      limit: string;
    },
  ) {
    super(message);
    this.name = "ResourcePolicyError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.limit = options.limit;
  }
}

export interface ResourcePolicy {
  limits: ResourceLimits;
  tryAcquireStitch(): (() => void) | undefined;
}

export function createResourcePolicy(options: ResourceLimitOptions = {}): ResourcePolicy {
  const limits = resolveResourceLimits(options);
  let activeStitches = 0;

  return {
    limits,
    tryAcquireStitch() {
      if (activeStitches >= limits.maxConcurrentStitches) return undefined;
      activeStitches += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeStitches -= 1;
      };
    },
  };
}

export function requestBodyLimitError(): ResourcePolicyError {
  return new ResourcePolicyError("Request body exceeds the configured body-byte limit.", {
    statusCode: 413,
    code: "RESOURCE_LIMIT_EXCEEDED",
    limit: "body_bytes",
  });
}

export function stitchLimitError(limit: string): ResourcePolicyError {
  return new ResourcePolicyError(`Request exceeds the configured ${limit} limit.`, {
    statusCode: 413,
    code: "RESOURCE_LIMIT_EXCEEDED",
    limit,
  });
}

export function stitchConcurrencyError(): ResourcePolicyError {
  return new ResourcePolicyError("Stitch concurrency limit is currently exhausted.", {
    statusCode: 429,
    code: "RESOURCE_CONCURRENCY_LIMIT",
    limit: "stitch_concurrency",
  });
}

export function ffmpegTimeoutError(): ResourcePolicyError {
  return new ResourcePolicyError("The stitch subprocess exceeded its time limit.", {
    statusCode: 504,
    code: "RESOURCE_TIMEOUT",
    limit: "ffmpeg_timeout",
  });
}

export function invalidStitchClipError(): ResourcePolicyError {
  return new ResourcePolicyError("A stitch clip is not valid base64 media data.", {
    statusCode: 400,
    code: "INVALID_STITCH_CLIP",
    limit: "stitch_clip_encoding",
  });
}

export function requestAbortedError(): ResourcePolicyError {
  return new ResourcePolicyError("The stitch request was cancelled.", {
    statusCode: 499,
    code: "REQUEST_ABORTED",
    limit: "request_cancellation",
  });
}

export function isRequestBodyTooLargeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  return candidate.type === "entity.too.large";
}
