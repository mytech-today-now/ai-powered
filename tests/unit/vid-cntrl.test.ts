/**
 * @file tests/unit/vid-cntrl.test.ts
 *
 * Unit tests for the vid-cntrl feature — bd-4dsk / V1-01 through V1-09.
 *
 * Tests verify that all five video-control parameters (aspectRatio, resolution,
 * quality, duration, fps) are forwarded correctly through the POST /video route
 * to provider.generateVideo().
 *
 * All tests run with AI_MOCK=true (no real API calls).
 */

import * as http from "node:http";
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";
import { createServer } from "../../src/ai-powered/server/index.js";

// ---------------------------------------------------------------------------
// HTTP helper
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

// ---------------------------------------------------------------------------
// V1-01 — backward compat: no controls, still succeeds
// ---------------------------------------------------------------------------

describe("V1-01: POST /video — no controls (backward compat)", () => {
  it("returns 200 with video modality", async () => {
    const res = await post(port, "/video", { prompt: "a sunrise" });
    expect(res.status).toBe(200);
    const body = res.body as { modality?: string; data?: string };
    expect(body.modality).toBe("video");
    expect(body.data).toMatch(/^data:video\//);
  });
});

// ---------------------------------------------------------------------------
// V1-02 to V1-06 — individual and combined control forwarding
// ---------------------------------------------------------------------------

describe("V1-02 to V1-06: POST /video — controls forwarded to provider.generateVideo", () => {
  it("V1-02: aspectRatio '16:9' is forwarded to provider.generateVideo", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const res = await post(port, "/video", { prompt: "landscape", aspectRatio: "16:9" });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("landscape", expect.objectContaining({ aspectRatio: "16:9" }));
  });

  it("V1-03: resolution '1080p' is forwarded to provider.generateVideo", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const res = await post(port, "/video", { prompt: "city", resolution: "1080p" });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("city", expect.objectContaining({ resolution: "1080p" }));
  });

  it("V1-04: quality 'high' is forwarded to provider.generateVideo", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const res = await post(port, "/video", { prompt: "ocean", quality: "high" });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("ocean", expect.objectContaining({ quality: "high" }));
  });

  it("V1-05: duration 8 is forwarded to provider.generateVideo", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const res = await post(port, "/video", { prompt: "forest", duration: 8 });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("forest", expect.objectContaining({ duration: 8 }));
  });

  it("V1-06: fps 30 is forwarded to provider.generateVideo", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const res = await post(port, "/video", { prompt: "waterfall", fps: 30 });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("waterfall", expect.objectContaining({ fps: 30 }));
  });
});

// ---------------------------------------------------------------------------
// V1-07 — all five controls together
// ---------------------------------------------------------------------------

describe("V1-07: POST /video — all five controls forwarded together", () => {
  it("all five controls are present in the generateVideo call", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const res = await post(port, "/video", {
      prompt: "mountain timelapse",
      aspectRatio: "9:16",
      resolution: "4k",
      quality: "standard",
      duration: 10,
      fps: 24,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      "mountain timelapse",
      expect.objectContaining({
        aspectRatio: "9:16",
        resolution: "4k",
        quality: "standard",
        duration: 10,
        fps: 24,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// V1-08 to V1-09 — validation errors
// ---------------------------------------------------------------------------

describe("V1-08 to V1-09: POST /video — validation errors", () => {
  it("V1-08: returns 400 when duration is a string", async () => {
    const res = await post(port, "/video", { prompt: "clip", duration: "five" });
    expect(res.status).toBe(400);
  });

  it("V1-09: returns 400 when fps is a negative number", async () => {
    const res = await post(port, "/video", { prompt: "clip", fps: -1 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// V1-10 to V1-16 — POST /batch per-item video controls forwarded to generateVideo
//
// These unit tests verify that each video-control field declared in
// BatchItemSchema is correctly assembled into `batchVideoOpts` inside the
// batch handler and forwarded to provider.generateVideo().
//
// V1-10: single item with aspectRatio — batchVideoOpts is truthy, field present
// V1-11: single item with resolution — batchVideoOpts is truthy, field present
// V1-12: single item with quality — batchVideoOpts is truthy, field present
// V1-13: single item with duration — batchVideoOpts is truthy, field present
// V1-14: single item with fps — batchVideoOpts is truthy, field present
// V1-15: all five controls together — batchVideoOpts truthy, all fields present
// V1-16: item with NO controls — generateVideo called with undefined (batchVideoOpts falsy)
// ---------------------------------------------------------------------------

/** Parse raw text as NDJSON and return the first line object. */
function parseFirstNdjsonLine(text: string): Record<string, unknown> {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) throw new Error("No NDJSON lines in response");
  return JSON.parse(line) as Record<string, unknown>;
}

/** POST to /batch with a single video item and return { status, text }. */
function postBatchVideo(
  batchPort: number,
  item: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ items: [{ modality: "video", ...item }] });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: batchPort,
        path: "/batch",
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
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: buf }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("V1-10: POST /batch — per-item aspectRatio forwarded; batchVideoOpts truthy", () => {
  it("aspectRatio '16:9' is passed to generateVideo and batchVideoOpts is truthy", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, body } = await postBatchVideo(port, {
      prompt: "aerial shot",
      aspectRatio: "16:9",
    });
    expect(status).toBe(200);
    const line = parseFirstNdjsonLine(body);
    expect(line["status"]).toBe("ok");
    // batchVideoOpts must be truthy (non-empty object) — confirmed by the second arg
    expect(spy).toHaveBeenCalledWith(
      "aerial shot",
      expect.objectContaining({ aspectRatio: "16:9" }),
    );
    // Verify the second argument is defined (batchVideoOpts was truthy)
    const [, opts] = spy.mock.calls[0]!;
    expect(opts).toBeDefined();
    expect(Object.keys(opts as object).length).toBeGreaterThan(0);
  });
});

describe("V1-11: POST /batch — per-item resolution forwarded; batchVideoOpts truthy", () => {
  it("resolution '1080p' is passed to generateVideo and batchVideoOpts is truthy", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, body } = await postBatchVideo(port, {
      prompt: "city skyline",
      resolution: "1080p",
    });
    expect(status).toBe(200);
    const line = parseFirstNdjsonLine(body);
    expect(line["status"]).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      "city skyline",
      expect.objectContaining({ resolution: "1080p" }),
    );
    const [, opts] = spy.mock.calls[0]!;
    expect(opts).toBeDefined();
    expect(Object.keys(opts as object).length).toBeGreaterThan(0);
  });
});

describe("V1-12: POST /batch — per-item quality forwarded; batchVideoOpts truthy", () => {
  it("quality 'high' is passed to generateVideo and batchVideoOpts is truthy", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, body } = await postBatchVideo(port, {
      prompt: "golden hour",
      quality: "high",
    });
    expect(status).toBe(200);
    const line = parseFirstNdjsonLine(body);
    expect(line["status"]).toBe("ok");
    expect(spy).toHaveBeenCalledWith("golden hour", expect.objectContaining({ quality: "high" }));
    const [, opts] = spy.mock.calls[0]!;
    expect(opts).toBeDefined();
    expect(Object.keys(opts as object).length).toBeGreaterThan(0);
  });
});

describe("V1-13: POST /batch — per-item duration forwarded; batchVideoOpts truthy", () => {
  it("duration 12 is passed to generateVideo and batchVideoOpts is truthy", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, body } = await postBatchVideo(port, {
      prompt: "rain on leaves",
      duration: 12,
    });
    expect(status).toBe(200);
    const line = parseFirstNdjsonLine(body);
    expect(line["status"]).toBe("ok");
    expect(spy).toHaveBeenCalledWith("rain on leaves", expect.objectContaining({ duration: 12 }));
    const [, opts] = spy.mock.calls[0]!;
    expect(opts).toBeDefined();
    expect(Object.keys(opts as object).length).toBeGreaterThan(0);
  });
});

describe("V1-14: POST /batch — per-item fps forwarded; batchVideoOpts truthy", () => {
  it("fps 60 is passed to generateVideo and batchVideoOpts is truthy", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, body } = await postBatchVideo(port, {
      prompt: "slow motion waterfall",
      fps: 60,
    });
    expect(status).toBe(200);
    const line = parseFirstNdjsonLine(body);
    expect(line["status"]).toBe("ok");
    expect(spy).toHaveBeenCalledWith("slow motion waterfall", expect.objectContaining({ fps: 60 }));
    const [, opts] = spy.mock.calls[0]!;
    expect(opts).toBeDefined();
    expect(Object.keys(opts as object).length).toBeGreaterThan(0);
  });
});

describe("V1-15: POST /batch — all five controls forwarded; batchVideoOpts truthy with all keys", () => {
  it("all five video controls appear in the generateVideo call for the batch item", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, body } = await postBatchVideo(port, {
      prompt: "cinematic drone flight",
      aspectRatio: "21:9",
      resolution: "4k",
      quality: "standard",
      duration: 20,
      fps: 24,
    });
    expect(status).toBe(200);
    const line = parseFirstNdjsonLine(body);
    expect(line["status"]).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      "cinematic drone flight",
      expect.objectContaining({
        aspectRatio: "21:9",
        resolution: "4k",
        quality: "standard",
        duration: 20,
        fps: 24,
      }),
    );
    // batchVideoOpts must be truthy — confirm the second arg is a non-empty object
    const [, opts] = spy.mock.calls[0]!;
    expect(opts).toBeDefined();
    expect(Object.keys(opts as object)).toHaveLength(5);
  });
});

describe("V1-16: POST /batch — item with no controls calls generateVideo with undefined", () => {
  it("generateVideo receives undefined (batchVideoOpts falsy) when no controls are set", async () => {
    const spy = vi.spyOn(MockProvider.prototype, "generateVideo");
    const { status, body } = await postBatchVideo(port, {
      prompt: "plain video clip",
    });
    expect(status).toBe(200);
    const line = parseFirstNdjsonLine(body);
    expect(line["status"]).toBe("ok");
    // No controls present → batchVideoOpts is empty → second arg must be undefined
    expect(spy).toHaveBeenCalledWith("plain video clip", undefined);
  });
});

// ---------------------------------------------------------------------------
// V1-17 — POST /batch rejects quality 'ultra' with HTTP 400 + structured error
//
// Verifies bd-ews2 / T3: Zod validation in BatchBodySchema (via VideoSizeSchema)
// rejects an item with quality:'ultra' and returns a 400 with:
//   { error: "Validation error", issues: ["items.0.quality: …"] }
// ---------------------------------------------------------------------------

describe("V1-17: POST /batch — quality 'ultra' rejected with HTTP 400 and structured error", () => {
  it("returns 400 with Validation error and issues array referencing items.0.quality", async () => {
    const { status, body } = await postBatchVideo(port, {
      prompt: "a sunset over mountains",
      quality: "ultra",
    });
    expect(status).toBe(400);
    // For a 400 response the batch handler returns JSON (not NDJSON).
    const parsed = JSON.parse(body) as { error?: string; issues?: string[] };
    expect(parsed.error).toBe("Validation error");
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues!.length).toBeGreaterThan(0);
    // Each element is "path: message" — the quality path inside items must appear.
    const issueText = parsed.issues!.join(" ");
    expect(issueText).toMatch(/quality/);
    expect(issueText).toMatch(/items/);
  });
});

// ---------------------------------------------------------------------------
// V1-18 — POST /video also rejects quality 'ultra' with HTTP 400
//
// Confirms that VideoBodySchema (which also merges VideoSizeSchema) enforces
// the same quality enum constraint on the direct /video endpoint.
// ---------------------------------------------------------------------------

describe("V1-18: POST /video — quality 'ultra' rejected with HTTP 400 and structured error", () => {
  it("returns 400 with Validation error and issues array referencing quality", async () => {
    const res = await post(port, "/video", {
      prompt: "a sunset over mountains",
      quality: "ultra",
    });
    expect(res.status).toBe(400);
    const body = res.body as { error?: string; issues?: string[] };
    expect(body.error).toBe("Validation error");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues!.length).toBeGreaterThan(0);
    const issueText = body.issues!.join(" ");
    expect(issueText).toMatch(/quality/);
  });
});
