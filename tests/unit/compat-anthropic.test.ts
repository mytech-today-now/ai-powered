/**
 * @file tests/unit/compat-anthropic.test.ts
 *
 * Unit tests for the Anthropic Messages API compatibility adapters in
 * src/ai-powered/server/compat/anthropic.ts.
 *
 * Covers:
 *   normaliseAnthropicContent()
 *     - plain string is returned unchanged
 *     - single text block array is flattened
 *     - multiple text blocks are concatenated without separator
 *     - empty array returns empty string
 *
 *   toAnthropicResponse()
 *     - all required envelope fields are present
 *     - id is prefixed with 'msg_'
 *     - unique id on each call
 *     - type is 'message', role is 'assistant'
 *     - content is an array of text blocks
 *     - stop_reason maps from TextResult.finishReason
 *     - usage maps input_tokens / output_tokens correctly
 *     - model maps from TextResult.model
 *
 * No API credentials or network access are required.
 */

import {
  normaliseAnthropicContent,
  toAnthropicResponse,
} from "../../src/ai-powered/server/compat/anthropic.js";
import type { TextResult } from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// Shared fixture factory
// ---------------------------------------------------------------------------

function makeTextResult(overrides: Partial<TextResult> = {}): TextResult {
  return {
    modality:     "text",
    provider:     "mock",
    model:        "claude-3-5-sonnet-20241022",
    content:      "The answer is 42.",
    finishReason: "end_turn",
    latencyMs:    55,
    cost:         { totalUsd: 0.002, isEstimate: false },
    usage: {
      promptTokens:     15,
      completionTokens: 25,
      totalTokens:      40,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normaliseAnthropicContent — plain string
// ---------------------------------------------------------------------------

describe("normaliseAnthropicContent — string input", () => {
  it("returns a plain string unchanged", () => {
    expect(normaliseAnthropicContent("hello world")).toBe("hello world");
  });

  it("returns an empty string unchanged", () => {
    expect(normaliseAnthropicContent("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normaliseAnthropicContent — block array input
// ---------------------------------------------------------------------------

describe("normaliseAnthropicContent — block array input", () => {
  it("flattens a single text block to its text value", () => {
    const result = normaliseAnthropicContent([{ type: "text", text: "hello" }]);
    expect(result).toBe("hello");
  });

  it("concatenates multiple text blocks with no separator", () => {
    const result = normaliseAnthropicContent([
      { type: "text", text: "hello" },
      { type: "text", text: " world" },
    ]);
    expect(result).toBe("hello world");
  });

  it("returns empty string for an empty block array", () => {
    expect(normaliseAnthropicContent([])).toBe("");
  });

  it("joins three blocks in order", () => {
    const result = normaliseAnthropicContent([
      { type: "text", text: "A" },
      { type: "text", text: "B" },
      { type: "text", text: "C" },
    ]);
    expect(result).toBe("ABC");
  });
});

// ---------------------------------------------------------------------------
// toAnthropicResponse — envelope shape
// ---------------------------------------------------------------------------

describe("toAnthropicResponse — envelope shape", () => {
  it("returns all required top-level fields", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    expect(env).toHaveProperty("id");
    expect(env).toHaveProperty("type");
    expect(env).toHaveProperty("role");
    expect(env).toHaveProperty("model");
    expect(env).toHaveProperty("content");
    expect(env).toHaveProperty("stop_reason");
    expect(env).toHaveProperty("stop_sequence");
    expect(env).toHaveProperty("usage");
  });

  it("type is 'message'", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    expect(env.type).toBe("message");
  });

  it("role is 'assistant'", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    expect(env.role).toBe("assistant");
  });

  it("stop_sequence is null", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    expect(env.stop_sequence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toAnthropicResponse — id
// ---------------------------------------------------------------------------

describe("toAnthropicResponse — id", () => {
  it("id starts with 'msg_'", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    expect(typeof env.id).toBe("string");
    expect((env.id as string).startsWith("msg_")).toBe(true);
  });

  it("generates a unique id on each call", () => {
    const id1 = (toAnthropicResponse(makeTextResult()) as Record<string, unknown>).id;
    const id2 = (toAnthropicResponse(makeTextResult()) as Record<string, unknown>).id;
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// toAnthropicResponse — model and stop_reason
// ---------------------------------------------------------------------------

describe("toAnthropicResponse — model and stop_reason", () => {
  it("model matches TextResult.model", () => {
    const env = toAnthropicResponse(makeTextResult({ model: "claude-3-haiku-20240307" })) as Record<string, unknown>;
    expect(env.model).toBe("claude-3-haiku-20240307");
  });

  it("stop_reason maps from TextResult.finishReason", () => {
    const env = toAnthropicResponse(makeTextResult({ finishReason: "end_turn" })) as Record<string, unknown>;
    expect(env.stop_reason).toBe("end_turn");
  });

  it("stop_reason 'max_tokens' propagates correctly", () => {
    const env = toAnthropicResponse(makeTextResult({ finishReason: "max_tokens" })) as Record<string, unknown>;
    expect(env.stop_reason).toBe("max_tokens");
  });
});

// ---------------------------------------------------------------------------
// toAnthropicResponse — content block
// ---------------------------------------------------------------------------

describe("toAnthropicResponse — content", () => {
  it("content is a non-empty array", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    expect(Array.isArray(env.content)).toBe(true);
    expect((env.content as unknown[]).length).toBeGreaterThan(0);
  });

  it("content[0].type is 'text'", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    const block = (env.content as Record<string, unknown>[])[0];
    expect(block.type).toBe("text");
  });

  it("content[0].text equals TextResult.content", () => {
    const env = toAnthropicResponse(makeTextResult({ content: "Test answer" })) as Record<string, unknown>;
    const block = (env.content as Record<string, unknown>[])[0];
    expect(block.text).toBe("Test answer");
  });
});

// ---------------------------------------------------------------------------
// toAnthropicResponse — usage mapping
// ---------------------------------------------------------------------------

describe("toAnthropicResponse — usage", () => {
  it("maps promptTokens → input_tokens", () => {
    const env = toAnthropicResponse(
      makeTextResult({ usage: { promptTokens: 7, completionTokens: 13, totalTokens: 20 } }),
    ) as Record<string, unknown>;
    const usage = env.usage as Record<string, number>;
    expect(usage.input_tokens).toBe(7);
  });

  it("maps completionTokens → output_tokens", () => {
    const env = toAnthropicResponse(
      makeTextResult({ usage: { promptTokens: 7, completionTokens: 13, totalTokens: 20 } }),
    ) as Record<string, unknown>;
    const usage = env.usage as Record<string, number>;
    expect(usage.output_tokens).toBe(13);
  });

  it("usage contains exactly input_tokens and output_tokens", () => {
    const env = toAnthropicResponse(makeTextResult()) as Record<string, unknown>;
    const usage = env.usage as Record<string, unknown>;
    expect(Object.keys(usage).sort()).toEqual(["input_tokens", "output_tokens"].sort());
  });
});

