/**
 * @file tests/unit/stitch-route.test.ts
 *
 * Unit tests for the NEW server-side stitchVideos() browser function — T-SR-01..T-SR-03.
 *
 * stitchVideos() in the updated app.js calls fetch('/stitch', …) instead of
 * running ffmpeg.wasm in the browser.  The logic is mirrored here as
 * makeStitcher() — a factory that accepts an injectable `fetchFn` so fetch
 * can be replaced with a vi.fn() per test without touching globals.
 *
 * Test environment: jsdom (DOM available).
 */

// @vitest-environment jsdom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// makeStitcher — injectable mirror of the new server-side stitchVideos()
// from implementation.md §7.  fetchFn defaults to globalThis.fetch.
// ---------------------------------------------------------------------------

type ResultItem = { status: string; modality: string; result?: { data?: string } };

function makeStitcher(fetchFn: typeof fetch = globalThis.fetch) {
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

    const clips = (resultItems ?? []).filter(
      (r): r is ResultItem =>
        (r as ResultItem).status === "ok" &&
        (r as ResultItem).modality === "video" &&
        Boolean((r as ResultItem).result?.data),
    );

    // Guard 1: require ≥ 2 valid video clips
    if (clips.length < 2) {
      if (combinedVideoStatus) combinedVideoStatus.textContent = "";
      if (combinedVideoSection) combinedVideoSection.hidden = true;
      if (btnDownloadCombined) btnDownloadCombined.hidden = true;
      return null;
    }

    if (combinedVideoSection) combinedVideoSection.hidden = false;
    if (combinedVideoPlayer) combinedVideoPlayer.src = "";
    if (btnDownloadCombined) btnDownloadCombined.hidden = true;
    if (combinedVideoStatus) combinedVideoStatus.textContent = "Sending clips to server…";

    try {
      const clipDataUris = clips.map((r) => r.result!.data!);
      if (combinedVideoStatus)
        combinedVideoStatus.textContent = `Stitching on server (${clips.length} clips)…`;

      const resp = await fetchFn("/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: clipDataUris }),
      });

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => ({ error: resp.statusText }))) as {
          error?: string;
        };
        throw new Error(
          `Server stitch failed (${resp.status}): ${errBody.error ?? resp.statusText}`,
        );
      }

      const json = (await resp.json()) as { data?: string; sizeMB?: number };
      if (!json.data) throw new Error("Server returned no data URI for combined video.");

      const b64 = json.data.replace(/^data:[^,]+,/, "");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "video/mp4" });
      const sizeMB = json.sizeMB ?? Math.round((blob.size / (1024 * 1024)) * 10) / 10;

      const url = URL.createObjectURL(blob);
      if (combinedVideoPlayer) combinedVideoPlayer.src = url;
      if (btnDownloadCombined) btnDownloadCombined.hidden = false;
      if (combinedVideoStatus) combinedVideoStatus.textContent = `Ready · ${sizeMB} MB`;
      return blob;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (combinedVideoStatus) combinedVideoStatus.textContent = `Stitch failed: ${msg}`;
      if (btnDownloadCombined) btnDownloadCombined.hidden = true;
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function clip(data = "data:video/mp4;base64,AAAA"): ResultItem {
  return { status: "ok", modality: "video", result: { data } };
}

function setupDom() {
  document.body.innerHTML = `
    <span  id="combined-video-status"></span>
    <div   id="combined-video-section" hidden></div>
    <video id="combined-video-player"></video>
    <button id="btn-download-combined" hidden></button>
  `;
}

function statusText() {
  return document.getElementById("combined-video-status")?.textContent ?? "";
}

// ---------------------------------------------------------------------------
// Tests — T-SR-01..T-SR-03
// ---------------------------------------------------------------------------

describe("stitchVideos() server-side — T-SR-01..T-SR-03", () => {
  beforeEach(() => {
    setupDom();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue("blob:mock-url"),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── T-SR-01 ───────────────────────────────────────────────────────────────
  it("T-SR-01: fewer than 2 clips → returns null; fetch not called; section hidden", async () => {
    const mockFetch = vi.fn();
    const stitchVideos = makeStitcher(mockFetch as typeof fetch);

    const result = await stitchVideos([clip()]);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect((document.getElementById("combined-video-section") as HTMLDivElement).hidden).toBe(true);
  });

  // ── T-SR-02 ───────────────────────────────────────────────────────────────
  it("T-SR-02: successful 2-clip stitch → Blob(video/mp4); status 'Ready · 1.2 MB'", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: "data:video/mp4;base64,AAAA", sizeMB: 1.2 }),
    });
    const stitchVideos = makeStitcher(mockFetch as typeof fetch);

    const result = await stitchVideos([clip(), clip()]);

    expect(result).toBeInstanceOf(Blob);
    expect((result as Blob).type).toBe("video/mp4");
    expect(statusText()).toBe("Ready · 1.2 MB");
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith("/stitch", expect.objectContaining({ method: "POST" }));
  });

  // ── T-SR-03 ───────────────────────────────────────────────────────────────
  it("T-SR-03: HTTP 500 from server → null; status starts with 'Stitch failed: Server stitch failed (500)'", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: "ffmpeg exited with code 1" }),
    });
    const stitchVideos = makeStitcher(mockFetch as typeof fetch);

    const result = await stitchVideos([clip(), clip()]);

    expect(result).toBeNull();
    expect(statusText()).toMatch(/^Stitch failed: Server stitch failed \(500\)/);
    expect(statusText()).toContain("ffmpeg exited with code 1");
  });
});
