/**
 * @file src/ai-powered/webhook.ts
 *
 * Fire-and-forget webhook delivery with exponential backoff for the ai-powered
 * filmbuff agent integration (Story 5).
 *
 * When `callbackUrl` is set in `SingleShotOptions`, `generateSingleShot` calls
 * `deliverWebhook()` after the result is known.  Delivery runs in a detached
 * async loop that never blocks the caller (REQ-WH-08).
 *
 * ## Payload schemas
 *
 * `shot:complete` — event, jobId, shotId, status, clipPath, durationSeconds,
 *   resolution, creditsCharged, timestamp
 *
 * `shot:failed` — event, jobId, shotId, status, errorCode, errorMessage,
 *   creditsCharged (always 0), timestamp  (no clipPath — REQ-WH-07)
 *
 * ## Signature header (REQ-WH-03)
 *
 * ```
 * X-AiPowered-Signature: sha256=<HMAC-SHA256(signingKey, rawBodyString).hex()>
 * ```
 *
 * Signing key priority:
 *   1. `agentApiKey` from the original `SingleShotOptions` (if non-empty)
 *   2. `AIPOWERED_WEBHOOK_SECRET` env var
 *   3. Neither set → header omitted, warning written to stderr
 *
 * ## Retry schedule (REQ-WH-04, REQ-WH-06)
 *
 * Initial attempt → 30 s → 5 min → 30 min (4 total attempts).
 * Stops immediately on the first 2xx response (REQ-WH-06).
 * After all attempts fail: full payload written to stderr as single-line JSON
 * with `"delivery_failed": true` (REQ-WH-05).
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/webhook-delivery/spec.md
 */

import { createHmac } from "node:crypto";
import { optionalWebhookSecret } from "./env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Retry delays in milliseconds: 30 s, 5 min, 30 min (REQ-WH-04). */
const RETRY_DELAYS_MS = [30_000, 300_000, 1_800_000] as const;

/** Total delivery attempts = 1 initial + 3 retries. */
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length;

// ---------------------------------------------------------------------------
// Payload types (spec §Payload Schemas)
// ---------------------------------------------------------------------------

export interface WebhookCompletePayload {
  event: "shot:complete";
  jobId: string;
  shotId: string;
  status: "complete";
  clipPath: string;
  durationSeconds: number;
  /** Pixel dimensions string, e.g. "1920x1080". */
  resolution: string;
  creditsCharged: number;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
}

export interface WebhookFailedPayload {
  event: "shot:failed";
  jobId: string;
  shotId: string;
  status: "failed";
  errorCode: string;
  errorMessage: string;
  /** Always 0 — no credits were consumed on a failed job (spec). */
  creditsCharged: 0;
  timestamp: string;
}

export type WebhookPayload = WebhookCompletePayload | WebhookFailedPayload;

// ---------------------------------------------------------------------------
// Signature computation (REQ-WH-03)
// ---------------------------------------------------------------------------

/**
 * Computes `sha256=<HMAC-SHA256 hex>` over the raw body string.
 * Uses the priority: agentApiKey > AIPOWERED_WEBHOOK_SECRET > omit.
 */
function computeSignature(body: string, key: string): string {
  return "sha256=" + createHmac("sha256", key).update(body).digest("hex");
}

function resolveSigningKey(agentApiKey: string | undefined): string | undefined {
  if (agentApiKey !== undefined && agentApiKey.length > 0) return agentApiKey;
  const envSecret = optionalWebhookSecret();
  return envSecret; // undefined if neither is set
}

// ---------------------------------------------------------------------------
// deliverWebhook (REQ-WH-01, REQ-WH-08)
// ---------------------------------------------------------------------------

/**
 * Sends a webhook POST to `callbackUrl` in a fire-and-forget detached loop.
 *
 * Never throws.  Never blocks the caller.  All errors and retries are handled
 * internally (REQ-WH-08).  After all 4 attempts fail, the payload is written
 * to `stderr` with `"delivery_failed": true` (REQ-WH-05).
 *
 * @param callbackUrl  Destination URL for the webhook POST.
 * @param payload      `shot:complete` or `shot:failed` event payload.
 * @param agentApiKey  Optional raw API key for HMAC signing (priority 1).
 */
export function deliverWebhook(
  callbackUrl: string,
  payload: WebhookPayload,
  agentApiKey: string | undefined,
): void {
  // Detached async loop — void is intentional (REQ-WH-08).
  void (async () => {
    const body = JSON.stringify(payload);
    const signingKey = resolveSigningKey(agentApiKey);

    if (signingKey === undefined) {
      process.stderr.write(
        "[ai-powered] webhook: no signing key available (agentApiKey absent and " +
          "AIPOWERED_WEBHOOK_SECRET not set); X-AiPowered-Signature header omitted.\n",
      );
    }

    const buildHeaders = (): Record<string, string> => {
      const h: Record<string, string> = { "Content-Type": "application/json" };
      if (signingKey !== undefined) {
        h["X-AiPowered-Signature"] = computeSignature(body, signingKey);
      }
      return h;
    };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }

      try {
        const res = await fetch(callbackUrl, {
          method: "POST",
          headers: buildHeaders(), // signature recomputed on each retry (spec)
          body,
        });
        if (res.ok) return; // 2xx → success; stop retrying (REQ-WH-06)
      } catch {
        // Network error — proceed to next retry attempt.
      }
    }

    // All attempts exhausted — log failed delivery to stderr (REQ-WH-05).
    const failedLog = JSON.stringify({
      delivery_failed: true,
      ...payload,
      callbackUrl,
      attempts: MAX_ATTEMPTS,
    });
    process.stderr.write(failedLog + "\n");
  })();
}
