/**
 * @file tests/unit/style-system.test.ts
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STYLE_REGISTRY,
  STYLE_STORAGE_KEY,
  createStyleController,
  getStyleById,
} from "../../src/ai-powered/web/style-system.js";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-style-id");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("style controller", () => {
  it("applies a style to the document and persists rotations", () => {
    const controller = createStyleController({
      document,
      storage: window.localStorage,
      previousStyleId: "aurora",
      random: () => 0,
    });

    const initialStyle = getStyleById("ember");
    expect(initialStyle).toBeDefined();
    expect(controller.style.id).toBe("ember");
    expect(document.documentElement.dataset.styleId).toBe("ember");
    expect(document.documentElement.style.getPropertyValue("--app-primary").trim()).toBe(
      initialStyle?.tokens.primary,
    );

    const rotated = controller.rotate();
    expect(rotated.id).toBe(controller.style.id);
    expect(rotated.id).not.toBe("ember");
    expect(document.documentElement.dataset.styleId).toBe(rotated.id);
    expect(window.localStorage.getItem(STYLE_STORAGE_KEY)).toBe(rotated.id);
    expect(document.documentElement.style.getPropertyValue("--app-surface").trim()).toBe(
      STYLE_REGISTRY.find((style) => style.id === rotated.id)?.tokens.surface,
    );
  });
});
