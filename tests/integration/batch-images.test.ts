/**
 * @file tests/integration/batch-images.test.ts
 *
 * Integration tests for POST /batch with `images` field support.
 * B-REF-01..B-REF-11, NDJSON-01, NDJSON-02 — bd-08tj / TASK-14.
 *
 * Tests run against a real Express server in mock mode (no API keys required).
 * All provider calls are handled by MockProvider.
 */

import * as http from "node:http";
import { createServer } from "../../src/ai-powered/server/index.js";

// ---------------------------------------------------------------------------
// Shared server (mock mode)
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
// HTTP helpers
// ---------------------------------------------------------------------------

function postJson(path: string, body: unknown): Promise<http.IncomingMessage> {
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
      resolve,
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Read the full response body and parse as NDJSON lines. */
function readNdjson(res: http.IncomingMessage): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    let buf = "";
    res.setEncoding("utf-8");
    res.on("data", (c: string) => {
      buf += c;
    });
    res.on("end", () => {
      try {
        const lines = buf.trim().split("\n").filter(Boolean);
        resolve(lines.map((l) => JSON.parse(l) as Record<string, unknown>));
      } catch (e) {
        reject(e);
      }
    });
    res.on("error", reject);
  });
}

/** Read the full response body and JSON-parse it. */
function readJson(res: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    res.setEncoding("utf-8");
    res.on("data", (c: string) => {
      buf += c;
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

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const IMG_URL = "https://cdn.example.com/hero.jpg";
const IMG_URL2 = "https://cdn.example.com/end.jpg";
const IMG_URL3 = "https://cdn.example.com/extra.jpg";

// ---------------------------------------------------------------------------
// B-REF-01 — video item with images: [url] → 200 ok
// ---------------------------------------------------------------------------

describe("B-REF-01: video item with one image URL", () => {
  it("returns HTTP 200 and status:ok", async () => {
    const res = await postJson("/batch", {
      items: [{ modality: "video", prompt: "A hero walks forward", images: [IMG_URL] }],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    expect(lines).toHaveLength(1);
    expect(lines[0]!["status"]).toBe("ok");
  }, 20_000);
});

// ---------------------------------------------------------------------------
// B-REF-02 — invalid image URL → 400 validation error
// ---------------------------------------------------------------------------

describe("B-REF-02: invalid image URL rejected by Zod", () => {
  it("returns HTTP 400 when images contains a non-URL string", async () => {
    const res = await postJson("/batch", {
      items: [{ modality: "video", prompt: "test", images: ["not-a-url"] }],
    });
    expect(res.statusCode).toBe(400);
    const body = await readJson(res);
    expect((body as { error: string }).error).toBeDefined();
  }, 10_000);
});

// ---------------------------------------------------------------------------
// B-REF-03 — batch item without images → status:ok, no routing fields
// ---------------------------------------------------------------------------

describe("B-REF-03: text item without images", () => {
  it("returns status:ok and no providerUsed field", async () => {
    const res = await postJson("/batch", {
      items: [{ modality: "text", prompt: "Say hello" }],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    expect(lines[0]!["status"]).toBe("ok");
    expect(lines[0]!["providerUsed"]).toBeUndefined();
  }, 20_000);
});

// ---------------------------------------------------------------------------
// B-REF-04 — fileRef + images present → images take precedence
// ---------------------------------------------------------------------------

describe("B-REF-04: fileRef + images coexist — images win", () => {
  it("returns status:ok (images field is used; invalid fileRef is silently ignored)", async () => {
    const res = await postJson("/batch", {
      items: [
        {
          modality: "video",
          prompt: "Hero with file",
          fileRef: "00000000-0000-0000-0000-000000000099",
          images: [IMG_URL],
        },
      ],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    expect(lines[0]!["status"]).toBe("ok");
  }, 20_000);
});

// ---------------------------------------------------------------------------
// B-REF-05 — two items, one with images, one without
// ---------------------------------------------------------------------------

describe("B-REF-05: two-item batch, mixed images presence", () => {
  it("both items return status:ok", async () => {
    const res = await postJson("/batch", {
      items: [
        { modality: "video", prompt: "Item one with image", images: [IMG_URL] },
        { modality: "text", prompt: "Item two without image" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    expect(lines).toHaveLength(2);
    expect(lines[0]!["status"]).toBe("ok");
    expect(lines[1]!["status"]).toBe("ok");
  }, 25_000);
});

// ---------------------------------------------------------------------------
// B-REF-06 — NDJSON line structure for a video item with images
// ---------------------------------------------------------------------------

describe("B-REF-06: NDJSON line has expected structural fields", () => {
  it("contains index, modality, prompt, status, and result", async () => {
    const res = await postJson("/batch", {
      items: [{ modality: "video", prompt: "Scene test", images: [IMG_URL] }],
    });
    const lines = await readNdjson(res);
    const line = lines[0]!;
    expect(line["index"]).toBe(0);
    expect(line["modality"]).toBe("video");
    expect(line["prompt"]).toBe("Scene test");
    expect(line["status"]).toBe("ok");
    expect(line["result"]).toBeDefined();
  }, 20_000);
});

// ---------------------------------------------------------------------------
// B-REF-07 / NDJSON-01 — xai + 2 images → routed to lumaai, warning present
// ---------------------------------------------------------------------------

describe("B-REF-07 / NDJSON-01: xai + 2 images → routes to lumaai", () => {
  it("NDJSON response contains providerUsed:lumaai and a warning", async () => {
    const res = await postJson("/batch", {
      provider: "xai",
      items: [{ modality: "video", prompt: "Dual-frame shot", images: [IMG_URL, IMG_URL2] }],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    const line = lines[0]!;
    expect(line["status"]).toBe("ok");
    expect(line["providerUsed"]).toBe("lumaai");
    expect(typeof line["warning"]).toBe("string");
    expect(line["warning"] as string).toMatch(/lumaai/);
  }, 25_000);
});

// ---------------------------------------------------------------------------
// B-REF-08 — xai + 3 images → routed to lumaai, truncation indicated
// ---------------------------------------------------------------------------

describe("B-REF-08: xai + 3 images → routes to lumaai and truncates", () => {
  it("NDJSON response contains providerUsed:lumaai and a warning about routing", async () => {
    const res = await postJson("/batch", {
      provider: "xai",
      items: [{ modality: "video", prompt: "Three frames", images: [IMG_URL, IMG_URL2, IMG_URL3] }],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    const line = lines[0]!;
    expect(line["status"]).toBe("ok");
    expect(line["providerUsed"]).toBe("lumaai");
    expect(line["warning"]).toBeDefined();
  }, 25_000);
});

// ---------------------------------------------------------------------------
// B-REF-09 — default provider (openai) + 1 image → routed to lumaai
// ---------------------------------------------------------------------------

describe("B-REF-09: default provider (openai) + image → routes to lumaai", () => {
  it("includes providerUsed:lumaai since openai does not support I2V", async () => {
    const res = await postJson("/batch", {
      items: [{ modality: "video", prompt: "Auto-route test", images: [IMG_URL] }],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    const line = lines[0]!;
    expect(line["status"]).toBe("ok");
    expect(line["providerUsed"]).toBe("lumaai");
  }, 20_000);
});

// ---------------------------------------------------------------------------
// B-REF-10 / NDJSON-02 — lumaai + 1 image → no routing change, no meta fields
// ---------------------------------------------------------------------------

describe("B-REF-10 / NDJSON-02: lumaai + 1 image → no routing metadata in NDJSON", () => {
  it("does NOT include providerUsed or warning when routing is not needed", async () => {
    const res = await postJson("/batch", {
      provider: "lumaai",
      items: [{ modality: "video", prompt: "Luma direct shot", images: [IMG_URL] }],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    const line = lines[0]!;
    expect(line["status"]).toBe("ok");
    expect(line["providerUsed"]).toBeUndefined();
    expect(line["warning"]).toBeUndefined();
  }, 20_000);
});

// ---------------------------------------------------------------------------
// B-REF-11 — multi-item batch, all with images
// ---------------------------------------------------------------------------

describe("B-REF-11: multi-item batch where all items have images", () => {
  it("all items complete with status:ok", async () => {
    const res = await postJson("/batch", {
      provider: "lumaai",
      items: [
        { modality: "video", prompt: "Shot A", images: [IMG_URL] },
        { modality: "video", prompt: "Shot B", images: [IMG_URL2] },
        { modality: "video", prompt: "Shot C", images: [IMG_URL, IMG_URL2] },
      ],
    });
    expect(res.statusCode).toBe(200);
    const lines = await readNdjson(res);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line["status"]).toBe("ok");
    }
  }, 30_000);
});
