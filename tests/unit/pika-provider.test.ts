import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { PikaProvider } from "../../src/ai-powered/providers/pika.js";
import { LimitsValidator } from "../../src/ai-powered/limits-validator.js";

const config = AiConfigSchema.parse({ provider: "pika", apiKey: "pika-test-key" });

function mockPikaFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/media/jobs/") && url.endsWith("/content")) {
      return new Response(JSON.stringify({ url: "https://cdn.example.test/video.mp4" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v1/media/jobs/")) {
      return new Response(
        JSON.stringify({
          request_id: "job-123",
          status: "completed",
          output: { video: { url: "https://cdn.example.test/video.mp4" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://cdn.example.test/video.mp4") {
      return new Response(Buffer.from("pika-video"), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    }
    expect(init?.headers).toMatchObject({ "X-API-Key": "pika-test-key" });
    return new Response(JSON.stringify({ request_id: "job-123", status: "queued" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function submittedBody(fetchMock: ReturnType<typeof mockPikaFetch>) {
  const submitCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/v1/media/"));
  expect(submitCall).toBeDefined();
  return JSON.parse(String(submitCall?.[1]?.body));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PikaProvider", () => {
  it("lists all current Pika video-output endpoints with options and input requirements", async () => {
    const models = await new PikaProvider(config).listModels("video");
    expect(models).toHaveLength(7);
    expect(models.map((model) => model.id)).toContain("pika/pika-2.5/text-to-video");
    expect(models.find((model) => model.id.includes("pikaframes"))?.inputRequirements).toEqual([
      { modality: "image", min: 2, max: 5, required: true },
    ]);
    expect(models.find((model) => model.id.includes("pikaffects/image"))?.options?.[0]?.name).toBe(
      "pikaffect",
    );
    expect(models.find((model) => model.id === "pika/pika-2.5/text-to-video")?.modalities).toEqual([
      "video",
    ]);
  });

  it("submits a text-to-video job, polls it, and returns a video data URI", async () => {
    const fetchMock = mockPikaFetch();
    const result = await new PikaProvider(config).generateVideo("A fox running", {
      model: "pika/pika-2.5/text-to-video",
      resolution: "1080p",
      duration: 5,
      seed: 42,
      negativePrompt: "blurry",
    });

    expect(result.provider).toBe("pika");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.data).toContain("data:video/mp4;base64,");
    expect(submittedBody(fetchMock)).toMatchObject({
      resolution: "1080p",
      duration_s: 5,
      seed: 42,
      negative_prompt: "blurry",
    });
  });

  it("preserves explicit inputMedia MIME values without re-sniffing the URL", async () => {
    const validateSpy = vi.spyOn(LimitsValidator, "validateVideo");
    const fetchMock = mockPikaFetch();
    await new PikaProvider(config).generateVideo("Animate this asset", {
      model: "pika/pika-2.5/image-to-video",
      inputMedia: [{ url: "https://cdn.example.test/asset", mimeType: "image/webp" }],
    });

    expect(validateSpy).toHaveBeenCalledWith(
      "pika",
      "pika/pika-2.5/image-to-video",
      expect.objectContaining({
        inputMedia: [
          { modality: "image", url: "https://cdn.example.test/asset", mimeType: "image/webp" },
        ],
      }),
    );
    expect(fetchMock).toHaveBeenCalled();
    expect(submittedBody(fetchMock)).toMatchObject({
      image: "https://cdn.example.test/asset",
    });
  });

  it.each([
    ["https://cdn.example.test/frame.png", "image/png"],
    ["https://cdn.example.test/frame.webp", "image/webp"],
  ])("infers %s as %s for image inputs", async (url, mimeType) => {
    const validateSpy = vi.spyOn(LimitsValidator, "validateVideo");
    const fetchMock = mockPikaFetch();
    await new PikaProvider(config).generateVideo("Animate the still image", {
      model: "pika/pika-2.5/image-to-video",
      images: [url],
    });

    expect(validateSpy).toHaveBeenCalledWith(
      "pika",
      "pika/pika-2.5/image-to-video",
      expect.objectContaining({
        inputMedia: [{ modality: "image", url, mimeType }],
      }),
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it("infers video URLs instead of defaulting them to JPEG", async () => {
    const validateSpy = vi.spyOn(LimitsValidator, "validateVideo");
    const fetchMock = mockPikaFetch();
    await new PikaProvider(config).generateVideo("Add motion to the clip", {
      model: "pika/pikadditions/video-to-video",
      images: ["https://cdn.example.test/source.mov"],
    });

    expect(validateSpy).toHaveBeenCalledWith(
      "pika",
      "pika/pikadditions/video-to-video",
      expect.objectContaining({
        inputMedia: [
          {
            modality: "video",
            url: "https://cdn.example.test/source.mov",
            mimeType: "video/quicktime",
          },
        ],
      }),
    );
    expect(fetchMock).toHaveBeenCalled();
    expect(submittedBody(fetchMock)).toMatchObject({
      video: "https://cdn.example.test/source.mov",
    });
  });

  it("fails fast when a signed URL does not expose a known extension", async () => {
    const validateSpy = vi.spyOn(LimitsValidator, "validateVideo");
    const fetchMock = mockPikaFetch();
    await expect(
      new PikaProvider(config).generateVideo("Animate the asset", {
        model: "pika/pika-2.5/image-to-video",
        images: ["https://cdn.example.test/asset?signature=abc123"],
      }),
    ).rejects.toThrow(/inputMedia\.mimeType|supported image\/video file extension/i);
    expect(validateSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps video-to-video input and rejects more than five keyframes", async () => {
    const fetchMock = mockPikaFetch();
    await new PikaProvider(config).generateVideo("Replace the subject", {
      model: "pika/pikadditions/video-to-video",
      inputMedia: [{ url: "https://cdn.example.test/source.mp4", mimeType: "video/mp4" }],
    });
    expect(submittedBody(fetchMock)).toMatchObject({
      video: "https://cdn.example.test/source.mp4",
    });

    expect(() =>
      LimitsValidator.validateVideo("pika", "pika/pikaframes/image-to-video", {
        inputMedia: Array.from({ length: 6 }, (_, index) => ({
          modality: "image" as const,
          url: `https://cdn.example.test/${index}.png`,
        })),
      }),
    ).toThrow(/at most 5 image/);
  });

  it("enforces the Pikaframes long-transition boundary", async () => {
    await expect(
      new PikaProvider(config).generateVideo("A smooth transition", {
        model: "pika/pikaframes/image-to-video",
        transitionDuration: 6,
        images: ["https://cdn.example.test/one.png"],
      }),
    ).rejects.toThrow(/exactly 2 images/);
  });
});
