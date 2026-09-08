/**
 * Tests — batch preflight provider checks
 *
 * Covers the browser-demo preflight flow in integrations/web-example/app.js:
 *  - import failure shows an accessible warning instead of disappearing
 *  - HEAD fetch rejection clears its timeout handle in finally
 *  - successful routing and blocking paths still behave as expected
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectI2VProvider } from "../../integrations/web-example/smart-default.js";

type BatchItem = {
  _id: string;
  modality?: string;
  images?: string[];
};

const BATCH_PROVIDER_BLOCK_TITLE =
  "One or more shots have unreachable image URLs or no available provider. " +
  "Remove or fix them before running.";

const BATCH_PREFLIGHT_WARNING =
  "Batch compatibility check unavailable. Server-side validation will still run.";

type TimerHandle = { id: number };

function createTimerTracker() {
  const pending = new Set<number>();
  let nextId = 1;

  const setTimeoutImpl = vi.fn(() => {
    const handle: TimerHandle = { id: nextId++ };
    pending.add(handle.id);
    return handle as unknown as ReturnType<typeof setTimeout>;
  });

  const clearTimeoutImpl = vi.fn((handle: unknown) => {
    if (handle && typeof handle === "object" && "id" in handle) {
      pending.delete((handle as TimerHandle).id);
    }
  });

  return { pending, setTimeoutImpl, clearTimeoutImpl };
}

function createRuntime(options?: {
  importModule?: () => Promise<{ selectI2VProvider: typeof selectI2VProvider }>;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  liveProviders?: string[];
  selectedProvider?: string;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}) {
  const importModule = options?.importModule ?? (async () => ({ selectI2VProvider }) as const);
  const fetchImpl =
    options?.fetchImpl ?? (async () => ({ ok: true, status: 200 }) as unknown as Response);
  const liveProviders = options?.liveProviders ?? ["lumaai", "xai", "venice"];
  const selectedProvider = options?.selectedProvider ?? "openai";
  const setTimeoutImpl = options?.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options?.clearTimeoutImpl ?? clearTimeout;

  document.body.innerHTML = "";

  const batchPreflight = document.createElement("div");
  batchPreflight.id = "batch-preflight";
  batchPreflight.className = "batch-preflight";

  const batchSummary = document.createElement("div");
  batchSummary.id = "batch-summary";
  batchSummary.className = "batch-summary";

  const btnBatchRun = document.createElement("button");
  btnBatchRun.id = "btn-batch-run";
  btnBatchRun.dataset.providerBlocked = "false";

  batchPreflight.appendChild(batchSummary);
  batchPreflight.appendChild(btnBatchRun);
  document.body.appendChild(batchPreflight);

  function syncBatchRunButtonState() {
    btnBatchRun.disabled = btnBatchRun.dataset.providerBlocked === "true";
  }

  function showBatchPreflightWarning(message: string) {
    let warningEl = batchSummary.querySelector<HTMLParagraphElement>(".batch-preflight-warning");
    if (!warningEl) {
      warningEl = document.createElement("p");
      warningEl.className = "warn-box batch-preflight-warning";
      warningEl.setAttribute("role", "status");
      warningEl.setAttribute("aria-live", "polite");
      batchSummary.appendChild(warningEl);
    }
    warningEl.textContent = message;
  }

  function renderShotList(items: BatchItem[]) {
    const ul = document.createElement("ul");
    for (const item of items) {
      const li = document.createElement("li");
      li.dataset.shotId = item._id;

      const status = document.createElement("span");
      status.className = "shot-preflight-status";
      status.dataset.shotId = item._id;
      status.textContent = "⏳";
      status.title = "Checking provider compatibility…";

      li.appendChild(status);
      ul.appendChild(li);
    }
    return ul;
  }

  async function runPreflightProviderChecks(items: BatchItem[], listEl: HTMLElement) {
    const videoImageItems = items.filter(
      (item) => (item.modality || "video") === "video" && item.images && item.images.length > 0,
    );
    if (!videoImageItems.length) return;

    let selectI2VProviderFn: typeof selectI2VProvider = selectI2VProvider;
    try {
      const mod = await importModule();
      selectI2VProviderFn = mod.selectI2VProvider;
    } catch {
      showBatchPreflightWarning(BATCH_PREFLIGHT_WARNING);
      return;
    }

    let hasBlockingError = false;

    await Promise.all(
      videoImageItems.map(async (item) => {
        const urls = item.images ?? [];
        const headResults = await Promise.all(
          urls.map(async (url) => {
            const ac = new AbortController();
            const timer = setTimeoutImpl(() => ac.abort(), 5000);
            try {
              const res = await fetchImpl(url, { method: "HEAD", signal: ac.signal });
              return res.ok;
            } catch {
              return false;
            } finally {
              clearTimeoutImpl(timer);
            }
          }),
        );

        const allUrlsOk = headResults.every(Boolean);
        const firstBadIdx = headResults.findIndex((ok) => !ok);
        const routing = selectI2VProviderFn(selectedProvider, urls.length, liveProviders);
        const noLiveProvider = !liveProviders.length;

        let icon = "✅";
        let title = `Provider: ${routing.provider} · ${urls.length} image(s) accepted`;
        let isBlocker = false;

        if (!allUrlsOk) {
          icon = "❌";
          isBlocker = true;
          title = "Image URL unreachable: " + urls[firstBadIdx];
        } else if (noLiveProvider && urls.length > 0) {
          icon = "❌";
          isBlocker = true;
          title = "No live video provider available — start the proxy with a valid API key";
        } else if (routing.warning) {
          icon = "⚠️";
          title = routing.warning;
          if (routing.alternativeProviders && routing.alternativeProviders.length) {
            title += " (alternatives: " + routing.alternativeProviders.join(", ") + ")";
          }
        }

        if (isBlocker) hasBlockingError = true;

        const statusEl = listEl.querySelector<HTMLSpanElement>(
          '.shot-preflight-status[data-shot-id="' + item._id + '"]',
        );
        if (statusEl) {
          statusEl.textContent = icon;
          statusEl.title = title;
          statusEl.style.color = isBlocker
            ? "var(--danger, #b91c1c)"
            : icon === "⚠️"
              ? "var(--amber, #d97706)"
              : "";
        }
      }),
    );

    if (hasBlockingError) {
      btnBatchRun.dataset.providerBlocked = "true";
      btnBatchRun.title = BATCH_PROVIDER_BLOCK_TITLE;
      syncBatchRunButtonState();
    }
  }

  function showBatchPreflight(items: BatchItem[]) {
    batchSummary.innerHTML = "";
    batchPreflight.classList.remove("hidden");
    btnBatchRun.dataset.providerBlocked = "false";
    btnBatchRun.title = "";
    syncBatchRunButtonState();

    const p = document.createElement("p");
    p.innerHTML =
      "<strong>" +
      items.length +
      " shot" +
      (items.length !== 1 ? "s" : "") +
      "</strong> loaded and ready to process.";
    const ul = renderShotList(items);
    batchSummary.appendChild(p);
    batchSummary.appendChild(ul);

    void runPreflightProviderChecks(items, ul).catch(() => {
      showBatchPreflightWarning(BATCH_PREFLIGHT_WARNING);
    });
  }

  return {
    batchSummary,
    batchPreflight,
    btnBatchRun,
    showBatchPreflight,
    showBatchPreflightWarning,
    runPreflightProviderChecks,
  };
}

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve());
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("batch preflight warning", () => {
  it("shows an accessible warning when smart-default.js cannot be imported and the caller still returns", async () => {
    const runtime = createRuntime({
      importModule: async () => {
        throw new Error("missing module");
      },
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200 }) as Response),
    });

    const items: BatchItem[] = [
      {
        _id: "shot-1",
        modality: "video",
        images: ["https://cdn.example.com/hero.jpg"],
      },
    ];

    expect(() => runtime.showBatchPreflight(items)).not.toThrow();
    await flushMicrotasks();

    const warningEl = runtime.batchSummary.querySelector(".batch-preflight-warning");
    expect(warningEl).not.toBeNull();
    expect(warningEl?.textContent).toBe(BATCH_PREFLIGHT_WARNING);
    expect(warningEl?.getAttribute("role")).toBe("status");
    expect(warningEl?.getAttribute("aria-live")).toBe("polite");
    expect(runtime.btnBatchRun.disabled).toBe(false);
  });
});

describe("HEAD timer cleanup", () => {
  it("clears the abort timer in finally when fetch rejects", async () => {
    const timers = createTimerTracker();
    const runtime = createRuntime({
      importModule: async () => ({ selectI2VProvider }),
      fetchImpl: vi.fn(async () => {
        throw new Error("network down");
      }),
      liveProviders: ["xai", "lumaai"],
      selectedProvider: "xai",
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });

    const items: BatchItem[] = [
      {
        _id: "shot-1",
        modality: "video",
        images: ["https://cdn.example.com/hero.jpg"],
      },
    ];

    const listEl = runtime.batchSummary.querySelector("ul") as HTMLUListElement | null;
    expect(listEl).toBeNull();

    const ul = document.createElement("ul");
    const li = document.createElement("li");
    const status = document.createElement("span");
    status.className = "shot-preflight-status";
    status.dataset.shotId = "shot-1";
    li.appendChild(status);
    ul.appendChild(li);

    await runtime.runPreflightProviderChecks(items, ul);

    expect(timers.setTimeoutImpl).toHaveBeenCalledTimes(1);
    expect(timers.clearTimeoutImpl).toHaveBeenCalledTimes(1);
    expect(timers.pending.size).toBe(0);
    expect(status.textContent).toBe("❌");
    expect(status.title).toBe("Image URL unreachable: https://cdn.example.com/hero.jpg");
  });
});

describe("Routing and blocking", () => {
  it("marks a reachable URL with the current routing result", async () => {
    const runtime = createRuntime({
      importModule: async () => ({ selectI2VProvider }),
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200 }) as Response),
      liveProviders: ["lumaai", "xai"],
      selectedProvider: "xai",
    });

    const items: BatchItem[] = [
      {
        _id: "shot-1",
        modality: "video",
        images: ["https://cdn.example.com/hero.jpg", "https://cdn.example.com/end.jpg"],
      },
    ];

    const ul = document.createElement("ul");
    const li = document.createElement("li");
    const status = document.createElement("span");
    status.className = "shot-preflight-status";
    status.dataset.shotId = "shot-1";
    li.appendChild(status);
    ul.appendChild(li);

    await runtime.runPreflightProviderChecks(items, ul);

    expect(status.textContent).toBe("⚠️");
    expect(status.title).toContain("Routed from xai to lumaai");
    expect(runtime.btnBatchRun.dataset.providerBlocked).toBe("false");
    expect(runtime.btnBatchRun.disabled).toBe(false);
  });

  it("keeps the current blocking behavior when no live provider is available", async () => {
    const runtime = createRuntime({
      importModule: async () => ({ selectI2VProvider }),
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200 }) as Response),
      liveProviders: [],
      selectedProvider: "xai",
    });

    const items: BatchItem[] = [
      {
        _id: "shot-1",
        modality: "video",
        images: ["https://cdn.example.com/hero.jpg"],
      },
    ];

    const ul = document.createElement("ul");
    const li = document.createElement("li");
    const status = document.createElement("span");
    status.className = "shot-preflight-status";
    status.dataset.shotId = "shot-1";
    li.appendChild(status);
    ul.appendChild(li);

    await runtime.runPreflightProviderChecks(items, ul);

    expect(status.textContent).toBe("❌");
    expect(status.title).toBe(
      "No live video provider available — start the proxy with a valid API key",
    );
    expect(runtime.btnBatchRun.dataset.providerBlocked).toBe("true");
    expect(runtime.btnBatchRun.title).toBe(BATCH_PROVIDER_BLOCK_TITLE);
    expect(runtime.btnBatchRun.disabled).toBe(true);
  });
});
