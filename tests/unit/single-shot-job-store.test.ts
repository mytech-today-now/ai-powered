/**
 * @file tests/unit/single-shot-job-store.test.ts
 *
 * Regression tests for durable single-shot job storage.
 *
 * Covers:
 *   - submitSingleShot() still returns `{ jobId }`
 *   - pollShotJob(jobId) still returns `{ jobId, status: "pending" }`
 *   - completed jobs survive a module re-import / restart
 *   - failed jobs survive a module re-import / restart and re-throw the captured error
 */

import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockGenerateVideo, mockGetAiClient } = vi.hoisted(() => ({
  mockGenerateVideo: vi.fn(),
  mockGetAiClient: vi.fn(),
}));

vi.mock("../../src/ai-powered/index.js", () => ({
  getAiClient: mockGetAiClient,
}));

type SavedEnv = Record<string, string | undefined>;

function saveEnvVars(keys: string[]): SavedEnv {
  const saved: SavedEnv = {};
  for (const key of keys) saved[key] = process.env[key];
  return saved;
}

function restoreEnvVars(saved: SavedEnv): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadSingleShotModule() {
  vi.resetModules();
  return import("../../src/ai-powered/single-shot.js");
}

async function waitForCondition(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      if (await check()) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Timed out waiting for single-shot job state to settle");
}

async function makeTempJobStorePath(): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-powered-jobs-"));
  return { dir, file: path.join(dir, "jobs.jsonl") };
}

const FIXTURE_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
]);
const STREAM_OVERSIZE_BYTES = 25 * 1024 * 1024 + 1;
const ARTIFACT_DELIVERY_MESSAGE =
  "Generation finished, but the video could not be saved. Retry the download before generating again.";

async function startMediaFixtureServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let retryRequests = 0;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (pathname === "/valid.mp4") {
      response.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": FIXTURE_BYTES.length,
      });
      response.end(FIXTURE_BYTES);
      return;
    }

    if (pathname === "/redirect.mp4") {
      response.writeHead(302, { location: "/valid.mp4" });
      response.end();
      return;
    }

    if (pathname === "/missing.mp4") {
      response.writeHead(404, { "content-type": "text/html" });
      response.end("<html>expired</html>");
      return;
    }

    if (pathname === "/oversized.mp4") {
      response.writeHead(200, { "content-type": "video/mp4" });
      const chunk = Buffer.alloc(64 * 1024, 0x5a);
      let sent = 0;
      const writeChunk = () => {
        if (response.destroyed) return;
        if (sent >= STREAM_OVERSIZE_BYTES) {
          response.end();
          return;
        }
        const size = Math.min(chunk.length, STREAM_OVERSIZE_BYTES - sent);
        sent += size;
        response.write(chunk.subarray(0, size), writeChunk);
      };
      writeChunk();
      return;
    }

    if (pathname === "/cancel.mp4") {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.write(FIXTURE_BYTES);
      setTimeout(() => {
        if (!response.destroyed) response.end(FIXTURE_BYTES);
      }, 5_000);
      return;
    }

    if (pathname === "/partial.mp4") {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.write(FIXTURE_BYTES);
      setTimeout(() => {
        if (!response.destroyed) response.destroy();
      }, 25);
      return;
    }

    if (pathname === "/retry.mp4") {
      retryRequests += 1;
      if (retryRequests === 1) {
        response.writeHead(404, { "content-type": "text/html" });
        response.end("<html>not ready</html>");
      } else {
        response.writeHead(200, {
          "content-type": "video/mp4",
          "content-length": FIXTURE_BYTES.length,
        });
        response.end(FIXTURE_BYTES);
      }
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not expose a TCP address");
  }

  return {
    baseUrl: "http://127.0.0.1:" + address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (
            error !== undefined &&
            (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          ) {
            reject(error);
            return;
          }
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

describe("single-shot job ledger durability", () => {
  let savedEnv: SavedEnv;
  let tempDir = "";
  let jobStorePath = "";
  let fixtureServer: Awaited<ReturnType<typeof startMediaFixtureServer>> | undefined;

  beforeEach(() => {
    savedEnv = saveEnvVars([
      "AIPOWERED_API_KEY",
      "AIPOWERED_AUTH_ENDPOINT",
      "AIPOWERED_JWT_PUBLIC_KEY",
      "AIPOWERED_SINGLE_SHOT_JOB_STORE",
      "AIPOWERED_WEBHOOK_SECRET",
      "AIPOWERED_REDIS_URL",
    ]);
    delete process.env["AIPOWERED_API_KEY"];
    delete process.env["AIPOWERED_AUTH_ENDPOINT"];
    delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
    delete process.env["AIPOWERED_REDIS_URL"];
    mockGetAiClient.mockReset();
    mockGenerateVideo.mockReset();
  });

  afterEach(async () => {
    restoreEnvVars(savedEnv);
    if (tempDir.length > 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    if (fixtureServer !== undefined) {
      await fixtureServer.close();
      fixtureServer = undefined;
    }
    vi.unstubAllGlobals();
  });

  it("materializes URL results as fixture bytes and follows redirects", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    fixtureServer = await startMediaFixtureServer();
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    mockGenerateVideo.mockResolvedValue({
      data: fixtureServer.baseUrl + "/redirect.mp4",
      mimeType: "video/mp4",
      cost: { totalUsd: 0.01 },
    });
    const outputPath = path.join(tempDir, "url-result.mp4");
    const { generateSingleShot } = await loadSingleShotModule();

    const result = await generateSingleShot({
      shot: { id: "url-result", prompt: "fixture", durationSeconds: 2 },
      provider: "mock",
      outputPath,
    });

    expect(result.status).toBe("complete");
    expect(await fs.readFile(outputPath)).toEqual(FIXTURE_BYTES);
    expect(await fs.readFile(outputPath, "utf8")).not.toBe(fixtureServer.baseUrl + "/redirect.mp4");
  });

  it("returns a typed delivery failure and preserves an existing output", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    fixtureServer = await startMediaFixtureServer();
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    mockGenerateVideo.mockResolvedValue({
      data: fixtureServer.baseUrl + "/missing.mp4",
      mimeType: "video/mp4",
      cost: { totalUsd: 0.01 },
    });
    const outputPath = path.join(tempDir, "existing.mp4");
    const priorBytes = Buffer.from("previous playable artifact");
    await fs.writeFile(outputPath, priorBytes);
    const { generateSingleShot } = await loadSingleShotModule();

    await expect(
      generateSingleShot({
        shot: { id: "expired-url", prompt: "fixture", durationSeconds: 2 },
        provider: "mock",
        outputPath,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_DELIVERY_ERROR",
      retryable: false,
      message: ARTIFACT_DELIVERY_MESSAGE,
    });

    expect(await fs.readFile(outputPath)).toEqual(priorBytes);
    expect(mockGenerateVideo).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized streaming bodies without replacing an existing output", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    fixtureServer = await startMediaFixtureServer();
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    mockGenerateVideo.mockResolvedValue({
      data: fixtureServer.baseUrl + "/oversized.mp4",
      mimeType: "video/mp4",
      cost: { totalUsd: 0.01 },
    });
    const outputPath = path.join(tempDir, "oversized.mp4");
    const priorBytes = Buffer.from("previous artifact");
    await fs.writeFile(outputPath, priorBytes);
    const { generateSingleShot } = await loadSingleShotModule();

    await expect(
      generateSingleShot({
        shot: { id: "oversized-url", prompt: "fixture", durationSeconds: 2 },
        provider: "mock",
        outputPath,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_DELIVERY_ERROR",
      message: ARTIFACT_DELIVERY_MESSAGE,
    });

    expect(await fs.readFile(outputPath)).toEqual(priorBytes);
  }, 30_000);

  it("treats cancellation and partial transfer as delivery failures", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    fixtureServer = await startMediaFixtureServer();
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    const outputPath = path.join(tempDir, "interrupted.mp4");
    const priorBytes = Buffer.from("previous artifact");
    await fs.writeFile(outputPath, priorBytes);
    const { generateSingleShot } = await loadSingleShotModule();

    const controller = new AbortController();
    mockGenerateVideo.mockResolvedValueOnce({
      data: fixtureServer.baseUrl + "/cancel.mp4",
      mimeType: "video/mp4",
      cost: { totalUsd: 0.01 },
    });
    const cancelled = generateSingleShot({
      shot: { id: "cancelled-url", prompt: "fixture", durationSeconds: 2 },
      provider: "mock",
      outputPath,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    await expect(cancelled).rejects.toMatchObject({
      code: "ARTIFACT_DELIVERY_ERROR",
      message: ARTIFACT_DELIVERY_MESSAGE,
    });
    expect(await fs.readFile(outputPath)).toEqual(priorBytes);

    mockGenerateVideo.mockResolvedValueOnce({
      data: fixtureServer.baseUrl + "/partial.mp4",
      mimeType: "video/mp4",
      cost: { totalUsd: 0.01 },
    });
    await expect(
      generateSingleShot({
        shot: { id: "partial-url", prompt: "fixture", durationSeconds: 2 },
        provider: "mock",
        outputPath,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_DELIVERY_ERROR",
      message: ARTIFACT_DELIVERY_MESSAGE,
    });
    expect(await fs.readFile(outputPath)).toEqual(priorBytes);
  });

  it("retries materialization from the generated result without calling the provider twice", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    fixtureServer = await startMediaFixtureServer();
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    mockGenerateVideo.mockResolvedValue({
      data: fixtureServer.baseUrl + "/retry.mp4",
      mimeType: "video/mp4",
      cost: { totalUsd: 0.37 },
    });
    const outputPath = path.join(tempDir, "retry.mp4");
    const options = {
      shot: { id: "retry-materialization", prompt: "fixture", durationSeconds: 2 },
      provider: "mock",
      outputPath,
      idempotencyKey: "retry-materialization-key",
    } as const;
    const { generateSingleShot } = await loadSingleShotModule();

    await expect(generateSingleShot(options)).rejects.toMatchObject({
      code: "ARTIFACT_DELIVERY_ERROR",
    });
    const result = await generateSingleShot(options);

    expect(result).toMatchObject({
      status: "complete",
      clipPath: outputPath,
      creditsCharged: 37,
    });
    expect(await fs.readFile(outputPath)).toEqual(FIXTURE_BYTES);
    expect(mockGenerateVideo).toHaveBeenCalledTimes(1);
  });

  it("returns the current jobId and pending status shape", async () => {
    ({ dir: tempDir, file: jobStorePath } = await makeTempJobStorePath());
    process.env["AIPOWERED_SINGLE_SHOT_JOB_STORE"] = jobStorePath;
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });

    let releasePendingJob: (() => void) | undefined;
    const pendingVideoPromise = new Promise<{
      data: string;
      cost: { totalUsd: number };
    }>((resolve) => {
      releasePendingJob = () => {
        resolve({
          data: "data:video/mp4;base64,ZmFrZS1wZW5kaW5n",
          cost: { totalUsd: 0.75 },
        });
      };
    });
    mockGenerateVideo.mockReturnValueOnce(pendingVideoPromise);

    const { submitSingleShot, pollShotJob } = await loadSingleShotModule();
    const submitResult = await submitSingleShot({
      shot: {
        id: "job-ledger-pending",
        prompt: "Hold this job open",
        durationSeconds: 3,
      },
      provider: "mock",
      outputPath: path.join(tempDir, "pending.mp4"),
    });

    expect(Object.keys(submitResult)).toEqual(["jobId"]);
    expect(submitResult.jobId).toMatch(/^job_\d+_[a-z0-9]{7}$/);

    const pending = await pollShotJob(submitResult.jobId);
    expect(pending).toEqual({
      jobId: submitResult.jobId,
      status: "pending",
    });

    if (releasePendingJob === undefined) {
      throw new Error("Pending job resolver was not initialised");
    }
    releasePendingJob();
    await waitForCondition(async () => {
      const result = await pollShotJob(submitResult.jobId);
      return result.status === "complete";
    });
  });

  it("persists a completed job across module re-instantiation", async () => {
    ({ dir: tempDir, file: jobStorePath } = await makeTempJobStorePath());
    fixtureServer = await startMediaFixtureServer();
    process.env["AIPOWERED_SINGLE_SHOT_JOB_STORE"] = jobStorePath;
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });

    let resolveVideo: ((value: { data: string; cost: { totalUsd: number } }) => void) | undefined;
    const videoPromise = new Promise<{
      data: string;
      cost: { totalUsd: number };
    }>((resolve) => {
      resolveVideo = resolve;
    });
    mockGenerateVideo.mockReturnValueOnce(videoPromise);

    const firstModule = await loadSingleShotModule();
    const submitResult = await firstModule.submitSingleShot({
      shot: {
        id: "job-ledger-complete",
        prompt: "Return a durable result",
        durationSeconds: 4,
      },
      provider: "mock",
      outputPath: path.join(tempDir, "complete.mp4"),
    });

    expect(await firstModule.pollShotJob(submitResult.jobId)).toEqual({
      jobId: submitResult.jobId,
      status: "pending",
    });

    if (resolveVideo === undefined) {
      throw new Error("Video resolver was not initialised");
    }
    resolveVideo({
      data: fixtureServer.baseUrl + "/valid.mp4",
      mimeType: "video/mp4",
      cost: { totalUsd: 1.25 },
    });

    await waitForCondition(async () => {
      const result = await firstModule.pollShotJob(submitResult.jobId);
      if (result.status !== "complete") return false;
      expect(await fs.readFile(path.join(tempDir, "complete.mp4"))).toEqual(FIXTURE_BYTES);
      return true;
    });

    const restartedModule = await loadSingleShotModule();
    const result = await restartedModule.pollShotJob(submitResult.jobId);

    expect(result).toEqual({
      jobId: submitResult.jobId,
      status: "complete",
      clipPath: path.join(tempDir, "complete.mp4"),
      creditsCharged: 125,
      idempotent: false,
    });
  });

  it("persists a failed job across module re-instantiation", async () => {
    ({ dir: tempDir, file: jobStorePath } = await makeTempJobStorePath());
    process.env["AIPOWERED_SINGLE_SHOT_JOB_STORE"] = jobStorePath;
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    mockGenerateVideo.mockRejectedValueOnce(new Error("provider exploded"));

    const firstModule = await loadSingleShotModule();
    const submitResult = await firstModule.submitSingleShot({
      shot: {
        id: "job-ledger-failed",
        prompt: "Fail this job",
        durationSeconds: 5,
      },
      provider: "mock",
      outputPath: path.join(tempDir, "failed.mp4"),
    });

    await waitForCondition(async () => {
      try {
        await firstModule.pollShotJob(submitResult.jobId);
        return false;
      } catch (err) {
        return (
          err instanceof Error &&
          (err as { name?: string }).name === "AiPoweredError" &&
          (err as { code?: string }).code === "PROVIDER_ERROR"
        );
      }
    });

    const restartedModule = await loadSingleShotModule();
    let caught: unknown;
    try {
      await restartedModule.pollShotJob(submitResult.jobId);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as { name?: string }).name).toBe("AiPoweredError");
    expect((caught as { code?: string }).code).toBe("PROVIDER_ERROR");
    expect((caught as Error).message).toContain("provider exploded");
  });

  it("fails fast with a clear degraded-mode error when the ledger path is not writable", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    process.env["AIPOWERED_SINGLE_SHOT_JOB_STORE"] = tempDir;
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });

    const { submitSingleShot } = await loadSingleShotModule();
    let caught: unknown;
    try {
      await submitSingleShot({
        shot: {
          id: "job-ledger-unavailable",
          prompt: "This should not be accepted",
          durationSeconds: 2,
        },
        provider: "mock",
        outputPath: path.join(tempDir, "unavailable.mp4"),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as { name?: string }).name).toBe("AiPoweredError");
    expect((caught as { code?: string }).code).toBe("PROVIDER_ERROR");
    expect((caught as Error).message).toContain("Async polling is disabled");
  });
  it("does not schedule a callback without an authenticated owner", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    mockGenerateVideo.mockResolvedValue({
      data: "data:video/mp4;base64,ZmFrZQ==",
      cost: { totalUsd: 0.01 },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { generateSingleShot } = await loadSingleShotModule();

    const result = await generateSingleShot({
      shot: { id: "unauth-callback", prompt: "test", durationSeconds: 2 },
      provider: "mock",
      outputPath: path.join(tempDir, "unauth.mp4"),
      callbackUrl: "https://93.184.216.34/webhook",
    });

    expect(result.status).toBe("complete");
    expect(fetchSpy).not.toHaveBeenCalled();
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("allows the trusted service credential to own callback delivery", async () => {
    ({ dir: tempDir } = await makeTempJobStorePath());
    process.env["AIPOWERED_API_KEY"] = "service-key";
    process.env["AIPOWERED_WEBHOOK_SECRET"] = "webhook-secret";
    mockGetAiClient.mockResolvedValue({ generateVideo: mockGenerateVideo });
    mockGenerateVideo.mockResolvedValue({
      data: "data:video/mp4;base64,ZmFrZQ==",
      cost: { totalUsd: 0.01 },
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);
    const { generateSingleShot } = await loadSingleShotModule();

    await generateSingleShot({
      shot: { id: "auth-callback", prompt: "test", durationSeconds: 2 },
      provider: "mock",
      outputPath: path.join(tempDir, "auth.mp4"),
      callbackUrl: "https://93.184.216.34/webhook",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const webhookBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(webhookBody).toMatchObject({
      event: "shot:complete",
      shotId: "auth-callback",
      clipPath: "auth.mp4",
    });
    expect(String(webhookBody.clipPath)).not.toContain(tempDir);
  });
});
