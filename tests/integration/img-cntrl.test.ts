/**
 * @file tests/integration/img-cntrl.test.ts
 *
 * Integration tests for the img-cntrl feature — bd-ak4p / I1-01 through I1-15.
 *
 * Tests verify that image/video control parameters (aspectRatio, width, height,
 * resolution, duration, fps, quality) flow correctly through the call chain:
 *   AiClient → provider.generateImage / provider.generateVideo
 *   POST /image and POST /video server routes → client → provider
 *
 * All tests run with AI_MOCK=true (no real API calls).
 */

import * as http from "node:http";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { AiClient } from "../../src/ai-powered/client.js";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import { ProviderCapabilityError, ProviderError } from "../../src/ai-powered/types.js";
import { LimitsValidator } from "../../src/ai-powered/limits-validator.js";
import { createServer } from "../../src/ai-powered/server/index.js";

// ---------------------------------------------------------------------------
// Helpers — build a mock AiClient + provider pair for call-option spy tests
// ---------------------------------------------------------------------------

function makeMockClient() {
  const config = AiConfigSchema.parse({ provider: "mock", mock: true });
  const provider = new MockProvider(config);
  const client = new AiClient(config, provider);
  return { client, provider };
}

// ---------------------------------------------------------------------------
// HTTP helpers (mirrors compat.test.ts)
// ---------------------------------------------------------------------------

function post(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
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
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Shared mock server (for route tests I1-14, I1-15)
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

// ---------------------------------------------------------------------------
// I1-01 — generateImage no size options
// ---------------------------------------------------------------------------

describe("I1-01: generateImage — no size options", () => {
  it("returns image result with no error (backward compat)", async () => {
    const { client } = makeMockClient();
    const result = await client.generateImage("a red circle");
    expect(result.modality).toBe("image");
    expect(result.provider).toBe("mock");
    expect(result.data).toMatch(/^data:image\//);
  });
});

// ---------------------------------------------------------------------------
// I1-02 to I1-04 — generateImage with options forwarded to provider
// ---------------------------------------------------------------------------

describe("I1-02 to I1-04: generateImage — options forwarded to provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("I1-02: aspectRatio '16:9' is passed to provider.generateImage", async () => {
    const { client, provider } = makeMockClient();
    const spy = vi.spyOn(provider, "generateImage");
    await client.generateImage("landscape", { aspectRatio: "16:9" });
    expect(spy).toHaveBeenCalledWith("landscape", expect.objectContaining({ aspectRatio: "16:9" }));
  });

  it("I1-03: width + height are passed to provider.generateImage", async () => {
    const { client, provider } = makeMockClient();
    const spy = vi.spyOn(provider, "generateImage");
    await client.generateImage("photo", { width: 1280, height: 720 });
    expect(spy).toHaveBeenCalledWith(
      "photo",
      expect.objectContaining({ width: 1280, height: 720 }),
    );
  });

  it("I1-04: aspectRatio '9:16' is passed to provider.generateImage", async () => {
    const { client, provider } = makeMockClient();
    const spy = vi.spyOn(provider, "generateImage");
    await client.generateImage("portrait", { aspectRatio: "9:16" });
    expect(spy).toHaveBeenCalledWith("portrait", expect.objectContaining({ aspectRatio: "9:16" }));
  });
});

// ---------------------------------------------------------------------------
// I1-05 — validateImage over-limit throws ProviderError with nearest-valid
// ---------------------------------------------------------------------------

describe("I1-05: over-limit image dimensions — ProviderError with nearest-valid", () => {
  beforeEach(() => {
    LimitsValidator._injectMockConfigs({
      venice: {
        provider: "venice",
        updatedAt: "2026-01-01",
        models: [
          {
            id: "fluently-xl",
            modalities: ["image"],
            resolutions: [
              { label: "1024×1024", width: 1024, height: 1024 },
              { label: "1280×720", width: 1280, height: 720 },
            ],
            maxWidth: 1280,
            maxHeight: 1280,
            maxPixels: 1638400,
          },
        ],
      },
      openai: { provider: "openai", updatedAt: "2026-01-01", models: [] },
      anthropic: { provider: "anthropic", updatedAt: "2026-01-01", models: [] },
      xai: { provider: "xai", updatedAt: "2026-01-01", models: [] },
      lumaai: { provider: "lumaai", updatedAt: "2026-01-01", models: [] },
    } as never);
  });

  afterEach(() => {
    LimitsValidator._injectMockConfigs(null);
  });

  it("venice fluently-xl 2000×2000 → ProviderError with nearest-valid hint", () => {
    expect(() => LimitsValidator.validateImage("venice", "fluently-xl", 2000, 2000)).toThrow(
      ProviderError,
    );
    try {
      LimitsValidator.validateImage("venice", "fluently-xl", 2000, 2000);
    } catch (err) {
      expect((err as ProviderError).message).toMatch(/nearest valid/i);
    }
  });
});

// ---------------------------------------------------------------------------
// I1-06 — Anthropic throws ProviderCapabilityError for image generation
// ---------------------------------------------------------------------------

describe("I1-06: Anthropic generateImage → ProviderCapabilityError", () => {
  it("throws ProviderCapabilityError directly from provider (no network call)", async () => {
    // BaseProvider.generateImage throws synchronously (before returning a
    // Promise), so we use the synchronous toThrow matcher rather than
    // rejects.toThrow.
    const { AnthropicProvider } = await import("../../src/ai-powered/providers/anthropic.js");
    const config = AiConfigSchema.parse({ provider: "anthropic", apiKey: "sk-test" });
    const provider = new AnthropicProvider(config);
    expect(() => provider.generateImage("a painting")).toThrow(ProviderCapabilityError);
  });
});

// ---------------------------------------------------------------------------
// I1-07 — generateVideo no size options
// ---------------------------------------------------------------------------

describe("I1-07: generateVideo — no size options", () => {
  it("returns video result with no error (backward compat)", async () => {
    const { client } = makeMockClient();
    const result = await client.generateVideo("a sunset");
    expect(result.modality).toBe("video");
    expect(result.provider).toBe("mock");
    expect(result.data).toMatch(/^data:video\//);
  });
});

// ---------------------------------------------------------------------------
// I1-08 to I1-09 — generateVideo with options forwarded to provider
// ---------------------------------------------------------------------------

describe("I1-08 to I1-09: generateVideo — options forwarded to provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("I1-08: aspectRatio '9:16' is passed to provider.generateVideo", async () => {
    const { client, provider } = makeMockClient();
    const spy = vi.spyOn(provider, "generateVideo");
    await client.generateVideo("portrait video", { aspectRatio: "9:16" });
    expect(spy).toHaveBeenCalledWith(
      "portrait video",
      expect.objectContaining({ aspectRatio: "9:16" }),
    );
  });

  it("I1-09: aspectRatio + duration are both passed to provider.generateVideo", async () => {
    const { client, provider } = makeMockClient();
    const spy = vi.spyOn(provider, "generateVideo");
    await client.generateVideo("ocean clip", { aspectRatio: "9:16", duration: 5 });
    expect(spy).toHaveBeenCalledWith(
      "ocean clip",
      expect.objectContaining({ aspectRatio: "9:16", duration: 5 }),
    );
  });
});

// ---------------------------------------------------------------------------
// I1-10 — validateVideo unsupported aspect ratio → ProviderError
// ---------------------------------------------------------------------------

describe("I1-10: unsupported video aspect ratio — ProviderError listing valid ratios", () => {
  beforeEach(() => {
    LimitsValidator._injectMockConfigs({
      lumaai: {
        provider: "lumaai",
        updatedAt: "2026-01-01",
        models: [
          {
            id: "ray-2-720p",
            modalities: ["video"],
            aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
            resolutions: [{ label: "720p", width: 1280, height: 720 }],
            maxWidth: 1280,
            maxHeight: 720,
            maxPixels: 921600,
            maxDurationSecs: 9,
            fpsOptions: [24],
          },
        ],
      },
      openai: { provider: "openai", updatedAt: "2026-01-01", models: [] },
      anthropic: { provider: "anthropic", updatedAt: "2026-01-01", models: [] },
      xai: { provider: "xai", updatedAt: "2026-01-01", models: [] },
      venice: { provider: "venice", updatedAt: "2026-01-01", models: [] },
    } as never);
  });

  afterEach(() => {
    LimitsValidator._injectMockConfigs(null);
  });

  it("lumaai ray-2-720p '21:9' → ProviderError listing supported ratios", () => {
    expect(() =>
      LimitsValidator.validateVideo("lumaai", "ray-2-720p", { aspectRatio: "21:9" }),
    ).toThrow(ProviderError);
    try {
      LimitsValidator.validateVideo("lumaai", "ray-2-720p", { aspectRatio: "21:9" });
    } catch (err) {
      const msg = (err as ProviderError).message;
      expect(msg).toMatch(/not supported/i);
      expect(msg).toMatch(/9:16|16:9/);
    }
  });
});

// ---------------------------------------------------------------------------
// I1-11 to I1-13 — CLI flag subprocess tests (bd-ocpj T14 implemented)
// ---------------------------------------------------------------------------

const BINARY = path.resolve("dist/ai-powered/cli/index.js");
const MOCK_ENV: NodeJS.ProcessEnv = { ...process.env, AI_MOCK: "true", NO_COLOR: "1" };

/** Build the CLI binary once before any CLI tests run (if not already built). */
beforeAll(() => {
  if (!fs.existsSync(BINARY)) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const r = spawnSync(npm, ["run", "build"], {
      encoding: "utf-8",
      stdio: "inherit",
      timeout: 120_000,
      cwd: path.resolve("."),
    });
    if (r.status !== 0) throw new Error(`Build failed: exit ${r.status ?? -1}`);
  }
}, 130_000);

describe("I1-11 to I1-13: CLI flags — subprocess tests (bd-ocpj T14)", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "img-cntrl-cli-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("I1-11: --aspect-ratio flag passed to generateImage (exits 0, file written)", () => {
    const outFile = path.join(tmpDir, "out.png");
    const r = spawnSync(
      "node",
      [BINARY, "image", "--mock", "--aspect-ratio", "16:9", "--output", outFile, "A sunset"],
      // 30 s: first subprocess spawn in a parallel fork incurs JIT cold-start overhead.
      { encoding: "utf-8", env: MOCK_ENV, timeout: 30_000 },
    );
    expect(r.status).toBe(0);
    expect(fs.existsSync(outFile)).toBe(true);
    expect(r.stderr).toContain("Saved to");
  }, 35_000);

  it("I1-12: --width / --height flags passed to generateImage (exits 0)", () => {
    const outFile = path.join(tmpDir, "out-wh.png");
    const r = spawnSync(
      "node",
      [
        BINARY,
        "image",
        "--mock",
        "--width",
        "1280",
        "--height",
        "720",
        "--output",
        outFile,
        "A landscape",
      ],
      { encoding: "utf-8", env: MOCK_ENV, timeout: 20_000 },
    );
    expect(r.status).toBe(0);
    expect(fs.existsSync(outFile)).toBe(true);
  });

  it("I1-13: --duration flag passed to generateVideo (exits 0 with --json output)", () => {
    const r = spawnSync(
      "node",
      [
        BINARY,
        "video",
        "--mock",
        "--aspect-ratio",
        "9:16",
        "--duration",
        "5",
        "--json",
        "A waterfall",
      ],
      { encoding: "utf-8", env: MOCK_ENV, timeout: 20_000 },
    );
    expect(r.status).toBe(0);
    const cleanStdout = r.stdout
      .split("\n")
      .filter((l) => !l.startsWith("[dotenv"))
      .join("\n");
    const result = JSON.parse(cleanStdout) as { modality?: string; data?: string };
    expect(result.modality).toBe("video");
    expect(result.data).toMatch(/^data:video\//);
    // 30 s: subprocess spawn incurs cold-start JIT overhead under parallel load.
  }, 30_000);
});

// ---------------------------------------------------------------------------
// I1-14 — POST /image route forwards aspectRatio + width/height
// ---------------------------------------------------------------------------

describe("I1-14: POST /image route — options forwarded through mock server", () => {
  it("returns 200 with image modality when aspectRatio + dimensions supplied", async () => {
    const res = await post(port, "/image", {
      prompt: "a blue square",
      aspectRatio: "16:9",
      width: 1280,
      height: 720,
    });
    expect(res.status).toBe(200);
    const body = res.body as { modality?: string; data?: string };
    expect(body.modality).toBe("image");
    expect(body.data).toMatch(/^data:image\//);
  });

  it("returns 200 with quality parameter accepted", async () => {
    const res = await post(port, "/image", {
      prompt: "a green circle",
      quality: "standard",
    });
    expect(res.status).toBe(200);
    const body = res.body as { modality?: string };
    expect(body.modality).toBe("image");
  });
});

// ---------------------------------------------------------------------------
// I1-15 — POST /video route forwards aspectRatio + duration + fps
// ---------------------------------------------------------------------------

describe("I1-15: POST /video route — options forwarded through mock server", () => {
  it("returns 200 with video modality when aspectRatio + duration supplied", async () => {
    const res = await post(port, "/video", {
      prompt: "a rolling wave",
      aspectRatio: "16:9",
      duration: 5,
      fps: 24,
    });
    expect(res.status).toBe(200);
    const body = res.body as { modality?: string; data?: string };
    expect(body.modality).toBe("video");
    expect(body.data).toMatch(/^data:video\//);
  });

  it("returns 400 when duration is not a number", async () => {
    const res = await post(port, "/video", {
      prompt: "clip",
      duration: "not-a-number",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Mobile upload — POST /upload
//
// These tests verify the server's multipart file-upload endpoint under the
// conditions a mobile phone user will encounter:
//
//   I1-16  Small JPEG   → 201 + fileRef UUID
//   I1-17  HEIC MIME    → 415 with a descriptive error (client should convert first)
//   I1-18  5 MiB JPEG   → 201 (multer 50 MiB limit not breached)
//   I1-19  No file      → 400
//   I1-20  WebP (Android common) → 201
//
// Uses Node 18+ built-in fetch + FormData so no extra dependencies are needed.
// ---------------------------------------------------------------------------

/**
 * Helper: POST multipart/form-data to the test server.
 * Returns { status, body } mirroring the JSON post() helper above.
 */
async function uploadMultipart(
  testPort: number,
  blobContent: Buffer | Uint8Array,
  mimeType: string,
  filename: string,
  provider = "openai",
): Promise<{ status: number; body: unknown }> {
  const formData = new FormData();
  formData.append("file", new Blob([blobContent], { type: mimeType }), filename);
  formData.append("provider", provider);
  const resp = await fetch(`http://127.0.0.1:${testPort}/upload`, {
    method: "POST",
    body: formData,
  });
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    body = await resp.text();
  }
  return { status: resp.status, body };
}

describe("Mobile upload — POST /upload", () => {
  it("I1-16: small JPEG (1 KiB) → 201 with fileRef UUID", async () => {
    const buf = Buffer.alloc(1024, 0xff);
    const res = await uploadMultipart(port, buf, "image/jpeg", "photo.jpg");
    expect(res.status).toBe(201);
    const body = res.body as { fileRef?: string };
    expect(body.fileRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("I1-17: HEIC MIME type → 415 Unsupported Media Type", async () => {
    const buf = Buffer.alloc(512, 0x00);
    const res = await uploadMultipart(port, buf, "image/heic", "photo.heic");
    expect(res.status).toBe(415);
    const body = res.body as { error?: string };
    expect(body.error).toMatch(/unsupported/i);
    // The error message should mention HEIC so the client can surface it.
    expect(body.error).toMatch(/heic/i);
  });

  it("I1-18: 5 MiB JPEG (typical mobile photo after client compression) → 201", async () => {
    const buf = Buffer.alloc(5 * 1024 * 1024, 0xff);
    const res = await uploadMultipart(port, buf, "image/jpeg", "bigphoto.jpg");
    expect(res.status).toBe(201);
    const body = res.body as { fileRef?: string };
    expect(typeof body.fileRef).toBe("string");
  }, 15_000); // allow extra time for large buffer

  it("I1-19: no file field → 400 Bad Request", async () => {
    const formData = new FormData();
    formData.append("provider", "openai");
    const resp = await fetch(`http://127.0.0.1:${port}/upload`, {
      method: "POST",
      body: formData,
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: string };
    expect(body.error).toMatch(/no file/i);
  });

  it("I1-20: WebP image (common Android camera format) → 201", async () => {
    const buf = Buffer.alloc(2048, 0x52); // arbitrary bytes
    const res = await uploadMultipart(port, buf, "image/webp", "shot.webp");
    expect(res.status).toBe(201);
    const body = res.body as { fileRef?: string };
    expect(typeof body.fileRef).toBe("string");
  });
});
