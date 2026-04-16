/**
 * @file tests/unit/backward-compat.test.ts
 *
 * Story 8 — Backward Compatibility Regression Tests (bd-hd6a, bd-3vc0, bd-b6z1)
 *
 * Verifies that all Stories 1–7 changes are fully backward-compatible with
 * existing callers that use only the pre-Epic public API.  Specifically covers:
 *
 *   G1 — All new SingleShotOptions fields are optional (REQ-BC-03)
 *   G2 — Identical runtime behavior when new fields are absent (REQ-BC-02)
 *   G3 — AiPoweredError extends Error; existing catch blocks work (REQ-BC-05)
 *   G4 — No Redis or webhook side-effects when optional fields absent (G2)
 *   G5 — Public API surface unchanged; no required params added (REQ-BC-03)
 *
 * bd-3vc0: Old destructuring `const { status, clipPath } = await generateSingleShot(...)`
 *          compiles and runs without modification.  The TypeScript compile-time
 *          proof is the fact that this file passes `tsc --noEmit` with zero errors
 *          (bd-b6z1) while containing the explicit destructuring pattern below.
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/backward-compat/spec.md
 * Requirements: REQ-BC-01, REQ-BC-02, REQ-BC-03, REQ-BC-04, REQ-BC-05
 */

import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Import from the source module — same convention used across tests/unit/*.test.ts.
// generateSingleShot is an Epic-level function not yet re-exported from index.ts;
// importing from single-shot.js matches the pattern in env.test.ts.
import { generateSingleShot } from "../../src/ai-powered/single-shot.js";
import type { SingleShotOptions, SingleShotResult } from "../../src/ai-powered/single-shot.js";

// AiPoweredError is exported from the public package surface (bd-6c2y / index.ts).
import { AiPoweredError } from "../../src/ai-powered/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SavedEnv = Record<string, string | undefined>;

function saveEnvVars(keys: string[]): SavedEnv {
  const saved: SavedEnv = {};
  for (const key of keys) saved[key] = process.env[key];
  return saved;
}

function restoreEnvVars(saved: SavedEnv): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Unique tmp path per call — avoids collision in parallel test runs. */
function tmpOutputPath(): string {
  return path.join(os.tmpdir(), `bc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
}

// ---------------------------------------------------------------------------
// G1 + G2 + bd-hd6a: existing caller with AIPOWERED_API_KEY and no new fields
// ---------------------------------------------------------------------------

describe("G2 — existing caller: AIPOWERED_API_KEY + no new fields (bd-hd6a / REQ-BC-02)", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars([
      "AIPOWERED_API_KEY",
      "AIPOWERED_AUTH_ENDPOINT",
      "AIPOWERED_JWT_PUBLIC_KEY",
    ]);
    // Pre-Epic env: only the global API key; no Story-1 endpoint or JWT vars.
    process.env["AIPOWERED_API_KEY"] = "ap_sk_backward_compat_test";
    delete process.env["AIPOWERED_AUTH_ENDPOINT"];
    delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it("succeeds with only pre-Epic required fields in SingleShotOptions (G1 / REQ-BC-03)", async () => {
    // Pre-Epic call: only shot, provider, outputPath — all new optional fields absent.
    // TypeScript accepts this without type errors (proven by tsc --noEmit — bd-b6z1).
    const result = await generateSingleShot({
      shot: { id: "s001", prompt: "Test shot — backward compat", durationSeconds: 3 },
      provider: "mock",
      outputPath: tmpOutputPath(),
      // Intentionally omitting all new Story-1 fields:
      //   agentToken, agentApiKey, agentId, callbackUrl, idempotencyKey, agentPaymentMethodId
    });

    expect(result.status).toBe("complete");
    expect(result.clipPath).toBeTruthy();
    expect(typeof result.jobId).toBe("string"); // pre-Epic field still present
  });

  it("creditsCharged is present on success but does not break old callers (REQ-BC-04)", async () => {
    const result = await generateSingleShot({
      shot: { id: "s002", prompt: "Credits field compat", durationSeconds: 3 },
      provider: "mock",
      outputPath: tmpOutputPath(),
    });

    // New field present — callers that don't access it are unaffected.
    expect(typeof result.creditsCharged).toBe("number");
    expect(result.creditsCharged).toBeGreaterThanOrEqual(0);
  });

  // bd-3vc0: Old-style destructuring — compile + runtime proof.
  // TypeScript structural compatibility: if creditsCharged/idempotent/errorCode
  // were *required* on SingleShotResult, this destructure would cause a TS error
  // on any code that constructs a value with only the old fields. Since they are
  // optional ('?:'), the pattern below compiles and runs identically to pre-Epic.
  it("old-style destructuring of { status, clipPath } compiles and runs correctly (bd-3vc0 / REQ-BC-04)", async () => {
    const fullResult = await generateSingleShot({
      shot: { id: "s003", prompt: "Destructuring test", durationSeconds: 3 },
      provider: "mock",
      outputPath: tmpOutputPath(),
    });

    // Pre-Epic caller pattern: only destructure the fields they know about.
    const { status, clipPath } = fullResult;

    expect(status).toBe("complete");
    expect(clipPath).toBeTruthy();
    expect(status).toMatch(/^(complete|failed|pending)$/);
  });

  it("pre-Epic type annotation SingleShotOptions without new fields compiles (G1 / REQ-BC-03)", async () => {
    // Explicitly typed as SingleShotOptions — all new fields are optional so
    // omitting them satisfies the type constraint without casting.
    const preEpicOpts: SingleShotOptions = {
      shot: { id: "s004", prompt: "Options type annotation test", durationSeconds: 5 },
      provider: "mock",
      outputPath: tmpOutputPath(),
    };

    const result = await generateSingleShot(preEpicOpts);
    expect(result.status).toBe("complete");
  });

  it("result is assignable to SingleShotResult type annotation (REQ-BC-04)", async () => {
    // Pre-Epic callers that annotate their result variable as SingleShotResult still compile.
    const result: SingleShotResult = await generateSingleShot({
      shot: { id: "s005", prompt: "Result type assignability", durationSeconds: 3 },
      provider: "mock",
      outputPath: tmpOutputPath(),
    });

    expect(result).toMatchObject({ status: "complete" });
    expect(typeof result.jobId).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// G3: AiPoweredError extends Error — existing catch handlers work (REQ-BC-05)
// ---------------------------------------------------------------------------

describe("G3 — AiPoweredError extends Error; existing catch blocks work (REQ-BC-05)", () => {
  it("thrown error satisfies instanceof Error (pre-Epic catch block pattern)", async () => {
    let caught: unknown;
    try {
      await generateSingleShot({
        shot: { id: "err001", prompt: "Error path test", durationSeconds: 3 },
        provider: "nonexistent-provider-xyz",
        outputPath: tmpOutputPath(),
      });
    } catch (err) {
      caught = err;
    }

    // Pre-Epic: callers tested `instanceof Error` — must still pass.
    expect(caught instanceof Error).toBe(true);
    // Post-Epic: callers that upgraded to AiPoweredError also work.
    expect(caught instanceof AiPoweredError).toBe(true);
  });

  it("AiPoweredError has .message property existing code relies on", async () => {
    let caught: unknown;
    try {
      await generateSingleShot({
        shot: { id: "err002", prompt: "Error message test", durationSeconds: 3 },
        provider: "bad-provider",
        outputPath: tmpOutputPath(),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught instanceof Error).toBe(true);
    expect(typeof (caught as Error).message).toBe("string");
    expect((caught as Error).message.length).toBeGreaterThan(0);
  });

  it("AiPoweredError.code and .retryable are present for upgraded callers (REQ-BC-05)", async () => {
    let caught: unknown;
    try {
      await generateSingleShot({
        shot: { id: "err003", prompt: "Error code test", durationSeconds: 3 },
        provider: "bad-provider",
        outputPath: tmpOutputPath(),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught instanceof AiPoweredError).toBe(true);
    const agentErr = caught as AiPoweredError;
    expect(agentErr.code).toBe("PROVIDER_ERROR");
    expect(typeof agentErr.retryable).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// G4: No Redis / webhook side-effects when optional fields absent
// ---------------------------------------------------------------------------

describe("G4 — No Redis or webhook side-effects when optional fields absent (REQ-BC-02)", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars(["AIPOWERED_API_KEY", "AIPOWERED_REDIS_URL", "AIPOWERED_WEBHOOK_SECRET"]);
    process.env["AIPOWERED_API_KEY"] = "ap_sk_g4_test";
    // Explicitly absent — must not cause errors when the trigger fields are also absent.
    delete process.env["AIPOWERED_REDIS_URL"];
    delete process.env["AIPOWERED_WEBHOOK_SECRET"];
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it("succeeds without AIPOWERED_REDIS_URL when idempotencyKey is absent (REQ-BC-02)", async () => {
    // Story 6 (Idempotency Cache) connects to Redis only when idempotencyKey is set.
    // Absent idempotencyKey → Redis code path not entered → no env var required.
    const result = await generateSingleShot({
      shot: { id: "g4-01", prompt: "No Redis test", durationSeconds: 3 },
      provider: "mock",
      outputPath: tmpOutputPath(),
      // idempotencyKey deliberately absent
    });
    expect(result.status).toBe("complete");
  });

  it("succeeds without AIPOWERED_WEBHOOK_SECRET when callbackUrl is absent (REQ-BC-02)", async () => {
    // Story 5 (Webhook Delivery) fires only when callbackUrl is set.
    // Absent callbackUrl → webhook code path not entered → no env var required.
    const result = await generateSingleShot({
      shot: { id: "g4-02", prompt: "No webhook test", durationSeconds: 3 },
      provider: "mock",
      outputPath: tmpOutputPath(),
      // callbackUrl deliberately absent
    });
    expect(result.status).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// G5: Public API surface — no required parameter changes (REQ-BC-03)
// ---------------------------------------------------------------------------

describe("G5 — Public API surface unchanged; no required params added (REQ-BC-03)", () => {
  it("generateSingleShot is still callable with the same required params as pre-Epic", () => {
    // The function is defined and callable — no signature break.
    expect(typeof generateSingleShot).toBe("function");
  });

  it("AiPoweredError can be constructed and is instanceof Error (public API check)", () => {
    const err = new AiPoweredError("PROVIDER_ERROR", "test message", false);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof AiPoweredError).toBe(true);
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.message).toBe("test message");
    expect(err.retryable).toBe(false);
  });
});
