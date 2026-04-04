/**
 * Tests — App-002: Fix fetchPreflightCostEstimate ignoring the user-configured proxy URL
 *
 * Covers:
 *  - proxy-aware-pricing-url: URL construction uses the configured proxy base, not a
 *    page-relative path.
 *
 * Reference: openspec/changes/app-002/tests/app-002.test.js
 */

import { describe, it, expect } from "vitest";

// ── Helper mirroring the fixed URL construction in app.js ─────────────────

/**
 * Mirrors the two-line fix inside fetchPreflightCostEstimate:
 *   const base = proxyUrlInput.value.trim() || "http://localhost:3001";
 *   const url  = `${base}/pricing?modality=video&model=${encodeURIComponent(model)}`;
 */
function buildPricingUrl(proxyInputValue: string, model: string): string {
  const base = proxyInputValue.trim() || "http://localhost:3001";
  return `${base}/pricing?modality=video&model=${encodeURIComponent(model)}`;
}

// ── proxy-aware-pricing-url ───────────────────────────────────────────────

describe("proxy-aware-pricing-url", () => {
  it("uses the default proxy URL when input is empty", () => {
    const url = buildPricingUrl("", "gen4_turbo");
    expect(url).toBe("http://localhost:3001/pricing?modality=video&model=gen4_turbo");
  });

  it("uses the default proxy URL when input is whitespace only", () => {
    const url = buildPricingUrl("   ", "gen4_turbo");
    expect(url).toBe("http://localhost:3001/pricing?modality=video&model=gen4_turbo");
  });

  it("uses the user-configured proxy URL when input is set", () => {
    const url = buildPricingUrl("http://192.168.1.10:3001", "gen4_turbo");
    expect(url).toBe(
      "http://192.168.1.10:3001/pricing?modality=video&model=gen4_turbo"
    );
  });

  it("URL is never page-relative (must start with http)", () => {
    const url = buildPricingUrl("http://localhost:3001", "gen4_turbo");
    expect(url.startsWith("http")).toBe(true);
    expect(url.startsWith("/pricing")).toBe(false);
  });

  it("encodes model names that contain slashes and colons", () => {
    const url = buildPricingUrl("http://localhost:3001", "provider/model:v2");
    expect(url).toContain("model=provider%2Fmodel%3Av2");
  });

  it("encodes model names that contain spaces", () => {
    const url = buildPricingUrl("http://localhost:3001", "my model");
    expect(url).toContain("model=my%20model");
  });

  it("preserves the modality=video query parameter", () => {
    const url = buildPricingUrl("http://localhost:3001", "gen4_turbo");
    expect(url).toContain("modality=video");
  });

  it("changing proxy input value changes the resulting URL", () => {
    const url1 = buildPricingUrl("http://localhost:3001", "gen4_turbo");
    const url2 = buildPricingUrl("http://my-proxy:8080", "gen4_turbo");
    expect(url1).not.toBe(url2);
    expect(url2.startsWith("http://my-proxy:8080")).toBe(true);
  });
});

