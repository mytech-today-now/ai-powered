/**
 * @file tests/unit/fallback-model-integration.test.ts
 * @vitest-environment jsdom
 *
 * Integration tests (T-PM-07 through T-PM-12) for the fallback-model change.
 * Uses jsdom DOM so event dispatch and <select> value assignments work.
 * All functions are mirrored from app.js (browser IIFE, not importable).
 *
 * Reference: openspec/changes/fallback-model/tests/test-plan.md
 */

import { describe, it, expect, vi } from "vitest";

// ── Mirrored types and helpers ───────────────────────────────────────────────

interface ModelEntry {
  id: string;
  name?: string;
  costPerUnit?: number | null;
}
type TabState = Map<string, { provider: string; model: string }>;

function persistSelection(ls: Storage, modality: string, provider: string, model: string): void {
  ls.setItem(`ai-powered:provider:${modality}`, provider);
  ls.setItem(`ai-powered:model:${modality}`, model);
}

function restoreSelection(
  ls: Storage,
  modality: string,
): { provider: string; model: string } | null {
  const provider = ls.getItem(`ai-powered:provider:${modality}`);
  const model = ls.getItem(`ai-powered:model:${modality}`);
  if (!provider || !model) return null;
  return { provider, model };
}

function autoSelectCheapest(modelList: ModelEntry[]): string | null {
  if (!modelList || modelList.length === 0) return null;
  const sorted = [...modelList].sort((a, b) => {
    const ca = a.costPerUnit != null ? a.costPerUnit : Infinity;
    const cb = b.costPerUnit != null ? b.costPerUnit : Infinity;
    return ca - cb;
  });
  return sorted[0].id;
}

function populateModelSelect(sel: HTMLSelectElement, modelList: ModelEntry[]): void {
  sel.innerHTML = "";
  if (modelList.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = "No compatible models";
    sel.appendChild(opt);
  } else {
    for (const m of modelList) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      sel.appendChild(opt);
    }
  }
}

/** Mirrors the loadTabModels + provider-change handler logic. */
async function simulateProviderChange(
  modality: string,
  newProvider: string,
  providerSel: HTMLSelectElement,
  modelSel: HTMLSelectElement,
  tabState: TabState,
  ls: Storage,
  fetchModels: (modality: string, provider: string) => Promise<ModelEntry[]>,
): Promise<void> {
  tabState.set(modality, { provider: newProvider, model: "" });
  const modelList = await fetchModels(modality, newProvider);
  populateModelSelect(modelSel, modelList);
  const cheapest = autoSelectCheapest(modelList) ?? "";
  modelSel.value = cheapest;
  tabState.set(modality, { provider: newProvider, model: cheapest });
  persistSelection(ls, modality, newProvider, cheapest);
}

/** Mirrors the model-change handler logic. */
function simulateModelChange(
  modality: string,
  newModel: string,
  tabState: TabState,
  ls: Storage,
): void {
  const current = tabState.get(modality) ?? { provider: "", model: "" };
  tabState.set(modality, { provider: current.provider, model: newModel });
  persistSelection(ls, modality, current.provider, newModel);
}

/** Mirrors the initTabSelections logic for a single modality. */
async function simulateInitModality(
  modality: string,
  allProviderIds: string[],
  defaultProvider: string,
  providerSel: HTMLSelectElement,
  modelSel: HTMLSelectElement,
  tabState: TabState,
  ls: Storage,
  fetchModels: (m: string, p: string) => Promise<ModelEntry[]>,
  warnSpy: (msg: string) => void,
): Promise<void> {
  const saved = restoreSelection(ls, modality);
  let provider = defaultProvider;
  if (saved) {
    if (allProviderIds.includes(saved.provider)) {
      provider = saved.provider;
    } else {
      warnSpy(
        `[fallback-model] Saved provider "${saved.provider}" not found for modality "${modality}"; falling back to default.`,
      );
    }
  }
  providerSel.value = provider;
  tabState.set(modality, { provider, model: "" });
  const modelList = await fetchModels(modality, provider);
  populateModelSelect(modelSel, modelList);
  let model = autoSelectCheapest(modelList) ?? "";
  if (saved && modelList.some((m) => m.id === saved.model)) {
    model = saved.model;
  } else if (saved && saved.model) {
    warnSpy(
      `[fallback-model] Saved model "${saved.model}" not found for provider "${provider}" modality "${modality}"; falling back to cheapest.`,
    );
  }
  modelSel.value = model;
  tabState.set(modality, { provider, model });
  persistSelection(ls, modality, provider, model);
}

// ── Helpers for creating select elements ─────────────────────────────────────

function makeSelect(...optionValues: string[]): HTMLSelectElement {
  const sel = document.createElement("select");
  for (const v of optionValues) {
    const opt = document.createElement("option");
    opt.value = opt.textContent = v;
    sel.appendChild(opt);
  }
  return sel;
}

// ── T-PM-07: Provider change triggers model repopulation + auto-selection ───

describe("T-PM-07: provider change triggers model repopulation", () => {
  it("populates model select with new provider's models and auto-selects cheapest", async () => {
    const tabState: TabState = new Map();
    const ls = window.localStorage;
    ls.clear();
    const providerSel = makeSelect("openai", "anthropic");
    const modelSel = makeSelect();

    const models: Record<string, ModelEntry[]> = {
      openai: [
        { id: "gpt-4o", costPerUnit: 5 },
        { id: "gpt-4o-mini", costPerUnit: 0.15 },
      ],
      anthropic: [
        { id: "claude-opus-4", costPerUnit: 15 },
        { id: "claude-haiku-3-5", costPerUnit: 0.25 },
      ],
    };
    const fetchModels = async (_: string, p: string) => models[p] ?? [];

    await simulateProviderChange(
      "text",
      "anthropic",
      providerSel,
      modelSel,
      tabState,
      ls,
      fetchModels,
    );

    expect(modelSel.options.length).toBe(2);
    expect(modelSel.value).toBe("claude-haiku-3-5");
    expect(tabState.get("text")).toEqual({ provider: "anthropic", model: "claude-haiku-3-5" });
    expect(ls.getItem("ai-powered:provider:text")).toBe("anthropic");
    expect(ls.getItem("ai-powered:model:text")).toBe("claude-haiku-3-5");
  });
});

// ── T-PM-08: Model change persists updated model to localStorage ─────────────

describe("T-PM-08: model change persists to localStorage", () => {
  it("updates tabState and localStorage when user selects a different model", () => {
    const tabState: TabState = new Map([["image", { provider: "openai", model: "dall-e-3" }]]);
    const ls = window.localStorage;
    ls.clear();

    simulateModelChange("image", "dall-e-2", tabState, ls);

    expect(tabState.get("image")).toEqual({ provider: "openai", model: "dall-e-2" });
    expect(ls.getItem("ai-powered:provider:image")).toBe("openai");
    expect(ls.getItem("ai-powered:model:image")).toBe("dall-e-2");
  });
});

// ── T-PM-09: Page-load restores all modalities from localStorage ─────────────

describe("T-PM-09: page-load restores saved selections", () => {
  it("restores provider and model for a modality when both keys are present", async () => {
    const ls = window.localStorage;
    ls.clear();
    ls.setItem("ai-powered:provider:video", "lumaai");
    ls.setItem("ai-powered:model:video", "dream-machine");

    const tabState: TabState = new Map();
    const providerSel = makeSelect("lumaai", "runwayml");
    const modelSel = makeSelect();
    const warnSpy = vi.fn();

    await simulateInitModality(
      "video",
      ["lumaai", "runwayml"],
      "runwayml",
      providerSel,
      modelSel,
      tabState,
      ls,
      async () => [
        { id: "dream-machine", costPerUnit: 0.01 },
        { id: "ray2", costPerUnit: 0.05 },
      ],
      warnSpy,
    );

    expect(tabState.get("video")).toEqual({ provider: "lumaai", model: "dream-machine" });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── T-PM-10: Stale-model guard falls back to cheapest ───────────────────────

describe("T-PM-10: stale model guard falls back to cheapest", () => {
  it("uses cheapest when saved model is absent from live list", async () => {
    const ls = window.localStorage;
    ls.clear();
    ls.setItem("ai-powered:provider:text", "openai");
    ls.setItem("ai-powered:model:text", "gpt-3.5-turbo"); // no longer available

    const tabState: TabState = new Map();
    const providerSel = makeSelect("openai");
    const modelSel = makeSelect();
    const warnSpy = vi.fn();

    await simulateInitModality(
      "text",
      ["openai"],
      "openai",
      providerSel,
      modelSel,
      tabState,
      ls,
      async () => [
        { id: "gpt-4o-mini", costPerUnit: 0.15 },
        { id: "gpt-4o", costPerUnit: 5 },
      ],
      warnSpy,
    );

    expect(tabState.get("text")?.model).toBe("gpt-4o-mini");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/gpt-3\.5-turbo/);
  });
});

// ── T-PM-11: Tab isolation — switching tabs doesn't affect other tabs ────────

describe("T-PM-11: tab isolation", () => {
  it("changing provider on image tab does not alter text tab state", async () => {
    const ls = window.localStorage;
    ls.clear();
    const tabState: TabState = new Map([
      ["text", { provider: "anthropic", model: "claude-haiku-3-5" }],
    ]);
    const providerSel = makeSelect("openai", "stability");
    const modelSel = makeSelect();

    await simulateProviderChange(
      "image",
      "stability",
      providerSel,
      modelSel,
      tabState,
      ls,
      async () => [{ id: "sd-ultra", costPerUnit: 0.08 }],
    );

    // text tab must be unchanged
    expect(tabState.get("text")).toEqual({ provider: "anthropic", model: "claude-haiku-3-5" });
    // image tab is updated
    expect(tabState.get("image")).toEqual({ provider: "stability", model: "sd-ultra" });
  });
});

// ── T-PM-12: Provider re-change discards manual model override ───────────────

describe("T-PM-12: provider re-change discards stale model override", () => {
  it("auto-selects cheapest after provider switches, discarding the old model value", async () => {
    const ls = window.localStorage;
    ls.clear();
    const tabState: TabState = new Map([["image", { provider: "openai", model: "dall-e-3" }]]);
    const providerSel = makeSelect("openai", "stability");
    const modelSel = makeSelect("dall-e-3", "dall-e-2");

    await simulateProviderChange(
      "image",
      "stability",
      providerSel,
      modelSel,
      tabState,
      ls,
      async () => [
        { id: "sd-ultra", costPerUnit: 0.08 },
        { id: "sd-core", costPerUnit: 0.03 },
      ],
    );

    expect(tabState.get("image")?.model).toBe("sd-core"); // cheapest of stability
    expect(tabState.get("image")?.provider).toBe("stability");
    expect(modelSel.value).toBe("sd-core");
  });
});
