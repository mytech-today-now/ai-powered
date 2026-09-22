/**
 * @file tests/unit/web-example-attachment-retrigger.test.ts
 *
 * Regression coverage for attachment-state re-triggering in
 * integrations/web-example/app.js.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "integrations/web-example/app.js");
const source = readFileSync(sourcePath, "utf8");
const start = source.indexOf("async function retriggerAttachmentDropdowns()");
const end = source.indexOf("/* ── JSZip availability helper");

if (start < 0) {
  throw new Error("Could not locate retriggerAttachmentDropdowns in app.js");
}
if (end < 0) {
  throw new Error("Could not locate the attachment retrigger boundary in app.js");
}
if (end <= start) {
  throw new Error("Invalid attachment retrigger slice in app.js");
}

const block = source.slice(start, end);

function runRetrigger({
  mode = "proxy",
  activeTabValue = "video",
  initialProvider = "default-video",
  refreshedProvider = "image-video",
  allProviders = [{ id: "default-video" }],
}: {
  mode?: string;
  activeTabValue?: string;
  initialProvider?: string;
  refreshedProvider?: string;
  allProviders?: Array<{ id: string }>;
} = {}) {
  const calls: string[][] = [];
  const providerSelect: { value: string } = { value: initialProvider };
  const context: any = {
    TAB_MODALITY: {
      text: "text",
      image: "image",
      audio: "audio",
      video: "video",
      structured: "structured",
    },
    activeTab: () => activeTabValue,
    modeSelect: { value: mode },
    currentMode: () => mode,
    allProviders,
    PROVIDER_SELECTS: {
      video: providerSelect,
    },
    refreshProviderDropdown: (modality: string) => {
      calls.push(["refresh", modality]);
      providerSelect.value = refreshedProvider;
      return providerSelect;
    },
    loadTabModels: async (modality: string, provider: string | undefined) => {
      calls.push(["load", modality, provider ?? ""]);
      return true;
    },
    updateAttachmentNotice: () => {
      calls.push(["notice"]);
    },
  };

  vm.createContext(context);
  vm.runInContext(block, context);

  return {
    calls,
    providerSelect,
    retrigger: context.retriggerAttachmentDropdowns as () => Promise<void>,
  };
}

describe("web-example attachment retrigger", () => {
  it("refreshes models without changing the selected provider after an attachment change", async () => {
    const { calls, providerSelect, retrigger } = runRetrigger({
      mode: "proxy",
      activeTabValue: "video",
      initialProvider: "default-video",
      refreshedProvider: "image-video",
      allProviders: [{ id: "default-video" }, { id: "image-video" }],
    });

    await retrigger();

    expect(calls).toEqual([["load", "video", ""], ["notice"]]);
    expect(providerSelect.value).toBe("default-video");
  });

  it("still updates the attachment notice when re-triggering is skipped", async () => {
    const { calls, retrigger } = runRetrigger({
      mode: "direct",
      activeTabValue: "text",
      allProviders: [{ id: "default-text" }],
    });

    await retrigger();

    expect(calls).toEqual([["notice"]]);
  });
});
