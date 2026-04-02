/**
 * @file tests/integration/providers.test.ts
 *
 * Integration-level tests for MockProvider, OpenAiProvider, AnthropicProvider,
 * VeniceProvider, and LumaAIProvider.
 * MockProvider is exercised against the full modality surface.
 * All other providers are tested without real API keys — only constructor
 * validation, capability guards, and static metadata are exercised (no
 * network I/O), with the exception of LumaAIProvider which mocks the SDK.
 */

import { z } from "zod";
import { vi } from "vitest";
import { AiConfigSchema, loadConfig } from "../../src/ai-powered/core.js";
import { AiClient } from "../../src/ai-powered/client.js";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import { VeniceProvider } from "../../src/ai-powered/providers/venice.js";
import { OpenAiProvider } from "../../src/ai-powered/providers/openai.js";
import { AnthropicProvider } from "../../src/ai-powered/providers/anthropic.js";
import { ProviderCapabilityError, ProviderError } from "../../src/ai-powered/types.js";
import { getLogger } from "../../src/ai-powered/utils.js";
import { createProvider } from "../../src/ai-powered/providers/index.js";

// ---------------------------------------------------------------------------
// Luma AI SDK mock — must be declared before any imports of lumaai
// ---------------------------------------------------------------------------

const mockGenerationsCreate = vi.hoisted(() => vi.fn());
const mockGenerationsGet = vi.hoisted(() => vi.fn());

vi.mock("lumaai", () => {
  /** Minimal APIError mirroring the real SDK shape. */
  class APIError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "APIError";
      this.status = status;
    }
  }

  // Must be a class (or a regular `function`, not an arrow) so that
  // `new LumaAI(...)` succeeds inside the provider constructor.
  class MockLumaAI {
    generations = {
      create: mockGenerationsCreate,
      get: mockGenerationsGet,
    };
  }
  (MockLumaAI as unknown as Record<string, unknown>)["APIError"] = APIError;

  return { default: MockLumaAI };
});

import { LumaAIProvider } from "../../src/ai-powered/providers/lumaai.js";

// ---------------------------------------------------------------------------
// MockProvider
// ---------------------------------------------------------------------------

describe("MockProvider", () => {
  const config = AiConfigSchema.parse({ mock: true, provider: "mock" });
  const provider = new MockProvider(config);

  describe("generateText", () => {
    it("returns a TextResult with correct shape and non-empty content", async () => {
      const result = await provider.generateText("test prompt");
      expect(result.modality).toBe("text");
      expect(result.provider).toBe("mock");
      expect(result.model).toBe("mock-text-v1");
      expect(typeof result.content).toBe("string");
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.usage.totalTokens).toBeGreaterThan(0);
      expect(result.finishReason).toBe("stop");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("POST /text mock response: cost.totalUsd is positive and isEstimate is false", async () => {
      // This mirrors what the server's POST /text endpoint returns in mock mode:
      // the provider calls calculateCost() with real token counts, so totalUsd > 0.
      const result = await provider.generateText("integration cost check");
      expect(result.cost.totalUsd).toBeGreaterThan(0);
      expect(result.cost.isEstimate).toBe(false);
    });
  });

  describe("generateImage", () => {
    it("returns an ImageResult with a base64 data URI", async () => {
      const result = await provider.generateImage("a red square");
      expect(result.modality).toBe("image");
      expect(result.provider).toBe("mock");
      expect(result.data).toMatch(/^data:image\//);
      expect(result.mimeType).toBe("image/png");
      expect(result.cost.totalUsd).toBeGreaterThanOrEqual(0);
    });
  });

  describe("generateStructured", () => {
    it("parses data through the supplied Zod schema", async () => {
      const schema = z.object({ name: z.string().default("test") });
      const result = await provider.generateStructured("give me a name", schema);
      expect(result.modality).toBe("structured");
      expect(result.data).toHaveProperty("name");
      expect(typeof result.data.name).toBe("string");
    });
  });

  describe("listModels", () => {
    it("returns at least one model for every supported modality", async () => {
      const models = await provider.listModels();
      const modalityCoverage = new Set(models.flatMap((m) => m.capabilities));
      expect(modalityCoverage.has("text")).toBe(true);
      expect(modalityCoverage.has("image")).toBe(true);
      expect(modalityCoverage.has("audio")).toBe(true);
      expect(modalityCoverage.has("video")).toBe(true);
      expect(modalityCoverage.has("structured")).toBe(true);
    });

    it("includes a dedicated image model with the image capability", async () => {
      const models = await provider.listModels("image");
      const imageModel = models.find((m) => m.id === "mock-image-v1");
      expect(imageModel).toBeDefined();
      expect(imageModel!.capabilities).toContain("image");
    });
  });

  describe("streamText", () => {
    it("yields at least one chunk", async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.streamText("stream test")) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toContain("mock response");
    });
  });
});

// ---------------------------------------------------------------------------
// OpenAiProvider — no-network tests
// ---------------------------------------------------------------------------

describe("OpenAiProvider", () => {
  const config = AiConfigSchema.parse({ provider: "openai", apiKey: "sk-test-key" });
  const provider = new OpenAiProvider(config);

  it("throws when constructed without an API key", () => {
    const cfg = AiConfigSchema.parse({ provider: "openai" });
    expect(() => new OpenAiProvider(cfg)).toThrow("OpenAI API key is required");
  });

  describe("listModels — no modality filter", () => {
    it("returns models covering all supported modalities", async () => {
      const models = await provider.listModels();
      const caps = new Set(models.flatMap((m) => m.capabilities));
      expect(caps.has("text")).toBe(true);
      expect(caps.has("image")).toBe(true);
      expect(caps.has("audio")).toBe(true);
      expect(caps.has("structured")).toBe(true);
    });
  });

  describe("listModels — filtered by modality", () => {
    it("returns only text models when modality=text", async () => {
      const models = await provider.listModels("text");
      expect(models.length).toBeGreaterThan(0);
      models.forEach((m) => expect(m.capabilities).toContain("text"));
    });

    it("returns only image models when modality=image", async () => {
      const models = await provider.listModels("image");
      expect(models.length).toBeGreaterThan(0);
      models.forEach((m) => expect(m.capabilities).toContain("image"));
      // text-only models must not appear
      const ids = models.map((m) => m.id);
      expect(ids).not.toContain("gpt-4o");
    });

    it("returns only audio models when modality=audio", async () => {
      const models = await provider.listModels("audio");
      expect(models.length).toBeGreaterThan(0);
      models.forEach((m) => expect(m.capabilities).toContain("audio"));
    });

    it("returns only structured models when modality=structured", async () => {
      const models = await provider.listModels("structured");
      expect(models.length).toBeGreaterThan(0);
      models.forEach((m) => expect(m.capabilities).toContain("structured"));
      // image-only models must not appear
      const ids = models.map((m) => m.id);
      expect(ids).not.toContain("dall-e-3");
    });

    it("returns empty array for video modality (not supported)", async () => {
      const models = await provider.listModels("video");
      expect(models).toHaveLength(0);
    });
  });

  it("reports supported modalities — text, image, audio, structured", () => {
    expect(provider.supportedModalities).toContain("text");
    expect(provider.supportedModalities).toContain("image");
    expect(provider.supportedModalities).toContain("audio");
    expect(provider.supportedModalities).toContain("structured");
    expect(provider.supportedModalities).not.toContain("video");
  });

  it("throws ProviderCapabilityError for generateVideo (unsupported modality)", () => {
    expect(() => provider.generateVideo("a test prompt")).toThrow(ProviderCapabilityError);
  });
});

// ---------------------------------------------------------------------------
// AnthropicProvider — no-network tests
// ---------------------------------------------------------------------------

describe("AnthropicProvider", () => {
  const config = AiConfigSchema.parse({ provider: "anthropic", apiKey: "sk-ant-test-key" });
  const provider = new AnthropicProvider(config);

  it("throws when constructed without an API key", () => {
    const cfg = AiConfigSchema.parse({ provider: "anthropic" });
    expect(() => new AnthropicProvider(cfg)).toThrow("Anthropic API key is required");
  });

  describe("listModels — no modality filter", () => {
    it("returns at least one model", async () => {
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe("listModels — filtered by modality", () => {
    it("returns only text models when modality=text", async () => {
      const models = await provider.listModels("text");
      expect(models.length).toBeGreaterThan(0);
      models.forEach((m) => expect(m.capabilities).toContain("text"));
    });

    it("returns only structured models when modality=structured", async () => {
      const models = await provider.listModels("structured");
      expect(models.length).toBeGreaterThan(0);
      models.forEach((m) => expect(m.capabilities).toContain("structured"));
    });

    it("returns empty array for image modality (not supported)", async () => {
      const models = await provider.listModels("image");
      expect(models).toHaveLength(0);
    });

    it("returns empty array for audio modality (not supported)", async () => {
      const models = await provider.listModels("audio");
      expect(models).toHaveLength(0);
    });

    it("returns empty array for video modality (not supported)", async () => {
      const models = await provider.listModels("video");
      expect(models).toHaveLength(0);
    });
  });

  it("reports supported modalities — text and structured only", () => {
    expect(provider.supportedModalities).toContain("text");
    expect(provider.supportedModalities).toContain("structured");
    expect(provider.supportedModalities).not.toContain("image");
    expect(provider.supportedModalities).not.toContain("audio");
    expect(provider.supportedModalities).not.toContain("video");
  });

  it("throws ProviderCapabilityError for generateImage (unsupported modality)", () => {
    expect(() => provider.generateImage("a test prompt")).toThrow(ProviderCapabilityError);
  });

  it("throws ProviderCapabilityError for synthesizeSpeech (unsupported modality)", () => {
    expect(() => provider.synthesizeSpeech("hello")).toThrow(ProviderCapabilityError);
  });

  it("throws ProviderCapabilityError for generateVideo (unsupported modality)", () => {
    expect(() => provider.generateVideo("a test prompt")).toThrow(ProviderCapabilityError);
  });
});

// ---------------------------------------------------------------------------
// VeniceProvider — no-network tests
// ---------------------------------------------------------------------------

describe("VeniceProvider", () => {
  it("throws when constructed without an API key", () => {
    const config = AiConfigSchema.parse({ provider: "venice" });
    expect(() => new VeniceProvider(config)).toThrow("Venice API key is required");
  });

  it("throws ProviderCapabilityError for transcribeAudio (unsupported modality)", () => {
    const config = AiConfigSchema.parse({ provider: "venice", apiKey: "ven-test-key" });
    const provider = new VeniceProvider(config);
    expect(() => provider.transcribeAudio(Buffer.alloc(0))).toThrow(ProviderCapabilityError);
  });

  it("throws ProviderCapabilityError for generateVideo (unsupported modality)", () => {
    const config = AiConfigSchema.parse({ provider: "venice", apiKey: "ven-test-key" });
    const provider = new VeniceProvider(config);
    expect(() => provider.generateVideo("make a movie")).toThrow(ProviderCapabilityError);
  });

  it("reports supported modalities as text, image, and structured", () => {
    const config = AiConfigSchema.parse({ provider: "venice", apiKey: "ven-test-key" });
    const provider = new VeniceProvider(config);
    expect(provider.supportedModalities).toContain("text");
    expect(provider.supportedModalities).toContain("image");
    expect(provider.supportedModalities).toContain("structured");
    expect(provider.supportedModalities).not.toContain("audio");
    expect(provider.supportedModalities).not.toContain("video");
  });
});

// ---------------------------------------------------------------------------
// LumaAIProvider — SDK-mocked tests (no network I/O)
// ---------------------------------------------------------------------------

/** Minimal completed Generation fixture returned by the mocked SDK. */
const COMPLETED_GENERATION = {
  id: "gen-test-123",
  state: "completed" as const,
  assets: { video: "https://cdn.lumalabs.ai/video/test.mp4" },
  failure_reason: undefined,
};

/** A base64-encoded 1-byte mp4 stub returned by the mocked fetch. */
const STUB_VIDEO_B64 = Buffer.from("fakevideobytes").toString("base64");
const STUB_DATA_URI = `data:video/mp4;base64,${STUB_VIDEO_B64}`;

describe("LumaAIProvider", () => {
  const config = AiConfigSchema.parse({ provider: "lumaai", apiKey: "luma-test-key" });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: create returns a queued job; get returns completed on first poll.
    mockGenerationsCreate.mockResolvedValue({ id: "gen-test-123", state: "queued" });
    mockGenerationsGet.mockResolvedValue(COMPLETED_GENERATION);
    // Stub global fetch to return a fake video buffer.
    // Use Uint8Array to guarantee a fresh, correctly-sized ArrayBuffer (Node.js
    // Buffer.prototype.buffer points to a pooled backing store and includes
    // bytes outside the buffer's own range).
    const fakeBytes = new Uint8Array(Buffer.from("fakevideobytes"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(fakeBytes.buffer),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --- Constructor ---

  it("throws when constructed without an API key", () => {
    // Temporarily remove the env var so the constructor can't fall back to it.
    const saved = process.env["LUMAAI_API_KEY"];
    delete process.env["LUMAAI_API_KEY"];
    try {
      const cfg = AiConfigSchema.parse({ provider: "lumaai" });
      expect(() => new LumaAIProvider(cfg)).toThrow("Luma AI API key is required");
    } finally {
      if (saved !== undefined) process.env["LUMAAI_API_KEY"] = saved;
    }
  });

  it("constructs successfully with a valid API key", () => {
    expect(() => new LumaAIProvider(config)).not.toThrow();
  });

  // --- Supported modalities ---

  it("supports only the video modality", () => {
    const provider = new LumaAIProvider(config);
    expect(provider.supportedModalities).toEqual(["video"]);
    expect(provider.supportedModalities).not.toContain("text");
    expect(provider.supportedModalities).not.toContain("image");
    expect(provider.supportedModalities).not.toContain("audio");
  });

  it("throws ProviderCapabilityError for generateText (unsupported)", () => {
    const provider = new LumaAIProvider(config);
    expect(() => provider.generateText("hello")).toThrow(ProviderCapabilityError);
  });

  it("throws ProviderCapabilityError for generateImage (unsupported)", () => {
    const provider = new LumaAIProvider(config);
    expect(() => provider.generateImage("hello")).toThrow(ProviderCapabilityError);
  });

  // --- listModels ---

  it("listModels() returns ray-2 and ray-flash-2", async () => {
    const provider = new LumaAIProvider(config);
    const models = await provider.listModels();
    const ids = models.map((m) => m.id);
    expect(ids).toContain("ray-2");
    expect(ids).toContain("ray-flash-2");
    models.forEach((m) => expect(m.capabilities).toContain("video"));
  });

  it("listModels('video') returns both video models", async () => {
    const provider = new LumaAIProvider(config);
    const models = await provider.listModels("video");
    expect(models.length).toBeGreaterThanOrEqual(2);
    models.forEach((m) => expect(m.capabilities).toContain("video"));
  });

  it("listModels('text') returns empty array (no text models)", async () => {
    const provider = new LumaAIProvider(config);
    const models = await provider.listModels("text");
    expect(models).toHaveLength(0);
  });

  // --- generateVideo — happy path ---

  it("generateVideo resolves with a valid VideoResult data URI", async () => {
    const provider = new LumaAIProvider(config);
    const result = await provider.generateVideo("a calm ocean at sunset");

    expect(result.modality).toBe("video");
    expect(result.provider).toBe("lumaai");
    expect(result.model).toBe("ray-2");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.data).toBe(STUB_DATA_URI);
    // ray-2 has a fixed per-clip cost of $0.14 (calculateCost, not estimated).
    expect(result.cost.totalUsd).toBe(0.14);
    expect(result.cost.isEstimate).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockGenerationsCreate).toHaveBeenCalledOnce();
    expect(mockGenerationsGet).toHaveBeenCalledWith("gen-test-123", expect.anything());
  });

  it("generateVideo polls through 'dreaming' state before completing", async () => {
    mockGenerationsGet
      .mockResolvedValueOnce({ id: "gen-test-123", state: "dreaming" })
      .mockResolvedValueOnce({ id: "gen-test-123", state: "dreaming" })
      .mockResolvedValueOnce(COMPLETED_GENERATION);

    // Stub _sleep so tests are not slowed by real 3-second delays.
    vi.useFakeTimers();
    const provider = new LumaAIProvider(config);
    const videoPromise = provider.generateVideo("stormy sea");

    // Advance timers for each poll interval (3 polls × 3000ms).
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const result = await videoPromise;
    expect(result.modality).toBe("video");
    expect(mockGenerationsGet).toHaveBeenCalledTimes(3);
  });

  it("generateVideo throws ProviderError when generation fails", async () => {
    mockGenerationsGet.mockResolvedValue({
      id: "gen-test-123",
      state: "failed",
      failure_reason: "content policy violation",
    });

    const provider = new LumaAIProvider(config);
    await expect(provider.generateVideo("disallowed prompt")).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.generateVideo("disallowed prompt")).rejects.toMatchObject({
      provider: "lumaai",
      retryable: false,
    });
  });

  it("generateVideo wraps a 429 SDK error as a retryable ProviderError", async () => {
    const { default: LumaAIModule } = await import("lumaai");
    const ApiErrorClass = (LumaAIModule as unknown as Record<string, unknown>)["APIError"] as new (
      msg: string,
      status?: number,
    ) => Error;
    mockGenerationsCreate.mockRejectedValue(new ApiErrorClass("rate limited", 429));

    const provider = new LumaAIProvider(config);
    await expect(provider.generateVideo("test")).rejects.toMatchObject({
      provider: "lumaai",
      retryable: true,
    });
  });

  it("generateVideo throws ProviderError when AbortSignal fires before submission", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new LumaAIProvider(config);
    await expect(
      provider.generateVideo("test", { signal: controller.signal }),
    ).rejects.toMatchObject({ provider: "lumaai", retryable: false });
  });

  // --- generateVideoFromImage ---

  it("generateVideoFromImage passes keyframes.frame0 with the image URL", async () => {
    const provider = new LumaAIProvider(config);
    const result = await provider.generateVideoFromImage(
      "https://example.com/frame.jpg",
      "zoom in slowly",
    );

    expect(result.modality).toBe("video");
    expect(result.data).toBe(STUB_DATA_URI);
    expect(mockGenerationsCreate).toHaveBeenCalledOnce();
    const callArg = mockGenerationsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect((callArg["keyframes"] as Record<string, unknown>)["frame0"]).toMatchObject({
      type: "image",
      url: "https://example.com/frame.jpg",
    });
  });

  it("generateVideoFromImage works without a text prompt", async () => {
    const provider = new LumaAIProvider(config);
    const result = await provider.generateVideoFromImage("https://example.com/frame.jpg");
    expect(result.modality).toBe("video");
    // prompt key must not be present when undefined
    const callArg = mockGenerationsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("prompt");
  });

  // --- API key masking in Pino logs ---

  it("masks the API key in Pino debug log at construction — raw key never logged", () => {
    const logger = getLogger();
    const debugSpy = vi.spyOn(logger, "debug");
    const rawKey = "luma-super-secret-raw-key";
    const cfg = AiConfigSchema.parse({ provider: "lumaai", apiKey: rawKey });

    new LumaAIProvider(cfg);

    // Find the 'initialised' debug call emitted by the constructor.
    const initCall = debugSpy.mock.calls.find(
      (c) => typeof c[1] === "string" && (c[1] as string).includes("initialised"),
    );
    expect(initCall).toBeDefined();
    const payload = initCall![0] as Record<string, unknown>;
    // maskApiKey("luma-super-secret-raw-key") → "[REDACTED]" (no known prefix match)
    expect(payload["apiKey"]).not.toBe(rawKey);
    expect(payload["apiKey"]).toBe("[REDACTED]");

    debugSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createProvider — mock routing
// ---------------------------------------------------------------------------
//
// createProvider trusts config.mock exclusively.  The AI_MOCK env var is
// mapped to config.mock by loadConfig() at Layer 5; explicit flags (Layer 6)
// can override it.  createProvider must NOT re-read process.env["AI_MOCK"]
// directly — doing so would bypass intentional mock:false overrides from
// routes like GET /models?provider=lumaai.

describe("createProvider — mock routing", () => {
  it("returns MockProvider when config.mock is true, regardless of provider", () => {
    // Explicitly set mock:true in the config (as loadConfig would do when AI_MOCK=true).
    const cfg = AiConfigSchema.parse({ provider: "lumaai", apiKey: "luma-key", mock: true });
    expect(cfg.mock).toBe(true);
    const provider = createProvider(cfg);
    expect(provider).toBeInstanceOf(MockProvider);
  });

  it("loadConfig maps AI_MOCK=true env var to config.mock=true (layered config)", () => {
    // vitest.config.ts sets AI_MOCK=true for every test run; loadConfig picks it up.
    expect(process.env["AI_MOCK"]).toBe("true");
    const cfg = loadConfig({ flags: { provider: "lumaai", apiKey: "luma-key" } as never });
    expect(cfg.mock).toBe(true);
    const provider = createProvider(cfg);
    expect(provider).toBeInstanceOf(MockProvider);
  });

  it("explicit mock:false flag overrides AI_MOCK env var via loadConfig layering", () => {
    expect(process.env["AI_MOCK"]).toBe("true"); // env has AI_MOCK=true ...
    // ... but Layer 6 flags win, so mock should be false.
    const cfg = loadConfig({
      flags: { provider: "lumaai", apiKey: "luma-key", mock: false } as never,
    });
    expect(cfg.mock).toBe(false);
    // createProvider must honour config.mock=false and NOT fall back to mock.
    const provider = createProvider(cfg);
    // With a missing real API key lumaai may throw, but it will NOT be MockProvider.
    expect(provider).not.toBeInstanceOf(MockProvider);
  });

  it("MockProvider handles video modality when config.mock=true", async () => {
    const cfg = AiConfigSchema.parse({ provider: "lumaai", apiKey: "luma-key", mock: true });
    const provider = createProvider(cfg);
    // MockProvider implements video; verify result shape.
    const result = await (provider as MockProvider).generateVideo("test prompt");
    expect(result.modality).toBe("video");
    expect(result.data).toMatch(/^data:video\//);
  });
});

// ---------------------------------------------------------------------------
// POST /batch route — server integration tests
// ---------------------------------------------------------------------------

import * as http from "node:http";
import { createServer } from "../../src/ai-powered/server/index.js";

/**
 * Read the full body of a Node.js IncomingMessage and JSON-parse it.
 * Used for non-NDJSON responses (e.g. validation error 400 bodies).
 */
function readBody(res: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    res.setEncoding("utf-8");
    res.on("data", (chunk: string) => {
      buf += chunk;
    });
    res.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
    res.on("error", reject);
  });
}

/**
 * Read the full body of a Node.js IncomingMessage (NDJSON stream) and return
 * each parsed line as an array.
 */
function readNdjson(res: http.IncomingMessage): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    let buf = "";
    res.setEncoding("utf-8");
    res.on("data", (chunk: string) => {
      buf += chunk;
    });
    res.on("end", () => {
      const lines = buf.split("\n").filter((l) => l.trim());
      try {
        resolve(lines.map((l) => JSON.parse(l)));
      } catch (e) {
        reject(e);
      }
    });
    res.on("error", reject);
  });
}

/**
 * POST JSON to a running server and return the raw IncomingMessage so tests
 * can stream NDJSON line by line.
 */
function postBatch(port: number, body: unknown): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/batch",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("POST /batch — server route", () => {
  let server: http.Server;
  let port: number;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        const app = createServer({ mock: true });
        server = app.listen(0, "127.0.0.1", () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      }),
    15_000,
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  // T-BA-01: missing prompt inside an item → 400 with Zod error path
  it("T-BA-01: returns 400 and Zod error when item is missing prompt", async () => {
    const res = await postBatch(port, { items: [{ modality: "video" }] });
    expect(res.statusCode).toBe(400);
    const body = (await readBody(res)) as Record<string, unknown>;
    expect(body["issues"]).toBeDefined();
    const issues = body["issues"] as string[];
    expect(issues.some((s) => s.includes("items.0.prompt"))).toBe(true);
  });

  // T-BA-02: empty items array → 400
  it("T-BA-02: returns 400 when items array is empty", async () => {
    const res = await postBatch(port, { items: [] });
    expect(res.statusCode).toBe(400);
  });

  // T-BA-04: missing items field entirely → 400
  it("T-BA-04: returns 400 when items field is missing", async () => {
    const res = await postBatch(port, { prompt: "oops" });
    expect(res.statusCode).toBe(400);
  });

  // T-BA-05: two text items — both succeed with status:"ok"
  it("T-BA-05: happy-path — streams one NDJSON line per text item", async () => {
    const items = [
      { modality: "text", name: "Shot 1", prompt: "Hello world" },
      { modality: "text", name: "Shot 2", prompt: "Goodbye world" },
    ];
    const res = await postBatch(port, { items });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);

    const lines = await readNdjson(res);
    expect(lines).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const line = lines[i] as Record<string, unknown>;
      expect(line["index"]).toBe(i);
      expect(line["name"]).toBe(items[i]!.name);
      expect(line["status"]).toBe("ok");
      expect(line["result"]).toBeDefined();
    }
  });

  // T-BA-06: single video item — result.data starts with "data:video/"
  it("T-BA-06: video batch item — result.data starts with data:video/", async () => {
    const res = await postBatch(port, {
      items: [{ modality: "video", name: "Clip 1", prompt: "A sunset over mountains" }],
    });
    expect(res.statusCode).toBe(200);
    const [line] = (await readNdjson(res)) as Array<Record<string, unknown>>;
    expect(line!["status"]).toBe("ok");
    expect(line!["modality"]).toBe("video");
    const result = line!["result"] as Record<string, unknown>;
    expect(typeof result["data"]).toBe("string");
    expect((result["data"] as string).startsWith("data:video/")).toBe(true);
  });

  // T-BA-09: per-item error does not abort the stream
  it("T-BA-09: per-item error does not abort remaining items", async () => {
    // Spy at the AiClient level (above _executeWithFallback) so the thrown
    // Error remains a plain Error — not AllProvidersExhaustedError — and the
    // batch route writes status:"error" for that item and continues the stream.
    let callCount = 0;
    const originalFn = AiClient.prototype.generateText;
    const spy = vi.spyOn(AiClient.prototype, "generateText").mockImplementation(function (
      this: AiClient,
      prompt,
      options,
    ) {
      callCount++;
      if (callCount === 2) throw new Error("Simulated per-item failure");
      return originalFn.call(this, prompt, options);
    });

    try {
      const items = [
        { modality: "text", prompt: "First" },
        { modality: "text", prompt: "Second (will fail)" },
        { modality: "text", prompt: "Third" },
      ];
      const res = await postBatch(port, { items });
      expect(res.statusCode).toBe(200);
      const lines = (await readNdjson(res)) as Array<Record<string, unknown>>;
      expect(lines).toHaveLength(3);
      expect(lines[0]!["status"]).toBe("ok");
      expect(lines[1]!["status"]).toBe("error");
      expect(lines[2]!["status"]).toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });
});
