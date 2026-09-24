import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebClient, WebMediaFetchError } from "../../src/ai-powered/web/fetch-client.js";

const SIGNED_IMAGE_URL = "https://media.example.test/image.png?token=secret-image-token";
const SIGNED_AUDIO_URL = "https://media.example.test/audio.mp3?token=secret-audio-token";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mediaResponse(
  body: BodyInit | null,
  contentType: string,
  status = 200,
  contentLength?: number,
): Response {
  const headers = new Headers({ "content-type": contentType });
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new Response(body, { status, headers });
}

function proxyClient() {
  return createWebClient({
    mode: "proxy",
    proxyUrl: "https://proxy.example.test",
    maxRetries: 0,
    backoffBase: 1,
  });
}

function imagePayload(url = SIGNED_IMAGE_URL) {
  return { url, cost: { totalUsd: 0, isEstimate: true } };
}

function musicPayload(url = SIGNED_AUDIO_URL) {
  return {
    url,
    model: "music-model",
    provider: "music-provider",
    cost: { totalUsd: 0, isEstimate: true },
  };
}

describe("secondary media URL validation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preserves valid proxy image and music URL results", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(imagePayload()))
      .mockResolvedValueOnce(mediaResponse(new Uint8Array([1, 2, 3]), "image/png"));

    const image = await proxyClient().generateImage("a lake");
    expect(image).toBeInstanceOf(Blob);
    expect(image.type).toBe("image/png");
    expect(image.size).toBe(3);

    fetchMock
      .mockResolvedValueOnce(jsonResponse(musicPayload()))
      .mockResolvedValueOnce(mediaResponse(new Uint8Array([4, 5]), "audio/mpeg"));

    const music = await proxyClient().generateMusic("a song");
    expect(music.audio).toBeInstanceOf(Blob);
    expect(music.audio.type).toBe("audio/mpeg");
    expect(music.audio.size).toBe(2);
  });

  it("validates proxy video URL responses before returning a Blob", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          url: "https://media.example.test/video.mp4",
          cost: { totalUsd: 0, isEstimate: true },
        }),
      )
      .mockResolvedValueOnce(mediaResponse(new Uint8Array([9]), "video/mp4"));

    const video = await proxyClient().generateVideo("a short clip");

    expect(video).toBeInstanceOf(Blob);
    expect(video.type).toBe("video/mp4");
  });

  it.each([401, 403, 404, 429, 503])(
    "rejects secondary image HTTP %s before reading an error body or creating output",
    async (status) => {
      const response = mediaResponse("<html>gateway failure</html>", "text/html", status);
      const blobSpy = vi.spyOn(response, "blob");
      const textSpy = vi.spyOn(response, "text");
      fetchMock.mockResolvedValueOnce(jsonResponse(imagePayload())).mockResolvedValueOnce(response);

      const promise = proxyClient().generateImage("a portrait");
      await expect(promise).rejects.toMatchObject({
        name: "WebMediaFetchError",
        code: "MEDIA_FETCH_ERROR",
        operation: "generateImage",
        mediaKind: "image",
        statusCode: status,
      });

      expect(blobSpy).not.toHaveBeenCalled();
      expect(textSpy).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects an expired signed audio URL without exposing the URL", async () => {
    const response = mediaResponse("expired", "text/plain", 403);
    const blobSpy = vi.spyOn(response, "blob");
    fetchMock.mockResolvedValueOnce(jsonResponse(musicPayload())).mockResolvedValueOnce(response);

    const error = await proxyClient()
      .generateMusic("a song")
      .catch((value: unknown) => value as WebMediaFetchError);

    expect(error).toBeInstanceOf(WebMediaFetchError);
    expect(error.statusCode).toBe(403);
    expect(error.operation).toBe("generateMusic");
    expect(error.message).toContain("authorization");
    expect(error.message).toContain("expired");
    expect(error.message).not.toContain("secret-audio-token");
    expect(error.message).not.toContain(SIGNED_AUDIO_URL);
    expect(blobSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["image", "text/html", "generateImage"],
    ["audio", "image/png", "generateMusic"],
  ] as const)("rejects a 200 response with wrong %s MIME", async (kind, contentType, operation) => {
    const response = mediaResponse("not media", contentType);
    const blobSpy = vi.spyOn(response, "blob");
    fetchMock
      .mockResolvedValueOnce(
        operation === "generateImage" ? jsonResponse(imagePayload()) : jsonResponse(musicPayload()),
      )
      .mockResolvedValueOnce(response);

    const promise =
      operation === "generateImage"
        ? proxyClient().generateImage("a scene")
        : proxyClient().generateMusic("a song");

    await expect(promise).rejects.toMatchObject({
      name: "WebMediaFetchError",
      code: "MEDIA_FETCH_ERROR",
      operation,
      statusCode: 200,
    });
    expect(blobSpy).not.toHaveBeenCalled();
  });

  it("rejects empty media bodies and does not return a playable Blob", async () => {
    const response = mediaResponse(new Uint8Array(), "image/png");
    fetchMock.mockResolvedValueOnce(jsonResponse(imagePayload())).mockResolvedValueOnce(response);

    await expect(proxyClient().generateImage("an empty result")).rejects.toMatchObject({
      name: "WebMediaFetchError",
      statusCode: 200,
    });
  });

  it("rejects a declared oversized body before reading it", async () => {
    const response = mediaResponse(new Uint8Array([1]), "audio/mpeg", 200, 100 * 1024 * 1024 + 1);
    const blobSpy = vi.spyOn(response, "blob");
    fetchMock.mockResolvedValueOnce(jsonResponse(musicPayload())).mockResolvedValueOnce(response);

    await expect(proxyClient().generateMusic("a large result")).rejects.toMatchObject({
      name: "WebMediaFetchError",
      operation: "generateMusic",
      mediaKind: "audio",
      statusCode: 200,
    });
    expect(blobSpy).not.toHaveBeenCalled();
  });

  it("propagates abort during the secondary URL fetch", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/image")) return Promise.resolve(jsonResponse(imagePayload()));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });

    const promise = proxyClient().generateImage("an abortable result", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not retry URL failure as a new generation request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(imagePayload()))
      .mockResolvedValueOnce(mediaResponse("busy", "text/plain", 503));

    await expect(proxyClient().generateImage("do not regenerate")).rejects.toMatchObject({
      statusCode: 503,
      operation: "generateImage",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://proxy.example.test/image");
  });
});
