/**
 * @file src/ai-powered/idempotency.ts
 *
 * Redis-backed idempotency cache for `generateSingleShot` and `submitSingleShot`.
 *
 * When `opts.idempotencyKey` is set, the call result is stored in Redis and returned
 * directly on re-submission — without calling the AI provider a second time.  This
 * prevents double-billing and duplicate generation in retry-heavy agent workflows.
 *
 * ## Storage selection
 *
 * | `AIPOWERED_REDIS_URL` | `ioredis` importable | Storage used                 |
 * |-----------------------|----------------------|------------------------------|
 * | not set               | —                    | **disabled** (silent)        |
 * | set                   | yes                  | Redis                        |
 * | set                   | no (not installed)   | explicit non-retryable error |
 *
 * ## Cache key format (spec §idempotency-cache)
 *
 * ```
 * ai-powered:idempotency:<idempotencyKey>:<provider>:<shotId>
 * ```
 *
 * Conflict detection uses a separate metadata key:
 * ```
 * ai-powered:idempotency:meta:<idempotencyKey>  →  {provider, shotId}
 * ```
 *
 * ## Requirements
 *
 * REQ-IC-01 — Second identical call returns idempotent:true; provider not called.
 * REQ-IC-02 — Second call does not contact the AI provider.
 * REQ-IC-03 — Same key + different provider → IDEMPOTENCY_CONFLICT.
 * REQ-IC-04 — Same key + different shotId   → IDEMPOTENCY_CONFLICT.
 * REQ-IC-05 — AIPOWERED_REDIS_URL absent → no error; result.idempotent always false.
 * REQ-IC-07 — Atomic SET NX prevents duplicate writes on concurrent calls.
 * REQ-IC-08 — AIPOWERED_REDIS_URL set but ioredis unavailable → explicit error;
 *   no in-memory fallback.
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/idempotency-cache/spec.md
 */

import { AiPoweredError } from "./errors.js";
import { optionalRedisUrl } from "./env.js";
import type { SingleShotResult } from "./single-shot.js";
// ioredis is an optional peer dependency — imported only via dynamic import inside
// getClient() so the module loads cleanly even when ioredis is not installed.
// The static type-only import gives full TypeScript coverage without a hard runtime dep.
import type { Redis as _IoRedis } from "ioredis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Compact metadata stored per idempotencyKey for conflict detection. */
interface IdempotencyMeta {
  /** Original provider string (e.g. "runway-gen3"). */
  provider: string;
  /** Original shot.id. */
  shotId: string;
}

/**
 * Minimal Redis-like interface used by this module.
 * Implemented by ioredis.
 * @internal
 */
interface RedisLike {
  get(key: string): Promise<string | null>;
  /** SET key value EX ttl NX — returns "OK" or null. */
  set(key: string, value: string, exMode: "EX", ttl: number, nxMode: "NX"): Promise<string | null>;
  quit(): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Redis dependency failure handling
// ---------------------------------------------------------------------------

const REDIS_DEPENDENCY_ERROR_PREFIX =
  "[ai-powered] idempotency: AIPOWERED_REDIS_URL is set, but ioredis could not be loaded. " +
  "Redis-backed idempotency is unavailable. Install ioredis or unset AIPOWERED_REDIS_URL.";

function failRedisDependency(error: unknown): never {
  const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : "";
  const message = `${REDIS_DEPENDENCY_ERROR_PREFIX}${detail}`;
  process.stderr.write(message + "\n");
  throw new AiPoweredError("PROVIDER_ERROR", message, false);
}

// ---------------------------------------------------------------------------
// Singleton Redis client
// ---------------------------------------------------------------------------

/** Cached client instance (null = disabled; real ioredis = production). */
let _redisClient: RedisLike | null | undefined = undefined; // undefined = not yet resolved

async function getClient(): Promise<RedisLike | null> {
  if (_redisClient !== undefined) return _redisClient;

  const redisUrl = optionalRedisUrl();
  if (redisUrl === undefined) {
    // AIPOWERED_REDIS_URL not set → idempotency disabled (REQ-IC-05).
    _redisClient = null;
    return null;
  }

  // AIPOWERED_REDIS_URL is set — try to load ioredis.
  try {
    // Dynamic import — ioredis is an optional peer dependency (listed in
    // `optionalDependencies`).  The static `import type` above provides full
    // TypeScript coverage; the runtime import here triggers actual connection.
    // If ioredis is absent (e.g. stripped from a minimal deploy), the catch
    // block fails fast with an explicit operator-visible error.
    const { Redis } = await import("ioredis");
    // IoRedis implements a superset of RedisLike; cast is safe.
    _redisClient = new Redis(redisUrl) as unknown as RedisLike;
  } catch (error) {
    failRedisDependency(error);
  }
  return _redisClient;
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS = 86_400; // 24 hours (REQ-IC-06)

function resultKey(idempotencyKey: string, provider: string, shotId: string): string {
  return `ai-powered:idempotency:${idempotencyKey}:${provider}:${shotId}`;
}

function metaKey(idempotencyKey: string): string {
  return `ai-powered:idempotency:meta:${idempotencyKey}`;
}

// ---------------------------------------------------------------------------
// Public options type
// ---------------------------------------------------------------------------

/** Parameters that identify an idempotent operation. */
export interface IdempotencyCheckOptions {
  /** Client-supplied deduplication key from `SingleShotOptions.idempotencyKey`. */
  idempotencyKey: string;
  /** Provider alias string from `SingleShotOptions.provider` (e.g. "runway-gen3"). */
  provider: string;
  /** Shot identifier from `SingleShotOptions.shot.id`. */
  shotId: string;
}

// ---------------------------------------------------------------------------
// checkIdempotency
// ---------------------------------------------------------------------------

/**
 * Checks whether a cached result exists for the given idempotencyKey.
 *
 * Returns the cached `SingleShotResult` (with `idempotent: true`) if one is
 * found, or `null` if the call is novel and should proceed to the provider.
 *
 * @throws {AiPoweredError} `IDEMPOTENCY_CONFLICT` — same key was submitted with
 *   a different `provider` or `shot.id` (REQ-IC-03, REQ-IC-04).
 */
export async function checkIdempotency(
  opts: IdempotencyCheckOptions,
): Promise<SingleShotResult | null> {
  const client = await getClient();
  if (client === null) return null; // disabled (REQ-IC-05)

  const { idempotencyKey, provider, shotId } = opts;
  const mk = metaKey(idempotencyKey);

  // Retrieve existing metadata (provider + shotId used on the first call).
  const rawMeta = await client.get(mk);
  if (rawMeta !== null) {
    const meta = JSON.parse(rawMeta) as IdempotencyMeta;

    // Conflict detection (REQ-IC-03, REQ-IC-04).
    if (meta.provider !== provider || meta.shotId !== shotId) {
      throw new AiPoweredError(
        "IDEMPOTENCY_CONFLICT",
        `idempotencyKey '${idempotencyKey}' was previously used with provider '${meta.provider}' ` +
          `and shotId '${meta.shotId}'; cannot reuse with provider '${provider}' and shotId '${shotId}'`,
        false,
      );
    }

    // Same provider + shotId — look up the cached result.
    const rk = resultKey(idempotencyKey, provider, shotId);
    const rawResult = await client.get(rk);
    if (rawResult !== null) {
      const cached = JSON.parse(rawResult) as SingleShotResult;
      return { ...cached, idempotent: true }; // REQ-IC-01
    }
  }

  return null; // Novel call — proceed to provider.
}

// ---------------------------------------------------------------------------
// storeIdempotency
// ---------------------------------------------------------------------------

/**
 * Stores a successful `SingleShotResult` in the idempotency cache.
 *
 * Uses atomic `SET NX` to prevent duplicate writes on concurrent identical
 * calls (REQ-IC-07).  A 24-hour TTL is applied to both the metadata and result
 * keys (REQ-IC-06).
 *
 * No-op when idempotency is disabled (AIPOWERED_REDIS_URL absent).
 */
export async function storeIdempotency(
  opts: IdempotencyCheckOptions,
  result: SingleShotResult,
): Promise<void> {
  const client = await getClient();
  if (client === null) return; // disabled (REQ-IC-05)

  const { idempotencyKey, provider, shotId } = opts;

  // Store metadata first (NX — first writer wins; prevents TOCTOU in concurrent calls).
  const mk = metaKey(idempotencyKey);
  const meta: IdempotencyMeta = { provider, shotId };
  await client.set(mk, JSON.stringify(meta), "EX", CACHE_TTL_SECONDS, "NX");

  // Store the result (NX — first writer wins).
  const rk = resultKey(idempotencyKey, provider, shotId);
  // Store with idempotent: false so first-call callers see the real value.
  // Subsequent callers get idempotent: true via checkIdempotency.
  const toStore: SingleShotResult = { ...result, idempotent: false };
  await client.set(rk, JSON.stringify(toStore), "EX", CACHE_TTL_SECONDS, "NX");
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Resets the cached Redis client singleton.
 * For use in unit tests only — call before each test that modifies
 * AIPOWERED_REDIS_URL to ensure a fresh client is created.
 * @internal
 */
export function _resetIdempotencyClient(): void {
  _redisClient = undefined;
}
