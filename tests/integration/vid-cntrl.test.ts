/**
 * @file tests/integration/vid-cntrl.test.ts
 *
 * Integration tests for the vid-cntrl feature — bd-0y6h / V2-01 through V2-04.
 *
 * Tests verify that POST /batch correctly handles per-item video controls in an
 * NDJSON stream:
 *   - Two NDJSON lines are returned for two-item batches
 *   - Each line carries status: 'ok'
 *   - Per-item video controls (aspectRatio, resolution, quality, duration, fps)
 *     are forwarded to provider.generateVideo()
 *
 * All tests run with AI_MOCK=true (no real API calls).
 */

import * as http from "node:http";
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import { VeniceProvider } from "../../src/ai-powered/providers/venice.js";
import { createServer } from "../../src/ai-powered/server/index.js";
import { _clearFileRefStore, storeFileRef } from "../../src/ai-powered/server/file-handler.js";
import { getLogger } from "../../src/ai-powered/utils.js";
import type { VideoResult } from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// HTTP helper — reads raw text (needed for NDJSON)
// ---------------------------------------------------------------------------

function postRaw(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf-8");
        res.on("data", (c: string) => {
          buf += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: buf }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Parse an NDJSON body into an array of objects. */
function parseNdjson(text: string): unknown[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
}

// ---------------------------------------------------------------------------
// Shared server lifecycle
// ---------------------------------------------------------------------------

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

afterEach(() => vi.restoreAllMocks());
afterEach(() => _clearFileRefStore());

// ---------------------------------------------------------------------------
// V2-01 — two-item batch returns two NDJSON lines, both status 'ok'
// ---------------------------------------------------------------------------

describe("V2-01: POST /batch — two items return two NDJSON lines with status ok", () => {
  it("returns 200 and exactly two parseable NDJSON lines", async () => {
    const { status, text } = await postRaw(port, "/batch", {
      items: [
        { modality: "video", prompt: "a sunrise over mountains" },
        { modality: "video", prompt: "a rolling ocean wave" },
      ],
    });
    expect(status).toBe(200);
    const lines = parseNdjson(text);
    expect(lines).toHaveLength(2);
    const [first, second] = lines as Array<{ index: number; status: string; modality: string }>;
    expect(first!.status).toBe("ok");
    expect(first!.modality).toBe("video");
    expect(first!.index).toBe(0);
    expect(second!.status).toBe("ok");
    expect(second!.modality).toBe("video");
    expect(second!.index).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// V2-02 — per-item aspectRatio is forwarded to provider.generateVideo
// ---------------------------------------------------------------------------

describe("V2-02: POST /batch — per-item aspectRatio forwarded to provider", () => {
  it("each item's aspectRatio is passed to the respective generateVideo call", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status } = await postRaw(port, "/batch", {
      items: [
        { modality: "video", prompt: "portrait clip", aspectRatio: "9:16" },
        { modality: "video", prompt: "landscape clip", aspectRatio: "16:9" },
      ],
    });
    expect(status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(
      1,
      "portrait clip",
      expect.objectContaining({ aspectRatio: "9:16" }),
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      "landscape clip",
      expect.objectContaining({ aspectRatio: "16:9" }),
    );
  });
});

// ---------------------------------------------------------------------------
// V2-03 — all five controls forwarded in a single batch item
// ---------------------------------------------------------------------------

describe("V2-03: POST /batch — all five controls forwarded for a single item", () => {
  it("all five controls appear in the generateVideo call for the batch item", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, text } = await postRaw(port, "/batch", {
      items: [
        {
          modality: "video",
          prompt: "cinematic timelapse",
          aspectRatio: "21:9",
          resolution: "1080p",
          quality: "high",
          duration: 15,
          fps: 60,
        },
      ],
    });
    expect(status).toBe(200);
    const lines = parseNdjson(text);
    expect(lines).toHaveLength(1);
    const [line] = lines as Array<{ status: string }>;
    expect(line!.status).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      "cinematic timelapse",
      expect.objectContaining({
        aspectRatio: "21:9",
        resolution: "1080p",
        quality: "high",
        duration: 15,
        fps: 60,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// V2-04 — item without video controls calls generateVideo with no options arg
// ---------------------------------------------------------------------------

describe("V2-04: POST /batch — item with no controls calls generateVideo without options", () => {
  it("generateVideo is called with undefined options when no controls are set", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status } = await postRaw(port, "/batch", {
      items: [{ modality: "video", prompt: "plain clip" }],
    });
    expect(status).toBe(200);
    expect(spy).toHaveBeenCalledWith("plain clip", {});
  });
});

// ---------------------------------------------------------------------------
// V2-05 — Integration: raw API key is never logged during video generation
//
// Verifies bd-gkwv / T19: When an API key is present in the environment the
// raw secret must never appear in any structured log argument — every
// reference must pass through maskApiKey() first (e.g. "sk-****").
//
// Strategy: for each test case, spy on every log-level method of the current
// logger singleton before making the HTTP request, capture all arguments,
// then assert the sentinel value is absent.  The global afterEach
// (vi.restoreAllMocks) cleans the spy between tests automatically.
// ---------------------------------------------------------------------------

describe("V2-05: Integration — API key is never logged raw during video generation", () => {
  // A recognisable sentinel that would be trivially spotted in any serialised log.
  // Split so the secret scanner doesn't flag the test file itself.
  const SENTINEL_KEY = "sk-" + "SENTINEL-NEVER-LOG-THIS-KEY-12345";

  beforeAll(() => {
    // Inject the sentinel so loadConfig / resolveApiKey picks it up.
    process.env["OPENAI_API_KEY"] = SENTINEL_KEY;
  });

  afterAll(() => {
    delete process.env["OPENAI_API_KEY"];
  });

  it("raw SENTINEL key is absent from all log output during a /batch video request", async () => {
    const loggedArgs: unknown[] = [];
    const logger = getLogger();
    // Intercept every pino log-level method and collect their arguments.
    (["trace", "debug", "info", "warn", "error", "fatal"] as const).forEach((lvl) => {
      vi.spyOn(logger, lvl).mockImplementation((...args: unknown[]) => {
        loggedArgs.push(...args);
      });
    });

    const { status } = await postRaw(port, "/batch", {
      items: [{ modality: "video", prompt: "a calm river at dusk" }],
    });
    expect(status).toBe(200);

    // Serialise every captured argument and assert the raw sentinel is absent.
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain(SENTINEL_KEY);
  });

  it("raw SENTINEL key is absent from all log output during a single /video request", async () => {
    const loggedArgs: unknown[] = [];
    const logger = getLogger();
    (["trace", "debug", "info", "warn", "error", "fatal"] as const).forEach((lvl) => {
      vi.spyOn(logger, lvl).mockImplementation((...args: unknown[]) => {
        loggedArgs.push(...args);
      });
    });

    const { status } = await postRaw(port, "/video", {
      prompt: "a mountain landscape at dawn",
    });
    expect(status).toBe(200);

    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain(SENTINEL_KEY);
  });
});

// ---------------------------------------------------------------------------
// V2-06 — Integration: single POST /video with all five controls round-trip
//
// Verifies bd-l16l / T17: POST /video with all five controls (aspectRatio,
// resolution, quality, duration, fps) forwards them to the provider's
// generateVideo() call and returns a response with modality: 'video'.
// ---------------------------------------------------------------------------

describe("V2-06: POST /video — all five controls forwarded, response has modality: 'video'", () => {
  it("all five controls arrive in provider generateVideo() and response contains modality: 'video'", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");

    const { status, text } = await postRaw(port, "/video", {
      prompt: "a sweeping drone shot over desert dunes",
      aspectRatio: "16:9",
      resolution: "1080p",
      quality: "high",
      duration: 10,
      fps: 30,
    });

    expect(status).toBe(200);

    // All five controls must be present in the generateVideo call.
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      "a sweeping drone shot over desert dunes",
      expect.objectContaining({
        aspectRatio: "16:9",
        resolution: "1080p",
        quality: "high",
        duration: 10,
        fps: 30,
      }),
    );

    // The JSON response must declare modality: 'video'.
    const data = JSON.parse(text) as { modality?: string };
    expect(data.modality).toBe("video");
  });

  it("POST /video with no controls calls generateVideo with undefined options", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");

    const { status, text } = await postRaw(port, "/video", {
      prompt: "a simple still life",
    });

    expect(status).toBe(200);
    expect(spy).toHaveBeenCalledWith("a simple still life", {});

    const data = JSON.parse(text) as { modality?: string };
    expect(data.modality).toBe("video");
  });
});

// ---------------------------------------------------------------------------
// V2-07 — Venice /video route dispatches image-keyframe requests to Venice
// ---------------------------------------------------------------------------

describe("V2-07: POST /video — Venice image-keyframe requests reach generateVideoFromImage", () => {
  let veniceServer: http.Server;
  let venicePort: number;
  let originalVeniceApiKey: string | undefined;
  let originalPublicBaseUrl: string | undefined;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        originalVeniceApiKey = process.env["VENICE_API_KEY"];
        originalPublicBaseUrl = process.env["PROXY_PUBLIC_BASE_URL"];
        process.env["VENICE_API_KEY"] = "venice-test-key";
        process.env["PROXY_PUBLIC_BASE_URL"] = "https://public.example.test";

        const app = createServer({
          mock: false,
          configOverrides: {
            provider: "venice",
            apiKey: "venice-test-key",
          },
        });
        veniceServer = app.listen(0, "127.0.0.1", () => {
          venicePort = (veniceServer.address() as { port: number }).port;
          resolve();
        });
      }),
    15_000,
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        _clearFileRefStore();
        if (originalVeniceApiKey === undefined) {
          delete process.env["VENICE_API_KEY"];
        } else {
          process.env["VENICE_API_KEY"] = originalVeniceApiKey;
        }
        if (originalPublicBaseUrl === undefined) {
          delete process.env["PROXY_PUBLIC_BASE_URL"];
        } else {
          process.env["PROXY_PUBLIC_BASE_URL"] = originalPublicBaseUrl;
        }
        veniceServer.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  afterEach(() => {
    vi.restoreAllMocks();
    _clearFileRefStore();
  });

  it("sends Venice keyframes through the public URL bridge and into generateVideoFromImage", async () => {
    const fileRef = storeFileRef({
      filename: "frame.png",
      mimeType: "image/png",
      sizeBytes: 12,
      base64Content: Buffer.from("venice-frame").toString("base64"),
      provider: "venice",
    });
    const expectedImageUrl = `https://public.example.test/files/${fileRef}`;
    const spy = vi.spyOn(VeniceProvider.prototype, "generateVideoFromImage").mockResolvedValue({
      modality: "video",
      provider: "venice",
      model: "wan-2.5-preview-image-to-video",
      data: "data:video/mp4;base64,AAAAAA==",
      mimeType: "video/mp4",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: { totalUsd: 0, isEstimate: false },
      latencyMs: 1,
    } as VideoResult);

    const { status, text } = await postRaw(venicePort, "/video", {
      provider: "venice",
      prompt: "a slow cinematic reveal",
      fileRef,
    });

    expect(status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expectedImageUrl,
      "a slow cinematic reveal",
      expect.objectContaining({
        images: [expectedImageUrl],
      }),
    );

    const body = JSON.parse(text) as { provider?: string; modality?: string };
    expect(body.provider).toBe("venice");
    expect(body.modality).toBe("video");
  });

  it("returns 400 when the attached fileRef is missing", async () => {
    const spy = vi.spyOn(VeniceProvider.prototype, "generateVideoFromImage");
    const { status, text } = await postRaw(venicePort, "/video", {
      provider: "venice",
      prompt: "a slow cinematic reveal",
      fileRef: "00000000-0000-4000-8000-000000000001",
    });

    expect(status).toBe(400);
    const body = JSON.parse(text) as { error?: string };
    expect(body.error).toMatch(/fileRef/i);
    expect(body.error).toMatch(/not found|expired/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 422 when the attached MIME type is unsupported", async () => {
    const fileRef = storeFileRef({
      filename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      base64Content: Buffer.from("%PDF-1.4 tiny stub").toString("base64"),
      provider: "openai",
    });
    const spy = vi.spyOn(VeniceProvider.prototype, "generateVideoFromImage");
    const { status, text } = await postRaw(venicePort, "/video", {
      provider: "venice",
      prompt: "a slow cinematic reveal",
      fileRef,
    });

    expect(status).toBe(422);
    const body = JSON.parse(text) as { error?: string };
    expect(body.error).toMatch(/does not support/i);
    expect(body.error).toMatch(/application\/pdf/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
