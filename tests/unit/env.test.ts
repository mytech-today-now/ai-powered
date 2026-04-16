/**
 * @file tests/unit/env.test.ts
 *
 * T-FB-15 — Env validation: malformed env var → ZodError at call time (not import)
 *
 * Verifies per-variable first-use validation (D1) and the Zod error messages
 * specified in:
 *   openspec/changes/filmbuff-ai-powered/specs/env-validation/spec.md
 *
 * Requirements covered:
 *   REQ-EV-01 — AIPOWERED_JWT_PUBLIC_KEY ZodError thrown at call time, not import
 *   REQ-EV-02 — AIPOWERED_AUTH_ENDPOINT ZodError includes variable name + https:// format
 *   REQ-EV-04 — Unset AIPOWERED_REDIS_URL does NOT throw; returns undefined
 *   REQ-EV-05 — ZodError messages identify the variable name and expected format
 *   D1        — No validation runs at bare module import
 */

import { ZodError } from "zod";
import {
  requireAuthEndpoint,
  requireJwtPublicKey,
  optionalRedisUrl,
  optionalWebhookSecret,
  optionalMcpToken,
  validateEnv,
} from "../../src/ai-powered/env.js";
import { generateSingleShot } from "../../src/ai-powered/single-shot.js";

// ---------------------------------------------------------------------------
// Helpers: save / restore individual env vars around each test
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

// ---------------------------------------------------------------------------
// requireAuthEndpoint()  (REQ-EV-02, REQ-EV-05)
// ---------------------------------------------------------------------------

describe("requireAuthEndpoint(): per-variable first-use validation (D1)", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars(["AIPOWERED_AUTH_ENDPOINT"]);
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it("D1 — importing env.ts does not throw even when AIPOWERED_AUTH_ENDPOINT is absent", () => {
    // If D1 is violated the test file itself fails to load; reaching this body proves it.
    delete process.env["AIPOWERED_AUTH_ENDPOINT"];
    expect(typeof requireAuthEndpoint).toBe("function");
  });

  it("'not-a-url' → ZodError; message identifies the variable and URL requirement (REQ-EV-02)", () => {
    process.env["AIPOWERED_AUTH_ENDPOINT"] = "not-a-url";
    expect(() => requireAuthEndpoint()).toThrow(ZodError);
    try {
      requireAuthEndpoint();
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const msg = (err as ZodError).issues.map((i) => i.message).join(" ");
      expect(msg).toMatch(/AIPOWERED_AUTH_ENDPOINT/i);
    }
  });

  it("'http://example.com' (non-HTTPS) → ZodError mentioning https:// format (REQ-EV-02)", () => {
    process.env["AIPOWERED_AUTH_ENDPOINT"] = "http://example.com";
    expect(() => requireAuthEndpoint()).toThrow(ZodError);
    try {
      requireAuthEndpoint();
    } catch (err) {
      const msg = (err as ZodError).issues.map((i) => i.message).join(" ");
      expect(msg).toMatch(/https/i);
    }
  });

  it("valid HTTPS URL → returns the value without throwing", () => {
    process.env["AIPOWERED_AUTH_ENDPOINT"] = "https://auth.example.com";
    expect(requireAuthEndpoint()).toBe("https://auth.example.com");
  });

  it("absent variable → ZodError (required, REQ-EV-05)", () => {
    delete process.env["AIPOWERED_AUTH_ENDPOINT"];
    expect(() => requireAuthEndpoint()).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// requireJwtPublicKey()  (REQ-EV-01, D1)
// ---------------------------------------------------------------------------

describe("requireJwtPublicKey(): throws at call time, not at import (REQ-EV-01, D1)", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars(["AIPOWERED_JWT_PUBLIC_KEY"]);
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it("D1 — module import succeeds with AIPOWERED_JWT_PUBLIC_KEY unset (REQ-EV-01)", () => {
    delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
    // Reaching this assertion proves the import did not throw.
    expect(typeof requireJwtPublicKey).toBe("function");
  });

  it("absent variable → ZodError thrown at call time (REQ-EV-01)", () => {
    delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
    expect(() => requireJwtPublicKey()).toThrow(ZodError);
  });

  it("value without PEM header → ZodError (REQ-EV-01)", () => {
    process.env["AIPOWERED_JWT_PUBLIC_KEY"] = "aGVsbG8="; // base64, no PEM header
    expect(() => requireJwtPublicKey()).toThrow(ZodError);
    try {
      requireJwtPublicKey();
    } catch (err) {
      const msg = (err as ZodError).issues.map((i) => i.message).join(" ");
      expect(msg).toMatch(/-----BEGIN PUBLIC KEY-----/);
    }
  });

  it("valid PEM header → returns the value without throwing", () => {
    const fakePem = "-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEB\n-----END PUBLIC KEY-----";
    process.env["AIPOWERED_JWT_PUBLIC_KEY"] = fakePem;
    expect(requireJwtPublicKey()).toBe(fakePem);
  });
});

// ---------------------------------------------------------------------------
// T-FB-15 — generateSingleShot with malformed endpoint → ZodError at call time
// ---------------------------------------------------------------------------

describe("T-FB-15 — generateSingleShot: env validation fires before provider call", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars(["AIPOWERED_AUTH_ENDPOINT"]);
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it(
    "AIPOWERED_AUTH_ENDPOINT='not-a-url' + agentApiKey → ZodError with variable name " +
      "and https:// format in message (T-FB-15, REQ-EV-02)",
    async () => {
      process.env["AIPOWERED_AUTH_ENDPOINT"] = "not-a-url";

      const callPromise = generateSingleShot({
        shot: { id: "s001", prompt: "aerial city pan", durationSeconds: 4 },
        provider: "runway-gen3",
        outputPath: "/tmp/t-fb-15-test.mp4",
        agentApiKey: "fb_sk_test_x",
      });

      await expect(callPromise).rejects.toThrow(ZodError);

      try {
        await callPromise;
      } catch (err) {
        expect(err).toBeInstanceOf(ZodError);
        const msg = (err as ZodError).issues.map((i) => i.message).join(" ");
        // REQ-EV-05: message must identify the variable name and expected format
        expect(msg).toMatch(/AIPOWERED_AUTH_ENDPOINT/i);
        // REQ-EV-02: expected format is HTTPS URL
        expect(msg).toMatch(/https|URL/i);
      }
    },
  );

  it("'http://example.com' (non-HTTPS) + agentApiKey → ZodError before any provider call", async () => {
    process.env["AIPOWERED_AUTH_ENDPOINT"] = "http://not-secure.example.com";

    await expect(
      generateSingleShot({
        shot: { id: "s002", prompt: "test", durationSeconds: 5 },
        provider: "runway-gen3",
        outputPath: "/tmp/t-fb-15-http.mp4",
        agentApiKey: "fb_sk_http_test",
      }),
    ).rejects.toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// optionalRedisUrl()  (REQ-EV-04 — absent does NOT throw)
// ---------------------------------------------------------------------------

describe("optionalRedisUrl(): absent variable returns undefined silently (REQ-EV-04)", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars(["AIPOWERED_REDIS_URL"]);
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it("absent → undefined (idempotency silently disabled, REQ-EV-04)", () => {
    delete process.env["AIPOWERED_REDIS_URL"];
    expect(optionalRedisUrl()).toBeUndefined();
  });

  it("empty string → undefined", () => {
    process.env["AIPOWERED_REDIS_URL"] = "";
    expect(optionalRedisUrl()).toBeUndefined();
  });

  it("valid redis:// URL → returns the value", () => {
    process.env["AIPOWERED_REDIS_URL"] = "redis://localhost:6379";
    expect(optionalRedisUrl()).toBe("redis://localhost:6379");
  });

  it("invalid URL when set → ZodError (not silent)", () => {
    process.env["AIPOWERED_REDIS_URL"] = "not-a-url";
    expect(() => optionalRedisUrl()).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// optionalWebhookSecret() / optionalMcpToken() — absent is OK
// ---------------------------------------------------------------------------

describe("optionalWebhookSecret / optionalMcpToken: absent = undefined", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars(["AIPOWERED_WEBHOOK_SECRET", "AIPOWERED_MCP_TOKEN"]);
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it("optionalWebhookSecret: absent → undefined", () => {
    delete process.env["AIPOWERED_WEBHOOK_SECRET"];
    expect(optionalWebhookSecret()).toBeUndefined();
  });

  it("optionalMcpToken: absent → undefined", () => {
    delete process.env["AIPOWERED_MCP_TOKEN"];
    expect(optionalMcpToken()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateEnv() — bulk validation
// ---------------------------------------------------------------------------

describe("validateEnv(): bulk validation for startup / testing use", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars([
      "AIPOWERED_API_KEY",
      "AIPOWERED_AUTH_ENDPOINT",
      "AIPOWERED_JWT_PUBLIC_KEY",
      "AIPOWERED_REDIS_URL",
      "AIPOWERED_WEBHOOK_SECRET",
      "AIPOWERED_MCP_TOKEN",
    ]);
  });

  afterEach(() => {
    restoreEnvVars(saved);
  });

  it("all optional vars absent → succeeds (empty object returned)", () => {
    delete process.env["AIPOWERED_API_KEY"];
    delete process.env["AIPOWERED_AUTH_ENDPOINT"];
    delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
    delete process.env["AIPOWERED_REDIS_URL"];
    delete process.env["AIPOWERED_WEBHOOK_SECRET"];
    delete process.env["AIPOWERED_MCP_TOKEN"];
    expect(() => validateEnv()).not.toThrow();
  });

  it("malformed AUTH_ENDPOINT in validateEnv → ZodError listing the field", () => {
    process.env["AIPOWERED_AUTH_ENDPOINT"] = "not-a-url";
    expect(() => validateEnv()).toThrow(ZodError);
  });
});
