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
 * Each attempt is capped at 10 s; timeout/abort counts as a retryable failure.
 * Stops immediately on the first 2xx response (REQ-WH-06).
 * After all attempts fail: redacted delivery metadata is written to stderr as single-line JSON
 * with `"delivery_failed": true` (REQ-WH-05).
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/webhook-delivery/spec.md
 */

import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { optionalWebhookSecret } from "./env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Retry delays in milliseconds: 30 s, 5 min, 30 min (REQ-WH-04). */
const RETRY_DELAYS_MS = [30_000, 300_000, 1_800_000] as const;

/** Total delivery attempts = 1 initial + 3 retries. */
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length;

/** Per-attempt deadline in milliseconds before aborting a stalled callback. */
const WEBHOOK_ATTEMPT_TIMEOUT_MS = 10_000;

/** Maximum response body size accepted from a callback endpoint. */
const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;

/** Explicit opt-in for local HTTP callback fixtures and development servers. */
const WEBHOOK_TEST_MODE_ENV = "AIPOWERED_WEBHOOK_TEST_MODE";

type DnsLookup = (hostname: string) => Promise<readonly string[]>;

const defaultDnsLookup: DnsLookup = async (hostname) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address }) => address);
};

let resolveDns: DnsLookup = defaultDnsLookup;

/** @internal Test-only DNS fixture hook. */
export function _setWebhookDnsLookupForTests(lookup?: DnsLookup): void {
  resolveDns = lookup ?? defaultDnsLookup;
}
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

export interface WebhookDestinationPolicy {
  /** Permit only localhost/loopback destinations and HTTP when explicitly true. */
  allowLocalhost?: boolean;
}

export interface ValidatedDestination {
  url: string;
  hostname: string;
  addresses: readonly string[];
  allowLocalhost: boolean;
}

class WebhookPolicyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "WebhookPolicyError";
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function isLocalhostName(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function parseIpv4(address: string): readonly number[] | undefined {
  const octets = address.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part))) return undefined;
  const parsed = octets.map(Number);
  return parsed.every((octet) => octet >= 0 && octet <= 255) ? parsed : undefined;
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return true;
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0]!;
  if (normalized === "::" || normalized === "::1") return true;

  const halves = normalized.split("::");
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const expanded =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : [...left];
  if (expanded.length !== 8 || expanded.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return true;

  const first = Number.parseInt(expanded[0]!, 16);
  const third = Number.parseInt(expanded[2]!, 16);
  const fourth = Number.parseInt(expanded[3]!, 16);
  const isIpv4Mapped = expanded.slice(0, 5).every((part) => part === "0") && expanded[5] === "ffff";
  const mappedIpv4 =
    (third >> 8) + "." + (third & 255) + "." + (fourth >> 8) + "." + (fourth & 255);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && expanded[1] === "0xdb8") ||
    (isIpv4Mapped && isPrivateIpv4(mappedIpv4))
  );
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) return isPrivateIpv6(normalized);
  return true;
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const ipv4 = parseIpv4(normalized);
  return ipv4?.[0] === 127 || normalized === "::1";
}

function validateParsedUrl(
  parsed: URL,
  policy: WebhookDestinationPolicy,
): { hostname: string; allowLocalhost: boolean } {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || parsed.username || parsed.password || parsed.hash) {
    throw new WebhookPolicyError("invalid_url");
  }

  const isLocalhost = isLocalhostName(hostname) || isLoopbackAddress(hostname);
  const allowLocalhost = Boolean(policy.allowLocalhost && isLocalhost);
  if (parsed.protocol !== "https:" && !(allowLocalhost && parsed.protocol === "http:")) {
    throw new WebhookPolicyError("https_required");
  }

  const port = parsed.port === "" ? undefined : Number.parseInt(parsed.port, 10);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new WebhookPolicyError("invalid_port");
  }
  if (!allowLocalhost && port !== undefined && port !== 443) {
    throw new WebhookPolicyError("port_not_allowed");
  }

  return { hostname, allowLocalhost };
}

function addressesForHost(hostname: string): readonly string[] | Promise<readonly string[]> {
  if (isIP(hostname) !== 0) return [hostname];
  return resolveDns(hostname).then((addresses) => {
    if (addresses.length === 0) throw new WebhookPolicyError("dns_no_addresses");
    return addresses;
  });
}

/**
 * Validates and resolves a callback destination before any request is made.
 * Public HTTPS destinations are allowed; private, link-local, and loopback
 * addresses are rejected unless localhost test mode is explicitly enabled.
 */
export function validateWebhookDestination(
  callbackUrl: string,
  policy: WebhookDestinationPolicy = {
    allowLocalhost: isTruthyEnv(process.env[WEBHOOK_TEST_MODE_ENV]),
  },
): ValidatedDestination | Promise<ValidatedDestination> {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new WebhookPolicyError("invalid_url");
  }

  const { hostname, allowLocalhost } = validateParsedUrl(parsed, policy);
  const addresses = addressesForHost(hostname);
  if (addresses instanceof Promise) {
    return addresses.then((resolvedAddresses) => {
      if (allowLocalhost) {
        if (!resolvedAddresses.every(isLoopbackAddress)) {
          throw new WebhookPolicyError("localhost_resolution_not_loopback");
        }
      } else if (resolvedAddresses.some(isPrivateAddress)) {
        throw new WebhookPolicyError("private_address");
      }
      return { url: callbackUrl, hostname, addresses: resolvedAddresses, allowLocalhost };
    });
  }

  if (allowLocalhost) {
    if (!addresses.every(isLoopbackAddress)) {
      throw new WebhookPolicyError("localhost_resolution_not_loopback");
    }
  } else if (addresses.some(isPrivateAddress)) {
    throw new WebhookPolicyError("private_address");
  }
  return { url: callbackUrl, hostname, addresses, allowLocalhost };
}

function destinationHash(callbackUrl: string): string {
  return createHash("sha256").update(callbackUrl).digest("hex");
}

function eventId(payload: WebhookPayload): string {
  return createHash("sha256")
    .update(payload.event + ":" + payload.jobId + ":" + payload.shotId)
    .digest("hex")
    .slice(0, 24);
}

function samePublicResolution(previous: readonly string[], current: readonly string[]): boolean {
  const previousSet = new Set(previous);
  return current.every((address) => previousSet.has(address));
}
function writeSafeDeliveryLog(
  kind: "delivery_failed" | "delivery_rejected",
  payload: WebhookPayload,
  callbackUrl: string,
  details: { attempts?: number; reason?: string },
): void {
  process.stderr.write(
    JSON.stringify({
      [kind]: true,
      event: payload.event,
      eventId: eventId(payload),
      jobId: payload.jobId,
      shotId: payload.shotId,
      status: payload.status,
      destinationHash: destinationHash(callbackUrl),
      ...(details.attempts !== undefined ? { attempts: details.attempts } : {}),
      ...(details.reason !== undefined ? { reason: details.reason } : {}),
    }) + "\n",
  );
}
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

async function fetchWebhookAttempt(callbackUrl: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, WEBHOOK_ATTEMPT_TIMEOUT_MS);

  try {
    return await fetch(callbackUrl, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function closeWebhookResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup is best-effort; the callback outcome is already known.
  }
}

function responseIsWithinLimit(response: Response): boolean {
  const headers = (response as Response & { headers?: Headers }).headers;
  const rawLength = headers?.get("content-length");
  if (rawLength === null || rawLength === undefined) return true;
  const length = Number.parseInt(rawLength, 10);
  return Number.isFinite(length) && length >= 0 && length <= MAX_WEBHOOK_RESPONSE_BYTES;
}

// ---------------------------------------------------------------------------
// deliverWebhook (REQ-WH-01, REQ-WH-08)
// ---------------------------------------------------------------------------

function safePolicyReason(error: unknown): string {
  return error instanceof WebhookPolicyError ? error.reason : "destination_unavailable";
}

async function revalidateDestination(
  callbackUrl: string,
  initial: ValidatedDestination,
  policy: WebhookDestinationPolicy,
): Promise<ValidatedDestination> {
  const current = validateWebhookDestination(callbackUrl, policy);
  const resolved = current instanceof Promise ? await current : current;
  if (!samePublicResolution(initial.addresses, resolved.addresses)) {
    throw new WebhookPolicyError("dns_resolution_changed");
  }
  return resolved;
}

async function runWebhookDelivery(
  callbackUrl: string,
  payload: WebhookPayload,
  agentApiKey: string | undefined,
  initialDestination: ValidatedDestination,
  policy: WebhookDestinationPolicy,
): Promise<void> {
  const body = JSON.stringify(payload);
  let signingKey: string | undefined;
  try {
    signingKey = resolveSigningKey(agentApiKey);
  } catch {
    writeSafeDeliveryLog("delivery_rejected", payload, callbackUrl, {
      reason: "signing_configuration_error",
    });
    return;
  }

  if (signingKey === undefined) {
    process.stderr.write(
      "[ai-powered] webhook: no signing key available (agentApiKey absent and " +
        "AIPOWERED_WEBHOOK_SECRET not set); X-AiPowered-Signature header omitted.\n",
    );
  }

  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (signingKey !== undefined) {
      headers["X-AiPowered-Signature"] = computeSignature(body, signingKey);
    }
    return headers;
  };

  let destination = initialDestination;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      try {
        destination = await revalidateDestination(callbackUrl, initialDestination, policy);
      } catch (error) {
        writeSafeDeliveryLog("delivery_rejected", payload, callbackUrl, {
          reason: safePolicyReason(error),
        });
        return;
      }
    }

    try {
      const response = await fetchWebhookAttempt(destination.url, {
        method: "POST",
        headers: buildHeaders(),
        body,
      });
      const responseWithinLimit = responseIsWithinLimit(response);
      await closeWebhookResponse(response);
      if (response.ok && responseWithinLimit) return;
    } catch {
      // Network error, timeout, abort, or oversized response: retry safely.
    }
  }

  writeSafeDeliveryLog("delivery_failed", payload, callbackUrl, {
    attempts: MAX_ATTEMPTS,
  });
}

/**
 * Sends a webhook POST to the callback URL in a fire-and-forget detached loop.
 * Never throws or blocks the caller; retries and errors are handled internally.
 *
 * @param callbackUrl Destination URL for the webhook POST.
 * @param payload Event payload.
 * @param agentApiKey Optional raw API key for HMAC signing.
 */
export function deliverWebhook(
  callbackUrl: string,
  payload: WebhookPayload,
  agentApiKey: string | undefined,
): void {
  const policy: WebhookDestinationPolicy = {
    allowLocalhost: isTruthyEnv(process.env[WEBHOOK_TEST_MODE_ENV]),
  };

  let validation: ValidatedDestination | Promise<ValidatedDestination>;
  try {
    validation = validateWebhookDestination(callbackUrl, policy);
  } catch (error) {
    writeSafeDeliveryLog("delivery_rejected", payload, callbackUrl, {
      reason: safePolicyReason(error),
    });
    return;
  }

  const startDelivery = (destination: ValidatedDestination): void => {
    void runWebhookDelivery(callbackUrl, payload, agentApiKey, destination, policy).catch(() => {
      writeSafeDeliveryLog("delivery_rejected", payload, callbackUrl, {
        reason: "delivery_internal_error",
      });
    });
  };

  if (validation instanceof Promise) {
    void validation.then(startDelivery).catch((error: unknown) => {
      writeSafeDeliveryLog("delivery_rejected", payload, callbackUrl, {
        reason: safePolicyReason(error),
      });
    });
  } else {
    startDelivery(validation);
  }
}
