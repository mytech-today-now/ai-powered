/**
 * @file tests/unit/web-fetch-client.test.ts
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebClient } from "../../src/ai-powered/web/fetch-client.js";
import { BudgetExceededError } from "../../src/ai-powered/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamingResponse(chunks: Array<string | Uint8Array>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function openAiData(content: string, terminator = "\n\n"): string {
  return "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + terminator;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("WebAiClient.listModels", () => {
  it("forwards accepts in proxy mode and preserves extra metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://proxy.example/models?modality=image&accepts=image");
      return jsonResponse([
        {
          id: "gpt-image-1",
          name: "GPT-Image-1",
          capabilities: ["image"],
          inputCapabilities: ["image"],
          vendorNote: "kept",
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({ mode: "proxy", proxyUrl: "https://proxy.example" });
    const models = await client.listModels("image", "image");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "gpt-image-1",
      name: "GPT-Image-1",
      capabilities: ["image"],
      inputCapabilities: ["image"],
      vendorNote: "kept",
    });
  });

  it("preserves raw model fields in direct mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/models");
      return jsonResponse({
        data: [
          {
            id: "claude-3-5-sonnet-20241022",
            display_name: "Claude 3.5 Sonnet",
            object: "model",
            context_window: 200000,
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-test-key",
    });
    const models = await client.listModels("text", "image");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "claude-3-5-sonnet-20241022",
      name: "Claude 3.5 Sonnet",
      capabilities: ["text", "structured"],
      inputCapabilities: ["image"],
      object: "model",
      context_window: 200000,
    });
  });
});

describe("WebAiClient proxy caller authentication", () => {
  it("parses the stable proxy envelope and preserves its correlation id", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "The server could not complete the request. Try again later.",
            message: "The server could not complete the request. Try again later.",
            code: "INTERNAL_SERVER_ERROR",
            status: 500,
            requestId: "browser-error-123",
            retryable: false,
          }),
          { status: 500, headers: { "X-Request-ID": "browser-error-123" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3001" });
    await expect(client.generateText("hello")).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      requestId: "browser-error-123",
      message: "The server could not complete the request. Try again later.",
    });
  });

  it("does not reflect a malformed non-JSON proxy body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          "C:\\private\\provider.json https://callback.example/hook?token=secret sk-browser-secret",
          { status: 502 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3001" });
    const error = await client.generateText("hello").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "PROXY_ERROR", statusCode: 502, message: "HTTP 502" });
    expect(String((error as Error).message)).not.toContain("callback.example");
    expect(String((error as Error).message)).not.toContain("sk-browser-secret");
  });

  it.each([
    ["bearer", "Bearer browser-jwt"],
    ["agent-key", "browser-agent-key"],
    ["api-key", "browser-service-key"],
  ] as const)(
    "emits exactly one %s caller header alongside provider credentials",
    async (type, value) => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(atob(headers.get("X-AI-Provider-Credentials") ?? "")).toContain("provider-secret");
        expect(headers.get("authorization")).toBe(type === "bearer" ? value : null);
        expect(headers.get("X-AI-Agent-Key")).toBe(type === "agent-key" ? value : null);
        expect(headers.get("X-AI-API-Key")).toBe(type === "api-key" ? value : null);
        return jsonResponse([{ id: "mock-text-v1", name: "Mock Text", capabilities: ["text"] }]);
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = createWebClient({
        mode: "proxy",
        proxyUrl: "http://localhost:3001",
        providerCredential: { apiKey: "provider-secret" },
        callerCredential: { type, value: value.replace(/^Bearer /, "") },
      });

      await expect(client.listModels()).resolves.toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("fails closed for unrelated proxy origins and sends neither credential class", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("X-AI-Agent-Key")).toBeNull();
      expect(headers.get("X-AI-API-Key")).toBeNull();
      expect(headers.get("X-AI-Provider-Credentials")).toBeNull();
      expect(JSON.stringify(init?.body ?? "")).not.toContain("provider-secret");
      return jsonResponse([{ id: "mock-text-v1", name: "Mock Text", capabilities: ["text"] }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "https://unrelated.example",
      providerCredential: { apiKey: "provider-secret" },
      callerCredential: { type: "agent-key", value: "caller-secret" },
    });

    await expect(client.listModels()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps protected proxy auth failures to stable, non-secret browser messages", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "Authentication required.", code: "AUTH_MISSING" }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
    });
    await expect(client.generateText("hello")).rejects.toMatchObject({
      name: "ProxyError",
      code: "AUTH_MISSING",
      statusCode: 401,
      message:
        "Proxy access requires a caller credential. Open Settings / Configuration to connect.",
    });
  });

  it("authenticates same-proxy media reads but not external media URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL) =>
        jsonResponse({
          url: "http://localhost:3001/files/protected-output",
          cost: { totalUsd: 0, isEstimate: false },
        }),
      )
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("X-AI-Agent-Key")).toBe("caller-secret");
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 });
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL) =>
        jsonResponse({
          url: "https://cdn.example/output.png",
          cost: { totalUsd: 0, isEstimate: false },
        }),
      )
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-AI-Agent-Key")).toBeNull();
        expect(headers.get("X-AI-Provider-Credentials")).toBeNull();
        return new Response(Uint8Array.from([4, 5, 6]), { status: 200 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      providerCredential: { apiKey: "provider-secret" },
      callerCredential: { type: "agent-key", value: "caller-secret" },
    });

    await expect(client.generateImage("same proxy")).resolves.toBeInstanceOf(Blob);
    await expect(client.generateImage("external")).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("WebAiClient direct text adapters", () => {
  it("sends a valid Anthropic Messages request and maps the response", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/messages");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("anthropic-test-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
      expect(headers.get("authorization")).toBeNull();

      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).toEqual({
        model: "claude-test",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
        max_tokens: 321,
        system: "Answer briefly.",
        temperature: 0.4,
      });
      expect(body).not.toHaveProperty("choices");
      expect(body.messages).not.toContainEqual({ role: "system", content: "Answer briefly." });

      return jsonResponse({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-test",
        content: [{ type: "text", text: "hi there" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 7, output_tokens: 3 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-test-key",
    });
    const result = await client.generateText("hello", {
      model: "claude-test",
      maxTokens: 321,
      systemPrompt: "Answer briefly.",
      temperature: 0.4,
    });

    expect(result).toMatchObject({
      content: "hi there",
      model: "claude-test",
      provider: "anthropic",
      finishReason: "end_turn",
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("always supplies Anthropic max_tokens when the caller omits maxTokens", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
      expect(body.max_tokens).toBe(4096);
      return jsonResponse({
        model: "claude-test",
        content: [{ type: "text", text: "ok" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-test-key",
      model: "claude-test",
    });

    await expect(client.generateText("hello")).resolves.toMatchObject({ content: "ok" });
  });

  it("rejects a malformed Anthropic response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: "claude-test",
        content: [{ type: "tool_use", id: "tool-1" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-test-key",
    });

    await expect(client.generateText("hello")).rejects.toThrow(
      "Malformed Anthropic response: missing text content block.",
    );
  });

  it("surfaces the nested Anthropic provider error without exposing the key", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "The request body is invalid.",
          },
        },
        400,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-secret-key",
    });

    const error = await client.generateText("hello").catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "ProxyError",
      statusCode: 400,
      message: "The request body is invalid.",
    });
    expect(String((error as Error).message)).not.toContain("anthropic-secret-key");
  });

  it("parses Anthropic start, delta, and stop SSE events", async () => {
    const sse = [
      "event: message_start\n",
      "data: " +
        JSON.stringify({
          type: "message_start",
          message: { id: "msg_test", type: "message", role: "assistant" },
        }) +
        "\n\n",
      "event: content_block_start\n",
      "data: " +
        JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }) +
        "\n\n",
      "event: content_block_delta\n",
      "data: " +
        JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        }) +
        "\n\n",
      "event: content_block_delta\n",
      "data: " +
        JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " world" },
        }) +
        "\n\n",
      "event: message_delta\n",
      "data: " +
        JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
        }) +
        "\n\n",
      "event: message_stop\n",
      'data: {"type":"message_stop"}\n\n',
    ].join("");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/messages");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "claude-test",
        max_tokens: 64,
        stream: true,
        system: "Stream briefly.",
      });
      expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-test-key",
    });
    const chunks: string[] = [];
    for await (const chunk of client.streamText("hello", {
      model: "claude-test",
      maxTokens: 64,
      systemPrompt: "Stream briefly.",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " world"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["a trailing newline", "\n"],
    ["an unterminated final line", ""],
  ])("flushes the final direct SSE event with %s", async (_description, terminator) => {
    const fetchMock = vi.fn(async () =>
      streamingResponse([openAiData("Hello"), openAiData(" world", terminator)]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const chunks: string[] = [];
    for await (const chunk of client.streamText("hello", { model: "gpt-test" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " world"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves exact text across split JSON and UTF-8 decoder boundaries", async () => {
    const body = openAiData("café");
    const encoded = new TextEncoder().encode(body);
    const jsonSplit = body.indexOf('"delta"') + 3;
    const utf8Start = new TextEncoder().encode(body.slice(0, body.indexOf("é"))).byteLength;
    const fetchMock = vi.fn(async () =>
      streamingResponse([
        encoded.slice(0, jsonSplit),
        encoded.slice(jsonSplit, utf8Start + 1),
        encoded.slice(utf8Start + 1),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const chunks: string[] = [];
    for await (const chunk of client.streamText("hello", { model: "gpt-test" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["café"]);
  });

  it("handles CRLF event boundaries and blank SSE lines deterministically", async () => {
    const fetchMock = vi.fn(async () =>
      streamingResponse([
        "event: message\r\n",
        openAiData("one", "\r\n"),
        "\r\n",
        openAiData("two", "\r\n"),
        "\r\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const chunks: string[] = [];
    for await (const chunk of client.streamText("hello", { model: "gpt-test" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["one", "two"]);
  });

  it("stops at [DONE] after yielding prior content", async () => {
    const fetchMock = vi.fn(async () =>
      streamingResponse([openAiData("before") + "data: [DONE]\n\n" + openAiData("after")]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const chunks: string[] = [];
    for await (const chunk of client.streamText("hello", { model: "gpt-test" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["before"]);
  });

  it("skips malformed direct events and recovers with the next valid event", async () => {
    const fetchMock = vi.fn(async () =>
      streamingResponse(["data: {not-json}\n\n" + openAiData("recovered")]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const chunks: string[] = [];
    for await (const chunk of client.streamText("hello", { model: "gpt-test" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["recovered"]);
  });

  it("propagates abort while reading a direct SSE stream", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancelled");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(openAiData("before")));
          controller.signal.addEventListener(
            "abort",
            () => streamController.error(controller.signal.reason ?? cancellation),
            { once: true },
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const chunks: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of client.streamText("hello", {
          model: "gpt-test",
          signal: controller.signal,
        })) {
          chunks.push(chunk);
          controller.abort(cancellation);
        }
      })(),
    ).rejects.toThrow("cancelled");

    expect(chunks).toEqual(["before"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forwards cancellation to a direct Anthropic request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort(new Error("cancelled"));
      throw controller.signal.reason;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-secret-key",
    });

    await expect(client.generateText("hello", { signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("runs the direct Anthropic budget preflight before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "direct",
      provider: "anthropic",
      apiKey: "anthropic-test-key",
      budgetUsd: 0,
    });

    await expect(client.generateText("over budget")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the OpenAI-compatible direct request body unchanged", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer openai-test-key");
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toEqual({
        model: "gpt-test",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "hello" },
        ],
        temperature: 0.2,
        max_tokens: 12,
      });
      return jsonResponse({
        model: "gpt-test",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    await expect(
      client.generateText("hello", {
        model: "gpt-test",
        systemPrompt: "Be concise.",
        temperature: 0.2,
        maxTokens: 12,
      }),
    ).resolves.toMatchObject({ content: "ok", provider: "openai" });
  });
});

it.each([
  {
    provider: "openai",
    endpoint: "https://api.openai.com/v1/models",
    responseBody: {
      data: [
        { id: "gpt-4o", object: "model" },
        { id: "gpt-3.5-turbo", object: "model" },
      ],
    },
    expectedIds: ["gpt-4o"],
  },
  {
    provider: "xai",
    endpoint: "https://api.x.ai/v1/models",
    responseBody: {
      data: [
        { id: "grok-vision-beta", object: "model" },
        { id: "grok-2", object: "model" },
      ],
    },
    expectedIds: ["grok-vision-beta"],
  },
])(
  "preserves image-capable direct-mode models for %s",
  async ({ provider, endpoint, responseBody, expectedIds }) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(endpoint);
      return jsonResponse(responseBody);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: provider as "openai" | "xai",
      apiKey: `${provider}-test-key`,
    });
    const models = await client.listModels("text", "image");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(models.map((model) => model.id)).toEqual(expectedIds);
    expect(models[0]?.inputCapabilities).toEqual(["image"]);
  },
);

describe("WebAiClient audio", () => {
  it("forwards a selected transcription model in direct mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/audio/transcriptions");
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("tts-1-hd");
      const file = form.get("file") as File | null;
      expect(file?.name).toBe("media.webm");
      return jsonResponse({ text: "hello" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const transcript = await client.transcribeAudio(
      new Blob([Uint8Array.from([1, 2, 3])], { type: "audio/webm" }),
      { model: "tts-1-hd" },
    );

    expect(transcript).toBe("hello");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to whisper-1 and tts-1 in direct mode when no model is supplied", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/audio/transcriptions")) {
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("whisper-1");
        return jsonResponse({ text: "transcript" });
      }
      if (url.endsWith("/audio/speech")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        expect(body.model).toBe("tts-1");
        return new Response(Uint8Array.from([82, 73, 70, 70]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const transcript = await client.transcribeAudio(
      new Blob([Uint8Array.from([1, 2, 3])], { type: "audio/webm" }),
    );
    const speech = await client.synthesizeSpeech("hello");

    expect(transcript).toBe("transcript");
    expect(speech).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards a selected TTS model in direct mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/audio/speech");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string;
        model?: string;
        voice?: string;
      };
      expect(body.input).toBe("hello");
      expect(body.model).toBe("tts-1-hd");
      expect(body.voice).toBe("alloy");
      return new Response(Uint8Array.from([82, 73, 70, 70]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "direct",
      provider: "openai",
      apiKey: "openai-test-key",
    });
    const speech = await client.synthesizeSpeech("hello", { model: "tts-1-hd" });

    expect(speech).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("WebAiClient music", () => {
  it("posts music options without placing the credential in JSON", async () => {
    const audioBase64 = "SUQzBA==";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:3001/music");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).toMatchObject({
        prompt: "night drive",
        provider: "musicapi",
        model: "sonic-v5",
        lyrics: "stay awake",
        instrumental: false,
        duration: 30,
        seed: 7,
      });
      expect(JSON.stringify(body)).not.toContain("secret-music-key");
      const encoded = new Headers(init?.headers).get("X-AI-Provider-Credentials");
      expect(encoded).toBeTruthy();
      expect(atob(encoded!)).toContain("secret-music-key");
      return jsonResponse({
        data: `data:audio/mpeg;base64,${audioBase64}`,
        provider: "musicapi",
        model: "sonic-v5",
        title: "Night Drive",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      providerCredential: { apiKey: "secret-music-key" },
    });
    const result = await client.generateMusic("night drive", {
      provider: "musicapi",
      model: "sonic-v5",
      lyrics: "stay awake",
      instrumental: false,
      duration: 30,
      seed: 7,
    });

    expect(result.audio).toBeInstanceOf(Blob);
    expect(result.audio.type).toBe("audio/mpeg");
    expect(result.title).toBe("Night Drive");
  });
});

describe("WebAiClient proxy budget", () => {
  const cost = { totalUsd: 0.1, isEstimate: false };

  it("preflights proxy text and accumulates the returned cost once", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        content: "ok",
        model: "mock-text-v1",
        provider: "mock",
        cost,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      budgetUsd: 1,
    });
    const result = await client.generateText("hello", { model: "mock-text-v1" });

    expect(result.content).toBe("ok");
    expect(client.spentUsd).toBe(0.1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects the next call at the exact accumulated limit before fetching", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        content: "ok",
        model: "mock-text-v1",
        provider: "mock",
        cost: { totalUsd: 0.1, isEstimate: false },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      budgetUsd: 0.1,
    });
    await client.generateText("hello", { model: "mock-text-v1" });

    await expect(client.generateText("again", { model: "mock-text-v1" })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(client.spentUsd).toBe(0.1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an over-limit proxy call before any network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      budgetUsd: 0,
    });

    await expect(
      client.generateMusic("over limit", { model: "mock-music-v1" }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "image",
      model: "mock-image-v1",
      run: (client: ReturnType<typeof createWebClient>) =>
        client.generateImage("image", { model: "mock-image-v1" }),
      response: { data: "data:image/png;base64,iVBORw0KGgo=", cost },
    },
    {
      name: "audio transcription",
      model: "mock-whisper-v1",
      run: (client: ReturnType<typeof createWebClient>) =>
        client.transcribeAudio(new Blob(["audio"], { type: "audio/webm" }), {
          model: "mock-whisper-v1",
        }),
      response: { text: "transcript", cost },
    },
    {
      name: "audio speech",
      model: "mock-tts-v1",
      run: (client: ReturnType<typeof createWebClient>) =>
        client.synthesizeSpeech("speak", { model: "mock-tts-v1" }),
      response: { audio: "SUQzBA==", cost },
    },
    {
      name: "video",
      model: "mock-video-v1",
      run: (client: ReturnType<typeof createWebClient>) =>
        client.generateVideo("video", { model: "mock-video-v1" }),
      response: { data: "data:video/mp4;base64,AAAA", cost },
    },
    {
      name: "music",
      model: "mock-music-v1",
      run: (client: ReturnType<typeof createWebClient>) =>
        client.generateMusic("music", { model: "mock-music-v1" }),
      response: { data: "data:audio/mpeg;base64,SUQzBA==", cost },
    },
    {
      name: "structured",
      model: "mock-structured-v1",
      run: (client: ReturnType<typeof createWebClient>) =>
        client.generateStructured("structured", { model: "mock-structured-v1" }),
      response: { data: { ok: true }, cost },
    },
  ])(
    "accounts the returned cost for proxy $name exactly once",
    async ({ run, response, model }) => {
      const fetchMock = vi.fn(async () => jsonResponse(response));
      vi.stubGlobal("fetch", fetchMock);
      const client = createWebClient({
        mode: "proxy",
        proxyUrl: "http://localhost:3001",
        budgetUsd: 1,
      });

      await run(client);

      expect(client.spentUsd).toBe(0.1);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(model).toBeTruthy();
    },
  );

  it("surfaces a server budget rejection code without retrying it", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "Budget exceeded", code: "BUDGET_EXCEEDED" }, 402),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      budgetUsd: 1,
      maxRetries: 3,
      backoffBase: 0,
      backoffCap: 0,
    });

    await expect(
      client.generateText("server rejected", { model: "mock-text-v1" }),
    ).rejects.toMatchObject({
      name: "ProxyError",
      code: "BUDGET_EXCEEDED",
      statusCode: 402,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.spentUsd).toBe(0);
  });

  it("fails closed when a finite-budget proxy response omits cost metadata", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ content: "unknown cost", model: "mock-text-v1", provider: "mock" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      budgetUsd: 1,
    });

    await expect(
      client.generateText("missing cost", { model: "mock-text-v1" }),
    ).rejects.toMatchObject({
      name: "ProxyError",
      code: "PROXY_COST_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.spentUsd).toBe(0);
  });

  it("retains bounded retries for safe model-list reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse([{ id: "mock-text-v1", name: "Mock Text" }]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      maxRetries: 1,
      backoffBase: 0,
      backoffCap: 0,
    });

    const models = await client.listModels();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(models[0]?.id).toBe("mock-text-v1");
    expect(client.spentUsd).toBe(0);
  });
});

describe("BrowserConversationSession transactional history", () => {
  function createSession(id: string) {
    sessionStorage.clear();
    const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3001" });
    return { client, session: client.session(id) };
  }

  function textResult(content: string) {
    return { content, model: "test-model", provider: "test-provider" };
  }

  it("commits one user and assistant turn after text success", async () => {
    const { client, session } = createSession("text-success");
    const generateText = vi.spyOn(client, "generateText").mockResolvedValue(textResult("answer"));

    await expect(session.send("question")).resolves.toBe("answer");

    expect(generateText).toHaveBeenCalledOnce();
    expect(generateText.mock.calls[0]?.[0]).toBe("User: question");
    expect(session.getHistory()).toEqual([
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
    ]);
    expect(sessionStorage.getItem("ai-session:text-success")).toBe(
      JSON.stringify(session.getHistory()),
    );
  });

  it("does not retain a failed text turn and retries with the same prompt", async () => {
    const { client, session } = createSession("text-retry");
    const generateText = vi
      .spyOn(client, "generateText")
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(textResult("recovered"));

    await expect(session.send("try again")).rejects.toThrow("provider unavailable");
    expect(session.getHistory()).toEqual([]);
    expect(sessionStorage.getItem("ai-session:text-retry")).toBeNull();

    await expect(session.send("try again")).resolves.toBe("recovered");
    expect(generateText.mock.calls.map(([prompt]) => prompt)).toEqual([
      "User: try again",
      "User: try again",
    ]);
    expect(session.getHistory()).toEqual([
      { role: "user", content: "try again" },
      { role: "assistant", content: "recovered" },
    ]);
  });

  it("commits one user and assistant turn after stream success", async () => {
    const { client, session } = createSession("stream-success");
    const streamText = vi.spyOn(client, "streamText").mockImplementation(async function* (prompt) {
      expect(prompt).toBe("User: stream this");
      yield "stream ";
      yield "answer";
    });
    const chunks: string[] = [];

    for await (const chunk of session.stream("stream this")) chunks.push(chunk);

    expect(chunks).toEqual(["stream ", "answer"]);
    expect(streamText).toHaveBeenCalledOnce();
    expect(session.getHistory()).toEqual([
      { role: "user", content: "stream this" },
      { role: "assistant", content: "stream answer" },
    ]);
  });

  it("discards partial stream output when the provider fails", async () => {
    const { client, session } = createSession("stream-failure");
    const streamText = vi.spyOn(client, "streamText").mockImplementation(async function* () {
      yield "partial";
      throw new Error("stream disconnected");
    });
    const chunks: string[] = [];

    await expect(
      (async () => {
        for await (const chunk of session.stream("stream question")) chunks.push(chunk);
      })(),
    ).rejects.toThrow("stream disconnected");

    expect(chunks).toEqual(["partial"]);
    expect(streamText).toHaveBeenCalledOnce();
    expect(session.getHistory()).toEqual([]);
    expect(sessionStorage.getItem("ai-session:stream-failure")).toBeNull();
  });

  it("discards a cancelled text turn without changing history", async () => {
    const { client, session } = createSession("text-cancel");
    const controller = new AbortController();
    const cancellation = new Error("cancelled");
    const generateText = vi
      .spyOn(client, "generateText")
      .mockImplementation(async (_prompt, options) => {
        expect(options?.signal).toBe(controller.signal);
        controller.abort(cancellation);
        throw cancellation;
      });

    await expect(session.send("cancel this", { signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );

    expect(generateText).toHaveBeenCalledOnce();
    expect(session.getHistory()).toEqual([]);
  });

  it("writes a successful turn once and preserves it after reload", async () => {
    const { client, session } = createSession("reload");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.spyOn(client, "generateText").mockResolvedValue(textResult("saved"));

    await session.send("persist me");
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem.mock.calls[0]?.[0]).toBe("ai-session:reload");
    expect(setItem.mock.calls[0]?.[1]).toBe(JSON.stringify(session.getHistory()));

    const reloaded = client.session("reload");
    expect(reloaded.getHistory()).toEqual(session.getHistory());
  });

  it("keeps committed history in memory and reports storage fallback failures", async () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
      removeItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
    };
    vi.stubGlobal("sessionStorage", storage);
    const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3001" });
    const session = client.session("storage-fallback");
    vi.spyOn(client, "generateText").mockResolvedValue(textResult("memory only"));

    await session.send("remember in memory");

    expect(session.getHistory()).toEqual([
      { role: "user", content: "remember in memory" },
      { role: "assistant", content: "memory only" },
    ]);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(
      "Conversation history is temporary in this browser",
    );

    const reloaded = client.session("storage-fallback");
    expect(reloaded.getHistory()).toEqual(session.getHistory());
  });

  it("serializes concurrent sends and builds each prompt from committed history", async () => {
    const { client, session } = createSession("concurrent");
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const prompts: string[] = [];
    const generateText = vi.spyOn(client, "generateText").mockImplementation(async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        await firstFinished;
        return textResult("first answer");
      }
      return textResult("second answer");
    });

    const first = session.send("first question");
    const second = session.send("second question");
    await vi.waitFor(() => expect(prompts).toEqual(["User: first question"]));
    expect(prompts).toEqual(["User: first question"]);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first answer", "second answer"]);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(prompts).toEqual([
      "User: first question",
      "User: first question\nAssistant: first answer\nUser: second question",
    ]);
    expect(session.getHistory()).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
      { role: "assistant", content: "second answer" },
    ]);
  });
});
describe("WebAiClient retry classification", () => {
  it("does not repeat a generation POST after a post-acceptance 503", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "accepted upstream, response unavailable" }, 503),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      maxRetries: 3,
      backoffBase: 0,
      backoffCap: 0,
    });

    await expect(
      client.generateText("paid generation", { model: "mock-text-v1" }),
    ).rejects.toMatchObject({
      name: "ProxyError",
      statusCode: 503,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.spentUsd).toBe(0);
  });

  it("does not repeat a generation POST when 429 includes Retry-After", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "rate limited" }, 429, { "Retry-After": "30" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      maxRetries: 3,
      backoffBase: 0,
      backoffCap: 0,
    });

    await expect(
      client.generateMusic("paid music", { model: "mock-music-v1" }),
    ).rejects.toMatchObject({
      name: "ProxyError",
      statusCode: 429,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not repeat a generation POST after a network failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("gateway disconnected");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      maxRetries: 3,
      backoffBase: 0,
      backoffCap: 0,
    });

    await expect(client.generateText("network failure", { model: "mock-text-v1" })).rejects.toThrow(
      "gateway disconnected",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("opens the browser circuit on final 503 responses", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "service unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      maxRetries: 2,
      backoffBase: 0,
      backoffCap: 0,
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(client.generateText("circuit", { model: "mock-text-v1" })).rejects.toMatchObject(
        {
          statusCode: 503,
        },
      );
    }

    const breaker = (client as unknown as { _breaker: { state: string; failures: number } })
      ._breaker;
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(breaker.state).toBe("OPEN");
    expect(breaker.failures).toBe(5);
  });

  it("does not count cancellation during safe-read backoff as circuit failure", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse([{ id: "recovered", name: "Recovered" }]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebClient({
      mode: "proxy",
      proxyUrl: "http://localhost:3001",
      maxRetries: 1,
      backoffBase: 1_000,
      backoffCap: 1_000,
    });

    const pending = client.listModels(undefined, { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    const breaker = (client as unknown as { _breaker: { state: string; failures: number } })
      ._breaker;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(breaker.state).toBe("CLOSED");
    expect(breaker.failures).toBe(0);
  });
});
