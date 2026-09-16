// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = process.cwd();
const appJsPath = path.join(repoRoot, "integrations", "web-example", "app.js");
const indexHtmlPath = path.join(repoRoot, "integrations", "web-example", "index.html");

afterEach(() => {
  vi.restoreAllMocks();
});

function createNoopStore() {
  return {
    clear: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(() => undefined),
    listRecords: vi.fn(async () => []),
    load: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    set: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  };
}

function createNoopWebClient() {
  return {
    generateImage: vi.fn(async () => ({})),
    generateStructured: vi.fn(async () => ({ data: {} })),
    generateText: vi.fn(async () => ({})),
    generateVideo: vi.fn(async () => ({})),
    listModels: vi.fn(async () => []),
    synthesizeSpeech: vi.fn(async () => ({})),
    transcribeAudio: vi.fn(async () => ({})),
  };
}

function loadWebExample() {
  const html = fs.readFileSync(indexHtmlPath, "utf8");
  const appJs = fs.readFileSync(appJsPath, "utf8");
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "http://localhost/",
  });
  const { window } = dom;
  const win = window as any;

  const webClient = createNoopWebClient();
  win.AiPowered = {
    DEFAULT_BROWSER_DB_NAME: "test-db",
    DEFAULT_REMOTE_CACHE_PREFIXES: [],
    DEFAULT_STORAGE_PREFIXES: [],
    DEFAULT_UI_KEYS: {
      activeTab: "active-tab",
      currentTextSessionId: "current-text-session-id",
      historyExpanded: "history-expanded",
    },
    buildSessionTitle: vi.fn(() => ""),
    clearPrefsByPrefix: vi.fn(async () => {}),
    createBrowserRecordStore: vi.fn(() => createNoopStore()),
    createObjectUrlRegistry: vi.fn(() => ({
      register: vi.fn(),
      revoke: vi.fn(),
      revokeAll: vi.fn(),
    })),
    createStyleController: vi.fn(() => ({
      rotate: vi.fn(() => ({ label: "Default" })),
      style: { label: "Default" },
    })),
    createWebClient: vi.fn(() => webClient),
    listPrefsByPrefix: vi.fn(async () => []),
    loadDiscoveryPosts: vi.fn(async () => []),
    loadReadmeMarkdown: vi.fn(async () => ""),
    recordDownloadName: vi.fn(() => ""),
    recordDownloadPayload: vi.fn(() => ""),
    recordSummaryText: vi.fn(() => ""),
    recordToManifest: vi.fn(() => ""),
    recordToPlainText: vi.fn(() => ""),
    readJsonPreference: vi.fn((_storage: unknown, _key: string, fallback: unknown) => fallback),
    writeJsonPreference: vi.fn(),
  };

  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: vi.fn(async () => ({
      blob: async () => new window.Blob(),
      json: async () => [],
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
    })),
  });
  Object.defineProperty(window, "alert", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:combined-test"),
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  win.JSZip = class {
    file() {}
    async generateAsync() {
      return new window.Blob(["zip"], { type: "application/zip" });
    }
  };
  win._FFmpeg = class {
    off() {}
    on() {}
    async exec() {
      return 0;
    }
    async load() {}
    async readFile() {
      return new Uint8Array([1, 2, 3]);
    }
    async terminate() {}
    async writeFile() {}
  };
  win._toBlobURL = vi.fn(async (value: string) => value);

  const hookedAppJs = appJs.replace(
    /\}\)\(\); \/\/ end IIFE\s*$/,
    `
  window.__TEST_HOOKS__ = {
    clearBatch,
    getCombinedVideoState() {
      return { combinedVideoBlob, combinedVideoDataUri };
    },
    setCombinedVideoState(blob, dataUri) {
      combinedVideoBlob = blob;
      combinedVideoDataUri = dataUri;
    },
  };
})(); // end IIFE
`,
  );

  window.eval(hookedAppJs);
  return dom;
}

describe("web-example combined video wiring", () => {
  it("resets combined video state when clearing the batch", () => {
    const dom = loadWebExample();
    const { window } = dom;
    const hooks = (window as any).__TEST_HOOKS__;
    const combinedBlob = new window.Blob(["combined"], { type: "video/mp4" });

    hooks.setCombinedVideoState(combinedBlob, "data:video/mp4;base64,Y29tYmluZWQ=");

    const section = window.document.getElementById("combined-video-section") as HTMLDivElement;
    const player = window.document.getElementById("combined-video-player") as HTMLVideoElement;
    const status = window.document.getElementById("combined-video-status") as HTMLSpanElement;
    const downloadBtn = window.document.getElementById(
      "btn-download-combined",
    ) as HTMLButtonElement;
    const batchFilename = window.document.getElementById("batch-filename") as HTMLSpanElement;
    const batchPreflight = window.document.getElementById("batch-preflight") as HTMLDivElement;
    const batchProgress = window.document.getElementById("batch-progress") as HTMLDivElement;
    const batchResults = window.document.getElementById("batch-results") as HTMLDivElement;
    const batchShots = window.document.getElementById("batch-shots") as HTMLDivElement;
    const batchSummary = window.document.getElementById("batch-summary") as HTMLDivElement;

    section.hidden = false;
    player.setAttribute("src", "blob:previous");
    status.textContent = "Ready";
    downloadBtn.hidden = false;
    batchFilename.textContent = "example.jsonl";
    batchPreflight.classList.remove("hidden");
    batchProgress.classList.remove("hidden");
    batchResults.classList.remove("hidden");
    batchShots.innerHTML = "<div>shot</div>";
    batchSummary.innerHTML = "<div>summary</div>";

    window.document.getElementById("btn-batch-clear")?.click();

    expect(hooks.getCombinedVideoState()).toEqual({
      combinedVideoBlob: null,
      combinedVideoDataUri: null,
    });
    expect(downloadBtn.hidden).toBe(true);
    expect(section.hidden).toBe(true);
    expect(player.getAttribute("src")).toBe("");
    expect(status.textContent).toBe("");
    expect(batchFilename.textContent).toBe("No file selected");
    expect(batchPreflight.classList.contains("hidden")).toBe(true);
    expect(batchProgress.classList.contains("hidden")).toBe(true);
    expect(batchResults.classList.contains("hidden")).toBe(true);
    expect(batchShots.innerHTML).toBe("");
    expect(batchSummary.innerHTML).toBe("");
  });

  it("downloads the stitched file as combined.mp4", () => {
    const dom = loadWebExample();
    const { window } = dom;
    const hooks = (window as any).__TEST_HOOKS__;
    const combinedBlob = new window.Blob(["combined"], { type: "video/mp4" });
    hooks.setCombinedVideoState(combinedBlob, "data:video/mp4;base64,Y29tYmluZWQ=");

    let downloadName = "";
    const clickSpy = vi
      .spyOn(window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });

    window.document.getElementById("btn-download-combined")?.click();

    expect(downloadName).toBe("combined.mp4");
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(combinedBlob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:combined-test");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("keeps the combined video wiring in the source", () => {
    const appJs = fs.readFileSync(appJsPath, "utf8");

    expect(appJs).toContain("const successCount = batchResultItems.filter(");
    expect(appJs).toContain("if (successCount >= 2) {");
    expect(appJs).toContain("combinedVideoDataUri = await new Promise((resolve) => {");
    expect(appJs).toContain(
      'if (combinedVideoPlayer) combinedVideoPlayer.src = combinedVideoDataUri || "";',
    );
    expect(appJs).toContain("combinedVideoBlob = null;");
    expect(appJs).toContain("combinedVideoDataUri = null;");
    expect(appJs).toContain('download: "combined.mp4"');
  });
});
