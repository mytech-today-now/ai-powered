/**
 * @file src/ai-powered/single-shot.ts
 *
 * Top-level agent functions for single-shot video generation.
 *
 * All three public functions (`generateSingleShot`, `submitSingleShot`,
 * `pollShotJob`) throw only `AiPoweredError` instances — never plain `Error`.
 * HTTP status codes from provider responses are mapped to typed `AgentErrorCode`
 * values via `mapHttpResponseToError()` and `mapProviderErrorToAgentError()`.
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/structured-errors/spec.md
 *       openspec/changes/filmbuff-ai-powered/specs/caller-identity/spec.md
 *
 * REQ-SE-01: No plain Error leakage from any public function.
 * REQ-SE-02: All thrown errors satisfy `err instanceof Error`.
 * REQ-SE-03: RATE_LIMITED errors include retryAfterMs when Retry-After header is present.
 * REQ-SE-04: PROVIDER_TIMEOUT is retryable; PROVIDER_CONTENT_POLICY is not.
 */

import { AiPoweredError } from "./errors.js";
import type { AgentErrorCode } from "./errors.js";
import { ProviderError } from "./types.js";
import type { ProviderName } from "./core.js";
import { getAiClient } from "./index.js";
import { resolveCredential } from "./auth.js";
import { checkIdempotency, storeIdempotency } from "./idempotency.js";
import { deliverWebhook } from "./webhook.js";
import { fundAgentAccount } from "./payments.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type { AgentErrorCode };
export { AiPoweredError };

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Describes a single shot to be generated. */
export interface ShotDescriptor {
  /** Client-assigned identifier for this shot (used for idempotency and logging). */
  id: string;
  /** Text prompt describing the desired video content. */
  prompt: string;
  /** Desired video duration in seconds. */
  durationSeconds: number;
}

/** Options accepted by `generateSingleShot` and `submitSingleShot`. */
export interface SingleShotOptions {
  /** Shot description. */
  shot: ShotDescriptor;
  /**
   * Target provider identifier.
   * Supported: "runway-gen3", "runway-gen4", "lumaai", "venice".
   * Unknown values throw `AiPoweredError("PROVIDER_ERROR", ..., false)`.
   */
  provider: string;
  /** Filesystem path where the completed video clip will be written. */
  outputPath: string;
  // ── Story 1 fields (optional; implemented in a later story) ──────────────
  /** OAuth2 Bearer JWT (RS256); validated locally before any provider call. */
  agentToken?: string;
  /** Raw API key prefixed 'fb_sk_' or 'ap_sk_'. */
  agentApiKey?: string;
  /** Informational label for audit logs; no authentication effect. */
  agentId?: string;
  /** Webhook URL for async job-completion notifications. */
  callbackUrl?: string;
  /** Client-supplied deduplication key. */
  idempotencyKey?: string;
  /** Stripe pm_* token enabling auto-top-up on INSUFFICIENT_CREDITS. */
  agentPaymentMethodId?: string;
}

/**
 * Result returned by `generateSingleShot` and `pollShotJob`.
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/caller-identity/spec.md
 * bd-hto9 / AC-19
 */
export interface SingleShotResult {
  /** Provider-assigned or internally generated job identifier. */
  jobId: string;
  /** Current job status. */
  status: "complete" | "failed" | "pending";
  /** Filesystem path of the completed clip (present when status === "complete"). */
  clipPath?: string;
  /**
   * Credits consumed by this specific call.
   *
   * Present on every successful (status === "complete") response, including
   * idempotent cache hits (AC-19 / T-FB-16).  The value is a non-negative
   * integer in credit units (1 credit = $0.01).
   */
  creditsCharged?: number;
  /**
   * `true` when the result was served from the idempotency cache rather than
   * generating a new video.  `false` (or absent) on fresh generations.
   *
   * Spec: caller-identity / idempotency (Story 6).
   */
  idempotent?: boolean;
  /**
   * Machine-readable error class when a non-throwing failure path is used.
   *
   * Populated when `status === "failed"` and the caller inspects the result
   * object instead of catching a thrown `AiPoweredError`.
   */
  errorCode?: AgentErrorCode;
}

// ---------------------------------------------------------------------------
// Internal job ledger (append-only JSONL; durable across restarts)
// ---------------------------------------------------------------------------

type JobEntry =
  | { status: "pending" }
  | { status: "complete"; result: SingleShotResult }
  | { status: "failed"; error: AiPoweredError };

interface SerializedAiPoweredError {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

type JobLedgerRecord =
  | { jobId: string; status: "pending" }
  | { jobId: string; status: "complete"; result: SingleShotResult }
  | { jobId: string; status: "failed"; error: SerializedAiPoweredError };

const DEFAULT_JOB_LEDGER_PATH = path.join(
  process.cwd(),
  "logs",
  "ai-powered-single-shot-jobs.jsonl",
);

function resolveJobLedgerPath(): string {
  const configured = process.env["AIPOWERED_SINGLE_SHOT_JOB_STORE"];
  const rawPath =
    configured !== undefined && configured.length > 0 ? configured : DEFAULT_JOB_LEDGER_PATH;
  return path.resolve(rawPath);
}

function serializeAiPoweredError(error: AiPoweredError): SerializedAiPoweredError {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
  };
}

function deserializeAiPoweredError(payload: SerializedAiPoweredError): AiPoweredError {
  return new AiPoweredError(payload.code, payload.message, payload.retryable, payload.retryAfterMs);
}

function encodeJobRecord(jobId: string, entry: JobEntry): JobLedgerRecord {
  if (entry.status === "pending") {
    return { jobId, status: "pending" };
  }

  if (entry.status === "complete") {
    return { jobId, status: "complete", result: entry.result };
  }

  return { jobId, status: "failed", error: serializeAiPoweredError(entry.error) };
}

function decodeJobRecord(raw: unknown): { jobId: string; entry: JobEntry } | null {
  if (raw === null || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const jobId = record["jobId"];
  const status = record["status"];
  if (typeof jobId !== "string" || typeof status !== "string") {
    return null;
  }

  if (status === "pending") {
    return { jobId, entry: { status: "pending" } };
  }

  if (
    status === "complete" &&
    record["result"] !== undefined &&
    record["result"] !== null &&
    typeof record["result"] === "object"
  ) {
    const result = record["result"] as Partial<SingleShotResult>;
    if (
      typeof result["jobId"] === "string" &&
      (result["status"] === "complete" ||
        result["status"] === "failed" ||
        result["status"] === "pending")
    ) {
      return {
        jobId,
        entry: { status: "complete", result: result as SingleShotResult },
      };
    }
  }

  if (
    status === "failed" &&
    record["error"] !== undefined &&
    record["error"] !== null &&
    typeof record["error"] === "object"
  ) {
    const error = record["error"] as Partial<SerializedAiPoweredError>;
    if (
      typeof error["code"] === "string" &&
      typeof error["message"] === "string" &&
      typeof error["retryable"] === "boolean"
    ) {
      return {
        jobId,
        entry: {
          status: "failed",
          error: deserializeAiPoweredError(error as SerializedAiPoweredError),
        },
      };
    }
  }

  return null;
}

function isMissingFileError(err: unknown): boolean {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === "string" &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function jobLedgerUnavailableError(
  action: "read" | "write",
  ledgerPath: string,
  cause: unknown,
): AiPoweredError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new AiPoweredError(
    "PROVIDER_ERROR",
    `Single-shot job ledger at ${ledgerPath} is unavailable while attempting to ${action}. ` +
      `Async polling is disabled until durable storage is writable. (${detail})`,
    false,
  );
}

function logJobLedgerFailure(phase: "complete" | "failed", jobId: string, cause: unknown): void {
  const detail = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(
    `[ai-powered] single-shot: job ledger write failed for ${phase} job ${jobId}: ${detail}\n`,
  );
}

async function appendJobRecord(jobId: string, entry: JobEntry): Promise<void> {
  const ledgerPath = resolveJobLedgerPath();
  try {
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.appendFile(ledgerPath, `${JSON.stringify(encodeJobRecord(jobId, entry))}\n`, "utf8");
  } catch (err) {
    throw jobLedgerUnavailableError("write", ledgerPath, err);
  }
}

async function readJobRecord(jobId: string): Promise<JobEntry | undefined> {
  const ledgerPath = resolveJobLedgerPath();
  let raw: string;

  try {
    raw = await fs.readFile(ledgerPath, "utf8");
  } catch (err) {
    if (isMissingFileError(err)) return undefined;
    throw jobLedgerUnavailableError("read", ledgerPath, err);
  }

  let latest: JobEntry | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const decoded = decodeJobRecord(JSON.parse(line) as unknown);
      if (decoded !== null && decoded.jobId === jobId) {
        latest = decoded.entry;
      }
    } catch {
      // Ignore malformed trailing lines so a partial append never hides older
      // durable job records.
    }
  }

  return latest;
}

/** Generates a unique job ID. */
function _newJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// HTTP status → AgentErrorCode mapping  (REQ-SE-03, REQ-SE-04, bd-t47d)
// ---------------------------------------------------------------------------

/**
 * Maps an HTTP `Response` to an `AiPoweredError` with the appropriate
 * `AgentErrorCode`.
 *
 * - 401 → AUTH_INVALID_KEY (retryable: false)
 * - 402 → INSUFFICIENT_CREDITS (retryable: false)
 * - 403 → AUTH_INSUFFICIENT_SCOPE (retryable: false)
 * - 404 → NOT_FOUND (retryable: false)
 * - 429 → RATE_LIMITED (retryable: true; retryAfterMs from Retry-After header)
 * - 451 → PROVIDER_CONTENT_POLICY (retryable: false)
 * - 504 → PROVIDER_TIMEOUT (retryable: true)
 * - 5xx → PROVIDER_ERROR (retryable: false)
 *
 * The `Retry-After` header is parsed as an integer number of seconds and
 * converted to milliseconds. If the header is absent or non-numeric the field
 * is omitted (REQ-SE-03).
 */
export function mapHttpResponseToError(response: Response): AiPoweredError {
  const status = response.status;
  const retryAfterRaw = response.headers.get("Retry-After");
  const retryAfterMs =
    retryAfterRaw !== null && /^[0-9]+$/.test(retryAfterRaw.trim())
      ? parseInt(retryAfterRaw.trim(), 10) * 1000
      : undefined;

  const statusText = response.statusText || `HTTP ${status}`;

  switch (status) {
    case 401:
      return new AiPoweredError("AUTH_INVALID_KEY", `Unauthorized: ${statusText}`, false);
    case 402:
      return new AiPoweredError(
        "INSUFFICIENT_CREDITS",
        `Insufficient credits: ${statusText}`,
        false,
      );
    case 403:
      return new AiPoweredError(
        "AUTH_INSUFFICIENT_SCOPE",
        `Forbidden — credential lacks required scope: ${statusText}`,
        false,
      );
    case 404:
      return new AiPoweredError("NOT_FOUND", `Resource not found: ${statusText}`, false);
    case 429:
      return new AiPoweredError("RATE_LIMITED", `Rate limited: ${statusText}`, true, retryAfterMs);
    case 451:
      return new AiPoweredError(
        "PROVIDER_CONTENT_POLICY",
        `Content policy violation: ${statusText}`,
        false,
      );
    case 504:
      return new AiPoweredError("PROVIDER_TIMEOUT", `Gateway timeout: ${statusText}`, true);
    default:
      if (status >= 500) {
        return new AiPoweredError(
          "PROVIDER_ERROR",
          `Provider error ${status}: ${statusText}`,
          false,
        );
      }
      return new AiPoweredError(
        "PROVIDER_ERROR",
        `Unexpected HTTP ${status}: ${statusText}`,
        false,
      );
  }
}

// ---------------------------------------------------------------------------
// ProviderError → AgentErrorCode mapping
// ---------------------------------------------------------------------------

/**
 * Translates any thrown value from an existing `ProviderError`-based call into a
 * typed `AiPoweredError`.  Already-typed `AiPoweredError` instances pass through
 * unchanged.
 *
 * Maps `ProviderError.statusCode` using the same table as `mapHttpResponseToError`:
 * - 429 → RATE_LIMITED (retryable: true)
 * - 451 → PROVIDER_CONTENT_POLICY (retryable: false)
 * - 504 → PROVIDER_TIMEOUT (retryable: true)
 * - other 5xx → PROVIDER_ERROR (retryable: false)
 * - Abort/timeout named errors → PROVIDER_TIMEOUT (retryable: true)
 * - Anything else → PROVIDER_ERROR (retryable: false)
 */
export function mapProviderErrorToAgentError(err: unknown): AiPoweredError {
  // Already typed — pass through.
  if (err instanceof AiPoweredError) return err;

  // Existing ProviderError: map statusCode → AgentErrorCode.
  if (err instanceof ProviderError) {
    const status = err.statusCode;
    const msg = err.message;
    if (status === 401) return new AiPoweredError("AUTH_INVALID_KEY", msg, false);
    if (status === 402) return new AiPoweredError("INSUFFICIENT_CREDITS", msg, false);
    if (status === 403) return new AiPoweredError("AUTH_INSUFFICIENT_SCOPE", msg, false);
    if (status === 404) return new AiPoweredError("NOT_FOUND", msg, false);
    if (status === 429) return new AiPoweredError("RATE_LIMITED", msg, true);
    if (status === 451) return new AiPoweredError("PROVIDER_CONTENT_POLICY", msg, false);
    if (status === 504) return new AiPoweredError("PROVIDER_TIMEOUT", msg, true);
    if (status !== undefined && status >= 500)
      return new AiPoweredError("PROVIDER_ERROR", msg, false);
    // retryable field from ProviderError guides the code choice for non-HTTP errors.
    if (err.retryable) return new AiPoweredError("PROVIDER_TIMEOUT", msg, true);
    return new AiPoweredError("PROVIDER_ERROR", msg, false);
  }

  // Network abort / timeout.
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return new AiPoweredError("PROVIDER_TIMEOUT", err.message, true);
    }
    if (err.message.toLowerCase().includes("timeout")) {
      return new AiPoweredError("PROVIDER_TIMEOUT", err.message, true);
    }
    return new AiPoweredError("PROVIDER_ERROR", err.message, false);
  }

  return new AiPoweredError("PROVIDER_ERROR", String(err), false);
}

// ---------------------------------------------------------------------------
// Provider alias map
// ---------------------------------------------------------------------------

/**
 * Maps filmbuff provider identifiers to the internal `ProviderName` used by
 * `getAiClient()`.  Unknown aliases cause a `PROVIDER_ERROR` to be thrown.
 */
const PROVIDER_ALIAS: Readonly<Record<string, string>> = {
  "runway-gen3": "runway",
  "runway-gen4": "runway",
  "runway-gen4.5": "runway",
  lumaai: "lumaai",
  luma: "lumaai",
  venice: "venice",
  mock: "mock",
};

function resolveProviderName(provider: string): string {
  const resolved = PROVIDER_ALIAS[provider.toLowerCase()];
  if (!resolved) {
    throw new AiPoweredError(
      "PROVIDER_ERROR",
      `Unknown provider "${provider}". Supported: ${Object.keys(PROVIDER_ALIAS).join(", ")}`,
      false,
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// generateSingleShot  (bd-86bb, REQ-SE-01)
// ---------------------------------------------------------------------------

/**
 * Generates a single video shot synchronously.
 *
 * Cross-cutting integrations added in bd-xqmn:
 *   (1) resolveCredential() — three-tier auth (JWT > API key > global env var).
 *       Called only when any credential field is present to preserve backward
 *       compatibility with callers that set AIPOWERED_API_KEY via env and pass
 *       no per-call credential fields.
 *   (2) checkIdempotency() — returns cached result when idempotencyKey matches.
 *   (3) storeIdempotency() — caches the result after a fresh generation.
 *   (4) deliverWebhook()   — fire-and-forget POST to opts.callbackUrl.
 *   (5) Auto-fund-and-retry — calls fundAgentAccount() on INSUFFICIENT_CREDITS
 *       when agentPaymentMethodId is set, then retries the provider call once.
 *
 * @throws {AiPoweredError} code `PROVIDER_ERROR` — unknown provider or non-retryable failure.
 * @throws {AiPoweredError} code `PROVIDER_TIMEOUT` — provider timed out (retryable).
 * @throws {AiPoweredError} code `RATE_LIMITED` — rate limit hit (retryable; retryAfterMs set).
 * @throws {AiPoweredError} code `PROVIDER_CONTENT_POLICY` — content policy rejection.
 * @throws {AiPoweredError} code `NOT_FOUND` — resource not found.
 * @throws {AiPoweredError} code `INSUFFICIENT_CREDITS` — insufficient credits and no auto-fund.
 * @throws {AiPoweredError} code `IDEMPOTENCY_CONFLICT` — same key reused with different params.
 * @throws {AiPoweredError} code `AUTH_MISSING`       — no credential of any kind available.
 * @throws {AiPoweredError} code `AUTH_INVALID_TOKEN` — JWT invalid or expired.
 * @throws {AiPoweredError} code `AUTH_INVALID_KEY`   — API key rejected by auth endpoint.
 * @throws {ZodError}                                  — env var present but malformed (REQ-EV-01/02).
 */
export async function generateSingleShot(opts: SingleShotOptions): Promise<SingleShotResult> {
  // ── (1) resolveCredential — three-tier auth (Story 1 / bd-xqmn) ──────────
  // Called when any credential source is present so ZodErrors for malformed env
  // vars fire at call time (D1 / REQ-EV-01, REQ-EV-02).  When none are present
  // (AI_MOCK tests without explicit creds) we skip auth to preserve backward
  // compatibility; production deployments always supply AIPOWERED_API_KEY.
  //
  // `resolveCredential` internally calls `requireJwtPublicKey()` /
  // `requireAuthEndpoint()` as needed, replacing the earlier manual checks.
  const hasCredential =
    opts.agentToken !== undefined ||
    opts.agentApiKey !== undefined ||
    (process.env["AIPOWERED_API_KEY"] !== undefined && process.env["AIPOWERED_API_KEY"].length > 0);
  if (hasCredential) {
    // ZodError propagates unchanged (REQ-EV-01/02); AiPoweredError propagates unchanged.
    await resolveCredential(opts);
  }

  // ── Fast-fail for unknown providers (keeps backward-compat error for bad names) ──
  const internalProvider = resolveProviderName(opts.provider);
  const jobId = _newJobId();

  // ── (2) checkIdempotency — return cached result if available ──────────────
  if (opts.idempotencyKey !== undefined) {
    const cached = await checkIdempotency({
      idempotencyKey: opts.idempotencyKey,
      provider: opts.provider,
      shotId: opts.shot.id,
    });
    if (cached !== null) return cached; // REQ-IC-01: idempotent hit
  }

  // ── Inner helper: execute the provider call + write file ──────────────────
  async function callProvider(): Promise<SingleShotResult> {
    const client = await getAiClient("single-shot", {
      provider: internalProvider as ProviderName,
    });

    const videoResult = await client.generateVideo(opts.shot.prompt, {
      duration: opts.shot.durationSeconds,
    });

    // Write video data to outputPath.
    // VideoResult.data is either a base64 data URI or a plain URL.
    if (videoResult.data.startsWith("data:")) {
      const base64 = videoResult.data.replace(/^data:[^;]+;base64,/, "");
      await fs.writeFile(opts.outputPath, Buffer.from(base64, "base64"));
    } else {
      await fs.writeFile(opts.outputPath, videoResult.data, "utf8");
    }

    return {
      jobId,
      status: "complete",
      clipPath: opts.outputPath,
      creditsCharged: Math.ceil(videoResult.cost.totalUsd * 100),
      idempotent: false,
    };
  }

  // ── (3+5) Provider call with auto-fund-and-retry on INSUFFICIENT_CREDITS ──
  let result: SingleShotResult;
  try {
    result = await callProvider();
  } catch (err) {
    const agentErr = mapProviderErrorToAgentError(err);

    // (5) Auto-fund-and-retry (Story 3 / bd-xqmn): when INSUFFICIENT_CREDITS
    //     and agentPaymentMethodId is set, fund the account and retry once.
    if (agentErr.code === "INSUFFICIENT_CREDITS" && opts.agentPaymentMethodId !== undefined) {
      try {
        await fundAgentAccount({
          stripePaymentMethodId: opts.agentPaymentMethodId,
          creditAmount: 100, // 100 credits = $1.00; enough for most single shots
          // exactOptionalPropertyTypes: omit agentApiKey when undefined
          ...(opts.agentApiKey !== undefined && { agentApiKey: opts.agentApiKey }),
        });
      } catch {
        // Funding failed — re-throw the original INSUFFICIENT_CREDITS error.
        throw agentErr;
      }
      // Retry the provider call once.  On second failure, throw as-is.
      try {
        result = await callProvider();
      } catch (retryErr) {
        throw mapProviderErrorToAgentError(retryErr);
      }
    } else {
      throw agentErr;
    }
  }

  // ── (3) storeIdempotency — cache the fresh result ─────────────────────────
  if (opts.idempotencyKey !== undefined) {
    // Best-effort; never throws — a cache write failure must not fail the call.
    await storeIdempotency(
      { idempotencyKey: opts.idempotencyKey, provider: opts.provider, shotId: opts.shot.id },
      result,
    ).catch(() => undefined);
  }

  // ── (4) deliverWebhook — fire-and-forget shot:complete notification ────────
  if (opts.callbackUrl !== undefined) {
    deliverWebhook(
      opts.callbackUrl,
      {
        event: "shot:complete",
        jobId: result.jobId,
        shotId: opts.shot.id,
        status: "complete",
        clipPath: result.clipPath ?? opts.outputPath,
        durationSeconds: opts.shot.durationSeconds,
        resolution: "1920x1080", // default; providers don't return resolution metadata yet
        creditsCharged: result.creditsCharged ?? 0,
        timestamp: new Date().toISOString(),
      },
      opts.agentApiKey,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// submitSingleShot  (bd-86bb, REQ-SE-01)
// ---------------------------------------------------------------------------

/**
 * Submits a single-shot video generation job asynchronously.
 *
 * Returns a `jobId` immediately.  The generation runs in a detached async loop;
 * use `pollShotJob(jobId)` to retrieve the result.
 *
 * @throws {AiPoweredError} code `PROVIDER_ERROR` — unknown provider.
 */
export async function submitSingleShot(opts: SingleShotOptions): Promise<{ jobId: string }> {
  // ── (1) resolveCredential — three-tier auth (bd-xqmn) ────────────────────
  // Same conditional logic as generateSingleShot: only validate when a
  // credential source is present so ZodErrors fire immediately at submit time
  // (not buried in a failed async job result).
  const hasCredential =
    opts.agentToken !== undefined ||
    opts.agentApiKey !== undefined ||
    (process.env["AIPOWERED_API_KEY"] !== undefined && process.env["AIPOWERED_API_KEY"].length > 0);
  if (hasCredential) {
    await resolveCredential(opts);
  }

  // Validate provider before returning jobId so callers get an immediate error
  // for unknown providers rather than a phantom jobId that always fails.
  resolveProviderName(opts.provider);

  const jobId = _newJobId();
  await appendJobRecord(jobId, { status: "pending" });

  // Fire-and-forget — do not await; errors are captured in the job store.
  // generateSingleShot already handles webhook delivery for shot:complete (bd-xqmn).
  // Here we add shot:failed webhook delivery for async submission failures.
  void (async () => {
    try {
      const result = await generateSingleShot(opts);
      try {
        await appendJobRecord(jobId, {
          status: "complete",
          result: { ...result, jobId },
        });
      } catch (err) {
        logJobLedgerFailure("complete", jobId, err);
      }
      // shot:complete webhook is delivered inside generateSingleShot itself (REQ-WH-08).
    } catch (err) {
      const agentErr = mapProviderErrorToAgentError(err);
      try {
        await appendJobRecord(jobId, { status: "failed", error: agentErr });
      } catch (storeErr) {
        logJobLedgerFailure("failed", jobId, storeErr);
      }

      // (4) shot:failed webhook delivery (REQ-WH-07, REQ-WH-08).
      if (opts.callbackUrl !== undefined) {
        deliverWebhook(
          opts.callbackUrl,
          {
            event: "shot:failed",
            jobId,
            shotId: opts.shot.id,
            status: "failed",
            errorCode: agentErr.code,
            errorMessage: agentErr.message,
            creditsCharged: 0,
            timestamp: new Date().toISOString(),
          },
          opts.agentApiKey,
        );
      }
    }
  })();

  return { jobId };
}

// ---------------------------------------------------------------------------
// pollShotJob  (bd-86bb, REQ-SE-01)
// ---------------------------------------------------------------------------

/**
 * Returns the current state of a previously submitted shot job.
 *
 * - If the job is still running, returns `{ jobId, status: "pending" }`.
 * - If the job succeeded, returns the full `SingleShotResult`.
 * - If the job failed, **throws** the captured `AiPoweredError` so callers can
 *   inspect `err.code` and `err.retryable` without checking a status field.
 *
 * @throws {AiPoweredError} code `NOT_FOUND` — `jobId` was never submitted or has
 *   no durable record in the job ledger.
 * @throws {AiPoweredError} (any code) — the error captured during generation when
 *   `status === "failed"`.
 */
export async function pollShotJob(jobId: string): Promise<SingleShotResult> {
  const entry = await readJobRecord(jobId);

  if (entry === undefined) {
    throw new AiPoweredError(
      "NOT_FOUND",
      `Job "${jobId}" not found. It may not have been submitted or may have been evicted.`,
      false,
    );
  }

  if (entry.status === "pending") {
    return { jobId, status: "pending" };
  }

  if (entry.status === "failed") {
    // Re-throw the original AiPoweredError so the caller can act on err.code.
    throw entry.error;
  }

  // status === "complete"
  return entry.result;
}
