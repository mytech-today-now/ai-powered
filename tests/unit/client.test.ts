/**
 * @file tests/unit/client.test.ts
 *
 * Unit tests for AiClient: budget enforcement, cost accumulation,
 * plugin pipeline order, onError hook, and session management.
 * All tests use MockProvider so no API credentials are required.
 */

import { AiClient } from "../../src/ai-powered/client.js";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import {
  BudgetExceededError,
  ProviderError,
  AiPoweredError,
} from "../../src/ai-powered/types.js";
import type {
  AiPlugin,
  RequestContext,
  ResponseContext,
} from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseConfig = AiConfigSchema.parse({ mock: true, provider: "mock" });

function makeClient(overrides: Record<string, unknown> = {}, plugins: AiPlugin[] = []): AiClient {
  const config = AiConfigSchema.parse({ ...baseConfig, ...overrides });
  const provider = new MockProvider(config);
  return new AiClient(config, provider, plugins);
}

// ---------------------------------------------------------------------------
// generateText — basic response shape
// ---------------------------------------------------------------------------

describe("AiClient.generateText", () => {
  it("resolves with a valid TextResult shape", async () => {
    const client = makeClient();
    const result = await client.generateText("hello");
    expect(result.modality).toBe("text");
    expect(result.provider).toBe("mock");
    expect(typeof result.content).toBe("string");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.cost.totalUsd).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

describe("AiClient budget", () => {
  it("throws BudgetExceededError before the API call when estimate exceeds session budget", async () => {
    // budgetSession=0.000001 is well below the estimated cost of even a 1-word prompt.
    const client = makeClient({ budgetSession: 0.000001 });
    await expect(client.generateText("hello")).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("accumulates cost after each successful call via getCumulativeCost()", async () => {
    const client = makeClient();
    expect(client.getCumulativeCost()).toBe(0);
    await client.generateText("hello");
    expect(client.getCumulativeCost()).toBeGreaterThan(0);
    const after1 = client.getCumulativeCost();
    await client.generateText("world");
    expect(client.getCumulativeCost()).toBeGreaterThan(after1);
  });
});

// ---------------------------------------------------------------------------
// Plugin pipeline
// ---------------------------------------------------------------------------

describe("AiClient plugin pipeline", () => {
  it("runs onRequest hooks in registration order", async () => {
    const order: string[] = [];
    const plugin1: AiPlugin = {
      name: "p1", version: "1.0.0",
      onRequest: async (ctx: RequestContext) => { order.push("p1"); return ctx; },
    };
    const plugin2: AiPlugin = {
      name: "p2", version: "1.0.0",
      onRequest: async (ctx: RequestContext) => { order.push("p2"); return ctx; },
    };
    const client = makeClient({}, [plugin1, plugin2]);
    await client.generateText("hi");
    expect(order).toEqual(["p1", "p2"]);
  });

  it("runs onResponse hooks in REVERSE registration order", async () => {
    const order: string[] = [];
    const plugin1: AiPlugin = {
      name: "r1", version: "1.0.0",
      onResponse: async (ctx: ResponseContext) => { order.push("r1"); return ctx; },
    };
    const plugin2: AiPlugin = {
      name: "r2", version: "1.0.0",
      onResponse: async (ctx: ResponseContext) => { order.push("r2"); return ctx; },
    };
    const client = makeClient({}, [plugin1, plugin2]);
    await client.generateText("hi");
    expect(order).toEqual(["r2", "r1"]);
  });

  it("calls onError with an AiPoweredError when the provider throws", async () => {
    let caughtError: AiPoweredError | null = null;
    const errorPlugin: AiPlugin = {
      name: "err-watcher", version: "1.0.0",
      onError: async (err: AiPoweredError) => { caughtError = err; },
    };
    const config = AiConfigSchema.parse({ mock: true, provider: "mock", fallback: false });
    const provider = new MockProvider(config);
    vi.spyOn(provider, "generateText").mockRejectedValue(
      new ProviderError("mock", "simulated failure", 500, false),
    );
    const client = new AiClient(config, provider, [errorPlugin]);
    await expect(client.generateText("fail")).rejects.toThrow();
    expect(caughtError).toBeInstanceOf(AiPoweredError);
  });
});

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

describe("AiClient.session", () => {
  it("returns the same ConversationSession for the same id", () => {
    const client = makeClient();
    const s1 = client.session("user-42");
    const s2 = client.session("user-42");
    expect(s1).toBe(s2);
  });

  it("returns different sessions for different ids", () => {
    const client = makeClient();
    const s1 = client.session("alice");
    const s2 = client.session("bob");
    expect(s1).not.toBe(s2);
  });
});

