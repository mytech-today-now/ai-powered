/**
 * @file tests/unit/mcp.test.ts
 *
 * Unit / integration tests for src/ai-powered/mcp-server.ts
 *
 *   T-FB-11 — tools/list returns exactly 6 tools, each with inputSchema.type="object"
 *              and a `required` array (REQ-MCP-01, REQ-MCP-02)
 *   T-FB-12 — generate_single_shot tool returns a SingleShotResult-shaped JSON blob
 *              (REQ-MCP-03, AI_MOCK=true)
 *   T-FB-13 — list_providers tool returns exactly 3 providers with creditCostPerSecond
 *              (REQ-MCP-04)
 *   T-FB-14 — HTTP StreamableHTTP transport: missing / wrong Bearer token → HTTP 401
 *              (REQ-MCP-06, bd-sqnu)
 *   T-FB-15 — HTTP transport defaults to loopback bind and rejects unsafe remote
 *              exposure without an auth token
 *   T-FB-16 — HTTP transport with auth + unsafe exposure still handles /mcp
 *
 * Tools T-FB-11 … T-FB-13 use the MCP SDK's InMemoryTransport + Client pair so
 * no real network or stdio is involved.  T-FB-14 spins up a minimal Express
 * server using the exported `createBearerAuthMiddleware` and makes a real HTTP
 * request via the built-in `fetch`.  T-FB-15 … T-FB-16 start the exported
 * `startMcpServer`, assert the actual listen host, and make an authenticated
 * `/mcp` initialize request via `fetch`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

// MCP SDK
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Subject under test
import {
  registerTools,
  createBearerAuthMiddleware,
  startMcpServer,
} from "../../src/ai-powered/mcp-server.js";

// ---------------------------------------------------------------------------
// Shared in-process MCP server/client pair
// ---------------------------------------------------------------------------

let client: Client;
let savedApiKey: string | undefined;

type CapturedListen = {
  server: http.Server;
  port: number | string | undefined;
  host: string | undefined;
};

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

async function startHttpMcpServer(
  options: Parameters<typeof startMcpServer>[0],
): Promise<CapturedListen> {
  let captured: CapturedListen | undefined;
  const originalListen = http.Server.prototype.listen;
  const listenSpy = vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (
    this: http.Server,
    ...args: unknown[]
  ) {
    captured = {
      server: this,
      port: args[0] as number | string | undefined,
      host: typeof args[1] === "string" ? (args[1] as string) : undefined,
    };
    // Delegate to the real implementation so the test exercises an actual socket bind.
    return originalListen.apply(this, args as never);
  });

  try {
    await startMcpServer(options);
    if (!captured) {
      throw new Error("Expected startMcpServer() to call listen()");
    }
    return captured;
  } finally {
    listenSpy.mockRestore();
  }
}

beforeAll(async () => {
  // generateSingleShot now calls resolveCredential() when a credential source
  // is present.  Set the global fallback so T-FB-12 tool calls succeed without
  // needing per-call agentToken / agentApiKey (REQ-BC-03 backward compat).
  savedApiKey = process.env["AIPOWERED_API_KEY"];
  process.env["AIPOWERED_API_KEY"] = "ap_sk_mcp_test";

  // Create a server, register all tools, then wire it to an in-memory transport.
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  // Restore AIPOWERED_API_KEY to whatever it was before this suite.
  if (savedApiKey === undefined) {
    delete process.env["AIPOWERED_API_KEY"];
  } else {
    process.env["AIPOWERED_API_KEY"] = savedApiKey;
  }
});

// ---------------------------------------------------------------------------
// T-FB-11 — tools/list: 6 tools with valid inputSchema
// ---------------------------------------------------------------------------

describe("T-FB-11: tools/list — 6 tools with inputSchema (REQ-MCP-01, REQ-MCP-02)", () => {
  const EXPECTED_TOOLS = [
    "generate_single_shot",
    "submit_single_shot",
    "poll_shot_job",
    "fund_agent_account",
    "get_credit_balance",
    "list_providers",
  ];

  it("returns exactly 6 tools", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(6);
  });

  it("returned tool names match the canonical manifest", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("every tool has inputSchema.type === 'object'", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.inputSchema, `${tool.name}.inputSchema.type`).toMatchObject({ type: "object" });
    }
  });

  it("every tool with required fields has inputSchema.required as an array", async () => {
    // The JSON Schema spec permits omitting `required` when no properties are
    // mandatory.  The MCP SDK follows this: tools whose inputSchema has only
    // optional fields (get_credit_balance, list_providers) will have
    // `required` absent or an empty array — both are valid.
    // The important invariant (tested below) is that tools WITH required inputs
    // correctly list them in a `required` array.
    const result = await client.listTools();
    for (const tool of result.tools) {
      const required = (tool.inputSchema as { required?: unknown[] }).required;
      // `required` must be an Array when present; `undefined` is also valid (no required fields).
      expect(
        required === undefined || Array.isArray(required),
        `${tool.name}.inputSchema.required should be an array or absent`,
      ).toBe(true);
    }
  });

  it("generate_single_shot requires shot, provider, outputPath", async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "generate_single_shot");
    const required = (tool!.inputSchema as { required: string[] }).required;
    expect(required).toContain("shot");
    expect(required).toContain("provider");
    expect(required).toContain("outputPath");
  });

  it("fund_agent_account requires stripePaymentMethodId and creditAmount", async () => {
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "fund_agent_account");
    const required = (tool!.inputSchema as { required: string[] }).required;
    expect(required).toContain("stripePaymentMethodId");
    expect(required).toContain("creditAmount");
  });
});

// ---------------------------------------------------------------------------
// T-FB-13 — list_providers returns 3 providers with creditCostPerSecond
// ---------------------------------------------------------------------------

describe("T-FB-13: list_providers tool (REQ-MCP-04)", () => {
  it("returns exactly 3 providers", async () => {
    const result = await client.callTool({ name: "list_providers", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as { providers: unknown[] };
    expect(parsed.providers).toHaveLength(3);
  });

  it("providers include runway-gen3, pika-2, kling-1.6", async () => {
    const result = await client.callTool({ name: "list_providers", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as {
      providers: Array<{ id: string; creditCostPerSecond: number }>;
    };
    const ids = parsed.providers.map((p) => p.id);
    expect(ids).toContain("runway-gen3");
    expect(ids).toContain("pika-2");
    expect(ids).toContain("kling-1.6");
  });

  it("every provider has creditCostPerSecond > 0", async () => {
    const result = await client.callTool({ name: "list_providers", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as {
      providers: Array<{ id: string; creditCostPerSecond: number }>;
    };
    for (const provider of parsed.providers) {
      expect(provider.creditCostPerSecond, `${provider.id}.creditCostPerSecond`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// T-FB-12 — generate_single_shot returns SingleShotResult shape (AI_MOCK=true)
// ---------------------------------------------------------------------------

describe("T-FB-12: generate_single_shot MCP tool (REQ-MCP-03)", () => {
  it("returns JSON with status, clipPath, and creditsCharged fields", async () => {
    const tmpFile = path.join(os.tmpdir(), `ai-powered-mcp-test-${Date.now()}.mp4`);

    const result = await client.callTool({
      name: "generate_single_shot",
      arguments: {
        shot: { id: "test-shot-01", prompt: "A calm ocean wave", durationSeconds: 3 },
        provider: "mock",
        outputPath: tmpFile,
      },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // SingleShotResult shape (AC-19): status, clipPath, creditsCharged
    expect(parsed).toHaveProperty("status");
    expect(parsed).toHaveProperty("clipPath");
    expect(parsed).toHaveProperty("creditsCharged");
  });

  it("content array has exactly one text element", async () => {
    const tmpFile = path.join(os.tmpdir(), `ai-powered-mcp-test-${Date.now()}.mp4`);

    const result = await client.callTool({
      name: "generate_single_shot",
      arguments: {
        shot: { id: "test-shot-02", prompt: "Mountain sunrise", durationSeconds: 5 },
        provider: "mock",
        outputPath: tmpFile,
      },
    });

    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { type: string }).type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// T-FB-14 — HTTP bearer auth middleware: missing/wrong token → 401
// ---------------------------------------------------------------------------

describe("T-FB-14: HTTP bearer auth middleware (REQ-MCP-06, bd-sqnu)", () => {
  let httpServer: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(createBearerAuthMiddleware("test-secret-token"));
    // Stub endpoint — any request reaching here has passed auth
    app.post("/mcp", (_req, res) => res.json({ ok: true }));

    httpServer = http.createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("returns error body matching spec format when header is missing", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }),
    });
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "Missing or invalid Authorization: Bearer token" });
  });

  it("returns 401 when Authorization header has wrong token", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 3 }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization scheme is not Bearer", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic dXNlcjpwYXNz",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 4 }),
    });
    expect(res.status).toBe(401);
  });

  it("passes through with correct Bearer token (non-401)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-secret-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 5 }),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// T-FB-15 / T-FB-16 — HTTP startup policy and authenticated StreamableHTTP
// ---------------------------------------------------------------------------

describe("T-FB-15/T-FB-16: HTTP transport startup policy", () => {
  it("binds HTTP transport to 127.0.0.1 by default", async () => {
    const { server, host } = await startHttpMcpServer({
      transport: "http",
      port: 0,
    });

    try {
      expect(host).toBe("127.0.0.1");
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");
      if (address && typeof address !== "string") {
        expect((address as AddressInfo).address).toBe("127.0.0.1");
      }
    } finally {
      await closeServer(server);
    }
  });

  it("rejects unsafe remote exposure when no auth token is provided", async () => {
    await expect(
      startMcpServer({
        transport: "http",
        port: 0,
        unsafeExposeNetwork: true,
      }),
    ).rejects.toThrow(
      "HTTP MCP remote exposure requires an authToken when unsafeExposeNetwork is enabled.",
    );
  });

  it("binds to 0.0.0.0 only when unsafe exposure is requested with auth and still handles /mcp", async () => {
    const token = "test-secret-token";
    const { server, host } = await startHttpMcpServer({
      transport: "http",
      port: 0,
      authToken: token,
      unsafeExposeNetwork: true,
    });

    try {
      expect(host).toBe("0.0.0.0");
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");
      if (address && typeof address !== "string") {
        expect((address as AddressInfo).address).toBe("0.0.0.0");
        const res = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              clientInfo: { name: "http-client", version: "0.0.0" },
              capabilities: {},
            },
          }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");
        const body = await res.text();
        expect(body).toContain('"jsonrpc":"2.0"');
        expect(body).toContain('"serverInfo"');
      }
    } finally {
      await closeServer(server);
    }
  });
});
