/**
 * @file tests/unit/browser-storage.test.ts
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserRecordDraft } from "../../src/ai-powered/web/browser-storage.js";
import {
  DEFAULT_REMOTE_CACHE_PREFIXES,
  DEFAULT_STORAGE_PREFIXES,
  DEFAULT_UI_KEYS,
  clearPrefsByPrefix,
  createBrowserRecordStore,
  createObjectUrlRegistry,
  listPrefsByPrefix,
  readJsonPreference,
  recordDownloadName,
  recordDownloadJsonPayload,
  recordDownloadPayload,
  recordSummaryText,
  recordToManifest,
  recordToPlainText,
  writeJsonPreference,
} from "../../src/ai-powered/web/browser-storage.js";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-style-id");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function buildSessionDraft(): BrowserRecordDraft {
  return {
    modality: "text",
    kind: "session",
    status: "complete",
    title: "Morning notes",
    prompt: "Hello there",
    messages: [
      { role: "user", content: "Hello there" },
      { role: "assistant", content: "Hi from the browser workbench" },
    ],
    transcript: "User: Hello there\nAssistant: Hi from the browser workbench",
    outputText: "User: Hello there\nAssistant: Hi from the browser workbench",
    outputSummary: "Hello there",
    provider: "openai",
    model: "gpt-4o-mini",
    styleId: "ember",
    fileName: "morning-notes.txt",
    mimeType: "text/plain",
    artifact: new Blob(["User: Hello there\nAssistant: Hi from the browser workbench"], {
      type: "text/plain",
    }),
    preview: null,
    notes: "saved",
    tags: ["demo"],
    favorite: true,
    metadata: { source: "test" },
  };
}

describe("browser storage helpers", () => {
  it("stores records, exports plain text, and summarizes the saved history", async () => {
    const store = createBrowserRecordStore({
      backend: "memory",
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
      storagePrefixes: DEFAULT_STORAGE_PREFIXES,
      remoteCachePrefixes: DEFAULT_REMOTE_CACHE_PREFIXES,
    });

    await store.ready;

    const saved = await store.saveRecord(buildSessionDraft());
    expect(saved.id).toBeTruthy();
    expect(saved.kind).toBe("session");
    expect(recordDownloadName(saved)).toBe("morning-notes.txt");
    expect(
      recordDownloadName({
        ...saved,
        fileName: "",
        title: "Hello, browser workbench!",
      }),
    ).toBe("hello-browser-workbench.txt");
    expect(recordSummaryText(saved)).toContain("Hello there");
    expect(recordToPlainText(saved)).toContain("User: Hello there");
    expect(recordToManifest(saved)).toMatchObject({
      id: saved.id,
      modality: "text",
      kind: "session",
      hasArtifact: true,
      artifactSize: saved.artifact?.size ?? 0,
    });

    const payload = recordDownloadPayload(saved);
    expect(payload.filename).toBe("morning-notes.txt");
    expect(payload.blob.type).toBe("text/plain");
    expect(await payload.blob.text()).toContain("Assistant: Hi from the browser workbench");

    const fetched = await store.getRecord(saved.id);
    expect(fetched?.title).toBe("Morning notes");

    const updated = await store.updateRecordMetadata(saved.id, {
      title: "Renamed notes",
      notes: "revised",
      favorite: false,
    });
    expect(updated?.title).toBe("Renamed notes");
    expect(updated?.notes).toBe("revised");
    expect(updated?.favorite).toBe(false);

    const summary = await store.getSummary();
    expect(summary.backend).toBe("memory");
    expect(summary.totalRecords).toBe(1);
    expect(summary.countsByModality.text).toBe(1);
    expect(await store.listRecords("text")).toHaveLength(1);
  });

  it("exports a complete, parseable per-record JSON manifest", async () => {
    const store = createBrowserRecordStore({ backend: "memory" });
    await store.ready;
    const saved = await store.saveRecord({
      modality: "video",
      kind: "artifact",
      status: "complete",
      title: "Unicode / long prompt",
      prompt: "line one\nline two \u{1F3AC}",
      provider: "lumaai",
      model: "ray-2",
      seed: 0,
      duration: 8,
      aspectRatio: "16:9",
      metadata: {
        schemaVersion: 2,
        historyEvent: {
          requested: {
            effectivePrompt: "line one\nline two \u{1F3AC}",
            referenceImages: [
              {
                fileName: "ref.png",
                fileRef: "ref-token",
                url: "https://proxy.example.test/files/ref-token",
              },
            ],
            options: { seed: 0, nested: { keep: true } },
          },
          result: { artifact: { url: "https://cdn.example.test/video.mp4" } },
        },
      },
    });

    const payload = recordDownloadJsonPayload(saved);
    expect(payload.blob.type).toBe("application/json");
    expect(payload.filename).toMatch(/^ai-powered-video-.*-.*\.json$/);
    const manifest = JSON.parse(await payload.blob.text());
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      id: saved.id,
      prompt: "line one\nline two \u{1F3AC}",
      seed: 0,
      metadata: {
        historyEvent: {
          requested: {
            options: { seed: 0, nested: { keep: true } },
          },
        },
      },
      artifact: {
        resultUrl: "https://cdn.example.test/video.mp4",
      },
    });
  });

  it("clears app-owned browser state while leaving unrelated keys intact", async () => {
    const store = createBrowserRecordStore({
      backend: "memory",
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
      storagePrefixes: DEFAULT_STORAGE_PREFIXES,
      remoteCachePrefixes: DEFAULT_REMOTE_CACHE_PREFIXES,
    });

    await store.ready;
    await store.setCache("ai-powered:remote:readme", "cached-readme");
    await store.setCache("custom-cache-key", "kept-for-summary");

    window.localStorage.setItem("temp:token", "removed");
    clearPrefsByPrefix(window.localStorage, ["temp:"]);
    expect(window.localStorage.getItem("temp:token")).toBeNull();

    writeJsonPreference(window.localStorage, DEFAULT_UI_KEYS.activeTab, "video");
    writeJsonPreference(window.localStorage, DEFAULT_UI_KEYS.infoTab, "settings");
    window.localStorage.setItem("keep:local", "keep");
    window.sessionStorage.setItem(DEFAULT_UI_KEYS.currentTextSessionId, "draft-123");
    window.sessionStorage.setItem("keep:session", "keep");

    expect(readJsonPreference(window.localStorage, DEFAULT_UI_KEYS.activeTab, "text")).toBe(
      "video",
    );
    expect(listPrefsByPrefix(window.localStorage, DEFAULT_STORAGE_PREFIXES)).toEqual(
      expect.arrayContaining([DEFAULT_UI_KEYS.activeTab, DEFAULT_UI_KEYS.infoTab]),
    );

    await store.resetAll();

    expect(window.localStorage.getItem(DEFAULT_UI_KEYS.activeTab)).toBeNull();
    expect(window.localStorage.getItem(DEFAULT_UI_KEYS.infoTab)).toBeNull();
    expect(window.localStorage.getItem("keep:local")).toBe("keep");
    expect(window.sessionStorage.getItem(DEFAULT_UI_KEYS.currentTextSessionId)).toBeNull();
    expect(window.sessionStorage.getItem("keep:session")).toBe("keep");

    const summary = await store.getSummary();
    expect(summary.cacheKeys).toEqual([]);
  });

  it("tracks object URLs so workbench previews can be reclaimed", () => {
    let objectUrlCounter = 1;
    const createObjectURL = vi.fn(() => `blob:${objectUrlCounter++}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    } as unknown as typeof URL);

    const registry = createObjectUrlRegistry();
    const first = registry.create(new Blob(["one"], { type: "text/plain" }));
    const second = registry.create(new Blob(["two"], { type: "text/plain" }));

    expect(first).toBe("blob:1");
    expect(second).toBe("blob:2");
    expect(registry.size()).toBe(2);

    registry.revoke(first);
    expect(revokeObjectURL).toHaveBeenCalledWith(first);
    expect(registry.size()).toBe(1);

    registry.revokeAll();
    expect(revokeObjectURL).toHaveBeenCalledWith(second);
    expect(registry.size()).toBe(0);
  });
});
