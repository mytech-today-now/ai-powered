/**
 * @file src/ai-powered/env.ts
 *
 * Environment variable validation for the ai-powered filmbuff agent integration.
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/env-validation/spec.md
 *
 * ## Validation Timing (D1 / Known Deviation)
 *
 * Validation runs at **first use** of each variable — NOT at bare module import.
 * This preserves compatibility with test setups that configure env vars after
 * `import`/`require()` statements.  Each exported accessor function validates
 * its own variable on every call, throwing a descriptive ZodError on failure.
 *
 * | Accessor                  | Validates                    | When called                     |
 * |---------------------------|------------------------------|---------------------------------|
 * | `requireAuthEndpoint()`   | AIPOWERED_AUTH_ENDPOINT      | agentApiKey path, fundAgent…()  |
 * | `requireJwtPublicKey()`   | AIPOWERED_JWT_PUBLIC_KEY     | agentToken path                 |
 * | `optionalRedisUrl()`      | AIPOWERED_REDIS_URL          | idempotency check (Story 6)     |
 * | `optionalWebhookSecret()` | AIPOWERED_WEBHOOK_SECRET     | webhook delivery (Story 5)      |
 * | `optionalMcpToken()`      | AIPOWERED_MCP_TOKEN          | HTTP MCP transport (Story 4)    |
 * | `validateEnv()`           | all 6 variables              | testing / explicit validation   |
 *
 * Requirements:
 *   REQ-EV-01 — Malformed AIPOWERED_JWT_PUBLIC_KEY raises ZodError at call time, not import.
 *   REQ-EV-02 — Non-HTTPS AIPOWERED_AUTH_ENDPOINT raises ZodError with variable name + format.
 *   REQ-EV-04 — Absent AIPOWERED_REDIS_URL does NOT throw; idempotency is silently disabled.
 *   REQ-EV-05 — ZodError messages include variable name, expected format, and received value.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Per-variable Zod schemas (REQ-EV-05 — descriptive messages)
// ---------------------------------------------------------------------------

const authEndpointSchema = z
  .string({
    required_error: "AIPOWERED_AUTH_ENDPOINT is required when agent key/JWT auth is used.",
  })
  .url("AIPOWERED_AUTH_ENDPOINT must be a valid URL.")
  .startsWith(
    "https://",
    "AIPOWERED_AUTH_ENDPOINT must be a valid HTTPS URL. Expected: string matching /^https:\\/\\/.+/",
  );

const jwtPublicKeySchema = z
  .string({
    required_error:
      "AIPOWERED_JWT_PUBLIC_KEY is required when agentToken authentication is configured. " +
      "Expected: RS256 PEM public key string beginning with '-----BEGIN PUBLIC KEY-----'",
  })
  .startsWith(
    "-----BEGIN PUBLIC KEY-----",
    "AIPOWERED_JWT_PUBLIC_KEY must be an RS256 PEM public key beginning with '-----BEGIN PUBLIC KEY-----'.",
  );

const redisUrlSchema = z
  .string()
  .url("AIPOWERED_REDIS_URL must be a valid URL (e.g. redis://localhost:6379).")
  .optional();

const webhookSecretSchema = z
  .string()
  .min(1, "AIPOWERED_WEBHOOK_SECRET must be a non-empty string.")
  .optional();

const mcpTokenSchema = z
  .string()
  .min(1, "AIPOWERED_MCP_TOKEN must be a non-empty string.")
  .optional();

const apiKeySchema = z.string().min(1, "AIPOWERED_API_KEY must be a non-empty string.").optional();

// ---------------------------------------------------------------------------
// Full schema (used by validateEnv() for bulk validation in tests)
// ---------------------------------------------------------------------------

/** Zod schema covering all 6 ai-powered environment variables. */
export const envSchema = z.object({
  AIPOWERED_API_KEY: apiKeySchema,
  AIPOWERED_AUTH_ENDPOINT: authEndpointSchema.optional(),
  AIPOWERED_JWT_PUBLIC_KEY: jwtPublicKeySchema.optional(),
  AIPOWERED_REDIS_URL: redisUrlSchema,
  AIPOWERED_WEBHOOK_SECRET: webhookSecretSchema,
  AIPOWERED_MCP_TOKEN: mcpTokenSchema,
});

/** Parsed type of all 6 env variables. */
export type EnvConfig = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// validateEnv() — bulk validation (for testing / explicit startup checks)
// ---------------------------------------------------------------------------

/**
 * Validates all six ai-powered environment variables against their Zod schemas.
 *
 * **This is NOT called at module import time** (see D1).  Call it explicitly
 * in integration tests or startup health-checks.  Per-variable paths in
 * production code use the individual accessor functions below.
 *
 * @throws {z.ZodError} If any present variable violates its format constraint.
 */
export function validateEnv(): EnvConfig {
  return envSchema.parse({
    AIPOWERED_API_KEY: process.env["AIPOWERED_API_KEY"],
    AIPOWERED_AUTH_ENDPOINT: process.env["AIPOWERED_AUTH_ENDPOINT"],
    AIPOWERED_JWT_PUBLIC_KEY: process.env["AIPOWERED_JWT_PUBLIC_KEY"],
    AIPOWERED_REDIS_URL: process.env["AIPOWERED_REDIS_URL"],
    AIPOWERED_WEBHOOK_SECRET: process.env["AIPOWERED_WEBHOOK_SECRET"],
    AIPOWERED_MCP_TOKEN: process.env["AIPOWERED_MCP_TOKEN"],
  });
}

// ---------------------------------------------------------------------------
// Per-variable accessor functions (first-use validation, D1)
// ---------------------------------------------------------------------------

/**
 * Returns the validated `AIPOWERED_AUTH_ENDPOINT` value.
 *
 * Called at first use of `agentApiKey` authentication and inside
 * `fundAgentAccount()`.  Throws a `ZodError` if the variable is absent or
 * not a valid HTTPS URL (REQ-EV-02).
 */
export function requireAuthEndpoint(): string {
  return authEndpointSchema.parse(process.env["AIPOWERED_AUTH_ENDPOINT"]);
}

/**
 * Returns the validated `AIPOWERED_JWT_PUBLIC_KEY` PEM string.
 *
 * Called at first use of `agentToken` authentication.  Throws a `ZodError` if
 * the variable is absent or does not begin with the expected PEM header (REQ-EV-01).
 */
export function requireJwtPublicKey(): string {
  return jwtPublicKeySchema.parse(process.env["AIPOWERED_JWT_PUBLIC_KEY"]);
}

/**
 * Returns the `AIPOWERED_REDIS_URL` value if set and valid, or `undefined`
 * if unset (idempotency is silently disabled, REQ-EV-04).
 *
 * Throws a `ZodError` only when the variable IS set but contains an invalid URL.
 */
export function optionalRedisUrl(): string | undefined {
  const raw = process.env["AIPOWERED_REDIS_URL"];
  if (raw === undefined || raw === "") return undefined;
  return redisUrlSchema.parse(raw);
}

/**
 * Returns the `AIPOWERED_WEBHOOK_SECRET` value if set, or `undefined`.
 * Throws a `ZodError` only when the variable is set but empty.
 */
export function optionalWebhookSecret(): string | undefined {
  const raw = process.env["AIPOWERED_WEBHOOK_SECRET"];
  if (raw === undefined) return undefined;
  return webhookSecretSchema.parse(raw);
}

/**
 * Returns the `AIPOWERED_MCP_TOKEN` value if set, or `undefined`.
 * Throws a `ZodError` only when the variable is set but empty.
 */
export function optionalMcpToken(): string | undefined {
  const raw = process.env["AIPOWERED_MCP_TOKEN"];
  if (raw === undefined) return undefined;
  return mcpTokenSchema.parse(raw);
}
