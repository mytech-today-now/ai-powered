import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "integrations/web-example/app.js");
const source = readFileSync(sourcePath, "utf8");
const start = source.indexOf("function populateProviderSelect");
const end = source.indexOf("/* ── Video constraint syncing");

if (start < 0) {
  throw new Error("Could not locate populateProviderSelect in app.js");
}
if (end < 0) {
  throw new Error("Could not locate the provider dropdown boundary in app.js");
}
if (end <= start) {
  throw new Error("Invalid provider dropdown slice in app.js");
}

const block = source.slice(start, end);

function createDocument() {
  return {
    createElement(tag) {
      return {
        tagName: tag,
        value: "",
        textContent: "",
        title: "",
        disabled: false,
        selected: false,
      };
    },
  };
}

function createMockSelect(initialValue = "") {
  const select = {
    value: initialValue,
    options: [],
    _innerHTML: "",
    appendChild(option) {
      this.options.push(option);
      return option;
    },
  };

  Object.defineProperty(select, "innerHTML", {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = value;
      this.options = [
        {
          value: "",
          textContent: "Default",
          title: "",
          disabled: false,
          selected: true,
        },
      ];
      this.value = "";
    },
  });

  return select;
}

function runRefresh(allProviders, hasImageAttached, initialValue = "") {
  const context = {
    document: createDocument(),
    allProviders,
    hasImageAttached,
  };
  vm.createContext(context);
  vm.runInContext(block, context);

  const select = createMockSelect(initialValue);
  context.videoProviderSelect = select;
  context.refreshVideoProviderDropdown();

  return select;
}

function optionValues(select) {
  return select.options.map((option) => option.value);
}

describe("web-example provider dropdown filtering", () => {
  it("keeps video providers that do not need image input when no attachment is present", () => {
    const select = runRefresh(
      [
        { id: "default-video", name: "Default Video", active: true, modalities: ["video"] },
        {
          id: "image-video",
          name: "Image Video",
          active: true,
          modalities: ["video"],
          inputModalities: ["image"],
        },
        {
          id: "audio-video",
          name: "Audio Video",
          active: true,
          modalities: ["video"],
          inputModalities: ["audio"],
        },
        {
          id: "text-only",
          name: "Text Only",
          active: true,
          modalities: ["text"],
          inputModalities: ["image"],
        },
      ],
      false,
      "default-video",
    );

    expect(optionValues(select)).toEqual(["", "default-video", "image-video", "audio-video"]);
    expect(select.value).toBe("default-video");
  });

  it("filters out video providers that cannot accept image input when an attachment is present", () => {
    const select = runRefresh(
      [
        { id: "default-video", name: "Default Video", active: true, modalities: ["video"] },
        {
          id: "image-video",
          name: "Image Video",
          active: true,
          modalities: ["video"],
          inputModalities: ["image"],
        },
        {
          id: "audio-video",
          name: "Audio Video",
          active: true,
          modalities: ["video"],
          inputModalities: ["audio"],
        },
      ],
      true,
      "default-video",
    );

    expect(optionValues(select)).toEqual(["", "image-video"]);
    expect(select.value).toBe("");
  });
});
