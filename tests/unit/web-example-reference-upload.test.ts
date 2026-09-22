/**
 * Regression coverage for incremental Demo GUI reference uploads.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "integrations/web-example/app.js"), "utf8");
const start = source.indexOf("function wireMultiFileUpload(inputEl");
const end = source.lastIndexOf(
  "/**",
  source.indexOf("Fetches models for the given modality", start),
);
if (start < 0 || end < 0) throw new Error("Could not locate wireMultiFileUpload in app.js");
const block = source.slice(start, end);

function createElement(tagName: string) {
  const listeners = new Map<string, () => void>();
  const element: any = {
    tagName,
    children: [],
    dataset: {},
    className: "",
    title: "",
    textContent: "",
    src: "",
    alt: "",
    type: "",
    classList: {
      toggle: vi.fn(),
    },
    appendChild(child: any) {
      this.children.push(child);
      return child;
    },
    setAttribute() {},
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, listener);
    },
    click() {
      return listeners.get("click")?.();
    },
  };
  Object.defineProperty(element, "innerHTML", {
    get: () => "",
    set: () => {
      element.children = [];
    },
  });
  return element;
}

function createHarness(
  options: {
    upload?: (file: any) => Promise<string>;
    getPolicy?: () => any;
    failPreview?: boolean;
  } = {},
) {
  const items: any[] = [];
  const uploaded: string[] = [];
  const input: any = {
    value: "",
    listeners: new Map<string, (event: any) => Promise<void>>(),
    addEventListener(type: string, listener: (event: any) => Promise<void>) {
      this.listeners.set(type, listener);
    },
    emit(files: any[]) {
      return this.listeners.get("change")?.({ target: { files } });
    },
  };
  const status: any = { textContent: "" };
  const thumbs = createElement("div");
  let objectUrlId = 0;
  const context: any = {
    document: { createElement },
    URL: {
      createObjectURL: () => {
        if (options.failPreview) throw new Error("preview unavailable");
        return `blob:${++objectUrlId}`;
      },
      revokeObjectURL: vi.fn(),
    },
    imageReferenceItems: items,
    videoReferenceItems: [],
    videoFileUploadInput: {},
    createReferenceId: (() => {
      let id = 0;
      return () => `item-${++id}`;
    })(),
    referenceFingerprint: (file: any) =>
      [file.name, file.type, file.size, file.lastModified].join("\u001f"),
    tabState: { get: () => ({ provider: "mock" }) },
    updateImageAttachmentState: vi.fn(),
    retriggerAttachmentDropdowns: vi.fn(async () => {}),
    compressImageForUpload: vi.fn(async (file: any) => file),
    persistReferenceItems: vi.fn(async () => {}),
    uploadFileRaw: async (file: any) => {
      const ref = options.upload ? await options.upload(file) : `ref-${file.name}`;
      uploaded.push(ref);
      return ref;
    },
  };
  vm.createContext(context);
  vm.runInContext(block, context);
  const controller = context.wireMultiFileUpload(
    input,
    status,
    thumbs,
    items,
    null,
    options.getPolicy,
  );
  return { input, status, thumbs, items, uploaded, url: context.URL, controller };
}

function file(name: string, lastModified = 1, type = "image/png") {
  return { name, type, size: name.length, lastModified };
}

function createReferenceRequestBuilder() {
  const referenceStart = source.indexOf("function referenceUrlForFileRef");
  const applyStateStart = source.indexOf("  function applyReferenceVisualState", referenceStart);
  if (referenceStart < 0 || applyStateStart < 0) {
    throw new Error("Could not locate reference request helpers in app.js");
  }

  const requestBlock = source
    .slice(referenceStart, applyStateStart)
    .replace(
      "let imageModelsCache = [];",
      'let imageModelsCache = [{ id: "model-1", name: "Image one", inputCapabilities: ["image"], inputRequirements: [{ modality: "image", max: 1 }] }];',
    )
    .replace("let videoModelsCache = [];", "let videoModelsCache = [];");
  const context: any = {
    MODEL_SELECTS: { image: { value: "model-1" } },
    proxyUrlInput: { value: "http://localhost:3001" },
    document: { getElementById: () => null },
  };
  vm.createContext(context);
  vm.runInContext(requestBlock, context);
  return context.buildReferenceRequest as (items: any[], label: string) => any;
}
describe("web-example incremental reference uploads", () => {
  it("appends separate selections in selection order and keeps duplicate policy explicit", async () => {
    const harness = createHarness();
    const a = file("a.png");
    const b = file("b.png");
    const c = file("c.png");

    await harness.input.emit([a]);
    await harness.input.emit([b]);
    await harness.input.emit([c]);
    await harness.input.emit([b]);

    expect(harness.items.map((item) => item.fileName)).toEqual(["a.png", "b.png", "c.png"]);
    expect(harness.items.map((item) => item.fileRef)).toEqual([
      "ref-a.png",
      "ref-b.png",
      "ref-c.png",
    ]);
    expect(harness.thumbs.children).toHaveLength(3);
  });

  it("moves files with accessible controls while preserving displayed order and filename", async () => {
    const harness = createHarness();
    await harness.input.emit([file("first.png"), file("second.png"), file("third.png")]);

    const first = harness.thumbs.children[0];
    await first.children
      .find((child: any) => child.className.includes("file-thumb-move-down"))
      .click();

    expect(harness.items.map((item) => item.fileName)).toEqual([
      "second.png",
      "first.png",
      "third.png",
    ]);
    expect(
      harness.thumbs.children[0].children.find(
        (child: any) => child.className === "file-thumb-name",
      ).textContent,
    ).toBe("second.png");
    expect(
      harness.thumbs.children[1].children.find(
        (child: any) => child.className === "file-thumb-name",
      ).textContent,
    ).toBe("first.png");
  });

  it("retains an exact filename and upload state when object URL creation fails", async () => {
    const harness = createHarness({ failPreview: true });
    await harness.input.emit([file("café 画像.png")]);

    expect(harness.items[0].fileName).toBe("café 画像.png");
    expect(harness.items[0].previewUrl).toBeNull();
    expect(harness.items[0].uploadState).toBe("ready");
    expect(
      harness.thumbs.children[0].children.find(
        (child: any) => child.className === "file-thumb-name",
      ).textContent,
    ).toBe("café 画像.png");
  });

  it("offers an explicit retry after a failed upload", async () => {
    let attempts = 0;
    const harness = createHarness({
      upload: async (selectedFile) => {
        attempts++;
        if (attempts === 1) throw new Error("temporary upload failure");
        return `retry-${selectedFile.name}`;
      },
    });
    await harness.input.emit([file("retry.png")]);
    expect(harness.items[0].uploadState).toBe("error");

    const retry = harness.thumbs.children[0].children.find(
      (child: any) => child.className === "file-thumb-retry",
    );
    await retry.click();
    expect(harness.items[0].uploadState).toBe("ready");
    expect(harness.items[0].fileRef).toBe("retry-retry.png");
  });

  it("removes exactly the middle item and revokes its preview URL", async () => {
    const harness = createHarness();
    await harness.input.emit([file("a.png"), file("b.png"), file("c.png")]);
    const middle = harness.thumbs.children[1];

    await middle.children.find((child: any) => child.className === "file-thumb-remove").click();

    expect(harness.items.map((item) => item.fileName)).toEqual(["a.png", "c.png"]);
    expect(harness.items.map((item) => item.fileRef)).toEqual(["ref-a.png", "ref-c.png"]);
    expect(harness.url.revokeObjectURL).toHaveBeenCalledWith("blob:2");
  });

  it("does not resurrect an item that is removed before upload completion", async () => {
    let resolveUpload!: (value: string) => void;
    const pendingUpload = new Promise<string>((resolve) => {
      resolveUpload = resolve;
    });
    const harness = createHarness({ upload: () => pendingUpload });
    const change = harness.input.emit([file("slow.png")]);
    await Promise.resolve();
    await harness.thumbs.children[0].children
      .find((child: any) => child.className === "file-thumb-remove")
      .click();
    resolveUpload("late-ref");
    await change;

    expect(harness.items).toHaveLength(0);
    expect(harness.thumbs.children).toHaveLength(0);
  });
  it("retains excess files and recalculates used files after arbitrary deletion", async () => {
    const policy = { imageMax: 2, videoMax: 0 };
    const harness = createHarness({ getPolicy: () => policy });
    await harness.input.emit([file("a.png"), file("b.png"), file("c.png")]);

    expect(harness.items.map((item) => item.referenceState)).toEqual(["used", "used", "excess"]);
    expect(harness.thumbs.children[2].children[1].textContent).toBe("Delete");

    await harness.thumbs.children[1].children
      .find((child: any) => child.className === "file-thumb-remove")
      .click();
    expect(harness.items.map((item) => item.fileName)).toEqual(["a.png", "c.png"]);
    expect(harness.items.map((item) => item.referenceState)).toEqual(["used", "used"]);

    policy.imageMax = 1;
    await harness.thumbs.children[1].children
      .find((child: any) => child.className === "file-thumb-remove")
      .click();
    expect(harness.items.map((item) => item.referenceState)).toEqual(["used"]);
  });

  it("keeps every selected file visible when the model permits fewer references", async () => {
    const harness = createHarness({ getPolicy: () => ({ imageMax: 1, videoMax: 0 }) });
    await harness.input.emit([file("a.png"), file("b.png"), file("c.png")]);

    expect(harness.items).toHaveLength(3);
    expect(harness.uploaded).toEqual(["ref-a.png", "ref-b.png", "ref-c.png"]);
    expect(harness.items.map((item) => item.referenceState)).toEqual(["used", "excess", "excess"]);
  });

  it("retains unsupported references for explicit deletion without uploading them", async () => {
    const harness = createHarness();
    await harness.input.emit([file("notes.txt", 1, "text/plain")]);

    expect(harness.items).toHaveLength(1);
    expect(harness.items[0].uploadState).toBe("error");
    expect(harness.items[0].error).toContain("Unsupported");
    expect(harness.uploaded).toHaveLength(0);
  });
  it("emits only permitted reference file refs after excess deletion", () => {
    const buildReferenceRequest = createReferenceRequestBuilder();
    const first = {
      id: "first",
      fileName: "first.png",
      mimeType: "image/png",
      sizeBytes: 1,
      fileRef: "ref-first",
      uploadState: "ready",
    };
    const second = { ...first, id: "second", fileName: "second.png", fileRef: "ref-second" };

    expect(() => buildReferenceRequest([first, second], "image")).toThrow(/excess/);
    expect(buildReferenceRequest([first], "image").fileRefs).toEqual(["ref-first"]);
    expect(buildReferenceRequest([first], "image").usedReferenceIds).toEqual(["first"]);
  });
});
