/**
 * @file tests/unit/idempotency.test.ts
 *
 * T-FB-18 — Idempotency cache policy and Redis client selection.
 *
 * Verifies the three key behaviors for Story 6:
 *   - No AIPOWERED_REDIS_URL → idempotency remains a no-op.
 *   - Healthy Redis path → cache keys and hits work as expected.
 *   - AIPOWERED_REDIS_URL set but ioredis unavailable → explicit failure, not
 *     a silent in-memory downgrade.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SingleShotResult } from "../../src/ai-powered/single-shot.js";

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

let tempFileCounter = 0;

function makeOutputPath(label: string): string {
  tempFileCounter += 1;
  return path.join(os.tmpdir(), `ai-powered-idempotency-${label}-${tempFileCounter}.mp4`);
}

describe("T-FB-18 — idempotency cache Redis client policy", () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = saveEnvVars(["AIPOWERED_REDIS_URL", "AIPOWERED_API_KEY"]);
    vi.resetModules();
    vi.doUnmock("ioredis");
  });

  afterEach(() => {
    restoreEnvVars(saved);
    vi.restoreAllMocks();
  });

  it("no AIPOWERED_REDIS_URL → generateSingleShot stays a no-op for idempotency", async () => {
    delete process.env["AIPOWERED_REDIS_URL"];
    delete process.env["AIPOWERED_API_KEY"];

    vi.doMock("ioredis", () => {
      throw new Error("ioredis should not be imported when idempotency is disabled");
    });

    const { generateSingleShot } = await import("../../src/ai-powered/single-shot.js");
    const outputPath = makeOutputPath("no-redis");

    try {
      const first = await generateSingleShot({
        shot: { id: "no-redis-1", prompt: "mock shot", durationSeconds: 3 },
        provider: "mock",
        outputPath,
        idempotencyKey: "no-redis-key",
      });

      const second = await generateSingleShot({
        shot: { id: "no-redis-1", prompt: "mock shot", durationSeconds: 3 },
        provider: "mock",
        outputPath,
        idempotencyKey: "no-redis-key",
      });

      expect(first.status).toBe("complete");
      expect(second.status).toBe("complete");
      expect(first.idempotent).toBe(false);
      expect(second.idempotent).toBe(false);
      expect(first.clipPath).toBe(outputPath);
      expect(second.clipPath).toBe(outputPath);
    } finally {
      await fs.rm(outputPath, { force: true });
    }
  });

  it("healthy Redis path stores and reads the same cache key format", async () => {
    process.env["AIPOWERED_REDIS_URL"] = "redis://localhost:6379";

    const constructorUrls: string[] = [];
    const callLog: Array<{ key: string; value: string }> = [];
    const backingStore = new Map<string, string>();

    vi.doMock("ioredis", () => {
      class MockRedis {
        constructor(url: string) {
          constructorUrls.push(url);
        }

        async get(key: string): Promise<string | null> {
          return backingStore.get(key) ?? null;
        }

        async set(
          key: string,
          value: string,
          _exMode: "EX",
          _ttl: number,
          nxMode: "NX",
        ): Promise<string | null> {
          callLog.push({ key, value });
          if (nxMode === "NX" && backingStore.has(key)) {
            return null;
          }
          backingStore.set(key, value);
          return "OK";
        }

        async quit(): Promise<unknown> {
          return undefined;
        }
      }

      return { Redis: MockRedis };
    });

    const { checkIdempotency, storeIdempotency, _resetIdempotencyClient } =
      await import("../../src/ai-powered/idempotency.js");
    _resetIdempotencyClient();

    const opts = {
      idempotencyKey: "session-42",
      provider: "runway-gen3",
      shotId: "s003",
    };

    const result: SingleShotResult = {
      jobId: "job-123",
      status: "complete",
      clipPath: "/tmp/example.mp4",
      creditsCharged: 17,
      idempotent: false,
    };

    await storeIdempotency(opts, result);

    expect(constructorUrls).toEqual(["redis://localhost:6379"]);
    expect(callLog.map((entry) => entry.key)).toEqual([
      "ai-powered:idempotency:meta:session-42",
      "ai-powered:idempotency:session-42:runway-gen3:s003",
    ]);

    const cached = await checkIdempotency(opts);
    expect(cached).toEqual({
      ...result,
      idempotent: true,
    });
  });

  it("configured Redis without ioredis → throws an explicit operator-visible error", async () => {
    process.env["AIPOWERED_REDIS_URL"] = "redis://localhost:6379";

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    vi.doMock("ioredis", () => {
      throw new Error("Cannot find module 'ioredis'");
    });

    const { checkIdempotency, _resetIdempotencyClient } =
      await import("../../src/ai-powered/idempotency.js");
    _resetIdempotencyClient();

    const failure = checkIdempotency({
      idempotencyKey: "session-42",
      provider: "runway-gen3",
      shotId: "s003",
    });

    let thrown: unknown;
    try {
      await failure;
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
    });
    expect((thrown as { name?: string }).name).toBe("AiPoweredError");
    expect((thrown as Error).message).toContain("AIPOWERED_REDIS_URL");
    expect((thrown as Error).message).toContain("ioredis");

    const stderrText = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(stderrText).toContain("AIPOWERED_REDIS_URL");
    expect(stderrText).toContain("ioredis");
  });
});
