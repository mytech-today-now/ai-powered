import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "integrations/web-example/app.js"), "utf8");

function sliceFunction(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Could not locate " + startMarker);
  return source.slice(start, end);
}

const autoSelectBlock = sliceFunction(
  "function autoSelectCheapest",
  "  /**\n   * Populate a model",
);
const populateBlock = sliceFunction(
  "function populateModelSelect",
  "  /**\n   * Returns the DOM anchor",
);
const loadBlock = sliceFunction(
  "async function loadTabModels",
  "  /**\n   * Page-load restore loop",
);

function createSelect() {
  const select: any = {
    _value: "",
    options: [],
    appendChild(option: any) {
      this.options.push(option);
      return option;
    },
    set innerHTML(_value: string) {
      this.options = [];
    },
    get value() {
      return this._value;
    },
    set value(value: string) {
      this._value = value;
    },
  };
  return select;
}

function createHarness() {
  const select = createSelect();
  const persisted: string[] = [];
  const context: any = {
    console,
    modeSelect: { value: "proxy" },
    MODEL_SELECTS: { image: select },
    tabState: new Map([["image", { provider: "mock", model: "model-keep" }]]),
    modelRefreshVersions: new Map(),
    hasImageAttached: false,
    imageModelsCache: [],
    videoModelsCache: [],
    providerSupportsInputModality: vi.fn(() => false),
    clearModelWarning: vi.fn(),
    showModelWarning: vi.fn(),
    syncImageConstraints: vi.fn(),
    syncVideoConstraints: vi.fn(),
    persistSelection: (modality: string, provider: string, model: string) => {
      persisted.push([modality, provider, model].join(":"));
    },
    document: {
      createElement: () => ({ value: "", textContent: "", disabled: false, selected: false }),
    },
    fetchModelList: vi.fn(async () => ({
      ok: true,
      modelList: [
        { id: "model-cheap", name: "Cheap", costPerUnit: 0 },
        { id: "model-keep", name: "Keep", costPerUnit: 1 },
      ],
    })),
  };
  vm.createContext(context);
  vm.runInContext(autoSelectBlock + populateBlock + loadBlock, context);
  return { context, select, persisted };
}

describe("web-example model selection stability", () => {
  it("keeps a selected model when reference-driven model options refresh", async () => {
    const harness = createHarness();

    await harness.context.loadTabModels("image");

    expect(harness.select.value).toBe("model-keep");
    expect(harness.context.tabState.get("image").model).toBe("model-keep");
    expect(harness.persisted).toEqual(["image:mock:model-keep"]);
  });

  it("ignores a stale model response after a newer refresh completes", async () => {
    const harness = createHarness();
    let resolveFirst!: (value: any) => void;
    let resolveSecond!: (value: any) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    let request = 0;
    harness.context.fetchModelList = vi.fn(() => (request++ === 0 ? first : second));

    const firstRefresh = harness.context.loadTabModels("image");
    harness.select.value = "model-new";
    harness.context.tabState.set("image", { provider: "mock", model: "model-new" });
    const secondRefresh = harness.context.loadTabModels("image");

    resolveSecond({
      ok: true,
      modelList: [{ id: "model-new", name: "New", costPerUnit: 1 }],
    });
    await secondRefresh;

    resolveFirst({
      ok: true,
      modelList: [{ id: "model-cheap", name: "Cheap", costPerUnit: 0 }],
    });
    await firstRefresh;

    expect(harness.select.value).toBe("model-new");
    expect(harness.context.tabState.get("image").model).toBe("model-new");
  });
});
