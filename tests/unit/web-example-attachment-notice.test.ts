/**
 * @file tests/unit/web-example-attachment-notice.test.ts
 *
 * Regression coverage for the contextual attachment notice in
 * integrations/web-example/app.js.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "integrations/web-example/app.js");
const source = readFileSync(sourcePath, "utf8");
const start = source.indexOf("function updateAttachmentNotice()");
const end = source.indexOf("async function retriggerAttachmentDropdowns()");

if (start < 0) {
  throw new Error("Could not locate updateAttachmentNotice in app.js");
}
if (end < 0) {
  throw new Error("Could not locate the attachment notice boundary in app.js");
}
if (end <= start) {
  throw new Error("Invalid attachment notice slice in app.js");
}

const block = source.slice(start, end);

function runUpdateAttachmentNotice({
  hasImageAttached = false,
  activeTabValue = "text",
  initialText = "",
} = {}) {
  const attachmentNoticeEl = { textContent: initialText };
  const context = {
    attachmentNoticeEl,
    hasImageAttached,
    TAB_MODALITY: {
      text: "text",
      image: "image",
      audio: "audio",
      video: "video",
      structured: "structured",
    },
    activeTab: () => activeTabValue,
  };

  vm.createContext(context);
  vm.runInContext(block, context);
  context.updateAttachmentNotice();
  return attachmentNoticeEl;
}

describe("web-example attachment notice", () => {
  it("shows the filtering notice for image-aware tabs when an image is attached", () => {
    const notice = runUpdateAttachmentNotice({
      hasImageAttached: true,
      activeTabValue: "image",
    });

    expect(notice.textContent).toBe(
      "Showing only models that accept image input. Remove the attachment to see all models.",
    );
  });

  it("shows the ignored notice for audio and structured tabs", () => {
    const audioNotice = runUpdateAttachmentNotice({
      hasImageAttached: true,
      activeTabValue: "audio",
    });
    const structuredNotice = runUpdateAttachmentNotice({
      hasImageAttached: true,
      activeTabValue: "structured",
    });

    expect(audioNotice.textContent).toBe("The attached image will be ignored for this modality.");
    expect(structuredNotice.textContent).toBe(
      "The attached image will be ignored for this modality.",
    );
  });

  it("clears the notice when the attachment is removed", () => {
    const notice = runUpdateAttachmentNotice({
      hasImageAttached: false,
      activeTabValue: "video",
      initialText:
        "Showing only models that accept image input. Remove the attachment to see all models.",
    });

    expect(notice.textContent).toBe("");
  });
});
