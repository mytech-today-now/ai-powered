/**
 * @file tests/unit/auth.test.ts
 *
 * Unit tests for src/ai-powered/auth.ts:
 *   T-FB-02 — JWT validation: valid / expired / malformed (AC-01, AC-02)
 *   T-FB-03 — API key cache: one POST per 60-second window (AC-03, D3)
 *   T-FB-04 — No credential + no env var → AUTH_MISSING (REQ-CI-04)
 *   bd-r624  — Credential masking: raw values never appear in messages / errors
 *
 * All tests run without network access (fetch is stubbed via vi.stubGlobal).
 * The `jsonwebtoken` module is mocked so no real RSA key material is needed.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock jsonwebtoken BEFORE importing auth.ts (Vitest hoists vi.mock calls)
// ---------------------------------------------------------------------------
vi.mock("jsonwebtoken", async (importOriginal) => {
  // Re-export the real error classes so instanceof checks work in auth.ts,
  // but replace jwt.verify with a controllable mock that each test configures.
  //
  // jsonwebtoken is a CJS module; in ESM context the real module.exports object
  // lives on `real.default`.  We must spread that (not the namespace itself) so
  // that `jwt.JsonWebTokenError` / `jwt.TokenExpiredError` remain valid
  // constructors inside auth.ts.
  const real = await importOriginal<typeof import("jsonwebtoken")>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cjsExports = (real as any).default ?? real;
  return {
    ...real,
    default: {
      ...cjsExports,
      verify: vi.fn(),
    },
  };
});

import jwt from "jsonwebtoken";
import {
  resolveCredential,
  maskApiKey,
  maskToken,
  _clearKeyCache,
} from "../../src/ai-powered/auth.js";
import { AiPoweredError } from "../../src/ai-powered/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----";
const FAKE_API_KEY = "fb_sk_live_abcdef1234567890";
const FAKE_AUTH_ENDPOINT = "https://auth.example.com";

function setJwtEnv(): void {
  process.env["AIPOWERED_JWT_PUBLIC_KEY"] = FAKE_PUBLIC_KEY;
}

function setApiKeyEnv(): void {
  process.env["AIPOWERED_AUTH_ENDPOINT"] = FAKE_AUTH_ENDPOINT;
}

function clearEnv(): void {
  delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
  delete process.env["AIPOWERED_AUTH_ENDPOINT"];
  delete process.env["AIPOWERED_API_KEY"];
}

// ---------------------------------------------------------------------------
// T-FB-02 — JWT validation
// ---------------------------------------------------------------------------
describe("T-FB-02: resolveCredential — agentToken (JWT)", () => {
  const mockVerify = vi.mocked(jwt.verify);

  beforeEach(() => {
    setJwtEnv();
    _clearKeyCache();
    mockVerify.mockReset();
  });

  afterEach(clearEnv);

  it("AC-01: valid RS256 JWT → returns type=jwt with sub as agentId", async () => {
    mockVerify.mockReturnValue({ sub: "agent-42", iat: 1000, exp: 9999 } as jwt.JwtPayload);

    const cred = await resolveCredential({ agentToken: "fake.jwt.token" });

    expect(cred.type).toBe("jwt");
    expect(cred.agentId).toBe("agent-42");
    expect(cred.scopes).toEqual([]);
    // jwt.verify called once with the right algorithm and clock tolerance
    expect(mockVerify).toHaveBeenCalledOnce();
    expect(mockVerify).toHaveBeenCalledWith(
      "fake.jwt.token",
      FAKE_PUBLIC_KEY,
      expect.objectContaining({ algorithms: ["RS256"], clockTolerance: 30 }),
    );
  });

  it("AC-01: valid JWT with no sub → falls back to opts.agentId", async () => {
    mockVerify.mockReturnValue({ iat: 1000 } as jwt.JwtPayload);

    const cred = await resolveCredential({ agentToken: "fake.jwt.token", agentId: "fallback-id" });

    expect(cred.agentId).toBe("fallback-id");
  });

  it("AC-02: expired JWT → throws AiPoweredError(AUTH_INVALID_TOKEN, retryable=false)", async () => {
    mockVerify.mockImplementation(() => {
      throw new jwt.TokenExpiredError("jwt expired", new Date());
    });

    await expect(resolveCredential({ agentToken: "expired.jwt.token" })).rejects.toThrow(
      expect.objectContaining({
        code: "AUTH_INVALID_TOKEN",
        retryable: false,
      }),
    );
  });

  it("AC-02: malformed JWT → throws AiPoweredError(AUTH_INVALID_TOKEN, retryable=false)", async () => {
    mockVerify.mockImplementation(() => {
      throw new jwt.JsonWebTokenError("invalid signature");
    });

    await expect(resolveCredential({ agentToken: "bad.jwt.token" })).rejects.toThrow(
      expect.objectContaining({ code: "AUTH_INVALID_TOKEN", retryable: false }),
    );
  });

  it("AC-02: expired JWT error message does not contain raw token (REQ-CI-06)", async () => {
    const rawToken = "super.secret.token.value";
    mockVerify.mockImplementation(() => {
      throw new jwt.TokenExpiredError("jwt expired", new Date());
    });

    let errorMessage = "";
    try {
      await resolveCredential({ agentToken: rawToken });
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    expect(errorMessage).not.toContain(rawToken);
  });

  it("unexpected non-JWT error during verify → re-thrown as AUTH_INVALID_TOKEN", async () => {
    mockVerify.mockImplementation(() => {
      throw new Error("PEM parse failed");
    });

    await expect(resolveCredential({ agentToken: "tok" })).rejects.toThrow(
      expect.objectContaining({ code: "AUTH_INVALID_TOKEN" }),
    );
  });
});

// ---------------------------------------------------------------------------
// T-FB-03 — API key cache (D3, AC-03)
// ---------------------------------------------------------------------------
describe("T-FB-03: resolveCredential — agentApiKey 60-second cache", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setApiKeyEnv();
    _clearKeyCache();
    // Stub global fetch with a successful verify-key response
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ agentId: "agent-cached", scopes: ["generate"] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("cache hit: second call within 60 s reuses cached entry (fetch called once)", async () => {
    await resolveCredential({ agentApiKey: FAKE_API_KEY });
    await resolveCredential({ agentApiKey: FAKE_API_KEY });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("cache miss: call after 61 s triggers a fresh POST (fetch called twice)", async () => {
    await resolveCredential({ agentApiKey: FAKE_API_KEY });

    // Advance time past the 60-second TTL
    vi.advanceTimersByTime(61_000);

    await resolveCredential({ agentApiKey: FAKE_API_KEY });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("cache hit returns type=apikey with agentId from the endpoint", async () => {
    const cred = await resolveCredential({ agentApiKey: FAKE_API_KEY });

    expect(cred.type).toBe("apikey");
    expect(cred.agentId).toBe("agent-cached");
    expect(cred.scopes).toEqual(["generate"]);
  });

  it("non-OK response from verify-key → AiPoweredError(AUTH_INVALID_KEY, retryable=false)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(resolveCredential({ agentApiKey: FAKE_API_KEY })).rejects.toThrow(
      expect.objectContaining({ code: "AUTH_INVALID_KEY", retryable: false }),
    );
  });

  it("error message for invalid key does NOT contain raw key value (REQ-CI-06)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

    let errorMessage = "";
    try {
      await resolveCredential({ agentApiKey: FAKE_API_KEY });
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    expect(errorMessage).not.toContain(FAKE_API_KEY);
    // Masked form should appear instead
    expect(errorMessage).toContain("***...");
  });

  it("network failure → AiPoweredError(AUTH_INVALID_KEY)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(resolveCredential({ agentApiKey: FAKE_API_KEY })).rejects.toThrow(
      expect.objectContaining({ code: "AUTH_INVALID_KEY" }),
    );
  });
});

// ---------------------------------------------------------------------------
// T-FB-04 — AUTH_MISSING
// ---------------------------------------------------------------------------
describe("T-FB-04: resolveCredential — no credential → AUTH_MISSING", () => {
  beforeEach(() => {
    _clearKeyCache();
    clearEnv();
  });

  it("throws AiPoweredError(AUTH_MISSING, retryable=false) when nothing is supplied", async () => {
    await expect(resolveCredential({})).rejects.toThrow(
      expect.objectContaining({
        code: "AUTH_MISSING",
        retryable: false,
      }),
    );
  });

  it("is instanceof AiPoweredError and instanceof Error", async () => {
    let caught: unknown;
    try {
      await resolveCredential({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiPoweredError);
    expect(caught).toBeInstanceOf(Error);
  });

  it("AIPOWERED_API_KEY set → resolves as global fallback (no error)", async () => {
    process.env["AIPOWERED_API_KEY"] = "global-key";
    const cred = await resolveCredential({});
    expect(cred.type).toBe("global");
    expect(cred.agentId).toBe("service");
    delete process.env["AIPOWERED_API_KEY"];
  });
});

// ---------------------------------------------------------------------------
// bd-r624 — maskApiKey / maskToken credential masking
// ---------------------------------------------------------------------------
describe("bd-r624: maskApiKey and maskToken — REQ-CI-06", () => {
  it("maskApiKey: shows last 4 chars, prefixes with ***...", () => {
    expect(maskApiKey("fb_sk_live_abcdef")).toBe("***...cdef");
  });

  it("maskApiKey: key of exactly 4 chars → returns *** (full key would be exposed)", () => {
    // A 4-char key has no characters to hide beyond the last 4, so we redact
    // the whole thing to prevent the raw value leaking.  REQ-CI-06.
    expect(maskApiKey("abcd")).toBe("***");
  });

  it("maskApiKey: key shorter than 4 chars → returns ***", () => {
    expect(maskApiKey("ab")).toBe("***");
    expect(maskApiKey("")).toBe("***");
  });

  it("maskApiKey: does NOT contain the full raw key value", () => {
    const raw = "fb_sk_live_super_secret_value";
    const masked = maskApiKey(raw);
    expect(masked).not.toContain("fb_sk_live_super_secret_val");
    expect(masked).not.toBe(raw);
  });

  it("maskToken: shows last 4 chars of token", () => {
    // ".sig" is 4 characters, so the result is "***..." + ".sig"
    expect(maskToken("eyJhbGciOiJSUzI1NiJ9.payload.sig")).toBe("***....sig");
  });

  it("maskToken: short token → returns ***", () => {
    expect(maskToken("abc")).toBe("***");
  });

  it("maskToken: does NOT contain the full raw token value", () => {
    const raw = "eyJhbGciOiJSUzI1NiJ9.sensitive_payload.unique_sig";
    const masked = maskToken(raw);
    expect(masked).not.toContain("sensitive_payload");
    expect(masked).not.toBe(raw);
  });
});
