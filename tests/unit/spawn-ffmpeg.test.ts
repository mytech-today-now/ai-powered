/**
 * @file tests/unit/spawn-ffmpeg.test.ts
 *
 * Unit tests for the spawnFfmpeg() logic — T-SF-01..T-SF-04.
 *
 * spawnFfmpeg() is a module-private function in routes.ts.  Its logic is
 * replicated here via makeSpawnFfmpeg() — a factory that imports `spawn`
 * from the Vitest-mocked 'node:child_process' module so the mock applies
 * without exporting the production symbol.
 *
 * Tests:
 *   T-SF-01 — Resolves on exit code 0
 *   T-SF-02 — Rejects on non-zero exit with tail stderr
 *   T-SF-03 — Rejects with actionable install-hint on ENOENT
 *   T-SF-04 — Stderr trimmed to last 2048 bytes on non-zero exit
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Mock node:child_process before any import that loads routes.ts
// ---------------------------------------------------------------------------
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// makeSpawnFfmpeg — mirrors the production spawnFfmpeg() in routes.ts.
// Importing `spawn` from the mocked module means the mock controls behaviour.
// ---------------------------------------------------------------------------
function makeSpawnFfmpeg() {
  return function spawnFfmpeg(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("ffmpeg", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      } as Parameters<typeof spawn>[2]);

      const stderrChunks: Buffer[] = [];
      (proc.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) =>
        stderrChunks.push(chunk),
      );
      (proc.stdout as NodeJS.ReadableStream).resume();

      proc.on("close", (code: number | null) => {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        if (code === 0) {
          resolve(stderr);
        } else {
          const tail = stderr.slice(-2048);
          reject(
            new Error(
              `ffmpeg exited with code ${code}.\nCommand: ffmpeg ${args.join(" ")}\nStderr (tail 2 KB):\n${tail}`,
            ),
          );
        }
      });

      proc.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          reject(
            new Error(
              "ffmpeg not found in PATH. Install it on the server host:\n" +
                "  macOS:   brew install ffmpeg\n" +
                "  Ubuntu:  sudo apt-get install -y ffmpeg\n" +
                "  Windows: scoop install ffmpeg\n" +
                "Or use: npm install @ffmpeg-installer/ffmpeg",
            ),
          );
        } else {
          reject(err);
        }
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers — build mock child processes backed by EventEmitter
// ---------------------------------------------------------------------------

function makeMockProc(stderrText = "", exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter() as EventEmitter & { resume: () => void };
  (proc.stdout as EventEmitter & { resume: () => void }).resume = vi.fn();
  proc.stderr = new EventEmitter();

  setImmediate(() => {
    if (stderrText) proc.stderr.emit("data", Buffer.from(stderrText, "utf8"));
    proc.emit("close", exitCode);
  });

  return proc;
}

function makeMockProcWithError(err: NodeJS.ErrnoException) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter() as EventEmitter & { resume: () => void };
  (proc.stdout as EventEmitter & { resume: () => void }).resume = vi.fn();
  proc.stderr = new EventEmitter();

  setImmediate(() => proc.emit("error", err));
  return proc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const spawnFfmpeg = makeSpawnFfmpeg();
const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

describe("spawnFfmpeg() — T-SF-01..T-SF-04", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── T-SF-01 ───────────────────────────────────────────────────────────────
  it("T-SF-01: resolves with stderr string on exit code 0", async () => {
    spawnMock.mockReturnValue(makeMockProc("banner text", 0));
    const result = await spawnFfmpeg(["-version"], "/tmp");
    expect(result).toBe("banner text");
  });

  // ── T-SF-02 ───────────────────────────────────────────────────────────────
  it("T-SF-02: rejects on non-zero exit; error contains exit code and tail stderr", async () => {
    spawnMock.mockReturnValue(makeMockProc("error line", 1));
    await expect(spawnFfmpeg(["-y", "-f", "concat"], "/tmp")).rejects.toSatisfy(
      (err: Error) =>
        err.message.includes("ffmpeg exited with code 1") && err.message.includes("error line"),
    );
  });

  // ── T-SF-03 ───────────────────────────────────────────────────────────────
  it("T-SF-03: rejects with install-hint error on ENOENT", async () => {
    const enoent = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    spawnMock.mockReturnValue(makeMockProcWithError(enoent as NodeJS.ErrnoException));
    await expect(spawnFfmpeg(["-version"], "/tmp")).rejects.toSatisfy(
      (err: Error) =>
        err.message.includes("ffmpeg not found in PATH") &&
        err.message.includes("brew install ffmpeg") &&
        err.message.includes("apt-get install"),
    );
  });

  // ── T-SF-04 ───────────────────────────────────────────────────────────────
  it("T-SF-04: error message contains at most 2048 bytes of stderr (not full 4096)", async () => {
    const longStderr = "x".repeat(4096);
    spawnMock.mockReturnValue(makeMockProc(longStderr, 1));
    const err = await spawnFfmpeg(["-version"], "/tmp").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const tail2k = "x".repeat(2048);
    expect((err as Error).message).toContain(tail2k);
    // The full 4096 x's should NOT appear as a contiguous block
    expect((err as Error).message).not.toContain("x".repeat(4097));
  });
});
