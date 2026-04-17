/**
 * @file tests/unit/stitch-videos.test.ts
 *
 * Unit tests for the stitchVideos() browser function — bd-iwbi / T-BCV-01..T-BCV-08.
 *
 * stitchVideos() is defined inside the app.js IIFE and closes over DOM refs and
 * window globals. This file mirrors its logic via makeStitcher() — a factory that
 * returns a functionally equivalent async function with an injectable SIZE_LIMIT
 * so that guard-4 (>500 MB) can be exercised with small test data.
 *
 * Test environment: jsdom (DOM + window globals available).
 * window._FFmpeg / window._toBlobURL are set per-test via mock factories.
 * SharedArrayBuffer is deleted for T-BCV-05 and restored in afterEach.
 */

// @vitest-environment jsdom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// TypeScript augmentation — extend Window for the CDN-injected globals
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    _FFmpeg: unknown;
    _toBlobURL: unknown;
  }
}

// ---------------------------------------------------------------------------
// makeStitcher — injectable mirror of stitchVideos() from app.js
//
// The SIZE_LIMIT parameter exists only for testability of guard 4.
// All other logic is a faithful copy of the production code.
// ---------------------------------------------------------------------------

function makeStitcher(
  sizeLimit = 500 * 1024 * 1024,
  loadMaxAttempts = 3,
  loadTimeoutMs = 90_000,
  loadRetryWaitMs = 2_000,
) {
  return async function stitchVideos(resultItems: unknown[]): Promise<Blob | null> {
    const combinedVideoStatus = document.getElementById("combined-video-status");
    const combinedVideoSection = document.getElementById(
      "combined-video-section",
    ) as HTMLDivElement | null;
    const combinedVideoPlayer = document.getElementById(
      "combined-video-player",
    ) as HTMLVideoElement | null;
    const btnDownloadCombined = document.getElementById(
      "btn-download-combined",
    ) as HTMLButtonElement | null;

    // Guard 1: require ≥ 2 valid video clips
    const clips = (resultItems ?? []).filter(
      (r: unknown) =>
        (r as Record<string, unknown>).status === "ok" &&
        (r as Record<string, unknown>).modality === "video" &&
        ((r as Record<string, unknown>).result as Record<string, unknown> | undefined)?.data,
    ) as Record<string, unknown>[];
    if (clips.length < 2) {
      if (combinedVideoStatus) combinedVideoStatus.textContent = "";
      if (combinedVideoSection) combinedVideoSection.hidden = true;
      if (btnDownloadCombined) btnDownloadCombined.hidden = true;
      return null;
    }

    // Guard 2: SharedArrayBuffer must exist (cross-origin isolation)
    if (typeof SharedArrayBuffer === "undefined") {
      if (combinedVideoStatus)
        combinedVideoStatus.textContent =
          "Combined video unavailable — page requires cross-origin isolation (COOP/COEP headers).";
      if (combinedVideoSection) combinedVideoSection.hidden = false;
      return null;
    }

    // Guard 3: CDN helpers must be loaded
    if (!window._FFmpeg || !window._toBlobURL) {
      if (combinedVideoStatus)
        combinedVideoStatus.textContent =
          "Combined video unavailable — ffmpeg.wasm CDN script not loaded.";
      if (combinedVideoSection) combinedVideoSection.hidden = false;
      return null;
    }

    // Guard 4: estimated decoded size ≤ sizeLimit (production: 500 MB)
    const estimatedBytes = clips.reduce((sum: number, r) => {
      const b64 = ((r.result as Record<string, unknown>).data as string).replace(
        /^data:[^,]+,/,
        "",
      );
      return sum + b64.length * 0.75;
    }, 0);
    if (estimatedBytes > sizeLimit) {
      if (combinedVideoStatus)
        combinedVideoStatus.textContent =
          "Combined video skipped — estimated decoded size exceeds 500 MB.";
      if (combinedVideoSection) combinedVideoSection.hidden = false;
      return null;
    }

    // Show section, reset player
    if (combinedVideoSection) combinedVideoSection.hidden = false;
    if (combinedVideoPlayer) combinedVideoPlayer.src = "";
    if (btnDownloadCombined) btnDownloadCombined.hidden = true;

    const FFmpegCtor = window._FFmpeg as new () => FfmpegInstance;
    const toBlobURL = window._toBlobURL as (url: string, type: string) => Promise<string>;

    // ── CDN load: retry loop — mirrors app.js production logic exactly ───────
    const BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
    const FFMPEG_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";

    let ffmpeg!: FfmpegInstance;
    let loadError: unknown = null;

    for (let attempt = 1; attempt <= loadMaxAttempts; attempt++) {
      const label = `attempt ${attempt}/${loadMaxAttempts}`;
      if (combinedVideoStatus)
        combinedVideoStatus.textContent = `Downloading ffmpeg.wasm (${label})…`;
      console.log(`[stitchVideos] ffmpeg load ${label} — fetching CDN assets…`);

      // Fresh instance per attempt — avoids partial-init state from a prior failure
      ffmpeg = new FFmpegCtor();
      ffmpeg.on("progress", () => {
        /* status updates handled in production; omitted in tests */
      });

      try {
        await Promise.race([
          (async () => {
            const workerBlobURL = await toBlobURL(`${FFMPEG_URL}/worker.js`, "text/javascript");
            await ffmpeg.load({
              classWorkerURL: workerBlobURL,
              coreURL: await toBlobURL(`${BASE}/ffmpeg-core.js`, "text/javascript"),
              wasmURL: await toBlobURL(`${BASE}/ffmpeg-core.wasm`, "application/wasm"),
            });
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `ffmpeg.wasm download timed out after ${Math.round(loadTimeoutMs / 1000)} s (${label})`,
                  ),
                ),
              loadTimeoutMs,
            ),
          ),
        ]);
        loadError = null;
        console.log(`[stitchVideos] ffmpeg loaded successfully on ${label}`);
        break; // ← exit retry loop on success
      } catch (err: unknown) {
        loadError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < loadMaxAttempts) {
          console.warn(`[stitchVideos] Load ${label} failed: ${msg} — retrying…`);
          if (combinedVideoStatus)
            combinedVideoStatus.textContent = `Download failed (${label}) — retrying in ${loadRetryWaitMs / 1000} s…`;
          await new Promise<void>((resolve) => setTimeout(resolve, loadRetryWaitMs));
        } else {
          console.error(`[stitchVideos] All ${loadMaxAttempts} load attempts failed.`, err);
        }
      }
    }

    try {
      // Surface the final load failure if all retry attempts were exhausted
      if (loadError) throw loadError;

      if (combinedVideoStatus) combinedVideoStatus.textContent = "Writing clips…";
      console.log(`[stitchVideos] Writing ${clips.length} clips to ffmpeg virtual FS…`);

      const concatLines: string[] = [];
      for (let i = 0; i < clips.length; i++) {
        const b64 = ((clips[i].result as Record<string, unknown>).data as string).replace(
          /^data:[^,]+,/,
          "",
        );
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await ffmpeg.writeFile(`clip${i}.mp4`, bytes);
        concatLines.push(`file 'clip${i}.mp4'`);
        console.log(`[stitchVideos]   → wrote clip${i}.mp4 (${bytes.length} bytes)`);
      }
      await ffmpeg.writeFile("list.txt", new TextEncoder().encode(concatLines.join("\n") + "\n"));
      console.log(`[stitchVideos] Concat manifest written; executing ffmpeg…`);
      if (combinedVideoStatus) combinedVideoStatus.textContent = "Stitching…";

      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-c",
        "copy",
        "combined.mp4",
      ]);
      console.log(`[stitchVideos] ffmpeg.exec() complete; reading output…`);

      const rawData = await ffmpeg.readFile("combined.mp4");
      const blob = new Blob([(rawData as Uint8Array).buffer], { type: "video/mp4" });
      const sizeMB = Math.round((blob.size / (1024 * 1024)) * 10) / 10;
      console.log(`[stitchVideos] Combined video ready — ${sizeMB} MB`);

      if (combinedVideoPlayer) combinedVideoPlayer.src = URL.createObjectURL(blob);
      if (btnDownloadCombined) btnDownloadCombined.hidden = false;
      if (combinedVideoStatus) combinedVideoStatus.textContent = `Ready · ${sizeMB} MB`;
      return blob;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[stitchVideos] Stitch failed:`, err);
      if (combinedVideoStatus) combinedVideoStatus.textContent = `Stitch failed: ${msg}`;
      if (btnDownloadCombined) btnDownloadCombined.hidden = true;
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// FfmpegInstance — minimal interface satisfied by the mock class
// ---------------------------------------------------------------------------

interface FfmpegInstance {
  on(event: string, cb: (arg: unknown) => void): void;
  load(opts: Record<string, string>): Promise<void>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  exec(args: string[]): Promise<number>;
  readFile(name: string): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Valid minimal base64 (atob must not throw). */
const SMALL_B64 = btoa("fake-video-bytes");

/** Build a successful video result item. */
function clip(b64 = SMALL_B64) {
  return { status: "ok", modality: "video", result: { data: `data:video/mp4;base64,${b64}` } };
}

/** Build a failed result item — excluded by guard 1. */
function errorClip() {
  return { status: "error", modality: "video", error: "Provider error", result: null };
}

// ---------------------------------------------------------------------------
// FFmpeg mock factory — returns a spy class + its single pre-built instance
// ---------------------------------------------------------------------------

function makeMockFFmpeg(overrides: Partial<FfmpegInstance> = {}): {
  MockFFmpegClass: ReturnType<typeof vi.fn>;
  instance: FfmpegInstance & Record<string, ReturnType<typeof vi.fn>>;
} {
  const instance = {
    on: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue(0),
    readFile: vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0, 4])),
    ...overrides,
  };
  // Must be a regular function (not arrow) so it can be called with `new`.
  // When a constructor returns an object, `new Ctor()` returns that object.
  const MockFFmpegClass = vi.fn(function MockFFmpegCtor() {
    return instance;
  });
  return { MockFFmpegClass, instance };
}

// ---------------------------------------------------------------------------
// DOM scaffolding
// ---------------------------------------------------------------------------

function setupDom(): void {
  document.body.innerHTML = `
    <span id="combined-video-status"></span>
    <div  id="combined-video-section" hidden></div>
    <video id="combined-video-player"></video>
    <button id="btn-download-combined" hidden></button>
  `;
}

function statusText(): string {
  return document.getElementById("combined-video-status")?.textContent ?? "";
}

// ---------------------------------------------------------------------------
// T-BCV-01..T-BCV-06
// ---------------------------------------------------------------------------

describe("stitchVideos() — bd-iwbi / T-BCV-01..T-BCV-08", () => {
  let savedSAB: typeof SharedArrayBuffer | undefined;

  beforeEach(() => {
    setupDom();
    savedSAB = "SharedArrayBuffer" in globalThis ? globalThis.SharedArrayBuffer : undefined;
    // jsdom may not implement URL.createObjectURL — stub so the happy path works
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue("blob:mock-url"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (savedSAB !== undefined) {
      globalThis.SharedArrayBuffer = savedSAB;
    } else {
      delete (globalThis as Record<string, unknown>).SharedArrayBuffer;
    }
    window._FFmpeg = undefined;
    window._toBlobURL = undefined;
    vi.restoreAllMocks();
  });

  // ── T-BCV-01 ──────────────────────────────────────────────────────────────
  it("T-BCV-01: 3 valid clips → Blob(video/mp4) returned; ffmpeg.exec called with concat args [-f concat -safe 0 -i list.txt -c copy combined.mp4]", async () => {
    const { MockFFmpegClass, instance } = makeMockFFmpeg();
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi.fn().mockResolvedValue("blob:core");

    const result = await makeStitcher()([clip(), clip(), clip()]);

    expect(result).toBeInstanceOf(Blob);
    expect((result as Blob).type).toBe("video/mp4");
    expect(instance.exec).toHaveBeenCalledWith([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "list.txt",
      "-c",
      "copy",
      "combined.mp4",
    ]);
    expect(instance.load).toHaveBeenCalledOnce();
  });

  // ── T-BCV-02 ──────────────────────────────────────────────────────────────
  it("T-BCV-02: only 1 valid clip → null immediately; FFmpeg constructor never called", async () => {
    const { MockFFmpegClass, instance } = makeMockFFmpeg();
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi.fn();

    const result = await makeStitcher()([clip()]);

    expect(result).toBeNull();
    expect(MockFFmpegClass).not.toHaveBeenCalled();
    expect(instance.load).not.toHaveBeenCalled();
  });

  // ── T-BCV-03 ──────────────────────────────────────────────────────────────
  it("T-BCV-03: 0 successful clips (all status=error) → null immediately; FFmpeg never instantiated", async () => {
    const { MockFFmpegClass } = makeMockFFmpeg();
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi.fn();

    const result = await makeStitcher()([errorClip(), errorClip(), errorClip()]);

    expect(result).toBeNull();
    expect(MockFFmpegClass).not.toHaveBeenCalled();
  });

  // ── T-BCV-04 ──────────────────────────────────────────────────────────────
  it("T-BCV-04: size guard exceeded → null + size-exceeded message in #combined-video-status", async () => {
    const { MockFFmpegClass } = makeMockFFmpeg();
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi.fn();
    // sizeLimit=100; 3 clips × btoa("A"×50) ≈ 68 chars each → 3×68×0.75≈153 > 100
    const largeB64 = btoa("A".repeat(50));

    const result = await makeStitcher(100)([clip(largeB64), clip(largeB64), clip(largeB64)]);

    expect(result).toBeNull();
    expect(MockFFmpegClass).not.toHaveBeenCalled();
    expect(statusText()).toContain("exceeds 500 MB");
  });

  // ── T-BCV-05 ──────────────────────────────────────────────────────────────
  it("T-BCV-05: SharedArrayBuffer=undefined → null + cross-origin isolation message; no uncaught exception", async () => {
    const { MockFFmpegClass } = makeMockFFmpeg();
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi.fn();

    delete (globalThis as Record<string, unknown>).SharedArrayBuffer;

    await expect(makeStitcher()([clip(), clip(), clip()])).resolves.toBeNull();

    expect(MockFFmpegClass).not.toHaveBeenCalled();
    expect(statusText()).toContain("cross-origin isolation");
  });

  // ── T-BCV-06 ──────────────────────────────────────────────────────────────
  it("T-BCV-06: ffmpeg.exec throws codec error → null returned; #combined-video-status = 'Stitch failed: Codec parameters are not compatible'", async () => {
    const { MockFFmpegClass } = makeMockFFmpeg({
      exec: vi.fn().mockRejectedValue(new Error("Codec parameters are not compatible")),
    });
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi.fn().mockResolvedValue("blob:core");

    const result = await makeStitcher()([clip(), clip(), clip()]);

    expect(result).toBeNull();
    expect(statusText()).toBe("Stitch failed: Codec parameters are not compatible");
  });

  // ── T-BCV-07 ──────────────────────────────────────────────────────────────
  it("T-BCV-07: toBlobURL fails on attempt 1, succeeds on attempt 2 → Blob returned (retry recovers)", async () => {
    // loadMaxAttempts=2 (1 retry), retryWait=0 ms so the test stays fast.
    const { MockFFmpegClass, instance } = makeMockFFmpeg();
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi
      .fn()
      .mockRejectedValueOnce(new Error("network glitch")) // attempt 1 fails on worker.js
      .mockResolvedValue("blob:core"); // attempt 2 (all 3 assets) succeeds

    const result = await makeStitcher(500 * 1024 * 1024, 2, 90_000, 0)([clip(), clip(), clip()]);

    expect(result).toBeInstanceOf(Blob);
    // A fresh FFmpeg instance is created for each attempt
    expect(MockFFmpegClass).toHaveBeenCalledTimes(2);
    // load() only resolves once — on the successful second attempt
    expect(instance.load).toHaveBeenCalledOnce();
  });

  // ── T-BCV-08 ──────────────────────────────────────────────────────────────
  it("T-BCV-08: all load attempts fail → null returned; #combined-video-status starts with 'Stitch failed'", async () => {
    // loadMaxAttempts=2, retryWait=0 ms so the test stays fast.
    const { MockFFmpegClass, instance } = makeMockFFmpeg();
    window._FFmpeg = MockFFmpegClass;
    window._toBlobURL = vi.fn().mockRejectedValue(new Error("CDN unreachable"));

    const result = await makeStitcher(500 * 1024 * 1024, 2, 90_000, 0)([clip(), clip(), clip()]);

    expect(result).toBeNull();
    expect(statusText()).toMatch(/^Stitch failed:/);
    // Two FFmpeg instances created (one per attempt), but load() never resolved
    expect(MockFFmpegClass).toHaveBeenCalledTimes(2);
    expect(instance.load).not.toHaveBeenCalled();
  });
});
