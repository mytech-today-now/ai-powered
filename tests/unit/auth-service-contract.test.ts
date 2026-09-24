import type { Request as ProxyRequest, Response as ProxyResponse } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../../src/ai-powered/mcp-server.js";
import { authenticateProxyRequest } from "../../src/ai-powered/server/auth.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { _clearKeyCache, resolveCredential } from "../../src/ai-powered/auth.js";
import { fundAgentAccount } from "../../src/ai-powered/payments.js";

const readFixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/auth-service/${name}.json`, import.meta.url), "utf8"),
  );
const contract = readFixture("contract");
const fixtures = readFixture("fixtures");
const scopes = z.array(z.enum(["read", "generate", "files:read", "files:write"])).min(1);
const id = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const safeKey = z
  .object({
    keyId: id,
    agentId: id,
    label: z.string().min(1).max(80),
    scopes,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
    lastUsedAt: z.string().datetime().nullable(),
    suffix: z.string().length(4),
  })
  .strict();
const selectedDeployment = z.object({
  serviceOwner: z.string().trim().min(1),
  serviceLocation: z.string().trim().min(1),
  database: z.string().trim().min(1),
});
const operations = z
  .array(
    z
      .object({
        operationId: z.string().min(1),
        method: z.enum(["POST", "GET"]),
        path: z.string().startsWith("/api/auth/"),
        caller: z.string().min(1),
        request: z.string().min(1),
        response: z.string().min(1),
        ratePolicy: z.string().min(1),
        cacheControl: z.literal("no-store"),
      })
      .strict(),
  )
  .superRefine((items, ctx) => {
    for (const values of [
      items.map((item) => item.operationId),
      items.map((item) => `${item.method} ${item.path}`),
    ]) {
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: "custom",
          message: "Operation names and method/path pairs must be unique.",
        });
      }
    }
  });

describe("portable issuer interface fixtures (not an issuer implementation)", () => {
  it("defines all ten operations once with explicit management authorization", () => {
    expect(operations.parse(contract.operations)).toHaveLength(10);
    expect(contract.operations.map((op: { operationId: string }) => op.operationId)).toEqual([
      "register",
      "login",
      "logout",
      "verifyEmail",
      "me",
      "createKey",
      "listKeys",
      "rotateKey",
      "revokeKey",
      "verifyKey",
    ]);
    expect(
      contract.operations.find((op: { operationId: string }) => op.operationId === "createKey")
        .caller,
    ).toBe("verified-session-csrf");
    expect(operations.safeParse([...contract.operations, contract.operations[0]]).success).toBe(
      false,
    );
  });

  it("keeps unresolved service ownership from being mistaken for a deployable release", () => {
    expect(contract.decision.status).toBe("blocked");
    expect(selectedDeployment.safeParse(contract.decision).success).toBe(false);
  });

  it("represents verified-account issuance and safe metadata without secret retrieval", () => {
    expect(fixtures.verifiedAccount.emailVerified).toBe(true);
    expect(fixtures.create.body.metadata.agentId).toBe(fixtures.verifiedAccount.agentId);
    safeKey.parse(fixtures.create.body.metadata);
    fixtures.list.keys.forEach((key: unknown) => safeKey.parse(key));
    expect(fixtures.create.headers["Cache-Control"]).toBe("no-store");
    expect(JSON.stringify(fixtures.list)).not.toContain(fixtures.create.body.key);
    expect(
      safeKey.safeParse({ ...fixtures.create.body.metadata, key: fixtures.create.body.key })
        .success,
    ).toBe(false);
    expect(safeKey.safeParse({ ...fixtures.create.body.metadata, scopes: [] }).success).toBe(false);
    expect(safeKey.safeParse({ ...fixtures.create.body.metadata, scopes: ["admin"] }).success).toBe(
      false,
    );
  });

  it("records denied operations with no disclosure or side effects", () => {
    for (const denial of fixtures.denials) {
      expect(denial.status).toBeGreaterThanOrEqual(400);
      expect(denial.sideEffects).toEqual([]);
      expect(denial.headers["Cache-Control"]).toBe("no-store");
      expect(JSON.stringify(denial)).not.toContain(fixtures.create.body.key);
    }
    expect(fixtures.serviceAccess.custodian).toBe("operator");
    expect(contract.dependencies.map((dep: { item: number }) => dep.item)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 2),
    );
  });
});

describe("real proxy auth consumer against portable response fixtures", () => {
  beforeEach(() => {
    _clearKeyCache();
    vi.stubEnv("AIPOWERED_API_KEY", "fixture_operator_secret");
    vi.stubEnv("AIPOWERED_AUTH_ENDPOINT", "https://auth.example.test/tenant/");
  });
  afterEach(() => {
    _clearKeyCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    "https://auth.example.test/tenant",
    "https://auth.example.test/tenant/",
    "https://auth.example.test/tenant///",
  ])("preserves the base path and joins exactly once: %s", async (base) => {
    vi.stubEnv("AIPOWERED_AUTH_ENDPOINT", base);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(fixtures.verification)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolveCredential({ agentApiKey: fixtures.create.body.key });
    expect(result).toEqual({ type: "apikey", unrestricted: false, ...fixtures.verification });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.example.test/tenant/api/auth/verify-key",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: fixtures.create.body.key }),
      }),
    );
  });

  it("normalizes the same service base for the existing funding consumer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ creditsAdded: 10 })));
    vi.stubGlobal("fetch", fetchMock);
    await fundAgentAccount({ stripePaymentMethodId: "pm_fixture", creditAmount: 10 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.example.test/tenant/api/payments/x402",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    "http://auth.example.test",
    "https://user:fixture@auth.example.test",
    "https://auth.example.test?destination=elsewhere",
    "https://auth.example.test#fragment",
    "https://auth.example.test?",
    "https://auth.example.test#",
  ])("rejects an unsafe service base before sending a credential: %s", async (base) => {
    vi.stubEnv("AIPOWERED_AUTH_ENDPOINT", base);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveCredential({ agentApiKey: fixtures.create.body.key })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with missing issuer configuration despite an internal fallback", async () => {
    vi.stubEnv("AIPOWERED_AUTH_ENDPOINT", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveCredential({ agentApiKey: fixtures.create.body.key })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves denial for old unscoped keys and the explicit internal SDK fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixtures.legacyVerification))),
    );
    expect(await resolveCredential({ agentApiKey: "fixture_legacy" })).toMatchObject({
      unrestricted: false,
      scopes: [],
    });
    expect(await resolveCredential({})).toEqual(fixtures.serviceAccess.principal);
  });
});

describe("existing HTTP and MCP adapters at the service boundary", () => {
  afterEach(() => {
    _clearKeyCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the shared base in the actual MCP credit handler", async () => {
    vi.stubEnv("AIPOWERED_AUTH_ENDPOINT", "https://auth.example.test/platform///");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ credits: 12 })));
    vi.stubGlobal("fetch", fetchMock);
    const server = new McpServer({ name: "contract-fixture", version: "1.0.0" });
    registerTools(server);
    const client = new Client({ name: "contract-consumer", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: "get_credit_balance",
        arguments: { agentApiKey: "fixture_agent_key" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ credits: 12 }) }]);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://auth.example.test/platform/api/account/credits",
        {
          headers: { "X-Agent-Api-Key": "fixture_agent_key" },
        },
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    ["anonymous key creation on resource server", "/api/auth/keys", {}, "AUTH_MISSING"],
    [
      "provider-only generation",
      "/text",
      { "X-AI-Provider-Credentials": "fixture_provider_secret" },
      "AUTH_MISSING",
    ],
    [
      "missing issuer configuration",
      "/text",
      { "X-AI-Agent-Key": "fixture_agent_key" },
      "AUTH_INVALID_KEY",
    ],
  ])("denies %s without reaching provider work", async (_label, path, headers, code) => {
    vi.stubEnv("AIPOWERED_API_KEY", "fixture_service_secret");
    vi.stubEnv("AIPOWERED_AUTH_ENDPOINT", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const providerWork = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const req = {
      method: "POST",
      path,
      get: (name: string) => (headers as Record<string, string>)[name],
    } as ProxyRequest;
    const res = { status } as unknown as ProxyResponse;
    await authenticateProxyRequest(req, res, providerWork, { public: false, scope: "generate" });
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Authentication required.", code });
    expect(providerWork).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.aiPrincipal).toBeUndefined();
  });
});
