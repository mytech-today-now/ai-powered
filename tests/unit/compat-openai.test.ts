/**
 * @file tests/unit/compat-openai.test.ts
 *
 * Unit tests for the OpenAI-compatibility serialisers in
 * src/ai-powered/server/compat/openai.ts.
 *
 * Covers:
 *   toOpenAiChatResponse()       – envelope fields, id prefix, usage mapping, finish_reason
 *   toOpenAiImageResponse()      – URL detection, base64 detection, format-mismatch warning
 *   ChatCompletionsBodySchema    – required-field validation, valid minimal parse
 *   response_format routing      – json_object → generateStructured(); text → generateText()
 *
 * No API credentials or network access are required — all inputs are plain
 * TypeScript objects matching the internal result interfaces.
 */

import { vi } from "vitest";
import {
  toOpenAiChatResponse,
  toOpenAiImageResponse,
  ChatCompletionsBodySchema,
  handleChatCompletions,
} from "../../src/ai-powered/server/compat/openai.js";
import { AiClient } from "../../src/ai-powered/client.js";
import type { TextResult, ImageResult } from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// Shared fixture factory
// ---------------------------------------------------------------------------

function makeTextResult(overrides: Partial<TextResult> = {}): TextResult {
  return {
    modality:     "text",
    provider:     "mock",
    model:        "mock-model",
    content:      "Hello, world!",
    finishReason: "stop",
    latencyMs:    42,
    cost:         { totalUsd: 0.001, isEstimate: false },
    usage: {
      promptTokens:     10,
      completionTokens: 20,
      totalTokens:      30,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Field presence
// ---------------------------------------------------------------------------

describe("toOpenAiChatResponse — envelope shape", () => {
  it("returns all required top-level fields", () => {
    const result = makeTextResult();
    const envelope = toOpenAiChatResponse(result) as Record<string, unknown>;

    expect(envelope).toHaveProperty("id");
    expect(envelope).toHaveProperty("object");
    expect(envelope).toHaveProperty("created");
    expect(envelope).toHaveProperty("model");
    expect(envelope).toHaveProperty("choices");
    expect(envelope).toHaveProperty("usage");
  });

  it("sets object to 'chat.completion'", () => {
    const envelope = toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>;
    expect(envelope.object).toBe("chat.completion");
  });

  it("sets created to a Unix timestamp (positive integer)", () => {
    const before = Math.floor(Date.now() / 1000);
    const envelope = toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>;
    const after = Math.floor(Date.now() / 1000);

    expect(typeof envelope.created).toBe("number");
    expect(Number.isInteger(envelope.created)).toBe(true);
    expect(envelope.created as number).toBeGreaterThanOrEqual(before);
    expect(envelope.created as number).toBeLessThanOrEqual(after);
  });

  it("sets model from TextResult.model", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ model: "gpt-4o" })) as Record<string, unknown>;
    expect(envelope.model).toBe("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// id prefix
// ---------------------------------------------------------------------------

describe("toOpenAiChatResponse — id", () => {
  it("id starts with 'chatcmpl-'", () => {
    const envelope = toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>;
    expect(typeof envelope.id).toBe("string");
    expect((envelope.id as string).startsWith("chatcmpl-")).toBe(true);
  });

  it("generates a unique id on each call", () => {
    const id1 = (toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>).id;
    const id2 = (toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>).id;
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// usage mapping
// ---------------------------------------------------------------------------

describe("toOpenAiChatResponse — usage", () => {
  it("maps promptTokens → prompt_tokens", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ usage: { promptTokens: 5, completionTokens: 15, totalTokens: 20 } })) as Record<string, unknown>;
    const usage = envelope.usage as Record<string, number>;
    expect(usage.prompt_tokens).toBe(5);
  });

  it("maps completionTokens → completion_tokens", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ usage: { promptTokens: 5, completionTokens: 15, totalTokens: 20 } })) as Record<string, unknown>;
    const usage = envelope.usage as Record<string, number>;
    expect(usage.completion_tokens).toBe(15);
  });

  it("maps totalTokens → total_tokens", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ usage: { promptTokens: 5, completionTokens: 15, totalTokens: 20 } })) as Record<string, unknown>;
    const usage = envelope.usage as Record<string, number>;
    expect(usage.total_tokens).toBe(20);
  });

  it("usage field contains exactly prompt_tokens, completion_tokens, total_tokens", () => {
    const envelope = toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>;
    const usage = envelope.usage as Record<string, unknown>;
    expect(Object.keys(usage).sort()).toEqual(
      ["completion_tokens", "prompt_tokens", "total_tokens"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// choices
// ---------------------------------------------------------------------------

describe("toOpenAiChatResponse — choices", () => {
  it("choices is a non-empty array", () => {
    const envelope = toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>;
    expect(Array.isArray(envelope.choices)).toBe(true);
    expect((envelope.choices as unknown[]).length).toBeGreaterThan(0);
  });

  it("choices[0].finish_reason equals TextResult.finishReason", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ finishReason: "length" })) as Record<string, unknown>;
    const choice = (envelope.choices as Record<string, unknown>[])[0];
    expect(choice.finish_reason).toBe("length");
  });

  it("choices[0].message.role is 'assistant'", () => {
    const envelope = toOpenAiChatResponse(makeTextResult()) as Record<string, unknown>;
    const choice = (envelope.choices as Record<string, unknown>[])[0];
    const message = choice.message as Record<string, unknown>;
    expect(message.role).toBe("assistant");
  });

  it("choices[0].message.content equals TextResult.content", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ content: "Test response" })) as Record<string, unknown>;
    const choice = (envelope.choices as Record<string, unknown>[])[0];
    const message = choice.message as Record<string, unknown>;
    expect(message.content).toBe("Test response");
  });

  it("choices[0].finish_reason 'stop' propagates correctly", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ finishReason: "stop" })) as Record<string, unknown>;
    const choice = (envelope.choices as Record<string, unknown>[])[0];
    expect(choice.finish_reason).toBe("stop");
  });

  it("choices[0].finish_reason 'content_filter' propagates correctly", () => {
    const envelope = toOpenAiChatResponse(makeTextResult({ finishReason: "content_filter" })) as Record<string, unknown>;
    const choice = (envelope.choices as Record<string, unknown>[])[0];
    expect(choice.finish_reason).toBe("content_filter");
  });
});

// ---------------------------------------------------------------------------
// Fixture factory — ImageResult
// ---------------------------------------------------------------------------

function makeImageResult(overrides: Partial<ImageResult> = {}): ImageResult {
  return {
    modality:  "image",
    provider:  "mock",
    model:     "mock-image-v1",
    data:      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=",
    mimeType:  "image/png",
    cost:      { totalUsd: 0, isEstimate: false },
    latencyMs: 1,
    usage:     { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    ...overrides,
  };
}

/** Minimal Express-like response stub used by toOpenAiImageResponse(). */
function makeResMock() {
  const headers: Record<string, string> = {};
  return {
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
    getHeaders: () => headers,
  };
}

// ---------------------------------------------------------------------------
// toOpenAiImageResponse — URL detection
// ---------------------------------------------------------------------------

describe("toOpenAiImageResponse — URL data", () => {
  it("sets data[0].url when result.data is an https:// URL", () => {
    const result  = makeImageResult({ data: "https://cdn.example.com/img.png" });
    const resMock = makeResMock();
    const envelope = toOpenAiImageResponse(result, "url", resMock as never) as Record<string, unknown>;
    const entry = (envelope["data"] as Record<string, string>[])[0]!;
    expect(entry["url"]).toBe("https://cdn.example.com/img.png");
    expect(entry["b64_json"]).toBeUndefined();
  });

  it("does NOT set ai-powered-warning when URL matches requested 'url' format", () => {
    const result  = makeImageResult({ data: "https://cdn.example.com/img.png" });
    const resMock = makeResMock();
    toOpenAiImageResponse(result, "url", resMock as never);
    expect(resMock.setHeader).not.toHaveBeenCalled();
  });

  it("envelope has a created Unix timestamp (number)", () => {
    const result  = makeImageResult({ data: "https://cdn.example.com/img.png" });
    const envelope = toOpenAiImageResponse(result, "url", makeResMock() as never) as Record<string, unknown>;
    expect(typeof envelope["created"]).toBe("number");
    expect(Number.isInteger(envelope["created"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toOpenAiImageResponse — base64 detection
// ---------------------------------------------------------------------------

describe("toOpenAiImageResponse — base64 data", () => {
  it("sets data[0].b64_json when result.data is a data URI (base64)", () => {
    const result  = makeImageResult(); // default data is a base64 data URI
    const resMock = makeResMock();
    const envelope = toOpenAiImageResponse(result, "b64_json", resMock as never) as Record<string, unknown>;
    const entry = (envelope["data"] as Record<string, string>[])[0]!;
    expect(typeof entry["b64_json"]).toBe("string");
    expect(entry["url"]).toBeUndefined();
  });

  it("does NOT set ai-powered-warning when base64 matches requested 'b64_json' format", () => {
    const result  = makeImageResult();
    const resMock = makeResMock();
    toOpenAiImageResponse(result, "b64_json", resMock as never);
    expect(resMock.setHeader).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// toOpenAiImageResponse — format mismatch warning
// ---------------------------------------------------------------------------

describe("toOpenAiImageResponse — format mismatch", () => {
  it("sets ai-powered-warning header when URL returned but b64_json requested", () => {
    const result  = makeImageResult({ data: "https://cdn.example.com/img.png" });
    const resMock = makeResMock();
    toOpenAiImageResponse(result, "b64_json", resMock as never);
    expect(resMock.setHeader).toHaveBeenCalledWith(
      "ai-powered-warning",
      expect.stringContaining("b64_json"),
    );
  });

  it("sets ai-powered-warning header when base64 returned but url requested", () => {
    const result  = makeImageResult(); // base64 data URI
    const resMock = makeResMock();
    toOpenAiImageResponse(result, "url", resMock as never);
    expect(resMock.setHeader).toHaveBeenCalledWith(
      "ai-powered-warning",
      expect.stringContaining("url"),
    );
  });

  it("still returns a valid envelope on format mismatch (falls back to actual format field)", () => {
    const result  = makeImageResult({ data: "https://cdn.example.com/img.png" });
    const envelope = toOpenAiImageResponse(result, "b64_json", makeResMock() as never) as Record<string, unknown>;
    const entry = (envelope["data"] as Record<string, string>[])[0]!;
    // Actual data is a URL so url field is set regardless of requested format
    expect(entry["url"]).toBe("https://cdn.example.com/img.png");
  });
});

// ---------------------------------------------------------------------------
// ChatCompletionsBodySchema — validation
// ---------------------------------------------------------------------------

describe("ChatCompletionsBodySchema — validation", () => {
  it("parse fails when messages is absent", () => {
    const result = ChatCompletionsBodySchema.safeParse({ model: "gpt-4o" });
    expect(result.success).toBe(false);
  });

  it("parse fails when messages is an empty array", () => {
    const result = ChatCompletionsBodySchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });

  it("parse succeeds with a minimal valid body (messages only)", () => {
    const result = ChatCompletionsBodySchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
  });

  it("parse succeeds with stream defaulting to false when omitted", () => {
    const result = ChatCompletionsBodySchema.safeParse({
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stream).toBe(false);
    }
  });

  it("parse fails when response_format has an unknown type", () => {
    const result = ChatCompletionsBodySchema.safeParse({
      messages: [{ role: "user", content: "Hi" }],
      response_format: { type: "invalid_type" },
    });
    expect(result.success).toBe(false);
  });

  it("parse succeeds with response_format type 'json_object'", () => {
    const result = ChatCompletionsBodySchema.safeParse({
      messages: [{ role: "user", content: "Hi" }],
      response_format: { type: "json_object" },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// response_format routing — json_object → generateStructured(); text → generateText()
// ---------------------------------------------------------------------------

describe("response_format routing", () => {
  /** Create a minimal mock Express response that captures the json() call. */
  function makeExpressResMock() {
    const captured: { json?: unknown } = {};
    return {
      json:      vi.fn((body: unknown) => { captured.json = body; }),
      status:    vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      write:     vi.fn(),
      end:       vi.fn(),
      headersSent: false,
      _captured: captured,
    };
  }

  it("calls generateStructured when response_format is json_object", async () => {
    const spy = vi.spyOn(AiClient.prototype, "generateStructured");
    const handler = handleChatCompletions({ mock: true });
    const req = {
      body: {
        messages: [{ role: "user", content: "Give me JSON" }],
        response_format: { type: "json_object" },
      },
    };
    const res = makeExpressResMock();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("calls generateText when response_format is text (or omitted)", async () => {
    const spy = vi.spyOn(AiClient.prototype, "generateText");
    const handler = handleChatCompletions({ mock: true });
    const req = {
      body: {
        messages: [{ role: "user", content: "Hello" }],
        response_format: { type: "text" },
      },
    };
    const res = makeExpressResMock();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("calls generateText when response_format is omitted entirely", async () => {
    const spy = vi.spyOn(AiClient.prototype, "generateText");
    const handler = handleChatCompletions({ mock: true });
    const req = {
      body: {
        messages: [{ role: "user", content: "Hello" }],
      },
    };
    const res = makeExpressResMock();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

