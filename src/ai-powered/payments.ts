/**
 * @file src/ai-powered/payments.ts
 *
 * Autonomous payment support for the ai-powered filmbuff agent integration.
 *
 * Implements the client side of the stripe402 payment flow so AI agents can
 * fund their own calls without requiring a pre-configured service account.
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/autonomous-payments/spec.md
 *       (Story 3, REQ-AP-01 through REQ-AP-07)
 */

import { AiPoweredError } from "./errors.js";
import { maskApiKey } from "./auth.js";
import { requireAuthEndpoint } from "./env.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for funding an agent account via stripe402.
 *
 * Spec: specs/autonomous-payments/spec.md
 */
export interface FundOptions {
  /** Stripe `pm_*` payment method token (REQ-AP-01). */
  stripePaymentMethodId: string;
  /** Number of credits to purchase. One credit = $0.01. */
  creditAmount: number;
  /**
   * If supplied, credits are applied to this key's balance instead of the
   * default account balance.  The raw key is NEVER logged (REQ-CI-06).
   */
  agentApiKey?: string;
  /**
   * When `true`, the response includes a single-use `X-Payment-Authorization`
   * token valid for 5 minutes (server-side enforced, REQ-AP-02 / D4).
   */
  returnPaymentToken?: boolean;
}

/**
 * Result returned by `fundAgentAccount`.
 *
 * Spec: specs/autonomous-payments/spec.md
 */
export interface FundResult {
  /** Credits actually added (may differ if price rounding applies). */
  creditsGranted: number;
  /** Agent's total credit balance after purchase. */
  newBalance: number;
  /**
   * Single-use token valid for 5 minutes; present when
   * `returnPaymentToken: true` was set in the request (REQ-AP-02).
   *
   * Pass as `X-Payment-Authorization: <paymentToken>` in direct HTTP calls
   * to the FilmBuff platform.  Validity is enforced server-side (D4).
   */
  paymentToken?: string;
  /** Stripe charge ID for receipts and auditing. */
  stripeChargeId: string;
}

// ---------------------------------------------------------------------------
// fundAgentAccount
// ---------------------------------------------------------------------------

/**
 * Funds an agent account by triggering a Stripe charge via the FilmBuff
 * stripe402 endpoint.
 *
 * The FilmBuff platform handles the Stripe charge server-side and returns
 * the `FundResult`.  This client function only constructs and dispatches the
 * POST request; no Stripe SDK is required (REQ-AP-07).
 *
 * @throws {AiPoweredError} `AUTH_MISSING`   — `AIPOWERED_AUTH_ENDPOINT` not set.
 * @throws {AiPoweredError} `PROVIDER_ERROR` — Payment endpoint returned a non-OK status.
 * @throws {AiPoweredError} `PROVIDER_ERROR` — Network failure reaching the endpoint.
 *
 * Spec: specs/autonomous-payments/spec.md, REQ-AP-01, REQ-AP-02, REQ-AP-07
 */
export async function fundAgentAccount(opts: FundOptions): Promise<FundResult> {
  // requireAuthEndpoint() validates AIPOWERED_AUTH_ENDPOINT (first-use, D1).
  // ZodError propagates unchanged if the var is absent/malformed (REQ-EV-02).
  let endpoint: string;
  try {
    endpoint = requireAuthEndpoint();
  } catch {
    throw new AiPoweredError(
      "AUTH_MISSING",
      "AIPOWERED_AUTH_ENDPOINT is not set or is not a valid HTTPS URL. " +
        "Set it to the FilmBuff platform base URL before calling fundAgentAccount.",
      false,
    );
  }

  const requestBody = {
    stripePaymentMethodId: opts.stripePaymentMethodId,
    creditAmount: opts.creditAmount,
    // Mask the key in logged request bodies (REQ-CI-06); send the raw value to
    // the endpoint for actual authentication.
    agentApiKey: opts.agentApiKey ?? undefined,
    returnPaymentToken: opts.returnPaymentToken ?? false,
  };

  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/payments/x402`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (networkErr) {
    throw new AiPoweredError(
      "PROVIDER_ERROR",
      `Failed to reach payment endpoint at ${endpoint}: ` +
        (networkErr instanceof Error ? networkErr.message : String(networkErr)),
      false,
    );
  }

  if (!res.ok) {
    const maskedKey = opts.agentApiKey ? ` (key: ${maskApiKey(opts.agentApiKey)})` : "";
    throw new AiPoweredError(
      "PROVIDER_ERROR",
      `Payment failed${maskedKey}: HTTP ${res.status} ${res.statusText} from ${endpoint}/api/payments/x402.`,
      false,
    );
  }

  return res.json() as Promise<FundResult>;
}
