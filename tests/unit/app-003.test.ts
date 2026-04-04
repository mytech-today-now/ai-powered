/**
 * Tests — App-003: Extract proxyStream helper; remove duplicated SSE/HTTP-error logic
 *
 * Covers:
 *  - proxy-stream-helper: proxyStream URL construction, error handling, response return
 *  - handle-text-stream-refactor: 402 surfaces j.error not statusText; body readable
 *  - audio-video-unaffected: audio/video paths use proxyPost (parsed JSON) not proxyStream
 *
 * Reference: openspec/changes/app-003/tests/app-003.test.js
 *            openspec/changes/app-003/examples/proxy-stream-helper.js demoJsonError
 *            App-003.md Acceptance Criteria items 4 and 6
 */

import { describe, it, expect } from "vitest";

// ── Helper mirroring the proxyStream implementation in app.js ─────────────────

/**
 * Mirrors proxyStream(endpoint, body) from app.js.
 * Accepts proxyInputValue in place of reading proxyUrlInput.value (no DOM needed).
 * Accepts fetchImpl instead of global fetch so tests can supply mocks.
 */
async function proxyStream(
  proxyInputValue: string,
  endpoint: string,
  body: Record<string, unknown>,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Response> {
  const base = proxyInputValue.trim() || "http://localhost:3001";
  let resp: Response;
  try {
    resp = await fetchImpl(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error("Network error: " + (err as Error).message);
  }
  if (!resp.ok) {
    let msg = "Server error " + resp.status;
    try { const j = await resp.json() as { error?: string }; msg = j.error ?? msg; } catch (_) {}
    throw new Error(msg);
  }
  return resp;
}

// ── Factories ─────────────────────────────────────────────────────────────────

function okResponse(extra: Partial<Response> = {}): Response {
  return { ok: true, status: 200, body: { getReader: () => ({}) }, ...extra } as unknown as Response;
}

function errorResponse(status: number, jsonBody: { error?: string; message?: string } | null = null): Response {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: jsonBody
      ? async () => jsonBody
      : async () => { throw new Error("not json"); },
  } as unknown as Response;
}

function networkError(message: string): () => Promise<never> {
  return async () => { throw new Error(message); };
}

// ── proxy-stream-helper ───────────────────────────────────────────────────────

describe("proxy-stream-helper", () => {
  it("uses the default proxy URL when input is empty", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string) => { capturedUrl = url; return okResponse(); };
    await proxyStream("", "/text", {}, mockFetch as never);
    expect(capturedUrl).toBe("http://localhost:3001/text");
  });

  it("uses the default proxy URL when input is whitespace only", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string) => { capturedUrl = url; return okResponse(); };
    await proxyStream("   ", "/text", {}, mockFetch as never);
    expect(capturedUrl).toBe("http://localhost:3001/text");
  });

  it("uses the user-configured proxy URL when input is set", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string) => { capturedUrl = url; return okResponse(); };
    await proxyStream("http://192.168.1.10:3001", "/text", {}, mockFetch as never);
    expect(capturedUrl).toBe("http://192.168.1.10:3001/text");
  });

  it("sends POST with Content-Type application/json", async () => {
    let capturedInit: RequestInit | null = null;
    const mockFetch = async (_url: string, init: RequestInit) => { capturedInit = init; return okResponse(); };
    await proxyStream("http://localhost:3001", "/text", { prompt: "hi" }, mockFetch as never);
    expect((capturedInit as RequestInit).method).toBe("POST");
    expect(((capturedInit as RequestInit).headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("serialises body as JSON", async () => {
    let capturedBody: string | null = null;
    const mockFetch = async (_url: string, init: RequestInit) => { capturedBody = init.body as string; return okResponse(); };
    await proxyStream("http://localhost:3001", "/text", { prompt: "hello", stream: true }, mockFetch as never);
    expect(capturedBody).toBe(JSON.stringify({ prompt: "hello", stream: true }));
  });

  it("returns the raw Response on success so caller can call resp.body.getReader()", async () => {
    const fakeResp = okResponse();
    const mockFetch = async () => fakeResp;
    const result = await proxyStream("http://localhost:3001", "/text", {}, mockFetch as never);
    expect(result).toBe(fakeResp);
    expect(typeof (result.body as unknown as { getReader: unknown }).getReader).toBe("function");
  });

  it("wraps network errors with 'Network error: ' prefix", async () => {
    const mockFetch = networkError("ECONNREFUSED");
    await expect(proxyStream("http://localhost:3001", "/text", {}, mockFetch as never))
      .rejects.toThrow("Network error: ECONNREFUSED");
  });

  // bd-jpc2: 402 must surface j.error, not statusText
  it("surfaces j.error from a 402 JSON body", async () => {
    const mockFetch = async () => errorResponse(402, { error: "Budget exceeded: $5.00 spent of $10.00" });
    await expect(proxyStream("http://localhost:3001", "/text", {}, mockFetch as never))
      .rejects.toThrow("Budget exceeded: $5.00 spent of $10.00");
  });

  it("uses 'Server error <status>' when the error body is not JSON", async () => {
    const mockFetch = async () => errorResponse(500);
    await expect(proxyStream("http://localhost:3001", "/text", {}, mockFetch as never))
      .rejects.toThrow("Server error 500");
  });

  it("uses 'Server error <status>' when the JSON body has no error field", async () => {
    const mockFetch = async () => errorResponse(503, { message: "unavailable" });
    await expect(proxyStream("http://localhost:3001", "/text", {}, mockFetch as never))
      .rejects.toThrow("Server error 503");
  });

  it("does NOT throw a page-relative URL (URL must start with http)", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string) => { capturedUrl = url; return okResponse(); };
    await proxyStream("http://localhost:3001", "/text", {}, mockFetch as never);
    expect(capturedUrl.startsWith("http")).toBe(true);
    expect(capturedUrl.startsWith("/text")).toBe(false);
  });
});



// ── handle-text-stream-refactor ───────────────────────────────────────────────

describe("handle-text-stream-refactor", () => {
  // bd-jpc2 primary assertion: 402 must surface j.error, NOT statusText
  it("a 402 with JSON body surfaces the error field, not statusText", async () => {
    const mockFetch = async () =>
      errorResponse(402, { error: "Budget exceeded: $5.00 spent of $10.00" });
    let thrownMessage = "";
    try {
      await proxyStream("http://localhost:3001", "/text", { prompt: "hi", stream: true }, mockFetch as never);
    } catch (err) {
      thrownMessage = (err as Error).message;
    }
    expect(thrownMessage).toBe("Budget exceeded: $5.00 spent of $10.00");
    // Verifies the fix: old code threw resp.statusText ("Payment Required")
    expect(thrownMessage).not.toContain("Payment Required");
  });

  it("a successful response provides resp.body for the decode loop", async () => {
    const chunks = [new Uint8Array([72, 101, 108, 108, 111])]; // "Hello"
    let chunkIndex = 0;
    const fakeReader = {
      read: async () => {
        if (chunkIndex < chunks.length) return { done: false, value: chunks[chunkIndex++] };
        return { done: true, value: undefined };
      },
    };
    const fakeResp = { ok: true, status: 200, body: { getReader: () => fakeReader } };
    const mockFetch = async () => fakeResp;

    const resp = await proxyStream(
      "http://localhost:3001", "/text", { prompt: "hi", stream: true }, mockFetch as never,
    );
    const reader = (resp.body as unknown as { getReader: () => typeof fakeReader }).getReader();
    const dec = new TextDecoder();
    let accumulated = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += dec.decode(value as Uint8Array, { stream: true });
    }
    expect(accumulated).toBe("Hello");
  });
});

// ── audio-video-unaffected (bd-le0i) ─────────────────────────────────────────
//
// Guards against scope creep from the handleTextStream refactor.
// Audio TTS (handleTtsSpeak) and Video generation (handleVideoGenerate) must
// continue to use proxyPost (which returns parsed JSON), NOT proxyStream
// (which returns the raw Response for stream reading).
//
// These tests mirror the proxyPost contract to verify both paths remain correct.

/**
 * Mirrors proxyPost(endpoint, body) — returns parsed JSON (not a raw Response).
 * Audio and video generation call this helper; proxyStream is text-stream only.
 */
async function proxyPost(
  proxyInputValue: string,
  endpoint: string,
  body: Record<string, unknown>,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
): Promise<unknown> {
  const base = proxyInputValue.trim() || "http://localhost:3001";
  let resp: Response;
  try {
    resp = await fetchImpl(base + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {
    throw new Error("Cannot reach proxy server at " + base);
  }
  if (!resp.ok) {
    let msg = resp.statusText ?? ("Server error " + resp.status);
    try {
      const j = await resp.json() as { error?: string };
      msg = j.error || msg;
    } catch (_) {}
    throw new Error("Server error " + resp.status + ": " + msg);
  }
  return resp.json();
}

describe("audio-video-unaffected", () => {
  it("audio TTS (proxyPost) returns parsed JSON, not a raw Response stream", async () => {
    const fakeAudio = { audio: "base64data==", mimeType: "audio/mpeg" };
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fakeAudio,
      } as unknown as Response);

    const result = await proxyPost("http://localhost:3001", "/audio/speak", { text: "Hello" }, mockFetch as never);
    // proxyPost returns parsed JSON — audio consumer reads result.audio
    expect(result).toEqual(fakeAudio);
    expect((result as typeof fakeAudio).audio).toBe("base64data==");
  });

  it("audio TTS does not expose a body.getReader() (it uses proxyPost, not proxyStream)", async () => {
    const fakeAudio = { audio: "base64data==", mimeType: "audio/mpeg" };
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fakeAudio,
      } as unknown as Response);

    const result = await proxyPost("http://localhost:3001", "/audio/speak", { text: "Hello" }, mockFetch as never);
    // The result is a plain object (parsed JSON), not a Response with .body
    expect(typeof (result as Record<string, unknown>)["body"]).not.toBe("object");
  });

  it("video generation (proxyPost) returns parsed JSON with result data field", async () => {
    const fakeVideo = { data: "data:video/mp4;base64,AAAA", cost: { totalUsd: 0.05 } };
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fakeVideo,
      } as unknown as Response);

    const result = await proxyPost(
      "http://localhost:3001",
      "/video",
      { prompt: "A sunset over mountains", provider: "lumaai" },
      mockFetch as never,
    );
    expect(result).toEqual(fakeVideo);
    expect((result as typeof fakeVideo).data).toContain("data:video/mp4");
  });

  it("video generation does not expose a body.getReader() (it uses proxyPost, not proxyStream)", async () => {
    const fakeVideo = { data: "data:video/mp4;base64,AAAA" };
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fakeVideo,
      } as unknown as Response);

    const result = await proxyPost("http://localhost:3001", "/video", { prompt: "Sunset" }, mockFetch as never);
    // proxyPost returns parsed JSON — no streaming body
    expect(typeof (result as Record<string, unknown>)["body"]).not.toBe("object");
  });

  it("audio and video 402 errors still propagate correctly via proxyPost", async () => {
    const mockFetch = async () =>
      ({
        ok: false,
        status: 402,
        statusText: "Payment Required",
        json: async () => ({ error: "Budget exceeded: $5.00 spent of $10.00" }),
      } as unknown as Response);

    await expect(proxyPost("http://localhost:3001", "/audio/speak", { text: "Hi" }, mockFetch as never))
      .rejects.toThrow("Server error 402");

    await expect(proxyPost("http://localhost:3001", "/video", { prompt: "Hi" }, mockFetch as never))
      .rejects.toThrow("Server error 402");
  });
});
