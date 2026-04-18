/**
 * @file tests/integration/stitch-endpoint.test.ts
 *
 * Integration tests for POST /stitch — T-SE-01..T-SE-06.
 *
 * Tests run against a real Express server (mock mode).
 * node:child_process spawn and node:fs/promises are mocked so no real ffmpeg
 * binary or filesystem is required.
 *
 * Tests:
 *   T-SE-01 — Valid 2-clip body returns HTTP 200 with data URI + sizeMB
 *   T-SE-02 — Fewer than 2 clips → HTTP 400
 *   T-SE-03 — More than 20 clips → HTTP 400
 *   T-SE-04 — Empty string in clips array → HTTP 400
 *   T-SE-05 — ffmpeg ENOENT → HTTP 500 with install hint
 *   T-SE-06 — Temp directory is removed after successful request
 */

import * as http from "node:http";
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before importing routes/server
// ---------------------------------------------------------------------------

// Minimal fake child process that emits close(0) by default
function makeFakeProc(exitCode = 0, stderrText = "") {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { resume: () => void };
    stderr: EventEmitter;
  };
  proc.stdout = Object.assign(new EventEmitter(), { resume: vi.fn() });
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (stderrText) proc.stderr.emit("data", Buffer.from(stderrText));
    proc.emit("close", exitCode);
  });
  return proc;
}

function makeFakeProcEnoent() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { resume: () => void };
    stderr: EventEmitter;
  };
  proc.stdout = Object.assign(new EventEmitter(), { resume: vi.fn() });
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    const err = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    proc.emit("error", err);
  });
  return proc;
}

vi.mock("node:child_process", () => ({ spawn: vi.fn(() => makeFakeProc()) }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-combined-mp4-bytes")),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// Import mocks after vi.mock declarations (Vitest hoists vi.mock)
import { spawn } from "node:child_process";
import * as fsMock from "node:fs/promises";

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
const rmMock = fsMock.rm as unknown as ReturnType<typeof vi.fn>;
const readFileMock = fsMock.readFile as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Shared Express server (started once, shared across all tests)
// ---------------------------------------------------------------------------

import { createServer } from "../../src/ai-powered/server/index.js";

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

beforeEach(() => {
  vi.clearAllMocks();
  spawnMock.mockImplementation(() => makeFakeProc());
  readFileMock.mockResolvedValue(Buffer.from("fake-combined-mp4-bytes"));
  rmMock.mockResolvedValue(undefined);
});

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

const TWO_CLIPS = ["data:video/mp4;base64,AAAA", "data:video/mp4;base64,BBBB"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /stitch — T-SE-01..T-SE-06", () => {
  // ── T-SE-01 ───────────────────────────────────────────────────────────────
  it("T-SE-01: valid 2-clip body → 200 with data URI and sizeMB", async () => {
    const res = await postJson("/stitch", { clips: TWO_CLIPS });
    const body = (await readJson(res)) as { data?: string; sizeMB?: number };

    expect(res.statusCode).toBe(200);
    expect(typeof body.data).toBe("string");
    expect((body.data as string).startsWith("data:video/mp4;base64,")).toBe(true);
    expect(typeof body.sizeMB).toBe("number");
  });

  // ── T-SE-02 ───────────────────────────────────────────────────────────────
  it("T-SE-02: fewer than 2 clips → 400 with validation message", async () => {
    const res = await postJson("/stitch", { clips: ["data:video/mp4;base64,AAAA"] });
    // parseBody returns { error: "Validation error", issues: string[] }
    const body = (await readJson(res)) as { error?: string; issues?: string[] };

    expect(res.statusCode).toBe(400);
    expect(body.error).toBe("Validation error");
    expect(body.issues?.join(" ")).toContain("at least 2 clips are required");
  });

  // ── T-SE-03 ───────────────────────────────────────────────────────────────
  it("T-SE-03: more than 20 clips → 400 with validation message", async () => {
    const clips = Array<string>(21).fill("data:video/mp4;base64,AAAA");
    const res = await postJson("/stitch", { clips });
    const body = (await readJson(res)) as { error?: string; issues?: string[] };

    expect(res.statusCode).toBe(400);
    expect(body.error).toBe("Validation error");
    expect(body.issues?.join(" ")).toContain("maximum of 20 clips per stitch request");
  });

  // ── T-SE-04 ───────────────────────────────────────────────────────────────
  it("T-SE-04: empty string in clips array → 400 with validation message", async () => {
    const res = await postJson("/stitch", { clips: ["data:video/mp4;base64,AAAA", ""] });
    const body = (await readJson(res)) as { error?: string; issues?: string[] };

    expect(res.statusCode).toBe(400);
    expect(body.error).toBe("Validation error");
    expect(body.issues?.join(" ")).toContain("each clip must be a non-empty base64 data URI");
  });

  // ── T-SE-05 ───────────────────────────────────────────────────────────────
  it("T-SE-05: ffmpeg ENOENT → 500 with install hint", async () => {
    spawnMock.mockImplementation(() => makeFakeProcEnoent());

    const res = await postJson("/stitch", { clips: TWO_CLIPS });
    const body = (await readJson(res)) as { error?: string };

    expect(res.statusCode).toBe(500);
    expect(body.error).toContain("ffmpeg not found in PATH");
  });

  // ── T-SE-06 ───────────────────────────────────────────────────────────────
  it("T-SE-06: temp directory is cleaned up (fs.rm called) after successful request", async () => {
    const res = await postJson("/stitch", { clips: TWO_CLIPS });
    expect(res.statusCode).toBe(200);

    // Give the finally-block a tick to run
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(rmMock).toHaveBeenCalledWith(
      expect.stringContaining("ai-powered-stitch-"),
      expect.objectContaining({ recursive: true, force: true }),
    );
  });
});
