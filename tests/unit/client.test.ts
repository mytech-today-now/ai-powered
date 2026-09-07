/**
 * @file tests/unit/client.test.ts
 *
 * Unit tests for AiClient: budget enforcement, cost accumulation,
 * plugin pipeline order, onError hook, and session management.
 * All tests use MockProvider so no API credentials are required.
 */

import { AiClient } from "../../src/ai-powered/client.js";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { BudgetExceededError, ProviderError, AiPoweredError } from "../../src/ai-powered/types.js";
import type { AiPlugin, RequestContext, ResponseContext } from "../../src/ai-powered/types.js";
import type { ProviderCallOptions } from "../../src/ai-powered/providers/base.js";
import type { TextResult } from "../../src/ai-powered/types.js";
import type { AiConfig } from "../../src/ai-powered/core.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseConfig = AiConfigSchema.parse({ mock: true, provider: "mock" });

class RecordingMockProvider extends MockProvider {
  lastGenerateTextCall: { prompt: string; options?: ProviderCallOptions } | null = null;

  override async generateText(prompt: string, options?: ProviderCallOptions): Promise<TextResult> {
    this.lastGenerateTextCall = {
      prompt,
      options: options ? { ...options } : undefined,
    };
    const model = options?.model ?? "mock-text-v1";
    return {
      modality: "text",
      provider: "mock",
      model,
      content: `prompt=${prompt};temperature=${options?.temperature ?? "default"};system=${options?.systemPrompt ?? "none"}`,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      cost: { totalUsd: 0.001, isEstimate: false },
      latencyMs: 1,
      finishReason: "stop",
    };
  }
}

function makeClient(overrides: Record<string, unknown> = {}, plugins: AiPlugin[] = []): AiClient {
  const config = AiConfigSchema.parse({ ...baseConfig, ...overrides });
  const provider = new MockProvider(config);
  return new AiClient(config, provider, plugins);
}

function makeRecordingClient(
  overrides: Record<string, unknown> = {},
  plugins: AiPlugin[] = [],
): { client: AiClient; provider: RecordingMockProvider; config: AiConfig } {
  const config = AiConfigSchema.parse({ ...baseConfig, ...overrides });
  const provider = new RecordingMockProvider(config);
  return {
    client: new AiClient(config, provider, plugins),
    provider,
    config,
  };
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
  it("passes request options through unchanged when no plugins are registered", async () => {
    const { client, provider } = makeRecordingClient();
    const result = await client.generateText("hello", {
      temperature: 0.25,
      maxTokens: 42,
      systemPrompt: "stay brief",
    });

    expect(provider.lastGenerateTextCall).toMatchObject({
      prompt: "hello",
      options: {
        temperature: 0.25,
        maxTokens: 42,
        systemPrompt: "stay brief",
      },
    });
    expect(provider.lastGenerateTextCall?.options?.messages).toBeUndefined();
    expect(result.content).toContain("prompt=hello");
    expect(result.model).toBe("mock-text-v1");
  });

  it("runs onRequest hooks in registration order", async () => {
    const order: string[] = [];
    const plugin1: AiPlugin = {
      name: "p1",
      version: "1.0.0",
      onRequest: async (ctx: RequestContext) => {
        order.push("p1");
        return ctx;
      },
    };
    const plugin2: AiPlugin = {
      name: "p2",
      version: "1.0.0",
      onRequest: async (ctx: RequestContext) => {
        order.push("p2");
        return ctx;
      },
    };
    const client = makeClient({}, [plugin1, plugin2]);
    await client.generateText("hi");
    expect(order).toEqual(["p1", "p2"]);
  });

  it("runs onResponse hooks in REVERSE registration order", async () => {
    const order: string[] = [];
    const plugin1: AiPlugin = {
      name: "r1",
      version: "1.0.0",
      onResponse: async (ctx: ResponseContext) => {
        order.push("r1");
        return ctx;
      },
    };
    const plugin2: AiPlugin = {
      name: "r2",
      version: "1.0.0",
      onResponse: async (ctx: ResponseContext) => {
        order.push("r2");
        return ctx;
      },
    };
    const client = makeClient({}, [plugin1, plugin2]);
    await client.generateText("hi");
    expect(order).toEqual(["r2", "r1"]);
  });

  it("lets onRequest rewrite prompt, model, and temperature before provider execution", async () => {
    const { provider, config } = makeRecordingClient();
    const plugin: AiPlugin = {
      name: "request-rewriter",
      version: "1.0.0",
      onRequest: async (ctx: RequestContext) => ({
        ...ctx,
        messages: [{ role: "user", content: "rewritten prompt" }],
        options: {
          ...ctx.options,
          temperature: 1.4,
          model: "gpt-4o-mini",
          systemPrompt: "rewritten system",
        },
      }),
    };
    const rewrittenClient = new AiClient(config, provider, [plugin]);

    const result = await rewrittenClient.generateText("original prompt", {
      temperature: 0.2,
      maxTokens: 32,
      systemPrompt: "original system",
    });

    expect(provider.lastGenerateTextCall).toMatchObject({
      prompt: "rewritten prompt",
      options: {
        temperature: 1.4,
        maxTokens: 32,
        systemPrompt: "rewritten system",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "rewritten prompt" }],
      },
    });
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.content).toContain("prompt=rewritten prompt");
    expect(result.content).toContain("temperature=1.4");
  });

  it("lets onResponse inspect and redact the returned result", async () => {
    const { provider, config } = makeRecordingClient();
    let observedContent = "";
    const plugin: AiPlugin = {
      name: "response-redactor",
      version: "1.0.0",
      onResponse: async (ctx: ResponseContext) => {
        observedContent = (ctx.result as TextResult).content;
        return {
          ...ctx,
          result: {
            ...(ctx.result as TextResult),
            content: "[redacted]",
          },
        };
      },
    };
    const redactingClient = new AiClient(config, provider, [plugin]);

    const result = await redactingClient.generateText("hello");

    expect(observedContent).toContain("prompt=hello");
    expect(result.content).toBe("[redacted]");
    expect(provider.lastGenerateTextCall?.prompt).toBe("hello");
  });

  it("rejects invalid request contexts returned by plugins", async () => {
    const { provider, config } = makeRecordingClient();
    const plugin: AiPlugin = {
      name: "bad-request",
      version: "1.0.0",
      onRequest: async () => undefined as unknown as RequestContext,
    };
    const failingClient = new AiClient(config, provider, [plugin]);

    await expect(failingClient.generateText("hello")).rejects.toThrow(/invalid RequestContext/i);
    expect(provider.lastGenerateTextCall).toBeNull();
  });

  it("rejects invalid response contexts returned by plugins", async () => {
    const { provider, config } = makeRecordingClient();
    const plugin: AiPlugin = {
      name: "bad-response",
      version: "1.0.0",
      onResponse: async () => undefined as unknown as ResponseContext,
    };
    const failingClient = new AiClient(config, provider, [plugin]);

    await expect(failingClient.generateText("hello")).rejects.toThrow(/invalid ResponseContext/i);
    expect(provider.lastGenerateTextCall?.prompt).toBe("hello");
  });

  it("keeps bypassed plugins skipped after an unexpected failure", async () => {
    const { provider, config } = makeRecordingClient();
    let flakyCalls = 0;
    let stableCalls = 0;
    const flaky: AiPlugin = {
      name: "flaky",
      version: "1.0.0",
      onRequest: async (ctx: RequestContext) => {
        flakyCalls += 1;
        if (flakyCalls === 1) {
          throw new Error("boom");
        }
        return ctx;
      },
    };
    const stable: AiPlugin = {
      name: "stable",
      version: "1.0.0",
      onRequest: async (ctx: RequestContext) => {
        stableCalls += 1;
        return {
          ...ctx,
          messages: [{ role: "user", content: `${ctx.messages[0]!.content} + plugin` }],
        };
      },
    };
    const bypassClient = new AiClient(config, provider, [flaky, stable]);

    await bypassClient.generateText("one");
    const result = await bypassClient.generateText("two");

    expect(flakyCalls).toBe(1);
    expect(stableCalls).toBe(2);
    expect(provider.lastGenerateTextCall?.prompt).toBe("two + plugin");
    expect(result.content).toContain("prompt=two + plugin");
  });

  it("calls onError with an AiPoweredError when the provider throws", async () => {
    let caughtError: AiPoweredError | null = null;
    const errorPlugin: AiPlugin = {
      name: "err-watcher",
      version: "1.0.0",
      onError: async (err: AiPoweredError) => {
        caughtError = err;
      },
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
