/**
 * @file src/ai-powered/auth.ts
 *
 * Three-tier credential resolution for the ai-powered filmbuff agent integration.
 *
 * Priority order (D1 from design.md):
 *   1. `agentToken`  — OAuth2 Bearer JWT, validated locally via RS256 (jsonwebtoken)
 *   2. `agentApiKey` — Raw API key, verified via POST to AIPOWERED_AUTH_ENDPOINT
 *   3. `AIPOWERED_API_KEY` env var — Global service-level fallback
 *
 * All public functions throw only `AiPoweredError` instances (REQ-SE-01).
 * Credential values are NEVER written to disk, logs, or status files (REQ-CI-06).
 *
 * JWT validation uses the `jsonwebtoken` package (D2 — local RS256, clockTolerance: 30 s).
 * AC-01 (valid token succeeds), AC-02 (expired/malformed throws AUTH_INVALID_TOKEN).
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/caller-identity/spec.md
 *       openspec/changes/filmbuff-ai-powered/design.md  (D1, D2, D3)
 */

import jwt from "jsonwebtoken";
import { AiPoweredError } from "./errors.js";
import type { SingleShotOptions } from "./single-shot.js";
import { requireAuthEndpoint, requireJwtPublicKey } from "./env.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resolved credential returned by `resolveCredential()`. */
export interface ResolvedCredential {
  /** How the credential was supplied. */
  type: "jwt" | "apikey" | "global";
  /**
   * Agent identifier extracted from the credential.
   *
   * - `jwt`    → `payload.sub` (or `opts.agentId` if `sub` is absent)
   * - `apikey` → value returned by the verify-key endpoint
   * - `global` → the string literal `"service"`
   */
  agentId: string | undefined;
  /**
   * Permission scopes granted to this credential.
   *
   * - `jwt`    → empty array (scope enforcement is a future Story)
   * - `apikey` → scopes returned by the verify-key endpoint
   * - `global` → empty array
   */
  scopes: string[];
}

// JwtPayload is provided by @types/jsonwebtoken (jwt.JwtPayload).
// The local interface definition was removed when the WebCrypto path was
// replaced by jwt.verify() in bd-4v13.

/** In-memory cache entry for API key verify responses (D3 — 60-second TTL). */
interface KeyCacheEntry {
  agentId: string;
  scopes: string[];
  /** Absolute epoch-ms timestamp after which this entry must be discarded. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Module-level API key cache (D3)
// ---------------------------------------------------------------------------

/**
 * Module-level Map for 60-second API key verification cache.
 *
 * Keys are raw `agentApiKey` values stored in memory only — never on disk.
 * Exported with underscore prefix for test-only cache reset; do NOT call in
 * production code paths.
 */
export const _keyCache = new Map<string, KeyCacheEntry>();

/**
 * Clears the key cache.  For use in unit tests only (T-FB-03).
 * @internal
 */
export function _clearKeyCache(): void {
  _keyCache.clear();
}

// ---------------------------------------------------------------------------
// JWT validation constants (D2)
// ---------------------------------------------------------------------------

/**
 * Clock tolerance applied to `exp` / `nbf` checks by `jsonwebtoken`.
 * Spec D2: allow 30-second clock skew between issuer and verifier.
 */
const CLOCK_TOLERANCE_S = 30;

// ---------------------------------------------------------------------------
// maskApiKey — for safe representation in error messages (REQ-CI-06)
// ---------------------------------------------------------------------------

/**
 * Returns a masked representation of a credential key (API key or token prefix)
 * suitable for error messages and logs.
 *
 * **Spec (bd-r624 / REQ-CI-06)**: redacts ALL characters except the last 4.
 * This ensures the raw value never appears in any log line, error message, or
 * file written to disk, while still providing a recognisable suffix for
 * operator debugging.
 *
 * Examples:
 * - `"fb_sk_live_abc123xyz"` → `"***...xyz "` (last 4 chars visible)
 * - `"short"`                → `"***"` (key too short to show a suffix)
 *
 * The full raw value is NEVER present in the return string.  REQ-CI-06.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 4) return "***";
  return `***...${key.slice(-4)}`;
}

/**
 * Returns a masked representation of a JWT token (Bearer token).
 *
 * Shows only the last 4 characters of the token to assist debugging without
 * leaking any structurally meaningful segments (header, payload, signature).
 * The raw token value is NEVER included in the return string.  REQ-CI-06.
 *
 * @example `"eyJ...sig"` → `"***...g"` (last 4 chars visible)
 */
export function maskToken(token: string): string {
  if (token.length <= 4) return "***";
  return `***...${token.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// resolveCredential()  (Story 1 / D1)
// ---------------------------------------------------------------------------

/**
 * Resolves exactly one credential from the supplied `SingleShotOptions`, in
 * three-tier priority order.
 *
 * | Priority | Source               | Validation                                |
 * |----------|----------------------|-------------------------------------------|
 * | 1        | `opts.agentToken`    | RS256 JWT via jsonwebtoken (synchronous); AIPOWERED_JWT_PUBLIC_KEY |
 * | 2        | `opts.agentApiKey`   | POST verify-key + 60-second cache; AIPOWERED_AUTH_ENDPOINT |
 * | 3        | `AIPOWERED_API_KEY`  | Global env-var fallback; no remote call   |
 *
 * @throws {AiPoweredError} `AUTH_INVALID_TOKEN` — JWT is invalid or expired.
 * @throws {AiPoweredError} `AUTH_INVALID_KEY`   — API key not recognized by the verify endpoint.
 * @throws {AiPoweredError} `AUTH_MISSING`        — No credential is present.
 * @throws {ZodError}                             — Env var is present but malformed (D1 first-use).
 *
 * REQ-CI-01 / REQ-CI-02 / REQ-CI-03 / REQ-CI-04 / REQ-CI-06
 */
export async function resolveCredential(opts: SingleShotOptions): Promise<ResolvedCredential> {
  // ── Priority 1: agentToken (JWT, RS256 via jsonwebtoken) ─────────────────
  if (opts.agentToken !== undefined) {
    // requireJwtPublicKey() validates AIPOWERED_JWT_PUBLIC_KEY (first-use, D1).
    // ZodError propagates unchanged if the var is absent/malformed (REQ-EV-01).
    const publicKey = requireJwtPublicKey();

    let payload: jwt.JwtPayload;
    try {
      // jwt.verify() is synchronous for the 3-argument form (no callback).
      // It throws TokenExpiredError (sub-class of JsonWebTokenError) for exp violations
      // and JsonWebTokenError for structural / signature failures.
      // clockTolerance accepts seconds; 30 s matches spec D2.
      // The raw agentToken value is NEVER logged here (REQ-CI-06).
      payload = jwt.verify(opts.agentToken, publicKey, {
        algorithms: ["RS256"],
        clockTolerance: CLOCK_TOLERANCE_S,
      }) as jwt.JwtPayload;
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError) {
        // Covers both TokenExpiredError (AC-02) and all other JWT errors (AC-02).
        // Raw token is NOT included in the message (REQ-CI-06).
        throw new AiPoweredError(
          "AUTH_INVALID_TOKEN",
          err instanceof jwt.TokenExpiredError
            ? "JWT has expired. Please refresh your agent token and retry."
            : "JWT is invalid or structurally malformed. " +
                "Ensure the token is RS256-signed and AIPOWERED_JWT_PUBLIC_KEY matches the issuer.",
          false,
        );
      }
      // Unexpected non-JWT error (e.g. PEM parse failure) — re-throw as AUTH_INVALID_TOKEN
      // to maintain the invariant that no plain Error escapes (REQ-SE-01).
      throw new AiPoweredError(
        "AUTH_INVALID_TOKEN",
        "Unexpected error during JWT verification: " +
          (err instanceof Error ? err.message : String(err)),
        false,
      );
    }

    // AC-01: valid token → extract sub as agentId; no network call made.
    return {
      type: "jwt",
      agentId:
        typeof payload.sub === "string" && payload.sub.length > 0
          ? payload.sub
          : (opts.agentId ?? undefined),
      scopes: [],
    };
  }

  // ── Priority 2: agentApiKey (verify-key endpoint with 60-second cache) ──
  if (opts.agentApiKey !== undefined) {
    // requireAuthEndpoint() validates AIPOWERED_AUTH_ENDPOINT (first-use, D1).
    // ZodError propagates unchanged if the var is absent/malformed (REQ-EV-02).
    const endpoint = requireAuthEndpoint();

    // Check 60-second cache first (D3 — REQ-CI-03).
    const cached = _keyCache.get(opts.agentApiKey);
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return { type: "apikey", agentId: cached.agentId, scopes: cached.scopes };
    }

    // Cache miss or expired — call the verify-key endpoint.
    let res: Response;
    try {
      res = await fetch(`${endpoint}/api/auth/verify-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the raw key to the endpoint; it is NOT logged here (REQ-CI-06).
        body: JSON.stringify({ key: opts.agentApiKey }),
      });
    } catch (networkErr) {
      throw new AiPoweredError(
        "AUTH_INVALID_KEY",
        `Failed to reach auth endpoint at ${endpoint}: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
        false,
      );
    }

    if (!res.ok) {
      // Mask key in error message — never expose raw key (REQ-CI-06).
      throw new AiPoweredError(
        "AUTH_INVALID_KEY",
        `Agent API key ${maskApiKey(opts.agentApiKey)} was not recognized by the auth endpoint (HTTP ${res.status}).`,
        false,
      );
    }

    const data = (await res.json()) as { agentId: string; scopes?: string[] };
    const entry: KeyCacheEntry = {
      agentId: data.agentId,
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
      expiresAt: Date.now() + 60_000, // 60-second TTL (REQ-CI-03)
    };
    _keyCache.set(opts.agentApiKey, entry);

    return { type: "apikey", agentId: entry.agentId, scopes: entry.scopes };
  }

  // ── Priority 3: AIPOWERED_API_KEY global fallback ────────────────────────
  const globalKey = process.env["AIPOWERED_API_KEY"];
  if (globalKey !== undefined && globalKey.length > 0) {
    return { type: "global", agentId: "service", scopes: [] };
  }

  // ── No credential found (REQ-CI-04) ──────────────────────────────────────
  throw new AiPoweredError(
    "AUTH_MISSING",
    "No agent credential was supplied (agentToken / agentApiKey) and " +
      "AIPOWERED_API_KEY is not set in the environment. " +
      "Provide at least one credential to authenticate this call.",
    false,
  );
}
