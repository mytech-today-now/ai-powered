/**
 * @file tests/unit/fallback-model.test.ts
 *
 * Unit tests for the three pure helper functions introduced by the
 * fallback-model change (TASK-04, TASK-05, TASK-06):
 *
 *   T-PM-01  persistSelection writes correct localStorage keys
 *   T-PM-02  restoreSelection returns saved pair when keys exist
 *   T-PM-03  restoreSelection returns null when keys are absent
 *   T-PM-04  autoSelectCheapest returns id of model with lowest costPerUnit
 *   T-PM-05  autoSelectCheapest treats null costPerUnit as Infinity
 *   T-PM-06  autoSelectCheapest returns null for empty list
 *
 * Functions are mirrored directly from app.js to keep tests self-contained
 * (app.js is a browser IIFE that cannot be imported in Node).
 *
 * Reference: openspec/changes/fallback-model/tests/test-plan.md
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Minimal localStorage mock (Node has no built-in localStorage) ───────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
    /** Returns a snapshot of all keys (for T-PM-01 isolation check). */
    keys: (): string[] => Object.keys(store),
  };
})();

// ── Mirror of persistSelection (app.js — TASK-04) ───────────────────────────

function persistSelection(modality: string, provider: string, model: string): void {
  localStorageMock.setItem(`ai-powered:provider:${modality}`, provider);
  localStorageMock.setItem(`ai-powered:model:${modality}`, model);
}

// ── Mirror of restoreSelection (app.js — TASK-05) ───────────────────────────

function restoreSelection(modality: string): { provider: string; model: string } | null {
  const provider = localStorageMock.getItem(`ai-powered:provider:${modality}`);
  const model = localStorageMock.getItem(`ai-powered:model:${modality}`);
  if (!provider || !model) return null;
  return { provider, model };
}

// ── Mirror of autoSelectCheapest (app.js — TASK-06) ─────────────────────────

interface ModelEntry {
  id: string;
  costPerUnit?: number | null;
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

// ── T-PM-01: persistSelection writes correct localStorage keys ───────────────

describe("T-PM-01: persistSelection", () => {
  beforeEach(() => localStorageMock.clear());

  it("writes provider key with correct value", () => {
    persistSelection("video", "runwayml", "gen4-turbo");
    expect(localStorageMock.getItem("ai-powered:provider:video")).toBe("runwayml");
  });

  it("writes model key with correct value", () => {
    persistSelection("video", "runwayml", "gen4-turbo");
    expect(localStorageMock.getItem("ai-powered:model:video")).toBe("gen4-turbo");
  });

  it("writes exactly two keys (no other modality keys are written)", () => {
    persistSelection("video", "runwayml", "gen4-turbo");
    const allKeys = localStorageMock.keys();
    expect(allKeys).toHaveLength(2);
    expect(allKeys).toContain("ai-powered:provider:video");
    expect(allKeys).toContain("ai-powered:model:video");
  });
});

// ── T-PM-02: restoreSelection returns saved pair when keys exist ─────────────

describe("T-PM-02: restoreSelection — keys present", () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.setItem("ai-powered:provider:text", "anthropic");
    localStorageMock.setItem("ai-powered:model:text", "claude-haiku-3-5");
  });

  it("returns the saved provider and model as an object", () => {
    const result = restoreSelection("text");
    expect(result).toEqual({ provider: "anthropic", model: "claude-haiku-3-5" });
  });
});

// ── T-PM-03: restoreSelection returns null when keys are absent ──────────────

describe("T-PM-03: restoreSelection — keys absent", () => {
  beforeEach(() => localStorageMock.clear());

  it("returns null when both keys are absent", () => {
    expect(restoreSelection("image")).toBeNull();
  });

  it("returns null when only the provider key is set", () => {
    localStorageMock.setItem("ai-powered:provider:audio", "openai");
    expect(restoreSelection("audio")).toBeNull();
  });

  it("returns null when only the model key is set", () => {
    localStorageMock.setItem("ai-powered:model:structured", "gpt-4o-mini");
    expect(restoreSelection("structured")).toBeNull();
  });
});

// ── T-PM-04: autoSelectCheapest returns id of model with lowest costPerUnit ──

describe("T-PM-04: autoSelectCheapest — correct sort order", () => {
  it("returns the id of the model with the lowest costPerUnit", () => {
    const result = autoSelectCheapest([
      { id: "claude-opus-4", costPerUnit: 15.0 },
      { id: "claude-haiku-3-5", costPerUnit: 0.25 },
      { id: "claude-sonnet-4-5", costPerUnit: 3.0 },
    ]);
    expect(result).toBe("claude-haiku-3-5");
  });

  it("does not mutate the original array", () => {
    const list = [
      { id: "expensive", costPerUnit: 10 },
      { id: "cheap", costPerUnit: 1 },
    ];
    autoSelectCheapest(list);
    expect(list[0].id).toBe("expensive"); // original order preserved
  });
});

// ── T-PM-05: autoSelectCheapest treats null costPerUnit as Infinity ──────────

describe("T-PM-05: autoSelectCheapest — null costPerUnit sorts last", () => {
  it("prefers a model with a finite cost over one with null cost", () => {
    const result = autoSelectCheapest([
      { id: "preview-model", costPerUnit: null },
      { id: "stable-model", costPerUnit: 1.5 },
    ]);
    expect(result).toBe("stable-model");
  });

  it("handles undefined costPerUnit the same as null", () => {
    const result = autoSelectCheapest([{ id: "no-price" }, { id: "priced", costPerUnit: 0.01 }]);
    expect(result).toBe("priced");
  });
});

// ── T-PM-06: autoSelectCheapest returns null for empty list ─────────────────

describe("T-PM-06: autoSelectCheapest — empty list", () => {
  it("returns null for an empty array", () => {
    expect(autoSelectCheapest([])).toBeNull();
  });
});
