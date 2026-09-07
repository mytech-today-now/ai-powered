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

describe("single-shot job ledger durability", () => {
  let savedEnv: SavedEnv;
  let tempDir = "";
  let jobStorePath = "";

  beforeEach(() => {
    savedEnv = saveEnvVars([
      "AIPOWERED_API_KEY",
      "AIPOWERED_AUTH_ENDPOINT",
      "AIPOWERED_JWT_PUBLIC_KEY",
      "AIPOWERED_SINGLE_SHOT_JOB_STORE",
    ]);
    delete process.env["AIPOWERED_API_KEY"];
    delete process.env["AIPOWERED_AUTH_ENDPOINT"];
    delete process.env["AIPOWERED_JWT_PUBLIC_KEY"];
    mockGetAiClient.mockReset();
    mockGenerateVideo.mockReset();
  });

  afterEach(async () => {
    restoreEnvVars(savedEnv);
    if (tempDir.length > 0) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
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
      data: "data:video/mp4;base64,ZmFrZS12aWRlby1ieXRlcw==",
      cost: { totalUsd: 1.25 },
    });

    await waitForCondition(async () => {
      const result = await firstModule.pollShotJob(submitResult.jobId);
      return result.status === "complete";
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
});
