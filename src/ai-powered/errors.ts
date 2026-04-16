/**
 * @file src/ai-powered/errors.ts
 *
 * Structured error types for the ai-powered filmbuff agent integration.
 *
 * Every public function in single-shot.ts throws only `AiPoweredError` instances
 * carrying a stable, machine-readable `AgentErrorCode` that autonomous agents can
 * branch on without string-parsing. Plain `Error` throws are prohibited in all
 * public-facing functions.
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/structured-errors/spec.md
 */

// ---------------------------------------------------------------------------
// AgentErrorCode discriminated union
// ---------------------------------------------------------------------------

/**
 * Machine-readable error codes for all public ai-powered agent functions.
 *
 * Invariants:
 * - `RATE_LIMITED` and `PROVIDER_TIMEOUT` are retryable (`retryable: true`).
 * - All `AUTH_*` codes, `PROVIDER_CONTENT_POLICY`, `INSUFFICIENT_CREDITS`,
 *   `AGENT_CREDIT_CAP_EXCEEDED`, `NOT_FOUND`, and `IDEMPOTENCY_CONFLICT`
 *   are not retryable (`retryable: false`).
 */
export type AgentErrorCode =
  /** No credential of any kind is available. */
  | "AUTH_MISSING"
  /** JWT signature invalid, expired, or structurally malformed. */
  | "AUTH_INVALID_TOKEN"
  /** API key not recognized by the verify endpoint. */
  | "AUTH_INVALID_KEY"
  /** Credential is valid but lacks the required permission scope. */
  | "AUTH_INSUFFICIENT_SCOPE"
  /** Agent credit balance is zero or below the required threshold. */
  | "INSUFFICIENT_CREDITS"
  /** Agent hit its configured monthly_credit_cap. */
  | "AGENT_CREDIT_CAP_EXCEEDED"
  /** Underlying video provider returned a non-retryable error. */
  | "PROVIDER_ERROR"
  /** Provider refused the request on content-policy grounds. */
  | "PROVIDER_CONTENT_POLICY"
  /** Provider did not respond within the configured timeoutMs window. */
  | "PROVIDER_TIMEOUT"
  /** Specified shot ID, job ID, or resource does not exist. */
  | "NOT_FOUND"
  /** Same idempotencyKey submitted with different parameters. */
  | "IDEMPOTENCY_CONFLICT"
  /** Agent credential exceeded request-rate limits. */
  | "RATE_LIMITED";

// ---------------------------------------------------------------------------
// AiPoweredError class
// ---------------------------------------------------------------------------

/**
 * Typed error thrown by all public ai-powered agent functions.
 *
 * Key invariants (REQ-SE-01 through REQ-SE-04):
 * - `err instanceof Error` is always `true` (subclass of Error).
 * - `err instanceof AiPoweredError` is always `true`.
 * - `retryable` is `true` only for `RATE_LIMITED` and `PROVIDER_TIMEOUT`.
 * - `retryAfterMs` is populated for `RATE_LIMITED` when the upstream provides
 *   a `Retry-After` header; for `PROVIDER_TIMEOUT` it reflects the configured
 *   `timeoutMs`.
 *
 * @example
 * ```typescript
 * try {
 *   await generateSingleShot({ ... });
 * } catch (err) {
 *   if (err instanceof AiPoweredError && err.code === 'RATE_LIMITED') {
 *     await new Promise(r => setTimeout(r, err.retryAfterMs ?? 5000));
 *     // retry...
 *   }
 * }
 * ```
 */
export class AiPoweredError extends Error {
  constructor(
    /** Machine-readable error classification. */
    public readonly code: AgentErrorCode,
    message: string,
    /** Whether the caller may safely retry the same request. */
    public readonly retryable: boolean,
    /**
     * Milliseconds to wait before retrying.
     * Populated for `RATE_LIMITED` (from `Retry-After` header) and
     * `PROVIDER_TIMEOUT` (from configured timeoutMs).
     */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AiPoweredError";
    // Restore prototype chain in transpiled environments (e.g. older Babel targets).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
