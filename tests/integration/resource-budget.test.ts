/**
 * Integration coverage for the server resource budget boundary.
 *
 * The limits are deliberately tiny so just-under/just-over cases stay fast
 * and deterministic. No live provider or ffmpeg binary is used.
 */

import * as http from "node:http";
import { EventEmitter } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "../../src/ai-powered/providers/mock.js";

function makeFakeProc(exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { resume: () => void };
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = Object.assign(new EventEmitter(), { resume: vi.fn() });
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => true);
  setImmediate(() => proc.emit("close", exitCode));
  return proc;
}

function makeHangingProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { resume: () => void };
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = Object.assign(new EventEmitter(), { resume: vi.fn() });
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => true);
  return proc;
}

vi.mock("node:child_process", () => ({ spawn: vi.fn(() => makeFakeProc()) }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 2 }),
  readFile: vi.fn().mockResolvedValue(Buffer.from("ok")),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { spawn } from "node:child_process";
import * as fsMock from "node:fs/promises";
import { createServer } from "../../src/ai-powered/server/index.js";

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
const statMock = fsMock.stat as unknown as ReturnType<typeof vi.fn>;
const readFileMock = fsMock.readFile as unknown as ReturnType<typeof vi.fn>;
const rmMock = fsMock.rm as unknown as ReturnType<typeof vi.fn>;

const TEST_LIMITS = {
  maxJsonBodyBytes: 1024,
  maxBatchItems: 2,
  maxBatchDurationSeconds: 10,
  maxStitchClips: 3,
  maxStitchClipBytes: 4,
  maxStitchDecodedBytes: 8,
  maxStitchOutputBytes: 5,
  maxFfmpegTimeoutMs: 30,
  maxConcurrentStitches: 1,
};

let server: http.Server;
let port: number;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer({ mock: true, resourceLimits: TEST_LIMITS }).listen(
        0,
        "127.0.0.1",
        () => {
          port = (server.address() as { port: number }).port;
          resolve();
        },
      );
    }),
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
  statMock.mockResolvedValue({ size: 2 });
  readFileMock.mockResolvedValue(Buffer.from("ok"));
  rmMock.mockResolvedValue(undefined);
});

function beginPost(path: string, body: unknown) {
  const payload = JSON.stringify(body);
  let responseResolve!: (response: http.IncomingMessage) => void;
  let responseReject!: (error: Error) => void;
  const response = new Promise<http.IncomingMessage>((resolve, reject) => {
    responseResolve = resolve;
    responseReject = reject;
  });
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
    responseResolve,
  );
  req.on("error", responseReject);
  req.write(payload);
  req.end();
  return { req, response };
}

function postJson(path: string, body: unknown): Promise<http.IncomingMessage> {
  return beginPost(path, body).response;
}

function readResponse(res: http.IncomingMessage): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => (body += chunk));
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    res.on("error", reject);
  });
}

function readJson(
  res: http.IncomingMessage,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return readResponse(res).then(({ status, body }) => ({ status, json: JSON.parse(body) }));
}

const clip = "data:video/mp4;base64,AAAA";

describe("resource budgets", () => {
  it("accepts a just-under JSON body and rejects an over-limit body before the provider", async () => {
    const generateText = vi.spyOn(MockProvider.prototype, "generateText");
    const under = await readResponse(
      await postJson("/batch", { items: [{ modality: "text", prompt: "x".repeat(700) }] }),
    );
    expect(under.status).toBe(200);
    const callsBeforeOver = generateText.mock.calls.length;

    const over = await readJson(
      await postJson("/batch", { items: [{ modality: "text", prompt: "x".repeat(2_000) }] }),
    );
    expect(over.status).toBe(413);
    expect(over.json.code).toBe("RESOURCE_LIMIT_EXCEEDED");
    expect(over.json.limit).toBe("body_bytes");
    expect(generateText.mock.calls.length).toBe(callsBeforeOver);
  });

  it("accepts the item and duration boundaries, then rejects over-limit batches before a provider call", async () => {
    const generateText = vi.spyOn(MockProvider.prototype, "generateText");
    const under = await readResponse(
      await postJson("/batch", {
        items: [
          { modality: "text", prompt: "one", duration: 5 },
          { modality: "text", prompt: "two", duration: 5 },
        ],
      }),
    );
    expect(under.status).toBe(200);
    const callsBeforeOver = generateText.mock.calls.length;

    const overItems = await readJson(
      await postJson("/batch", {
        items: [
          { modality: "text", prompt: "one" },
          { modality: "text", prompt: "two" },
          { modality: "text", prompt: "three" },
        ],
      }),
    );
    expect(overItems.status).toBe(413);
    expect(overItems.json.limit).toBe("batch_item_count");

    const overDuration = await readJson(
      await postJson("/batch", {
        items: [{ modality: "video", prompt: "long", duration: 11 }],
      }),
    );
    expect(overDuration.status).toBe(413);
    expect(overDuration.json.limit).toBe("batch_duration");
    expect(generateText.mock.calls.length).toBe(callsBeforeOver);
  });

  it("rejects malformed, per-clip, and aggregate stitch data before ffmpeg", async () => {
    const malformed = await readJson(await postJson("/stitch", { clips: ["not base64", clip] }));
    expect(malformed.status).toBe(400);
    expect(malformed.json.code).toBe("INVALID_STITCH_CLIP");
    expect(spawnMock).not.toHaveBeenCalled();

    const overClip = await readJson(
      await postJson("/stitch", { clips: ["data:video/mp4;base64,AAAAAAA=", clip] }),
    );
    expect(overClip.status).toBe(413);
    expect(overClip.json.limit).toBe("stitch_clip_bytes");
    expect(spawnMock).not.toHaveBeenCalled();

    const overAggregate = await readJson(await postJson("/stitch", { clips: [clip, clip, clip] }));
    expect(overAggregate.status).toBe(413);
    expect(overAggregate.json.limit).toBe("stitch_decoded_bytes");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects oversized ffmpeg output without reading or encoding it, and cleans up", async () => {
    statMock.mockResolvedValue({ size: 6 });
    const response = await readJson(await postJson("/stitch", { clips: [clip, clip] }));
    expect(response.status).toBe(413);
    expect(response.json.limit).toBe("stitch_output_bytes");
    expect(readFileMock).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledOnce();
  });

  it("kills a timed-out ffmpeg process and cleans up", async () => {
    const hanging = makeHangingProc();
    spawnMock.mockReturnValue(hanging);
    const response = await readJson(await postJson("/stitch", { clips: [clip, clip] }));
    expect(response.status).toBe(504);
    expect(response.json.code).toBe("RESOURCE_TIMEOUT");
    expect(hanging.kill).toHaveBeenCalledWith("SIGKILL");
    expect(rmMock).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent stitch and cancels the first request without starting another ffmpeg", async () => {
    const hanging = makeHangingProc();
    spawnMock.mockReturnValue(hanging);
    const first = beginPost("/stitch", { clips: [clip, clip] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = await readJson(await postJson("/stitch", { clips: [clip, clip] }));
    expect(second.status).toBe(429);
    expect(second.json.code).toBe("RESOURCE_CONCURRENCY_LIMIT");
    expect(spawnMock).toHaveBeenCalledOnce();

    void first.response.catch(() => undefined);
    first.req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hanging.kill).toHaveBeenCalledWith("SIGKILL");
    expect(rmMock).toHaveBeenCalledOnce();
  });
});
