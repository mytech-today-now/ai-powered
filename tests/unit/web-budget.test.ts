import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebClient } from "../../src/ai-powered/web/fetch-client.js";
import { BudgetExceededError } from "../../src/ai-powered/types.js";
import { estimateCost } from "../../src/ai-powered/shared/cost.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeOpenAiTextResponse(content: string): Response {
  return jsonResponse({
    choices: [{ message: { content }, finish_reason: "stop" }],
    model: "gpt-4o",
    usage: { prompt_tokens: 24, completion_tokens: 12, total_tokens: 36 },
  });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebAiClient direct budget estimates", () => {
  it("blocks a direct image call before fetch when the projected spend exceeds budget", async () => {
    const prompt = "a red square";
    const estimate = estimateCost("dall-e-3", prompt).totalUsd;
    const blockedBudget = estimate - 0.001;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "sk-test",
      budgetUsd: blockedBudget,
    });

    const blockedCall = client.generateImage(prompt);
    await expect(blockedCall).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(blockedCall).rejects.toMatchObject({
      name: "BudgetExceededError",
      message: `Budget exceeded: spent $${estimate.toFixed(4)} of $${blockedBudget.toFixed(4)} limit.`,
      spentUsd: estimate,
      budgetUsd: blockedBudget,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.spentUsd).toBe(0);
  });

  it("permits a direct structured call when the original prompt estimate still fits", async () => {
    const prompt = "budgeted structured prompt ".repeat(160);
    const estimate = estimateCost("gpt-4o", prompt).totalUsd;
    const allowedBudget = estimate + 0.0001;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeOpenAiTextResponse(JSON.stringify({ title: "allowed", score: 7 })));
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "sk-test",
      budgetUsd: allowedBudget,
    });

    const result = await client.generateStructured<{ title: string; score: number }>(prompt);

    expect(result).toEqual({
      data: { title: "allowed", score: 7 },
      model: "gpt-4o",
      provider: "openai",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.spentUsd).toBe(0);
  });

  it("still accumulates cost when the internal spend helper receives a cost-bearing result", () => {
    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "sk-test",
    });

    (
      client as unknown as {
        _accumulateCost(result: { cost?: { totalUsd: number } }): void;
      }
    )._accumulateCost({ cost: { totalUsd: 0.0012 } });

    expect(client.spentUsd).toBeCloseTo(0.0012);
  });
});
