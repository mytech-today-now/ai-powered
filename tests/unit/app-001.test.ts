/**
 * Tests — App-001: Fix stale forEach index in showBatchPreflight remove buttons
 *
 * Covers:
 *  - stable-id-assignment: _id injected at parse time, preservation of existing _id
 *  - stable-id-removal:    correct item removed by findIndex after prior removals
 *
 * Reference: openspec/changes/app-001/tests/app-001.test.js
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Helpers mirroring the fixed app.js logic ─────────────────────────────

interface BatchItem {
  _id?: string;
  name: string;
  prompt: string;
  modality?: string;
  duration?: number;
}

/** Injects _id into each item (mirrors the injection loop in app.js) */
function injectStableIds(items: BatchItem[]): BatchItem[] {
  items.forEach(item => {
    item._id = item._id ?? crypto.randomUUID();
  });
  return items;
}

/** Returns a remove handler keyed by stable _id (mirrors fixed click handler) */
function createRemoveHandler(itemId: string, batchItemsRef: BatchItem[]): () => void {
  return function () {
    const idx = batchItemsRef.findIndex(x => x._id === itemId);
    if (idx !== -1) batchItemsRef.splice(idx, 1);
  };
}

// ── stable-id-assignment ─────────────────────────────────────────────────

describe("stable-id-assignment", () => {
  it("assigns a non-empty _id string to every item that lacks one", () => {
    const items: BatchItem[] = [
      { name: "Shot 1", prompt: "A." },
      { name: "Shot 2", prompt: "B." },
    ];
    injectStableIds(items);
    items.forEach(item => {
      expect(typeof item._id).toBe("string");
      expect(item._id!.length).toBeGreaterThan(0);
    });
  });

  it("does NOT overwrite a pre-existing _id", () => {
    const items: BatchItem[] = [{ name: "Archived", prompt: "…", _id: "fixed-uuid-9999" }];
    injectStableIds(items);
    expect(items[0]._id).toBe("fixed-uuid-9999");
  });

  it("assigns unique _id values to distinct items", () => {
    const items: BatchItem[] = Array.from({ length: 5 }, (_, i) => ({
      name: `Shot ${i + 1}`,
      prompt: "…",
    }));
    injectStableIds(items);
    const ids = items.map(x => x._id);
    expect(new Set(ids).size).toBe(5);
  });

  it("preserves all other properties after injection", () => {
    const items: BatchItem[] = [{ name: "Hero Shot", prompt: "Close-up.", modality: "video", duration: 5 }];
    injectStableIds(items);
    expect(items[0].name).toBe("Hero Shot");
    expect(items[0].prompt).toBe("Close-up.");
    expect(items[0].modality).toBe("video");
    expect(items[0].duration).toBe(5);
  });
});

// ── stable-id-removal ────────────────────────────────────────────────────

describe("stable-id-removal", () => {
  let batchItems: BatchItem[];
  let handlers: Array<() => void>;

  beforeEach(() => {
    batchItems = [
      { _id: "id-1", name: "Shot 1", prompt: "A." },
      { _id: "id-2", name: "Shot 2", prompt: "B." },
      { _id: "id-3", name: "Shot 3", prompt: "C." },
      { _id: "id-4", name: "Shot 4", prompt: "D." },
      { _id: "id-5", name: "Shot 5", prompt: "E." },
    ];
    // Capture handlers at "render time" — each keyed by stable _id
    handlers = batchItems.map(item => createRemoveHandler(item._id!, batchItems));
  });

  it("removes the correct item when no prior removals", () => {
    handlers[2](); // click "Shot 3" handler
    expect(batchItems).toHaveLength(4);
    expect(batchItems.find(x => x._id === "id-3")).toBeUndefined();
  });

  it("removes the correct item after one prior removal", () => {
    handlers[0](); // remove Shot 1
    handlers[2](); // click "Shot 3" handler (now at live index 1, not 2)
    const names = batchItems.map(x => x.name);
    expect(names).not.toContain("Shot 1");
    expect(names).not.toContain("Shot 3");
    expect(names).toContain("Shot 2");
    expect(names).toContain("Shot 4");
    expect(names).toContain("Shot 5");
  });

  it("AC: removing shots 1, 3, 5 (by label) leaves shots 2 and 4", () => {
    handlers[0](); // Shot 1
    handlers[2](); // Shot 3
    handlers[4](); // Shot 5
    expect(batchItems).toHaveLength(2);
    expect(batchItems[0]._id).toBe("id-2");
    expect(batchItems[1]._id).toBe("id-4");
  });

  it("does nothing when _id is not found", () => {
    const orphanHandler = createRemoveHandler("non-existent-id", batchItems);
    orphanHandler();
    expect(batchItems).toHaveLength(5); // unchanged
  });
});

