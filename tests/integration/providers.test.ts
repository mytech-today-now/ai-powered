/**
 * @file tests/integration/providers.test.ts
 *
 * Integration-level tests for MockProvider and VeniceProvider.
 * MockProvider is exercised against the full modality surface.
 * VeniceProvider is tested without a real API key — only the capability guards
 * and constructor validation are exercised (no network I/O).
 */

import { z } from "zod";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import { VeniceProvider } from "../../src/ai-powered/providers/venice.js";
import { ProviderCapabilityError } from "../../src/ai-powered/types.js";

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
// VeniceProvider — no-network tests
// ---------------------------------------------------------------------------

describe("VeniceProvider", () => {
  it("throws when constructed without an API key", () => {
    const config = AiConfigSchema.parse({ provider: "venice" });
    expect(() => new VeniceProvider(config)).toThrow(
      "Venice API key is required",
    );
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

