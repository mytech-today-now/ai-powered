import { afterEach, describe, expect, it, vi } from "vitest";
import { WebAiClient } from "../../src/ai-powered/web/fetch-client.js";

describe("WebAiClient.transcribeAudio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("forwards the audio mime type in proxy mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe("https://proxy.example/audio/transcribe");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as { audioBase64?: string; mimeType?: string };
      expect(body.audioBase64).toBeTruthy();
      expect(body.mimeType).toBe("audio/mp4");
      return new Response(JSON.stringify({ text: "proxy transcript" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    const client = new WebAiClient({ mode: "proxy", proxyUrl: "https://proxy.example" });
    const audio = new Blob(["proxy audio"], { type: "audio/mp4" });

    await expect(client.transcribeAudio(audio)).resolves.toBe("proxy transcript");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a filename derived from the audio mime type in direct mode", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(init?.method).toBe("POST");
      const form = init?.body as FormData;
      const file = form.get("file") as { name?: string } | null;
      expect(file?.name).toBe("media.mp4");
      expect(form.get("model")).toBe("whisper-1");
      return new Response(JSON.stringify({ text: "direct transcript" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    const client = new WebAiClient({ mode: "direct", provider: "openai", apiKey: "test-key" });
    const audio = new Blob(["direct audio"], { type: "audio/mp4" });

    await expect(client.transcribeAudio(audio)).resolves.toBe("direct transcript");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
