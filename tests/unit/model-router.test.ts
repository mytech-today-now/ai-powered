/**
 * @file tests/unit/model-router.test.ts
 *
 * Unit tests for inferProviderFromModel() in
 * src/ai-powered/server/compat/model-router.ts.
 *
 * Rules under test (first-match wins):
 *   claude-*                              → "anthropic"
 *   gpt-* | o[0-9]* | dall-e-* | whisper-* | tts-* → "openai"
 *   grok-*                                → "xai"
 *   venice-* | llama*venice*             → "venice"
 *   dream-shaper* | fluently* | flux*    → "venice" (Venice image models)
 *   ray-* | photon-*                     → "lumaai"
 *   (no match)                           → undefined
 *
 * The function is side-effect-free; no credentials or network access required.
 */

import { inferProviderFromModel } from "../../src/ai-powered/server/compat/model-router.js";

// ---------------------------------------------------------------------------
// Anthropic — claude-*
// ---------------------------------------------------------------------------

describe("inferProviderFromModel — Anthropic", () => {
  it("returns 'anthropic' for claude-3-5-sonnet-20241022", () => {
    expect(inferProviderFromModel("claude-3-5-sonnet-20241022")).toBe("anthropic");
  });

  it("returns 'anthropic' for claude-3-haiku-20240307", () => {
    expect(inferProviderFromModel("claude-3-haiku-20240307")).toBe("anthropic");
  });

  it("returns 'anthropic' for claude-2.1", () => {
    expect(inferProviderFromModel("claude-2.1")).toBe("anthropic");
  });

  it("returns 'anthropic' for any claude- prefix", () => {
    expect(inferProviderFromModel("claude-instant-1")).toBe("anthropic");
  });
});

// ---------------------------------------------------------------------------
// OpenAI — gpt-*, o[0-9]*, dall-e-*, whisper-*, tts-*
// ---------------------------------------------------------------------------

describe("inferProviderFromModel — OpenAI", () => {
  it("returns 'openai' for gpt-4o", () => {
    expect(inferProviderFromModel("gpt-4o")).toBe("openai");
  });

  it("returns 'openai' for gpt-3.5-turbo", () => {
    expect(inferProviderFromModel("gpt-3.5-turbo")).toBe("openai");
  });

  it("returns 'openai' for o1 (o[0-9] pattern)", () => {
    expect(inferProviderFromModel("o1")).toBe("openai");
  });

  it("returns 'openai' for o3-mini", () => {
    expect(inferProviderFromModel("o3-mini")).toBe("openai");
  });

  it("returns 'openai' for dall-e-3", () => {
    expect(inferProviderFromModel("dall-e-3")).toBe("openai");
  });

  it("returns 'openai' for whisper-1", () => {
    expect(inferProviderFromModel("whisper-1")).toBe("openai");
  });

  it("returns 'openai' for tts-1", () => {
    expect(inferProviderFromModel("tts-1")).toBe("openai");
  });

  it("returns 'openai' for tts-1-hd", () => {
    expect(inferProviderFromModel("tts-1-hd")).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// xAI — grok-*
// ---------------------------------------------------------------------------

describe("inferProviderFromModel — xAI", () => {
  it("returns 'xai' for grok-2", () => {
    expect(inferProviderFromModel("grok-2")).toBe("xai");
  });

  it("returns 'xai' for grok-beta", () => {
    expect(inferProviderFromModel("grok-beta")).toBe("xai");
  });
});

// ---------------------------------------------------------------------------
// Venice — venice-*, llama*venice*, dream-shaper*, fluently*, flux*
// ---------------------------------------------------------------------------

describe("inferProviderFromModel — Venice", () => {
  it("returns 'venice' for venice-uncensored", () => {
    expect(inferProviderFromModel("venice-uncensored")).toBe("venice");
  });

  it("returns 'venice' for llama-3-venice-2", () => {
    expect(inferProviderFromModel("llama-3-venice-2")).toBe("venice");
  });

  it("returns 'venice' for dream-shaper-8", () => {
    expect(inferProviderFromModel("dream-shaper-8")).toBe("venice");
  });

  it("returns 'venice' for fluently-xl", () => {
    expect(inferProviderFromModel("fluently-xl")).toBe("venice");
  });

  it("returns 'venice' for flux-dev", () => {
    expect(inferProviderFromModel("flux-dev")).toBe("venice");
  });

  it("returns 'venice' for flux-pro-1.1", () => {
    expect(inferProviderFromModel("flux-pro-1.1")).toBe("venice");
  });
});

// ---------------------------------------------------------------------------
// LumaAI — ray-*, photon-*
// ---------------------------------------------------------------------------

describe("inferProviderFromModel — LumaAI", () => {
  it("returns 'lumaai' for ray-2", () => {
    expect(inferProviderFromModel("ray-2")).toBe("lumaai");
  });

  it("returns 'lumaai' for ray-flash-2", () => {
    expect(inferProviderFromModel("ray-flash-2")).toBe("lumaai");
  });

  it("returns 'lumaai' for photon-1", () => {
    expect(inferProviderFromModel("photon-1")).toBe("lumaai");
  });

  it("returns 'lumaai' for photon-flash-1", () => {
    expect(inferProviderFromModel("photon-flash-1")).toBe("lumaai");
  });
});

// ---------------------------------------------------------------------------
// Unknown / no match → undefined
// ---------------------------------------------------------------------------

describe("inferProviderFromModel — unknown models", () => {
  it("returns undefined for an unrecognised model string", () => {
    expect(inferProviderFromModel("unknown-model-xyz")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(inferProviderFromModel("")).toBeUndefined();
  });

  it("returns undefined for a model with no recognised prefix", () => {
    expect(inferProviderFromModel("llama-3-8b")).toBeUndefined();
  });

  it("does NOT match 'claude' mid-string (prefix-only rule)", () => {
    // 'myclaude-3' does not start with 'claude-'
    expect(inferProviderFromModel("myclaude-3")).toBeUndefined();
  });
});

