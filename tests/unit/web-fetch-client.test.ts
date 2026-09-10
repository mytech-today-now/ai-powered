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
