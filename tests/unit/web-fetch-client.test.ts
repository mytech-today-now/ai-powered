/**
 * @file tests/unit/web-fetch-client.test.ts
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebClient } from "../../src/ai-powered/web/fetch-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
