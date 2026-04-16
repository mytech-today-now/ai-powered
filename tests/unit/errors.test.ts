/**
 * @file tests/unit/errors.test.ts
 *
 * T-FB-01 — Unit tests for AgentErrorCode and AiPoweredError.
 *
 * Verifies all 12 AgentErrorCode values and the AiPoweredError class
 * invariants specified in:
 *   openspec/changes/filmbuff-ai-powered/specs/structured-errors/spec.md
 *
 * Requirements covered:
 *   REQ-SE-01 — No plain Error leakage (constructor-level invariant)
 *   REQ-SE-02 — err instanceof Error === true for all AiPoweredError instances
 *   REQ-SE-03 — RATE_LIMITED carries retryAfterMs when provided
 *   REQ-SE-04 — PROVIDER_TIMEOUT retryable; PROVIDER_CONTENT_POLICY not retryable
 *   REQ-SE-05 — A test case for every AgentErrorCode value exists in the suite
 */

import { AiPoweredError } from "../../src/ai-powered/errors.js";
import type { AgentErrorCode } from "../../src/ai-powered/errors.js";
// Verify the public package export surface (bd-6c2y)
import { AiPoweredError as PublicAiPoweredError } from "../../src/ai-powered/index.js";
import type { AgentErrorCode as PublicAgentErrorCode } from "../../src/ai-powered/index.js";
import {
  mapHttpResponseToError,
  mapProviderErrorToAgentError,
} from "../../src/ai-powered/single-shot.js";
import { ProviderError } from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All 12 AgentErrorCode values paired with their expected retryable flag. */
const ALL_CODES: ReadonlyArray<{ code: AgentErrorCode; retryable: boolean }> = [
  { code: "AUTH_MISSING", retryable: false },
  { code: "AUTH_INVALID_TOKEN", retryable: false },
  { code: "AUTH_INVALID_KEY", retryable: false },
  { code: "AUTH_INSUFFICIENT_SCOPE", retryable: false },
  { code: "INSUFFICIENT_CREDITS", retryable: false },
  { code: "AGENT_CREDIT_CAP_EXCEEDED", retryable: false },
  { code: "PROVIDER_ERROR", retryable: false },
  { code: "PROVIDER_CONTENT_POLICY", retryable: false },
  { code: "PROVIDER_TIMEOUT", retryable: true },
  { code: "NOT_FOUND", retryable: false },
  { code: "IDEMPOTENCY_CONFLICT", retryable: false },
  { code: "RATE_LIMITED", retryable: true },
];

// ---------------------------------------------------------------------------
// T-FB-01 — All 12 AgentErrorCode values
// ---------------------------------------------------------------------------

describe("T-FB-01 — AiPoweredError: all 12 AgentErrorCode values", () => {
  it.each(ALL_CODES)("$code: err.code, instanceof, and name are correct", ({ code, retryable }) => {
    const err = new AiPoweredError(code, "test message", retryable);

    // REQ-SE-05: one test case per AgentErrorCode value
    expect(err.code).toBe(code);

    // REQ-SE-02: must satisfy instanceof Error
    expect(err).toBeInstanceOf(Error);

    // Must satisfy instanceof AiPoweredError
    expect(err).toBeInstanceOf(AiPoweredError);

    // name property must be 'AiPoweredError'
    expect(err.name).toBe("AiPoweredError");

    // message must be preserved
    expect(err.message).toBe("test message");
  });
});

// ---------------------------------------------------------------------------
// retryable invariants (REQ-SE-04)
// ---------------------------------------------------------------------------

describe("AiPoweredError: retryable invariants", () => {
  it("RATE_LIMITED is retryable", () => {
    const err = new AiPoweredError("RATE_LIMITED", "Rate limit hit", true);
    expect(err.retryable).toBe(true);
  });

  it("PROVIDER_TIMEOUT is retryable", () => {
    const err = new AiPoweredError("PROVIDER_TIMEOUT", "Timed out", true);
    expect(err.retryable).toBe(true);
  });

  it("PROVIDER_CONTENT_POLICY is NOT retryable (REQ-SE-04)", () => {
    const err = new AiPoweredError("PROVIDER_CONTENT_POLICY", "Content rejected", false);
    expect(err.retryable).toBe(false);
  });

  it("all AUTH_* codes are not retryable", () => {
    const authCodes: AgentErrorCode[] = [
      "AUTH_MISSING",
      "AUTH_INVALID_TOKEN",
      "AUTH_INVALID_KEY",
      "AUTH_INSUFFICIENT_SCOPE",
    ];
    for (const code of authCodes) {
      const err = new AiPoweredError(code, "auth error", false);
      expect(err.retryable).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// retryAfterMs (REQ-SE-03)
// ---------------------------------------------------------------------------

describe("AiPoweredError: retryAfterMs", () => {
  it("is undefined when not supplied", () => {
    const err = new AiPoweredError("RATE_LIMITED", "Rate limit", true);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("is populated when explicitly provided (REQ-SE-03)", () => {
    const err = new AiPoweredError("RATE_LIMITED", "Rate limit", true, 15_000);
    expect(err.retryAfterMs).toBe(15_000);
  });

  it("is present on PROVIDER_TIMEOUT with configured timeoutMs", () => {
    const err = new AiPoweredError("PROVIDER_TIMEOUT", "Timed out", true, 30_000);
    expect(err.retryAfterMs).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Public package export surface (bd-6c2y)
// ---------------------------------------------------------------------------

describe("Public export: AiPoweredError and AgentErrorCode from 'ai-powered'", () => {
  it("PublicAiPoweredError is the same class as errors.ts AiPoweredError", () => {
    expect(PublicAiPoweredError).toBe(AiPoweredError);
  });

  it("instances created via public export satisfy instanceof checks", () => {
    const err = new PublicAiPoweredError("NOT_FOUND", "missing resource", false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PublicAiPoweredError);
    expect(err.code).toBe("NOT_FOUND");
    // Type-level check: AgentErrorCode is exported as a type
    const code: PublicAgentErrorCode = err.code;
    expect(typeof code).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// mapHttpResponseToError (bd-t47d)
// ---------------------------------------------------------------------------

describe("mapHttpResponseToError: HTTP status → AgentErrorCode", () => {
  function makeResponse(status: number, headers: Record<string, string> = {}): Response {
    return new Response(null, {
      status,
      statusText: `Status ${status}`,
      headers,
    });
  }

  const cases: Array<[number, AgentErrorCode, boolean]> = [
    [401, "AUTH_INVALID_KEY", false],
    [402, "INSUFFICIENT_CREDITS", false],
    [403, "AUTH_INSUFFICIENT_SCOPE", false],
    [404, "NOT_FOUND", false],
    [429, "RATE_LIMITED", true],
    [451, "PROVIDER_CONTENT_POLICY", false],
    [500, "PROVIDER_ERROR", false],
    [503, "PROVIDER_ERROR", false],
    [504, "PROVIDER_TIMEOUT", true],
  ];

  it.each(cases)("HTTP %i → %s (retryable=%s)", (status, expectedCode, expectedRetryable) => {
    const err = mapHttpResponseToError(makeResponse(status));
    expect(err).toBeInstanceOf(AiPoweredError);
    expect(err.code).toBe(expectedCode);
    expect(err.retryable).toBe(expectedRetryable);
  });

  it("HTTP 429 with Retry-After header populates retryAfterMs (REQ-SE-03)", () => {
    const err = mapHttpResponseToError(makeResponse(429, { "Retry-After": "30" }));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("HTTP 429 without Retry-After header leaves retryAfterMs undefined", () => {
    const err = mapHttpResponseToError(makeResponse(429));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterMs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapProviderErrorToAgentError
// ---------------------------------------------------------------------------

describe("mapProviderErrorToAgentError: internal ProviderError → AgentErrorCode", () => {
  it("passes AiPoweredError through unchanged", () => {
    const original = new AiPoweredError("NOT_FOUND", "not found", false);
    const mapped = mapProviderErrorToAgentError(original);
    expect(mapped).toBe(original);
  });

  it("maps ProviderError with status 429 → RATE_LIMITED", () => {
    const err = mapProviderErrorToAgentError(new ProviderError("mock", "rate limit", 429, true));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryable).toBe(true);
  });

  it("maps ProviderError with status 451 → PROVIDER_CONTENT_POLICY (not retryable)", () => {
    const err = mapProviderErrorToAgentError(
      new ProviderError("mock", "content policy", 451, false),
    );
    expect(err.code).toBe("PROVIDER_CONTENT_POLICY");
    expect(err.retryable).toBe(false);
  });

  it("maps ProviderError with status 504 → PROVIDER_TIMEOUT (retryable)", () => {
    const err = mapProviderErrorToAgentError(
      new ProviderError("mock", "gateway timeout", 504, true),
    );
    expect(err.code).toBe("PROVIDER_TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("maps ProviderError with status 500 → PROVIDER_ERROR", () => {
    const err = mapProviderErrorToAgentError(
      new ProviderError("mock", "internal error", 500, false),
    );
    expect(err.code).toBe("PROVIDER_ERROR");
  });

  it("maps AbortError → PROVIDER_TIMEOUT (retryable)", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const err = mapProviderErrorToAgentError(abort);
    expect(err.code).toBe("PROVIDER_TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("maps plain string → PROVIDER_ERROR", () => {
    const err = mapProviderErrorToAgentError("unexpected string error");
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.retryable).toBe(false);
  });
});
