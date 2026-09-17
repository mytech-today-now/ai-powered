import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

type ClipLike = {
  status: string;
  modality: string;
  result?: {
    data?: unknown;
    mimeType?: string;
    cost?: { totalUsd: number };
  };
  error?: string;
  name?: string;
  index?: number;
};

type HarnessState = {
  combinedVideoBlob: Blob | null;
  combinedVideoDataUri: string | null;
};

type FfmpegProgressEvent = {
  progress?: number;
};

class MockFFmpeg {
  readonly handlers: Record<string, (event: FfmpegProgressEvent) => void> = {};
  readonly on = vi.fn((event: string, handler: (payload: FfmpegProgressEvent) => void) => {
    this.handlers[event] = handler;
  });
  readonly off = vi.fn();
  readonly load = vi.fn(async () => {
    this.handlers.progress?.({ progress: 0.25 });
  });
  readonly writeFile = vi.fn(async () => {});
  readonly exec = vi.fn(async () => {
    this.handlers.progress?.({ progress: 1 });
    return 0;
  });
  readonly readFile = vi.fn(async () => new Uint8Array([0, 1, 2, 3]));
  readonly terminate = vi.fn(async () => {});
}

type StitchHarness = {
  window: Window & {
    _FFmpeg?: new () => MockFFmpeg;
    _toBlobURL?: (url: string, mimeType: string) => Promise<string>;
    SharedArrayBuffer?: unknown;
  };
  state: HarnessState;
  combinedVideoSection: { hidden: boolean };
  combinedVideoStatus: { textContent: string };
  combinedVideoPlayer: { src: string };
  btnDownloadCombined: { hidden: boolean };
  ffmpegMock: MockFFmpeg;
  revokeObjectUrl: ReturnType<typeof vi.fn>;
  consoleError: ReturnType<typeof vi.fn>;
  stitchVideos: (resultItems: ClipLike[]) => Promise<Blob | null>;
};

const appJsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../integrations/web-example/app.js",
);

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  return map[mimeType] ?? "bin";
}

function dataUrlToBlob(window: Window, dataUrl: string): Blob {
  const [header, base64 = ""] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  return new window.Blob([bytes], { type: mime });
}

function makeDataUri(bytes: number[], mimeType = "video/mp4"): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function makeHugeDataUri(base64Length: number): string {
  const base64Like = {
    length: base64Length,
    trim() {
      return this;
    },
    endsWith() {
      return false;
    },
  };

  const fakeDataUri = {
    match() {
      return ["data:video/mp4;base64,", "video/mp4"];
    },
    indexOf() {
      return 21;
    },
    slice() {
      return base64Like;
    },
  };

  return fakeDataUri as unknown as string;
}

function makeVideoClip(data: string, overrides: Partial<ClipLike["result"]> = {}): ClipLike {
  return {
    status: "ok",
    modality: "video",
    result: {
      data,
      mimeType: "video/mp4",
      ...overrides,
    },
  };
}

function makeHarness(
  options: {
    sharedArrayBuffer?: unknown;
    previousSrc?: string;
    withRuntime?: boolean;
    ffmpegMock?: MockFFmpeg;
  } = {},
): StitchHarness {
  const dom = new JSDOM("", { url: "https://example.test/" });
  const window = dom.window as StitchHarness["window"];
  const state: HarnessState = {
    combinedVideoBlob: null,
    combinedVideoDataUri: null,
  };
  const combinedVideoSection = { hidden: true };
  const combinedVideoStatus = { textContent: "" };
  const combinedVideoPlayer = { src: options.previousSrc ?? "" };
  const btnDownloadCombined = { hidden: true };
  const revokeObjectUrl = vi.fn();
  const consoleError = vi.fn();
  const ffmpegMock = options.ffmpegMock ?? new MockFFmpeg();
  const sharedArrayBufferValue = Object.prototype.hasOwnProperty.call(options, "sharedArrayBuffer")
    ? options.sharedArrayBuffer
    : class MockSharedArrayBuffer {};

  Object.defineProperty(window.URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
    writable: true,
  });
  Object.defineProperty(window, "SharedArrayBuffer", {
    configurable: true,
    value: sharedArrayBufferValue,
    writable: true,
  });

  if (options.withRuntime === false) {
    (window as typeof window & Record<string, unknown>)._FFmpeg = undefined;
    (window as typeof window & Record<string, unknown>)._toBlobURL = undefined;
  } else {
    (window as typeof window & Record<string, unknown>)._FFmpeg = vi.fn(function _FFmpeg() {
      return ffmpegMock;
    });
    (window as typeof window & Record<string, unknown>)._toBlobURL = vi.fn(
      async (url: string, mimeType: string) => `blob:${mimeType}:${url}`,
    );
  }

  const stitchVideos = compileStitchVideos({
    window,
    state,
    combinedVideoSection,
    combinedVideoStatus,
    combinedVideoPlayer,
    btnDownloadCombined,
    mimeToExt,
    dataUrlToBlob: (dataUrl: string) => dataUrlToBlob(window, dataUrl),
    console: {
      error: consoleError,
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  });

  return {
    window,
    state,
    combinedVideoSection,
    combinedVideoStatus,
    combinedVideoPlayer,
    btnDownloadCombined,
    ffmpegMock,
    revokeObjectUrl,
    consoleError,
    stitchVideos,
  };
}

function compileStitchVideos(ctx: {
  window: StitchHarness["window"];
  state: HarnessState;
  combinedVideoSection: { hidden: boolean };
  combinedVideoStatus: { textContent: string };
  combinedVideoPlayer: { src: string };
  btnDownloadCombined: { hidden: boolean };
  mimeToExt: typeof mimeToExt;
  dataUrlToBlob: (dataUrl: string) => Blob;
  console: {
    error: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
}): (resultItems: ClipLike[]) => Promise<Blob | null> {
  const source = fs.readFileSync(appJsPath, "utf8");
  const startMarker = "async function stitchVideos(resultItems)";
  const endMarker = "/* ── DURATION ERROR MESSAGING";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  if (start < 0 || end < 0) {
    throw new Error("Unable to extract stitchVideos() from integrations/web-example/app.js");
  }

  let helper = source.slice(start, end);
  helper = helper.replace(/\bcombinedVideoBlob\b/g, "ctx.state.combinedVideoBlob");
  helper = helper.replace(/\bcombinedVideoDataUri\b/g, "ctx.state.combinedVideoDataUri");
  helper = helper.replace(startMarker, "return async function stitchVideos(resultItems)");

  const body = [
    '"use strict";',
    "const window = ctx.window;",
    "const Blob = window.Blob;",
    "const FileReader = window.FileReader;",
    "const URL = window.URL;",
    "const combinedVideoSection = ctx.combinedVideoSection;",
    "const combinedVideoStatus = ctx.combinedVideoStatus;",
    "const combinedVideoPlayer = ctx.combinedVideoPlayer;",
    "const btnDownloadCombined = ctx.btnDownloadCombined;",
    "const mimeToExt = ctx.mimeToExt;",
    "const dataUrlToBlob = ctx.dataUrlToBlob;",
    "const console = ctx.console;",
    helper,
  ].join("\n");

  return new Function("ctx", body)(ctx) as (resultItems: ClipLike[]) => Promise<Blob | null>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stitchVideos", () => {
  it("returns null and resets stale output when fewer than two valid clips are available", async () => {
    const harness = makeHarness({ previousSrc: "blob:previous-stitch" });

    const result = await harness.stitchVideos([
      makeVideoClip(makeDataUri([1, 2, 3])),
      { status: "error", modality: "video", error: "clip failed" },
    ]);

    expect(result).toBeNull();
    expect(harness.state.combinedVideoBlob).toBeNull();
    expect(harness.state.combinedVideoDataUri).toBeNull();
    expect(harness.combinedVideoSection.hidden).toBe(true);
    expect(harness.combinedVideoStatus.textContent).toBe("");
    expect(harness.btnDownloadCombined.hidden).toBe(true);
    expect(harness.combinedVideoPlayer.src).toBe("");
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:previous-stitch");
  });

  it("fails closed when SharedArrayBuffer is unavailable", async () => {
    const harness = makeHarness({
      previousSrc: "blob:previous-stitch",
      sharedArrayBuffer: undefined,
    });

    const result = await harness.stitchVideos([
      makeVideoClip(makeDataUri([1, 2, 3])),
      makeVideoClip(makeDataUri([4, 5, 6])),
    ]);

    expect(result).toBeNull();
    expect(harness.state.combinedVideoBlob).toBeNull();
    expect(harness.state.combinedVideoDataUri).toBeNull();
    expect(harness.combinedVideoSection.hidden).toBe(false);
    expect(harness.combinedVideoStatus.textContent).toContain("SharedArrayBuffer support");
    expect(harness.btnDownloadCombined.hidden).toBe(true);
    expect(harness.window._FFmpeg).not.toHaveBeenCalled();
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:previous-stitch");
  });

  it("fails closed when the FFmpeg runtime helpers are missing", async () => {
    const harness = makeHarness({
      sharedArrayBuffer: class MockSharedArrayBuffer {},
      withRuntime: false,
    });

    const result = await harness.stitchVideos([
      makeVideoClip(makeDataUri([1, 2, 3])),
      makeVideoClip(makeDataUri([4, 5, 6])),
    ]);

    expect(result).toBeNull();
    expect(harness.state.combinedVideoBlob).toBeNull();
    expect(harness.state.combinedVideoDataUri).toBeNull();
    expect(harness.combinedVideoSection.hidden).toBe(false);
    expect(harness.combinedVideoStatus.textContent).toContain("runtime unavailable");
    expect(harness.btnDownloadCombined.hidden).toBe(true);
  });

  it("fails closed when the combined payload exceeds the 500 MB browser limit", async () => {
    const harness = makeHarness({
      sharedArrayBuffer: class MockSharedArrayBuffer {},
    });

    const hugeClip = makeVideoClip(makeHugeDataUri(350_000_000));

    const result = await harness.stitchVideos([hugeClip, hugeClip]);

    expect(result).toBeNull();
    expect(harness.state.combinedVideoBlob).toBeNull();
    expect(harness.state.combinedVideoDataUri).toBeNull();
    expect(harness.combinedVideoSection.hidden).toBe(false);
    expect(harness.combinedVideoStatus.textContent).toContain("500 MB browser limit");
    expect(harness.btnDownloadCombined.hidden).toBe(true);
    expect(harness.window._FFmpeg).not.toHaveBeenCalled();
  });

  it("stitches clips and records the combined video blob on success", async () => {
    const harness = makeHarness({
      previousSrc: "blob:stale-preview",
      sharedArrayBuffer: class MockSharedArrayBuffer {},
    });

    const clips = [
      makeVideoClip(makeDataUri([0, 1, 2, 3]), { mimeType: "video/mp4" }),
      makeVideoClip(makeDataUri([4, 5, 6, 7]), { mimeType: "video/mp4" }),
    ];

    const result = await harness.stitchVideos(clips);

    expect(result).toBeInstanceOf(harness.window.Blob);
    expect(result?.type).toBe("video/mp4");
    expect(harness.state.combinedVideoBlob).toBeInstanceOf(harness.window.Blob);
    expect(harness.state.combinedVideoDataUri).toMatch(/^data:video\/mp4;base64,/);
    expect(harness.combinedVideoSection.hidden).toBe(false);
    expect(harness.combinedVideoStatus.textContent).toContain("Stitching 2 clips");
    expect(harness.ffmpegMock.on).toHaveBeenCalledWith("progress", expect.any(Function));
    expect(harness.ffmpegMock.load).toHaveBeenCalledTimes(1);
    expect(harness.ffmpegMock.writeFile).toHaveBeenCalledTimes(3);
    expect(harness.ffmpegMock.exec).toHaveBeenCalledWith([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat.txt",
      "-c",
      "copy",
      "combined.mp4",
    ]);
    expect(harness.ffmpegMock.readFile).toHaveBeenCalledWith("combined.mp4");
    expect(harness.ffmpegMock.off).toHaveBeenCalledWith("progress", expect.any(Function));
    expect(harness.ffmpegMock.terminate).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:stale-preview");

    const writtenNames = harness.ffmpegMock.writeFile.mock.calls.map(([name]) => name);
    expect(writtenNames).toEqual(["combined-clip-0.mp4", "combined-clip-1.mp4", "concat.txt"]);
  });

  it("cleans up and surfaces a failure when FFmpeg exec throws", async () => {
    const ffmpegMock = new MockFFmpeg();
    ffmpegMock.exec.mockImplementation(async () => {
      ffmpegMock.handlers.progress?.({ progress: 0.6 });
      throw new Error("ffmpeg exploded");
    });

    const harness = makeHarness({
      sharedArrayBuffer: class MockSharedArrayBuffer {},
      ffmpegMock,
    });

    const result = await harness.stitchVideos([
      makeVideoClip(makeDataUri([9, 8, 7]), { mimeType: "video/mp4" }),
      makeVideoClip(makeDataUri([6, 5, 4]), { mimeType: "video/mp4" }),
    ]);

    expect(result).toBeNull();
    expect(harness.state.combinedVideoBlob).toBeNull();
    expect(harness.state.combinedVideoDataUri).toBeNull();
    expect(harness.combinedVideoSection.hidden).toBe(false);
    expect(harness.combinedVideoStatus.textContent).toContain("Stitch failed: ffmpeg exploded");
    expect(harness.consoleError).toHaveBeenCalledWith(
      "[stitchVideos] Stitch failed:",
      expect.any(Error),
    );
    expect(harness.ffmpegMock.off).toHaveBeenCalledWith("progress", expect.any(Function));
    expect(harness.ffmpegMock.terminate).toHaveBeenCalledTimes(1);
  });
});
