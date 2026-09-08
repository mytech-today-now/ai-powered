/**
 * @file tests/unit/config.test.ts
 *
 * Unit tests for: AiConfigSchema, maskApiKey, serializePublicConfig,
 * renderTemplate, loadConfig flag-layering, and ConversationSession.  All
 * tests run with AI_MOCK=true
 * (set by vitest.config.ts) — no API credentials required.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AiConfigSchema,
  ConfigError,
  CURRENT_VERSION,
  GLOBAL_CONFIG_PATH,
  loadConfig,
} from "../../src/ai-powered/core.js";
import {
  maskApiKey,
  serializePublicConfig,
  listPricing,
  lookupModelPricing,
  calculateCost,
  estimateCost,
} from "../../src/ai-powered/utils.js";
import { renderTemplate, getBuiltInTemplate } from "../../src/ai-powered/templates/builtins.js";
import { ConversationSession } from "../../src/ai-powered/client.js";

afterEach(() => {
  fs.rmSync(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// maskApiKey
// ---------------------------------------------------------------------------

describe("maskApiKey", () => {
  it("masks OpenAI sk- keys", () => {
    expect(maskApiKey("sk-abc123")).toBe("sk-****");
  });
  it("masks Anthropic sk-ant- keys (longer prefix wins)", () => {
    expect(maskApiKey("sk-ant-api03-xyz")).toBe("sk-ant-****");
  });
  it("masks xAI xai- keys", () => {
    expect(maskApiKey("xai-somekey")).toBe("xai-****");
  });
  it("masks Venice ven- keys", () => {
    expect(maskApiKey("ven-abc")).toBe("ven-****");
  });
  it("returns [REDACTED] for empty string", () => {
    expect(maskApiKey("")).toBe("[REDACTED]");
  });
  it("returns [REDACTED] for unrecognised key format", () => {
    expect(maskApiKey("totally-random-key")).toBe("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// serializePublicConfig
// ---------------------------------------------------------------------------

describe("serializePublicConfig", () => {
  it("masks apiKey, omits empty customHeaders, and keeps safe fields unchanged", () => {
    const publicConfig = serializePublicConfig({
      provider: "openai",
      temperature: 0.42,
      apiKey: "sk-test-secret",
      customHeaders: {},
    });

    expect(publicConfig.provider).toBe("openai");
    expect(publicConfig.temperature).toBe(0.42);
    expect(publicConfig.apiKey).toBe("sk-****");
    expect(publicConfig).not.toHaveProperty("customHeaders");
  });

  it("returns [REDACTED] when apiKey is missing", () => {
    const publicConfig = serializePublicConfig({ provider: "openai", stream: false });

    expect(publicConfig.provider).toBe("openai");
    expect(publicConfig.stream).toBe(false);
    expect(publicConfig.apiKey).toBe("[REDACTED]");
    expect(publicConfig).not.toHaveProperty("customHeaders");
  });

  it("redacts nested secret-like fields recursively", () => {
    const publicConfig = serializePublicConfig({
      provider: "openai",
      credentials: {
        accessToken: "token-123",
        nested: {
          clientSecret: "secret-abc",
          apiKey: "sk-nested-secret",
          publicValue: "ok",
        },
      },
      metadata: {
        authorization: "Bearer secret",
      },
    });

    expect(publicConfig.credentials).toEqual({
      accessToken: "[REDACTED]",
      nested: {
        clientSecret: "[REDACTED]",
        apiKey: "sk-****",
        publicValue: "ok",
      },
    });
    expect(publicConfig.metadata).toEqual({
      authorization: "[REDACTED]",
    });
  });
});

// ---------------------------------------------------------------------------
// AiConfigSchema
// ---------------------------------------------------------------------------

describe("AiConfigSchema", () => {
  it("applies Zod defaults when no fields are provided", () => {
    const cfg = AiConfigSchema.parse({});
    expect(cfg.modality).toBe("text");
    expect(cfg.provider).toBe("openai");
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.stream).toBe(false);
    expect(cfg.fallback).toBe(true);
    expect(cfg.mock).toBe(false);
  });

  it("accepts all valid provider names", () => {
    for (const p of ["openai", "anthropic", "xai", "venice", "custom", "mock"]) {
      expect(AiConfigSchema.safeParse({ provider: p }).success).toBe(true);
    }
  });

  it("rejects temperature above 2", () => {
    expect(AiConfigSchema.safeParse({ temperature: 3 }).success).toBe(false);
  });

  it("rejects temperature below 0", () => {
    expect(AiConfigSchema.safeParse({ temperature: -1 }).success).toBe(false);
  });

  it("rejects an invalid provider name", () => {
    expect(AiConfigSchema.safeParse({ provider: "gpt-unknown" }).success).toBe(false);
  });

  it("accepts a positive budgetSession", () => {
    const cfg = AiConfigSchema.parse({ budgetSession: 2.5 });
    expect(cfg.budgetSession).toBe(2.5);
  });

  it("rejects non-positive budgetSession", () => {
    expect(AiConfigSchema.safeParse({ budgetSession: 0 }).success).toBe(false);
    expect(AiConfigSchema.safeParse({ budgetSession: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — flag-layer precedence
// ---------------------------------------------------------------------------

describe("loadConfig with flags", () => {
  it("flag temperature overrides Zod default", () => {
    const cfg = loadConfig({ flags: { temperature: 0.3, mock: true } });
    expect(cfg.temperature).toBe(0.3);
    expect(cfg.mock).toBe(true);
  });

  it("throws ConfigError when flags produce an invalid config", () => {
    expect(() => loadConfig({ flags: { temperature: 99 } })).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — isolated home regression coverage
// ---------------------------------------------------------------------------

describe("loadConfig home isolation", () => {
  const isolatedHome = process.env["HOME"] ?? "";
  const configDir = path.dirname(GLOBAL_CONFIG_PATH);
  const markerFile = path.join(configDir, "marker.txt");

  it("binds the global config path to the throwaway home directory", () => {
    expect(isolatedHome).not.toBe("");
    expect(GLOBAL_CONFIG_PATH).toBe(path.join(isolatedHome, ".ai-powered", "config.json"));
  });

  it("migrates a stale 0.1.0 config in the isolated home and backs it up there", () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      GLOBAL_CONFIG_PATH,
      JSON.stringify({ version: "0.1.0", provider: "mock", modality: "text" }, null, 2) + "\n",
      "utf-8",
    );

    const cfg = loadConfig({ flags: { mock: true } });

    expect(cfg.version).toBe(CURRENT_VERSION);
    expect(cfg.mock).toBe(true);

    const backupNames = fs
      .readdirSync(configDir)
      .filter((name) => name.startsWith("config.json.bak."));
    expect(backupNames).toHaveLength(1);

    const backupPath = path.join(configDir, backupNames[0]!);
    const backupContents = JSON.parse(fs.readFileSync(backupPath, "utf-8")) as Record<
      string,
      unknown
    >;

    expect(backupContents.version).toBe("0.1.0");
    expect(backupContents.provider).toBe("mock");
    expect(backupContents.modality).toBe("text");
    expect(backupPath.startsWith(isolatedHome)).toBe(true);
  });

  it("starts the next test without a leftover home marker", () => {
    expect(fs.existsSync(markerFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — AI_FALLBACK_PROVIDERS env var
// ---------------------------------------------------------------------------

describe("loadConfig AI_FALLBACK_PROVIDERS env var", () => {
  const ORIGINAL = process.env["AI_FALLBACK_PROVIDERS"];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env["AI_FALLBACK_PROVIDERS"];
    } else {
      process.env["AI_FALLBACK_PROVIDERS"] = ORIGINAL;
    }
  });

  it("parses a comma-separated list into fallbackProviders", () => {
    process.env["AI_FALLBACK_PROVIDERS"] = "anthropic,xai";
    const cfg = loadConfig({ flags: { mock: true } });
    expect(cfg.fallbackProviders).toEqual(["anthropic", "xai"]);
  });

  it("trims whitespace around provider names", () => {
    process.env["AI_FALLBACK_PROVIDERS"] = " anthropic , xai ";
    const cfg = loadConfig({ flags: { mock: true } });
    expect(cfg.fallbackProviders).toEqual(["anthropic", "xai"]);
  });

  it("single provider name works without trailing comma", () => {
    process.env["AI_FALLBACK_PROVIDERS"] = "mock";
    const cfg = loadConfig({ flags: { mock: true } });
    expect(cfg.fallbackProviders).toEqual(["mock"]);
  });

  it("empty string leaves fallbackProviders at default []", () => {
    process.env["AI_FALLBACK_PROVIDERS"] = "";
    const cfg = loadConfig({ flags: { mock: true } });
    expect(cfg.fallbackProviders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe("renderTemplate", () => {
  it("substitutes caller vars into the prompt", () => {
    const tpl = getBuiltInTemplate("summarize")!;
    const result = renderTemplate(tpl, { text: "Hello world" });
    expect(result).toContain("Hello world");
  });

  it("uses template.defaults when a var is not supplied by the caller", () => {
    const tpl = getBuiltInTemplate("summarize")!;
    const result = renderTemplate(tpl, { text: "some text" });
    expect(result).toContain("English"); // default language
  });

  it("throws when a required variable is missing", () => {
    const tpl = getBuiltInTemplate("qa")!; // requires {{question}} and {{context}}
    expect(() => renderTemplate(tpl, { question: "Q?" })).toThrow(/missing required variables/);
  });
});

// ---------------------------------------------------------------------------
// ConversationSession
// ---------------------------------------------------------------------------

describe("ConversationSession", () => {
  it("stores user and assistant messages in insertion order", () => {
    const session = new ConversationSession("sess-1");
    session.addUser("Hello");
    session.addAssistant("Hi there");
    const msgs = session.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[1]!.role).toBe("assistant");
  });

  it("prepends a system message when systemPrompt is supplied", () => {
    const session = new ConversationSession("sess-2", "You are helpful");
    session.addUser("Hi");
    const msgs = session.getMessages();
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content).toBe("You are helpful");
  });

  it("clear() removes all stored messages", () => {
    const session = new ConversationSession("sess-3");
    session.addUser("Hello");
    session.clear();
    expect(session.getMessages()).toHaveLength(0);
  });

  it("getHistory() returns a defensive copy", () => {
    const session = new ConversationSession("sess-4");
    session.addUser("msg");
    const history = session.getHistory();
    history.pop();
    expect(session.getHistory()).toHaveLength(1); // original unchanged
  });
});

// ---------------------------------------------------------------------------
// listPricing
// ---------------------------------------------------------------------------

describe("listPricing", () => {
  it("returns a non-empty array", () => {
    const entries = listPricing();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("results are sorted alphabetically by model id", () => {
    const entries = listPricing();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.model.localeCompare(entries[i - 1]!.model)).toBeGreaterThanOrEqual(0);
    }
  });

  it("every entry has a model, modality, and primaryUsd", () => {
    for (const e of listPricing()) {
      expect(typeof e.model).toBe("string");
      expect(["text", "image", "audio", "video"]).toContain(e.modality);
      expect(typeof e.primaryUsd).toBe("number");
      expect(e.primaryUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("filters by modality=video", () => {
    const entries = listPricing({ modality: "video" });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.modality).toBe("video");
      expect(e.perVideoUsd).toBeDefined();
    }
  });

  it("filters by modality=image", () => {
    const entries = listPricing({ modality: "image" });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.modality).toBe("image");
    }
  });

  it("filters by model substring", () => {
    const entries = listPricing({ model: "gpt-4o" });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.model).toContain("gpt-4o");
    }
  });

  it("returns empty array when model filter matches nothing", () => {
    expect(listPricing({ model: "nonexistent-model-xyz" })).toHaveLength(0);
  });

  it("filters by model substring 'gpt-4' — returns all gpt-4 variants including base entry", () => {
    const entries = listPricing({ model: "gpt-4" });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.model).toContain("gpt-4");
    }
    // Both the base "gpt-4" entry and versioned variants must be present.
    const ids = entries.map((e) => e.model);
    expect(ids).toContain("gpt-4");
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4-turbo");
  });

  it("Luma AI ray-flash-2 has primaryUsd=0.04 and modality=video", () => {
    const entry = listPricing({ model: "ray-flash-2" }).find((e) => e.model === "ray-flash-2");
    expect(entry).toBeDefined();
    expect(entry!.modality).toBe("video");
    expect(entry!.primaryUsd).toBe(0.04);
    expect(entry!.perVideoUsd).toBe(0.04);
  });

  it("Luma AI ray-2 has primaryUsd=0.14", () => {
    const entry = listPricing({ model: "ray-2" }).find((e) => e.model === "ray-2");
    expect(entry).toBeDefined();
    expect(entry!.primaryUsd).toBe(0.14);
  });

  it("gpt-4o has modality=text and correct rates", () => {
    const entry = listPricing().find((e) => e.model === "gpt-4o");
    expect(entry).toBeDefined();
    expect(entry!.modality).toBe("text");
    expect(entry!.promptPer1kUsd).toBe(0.005);
    expect(entry!.completionPer1kUsd).toBe(0.015);
    expect(entry!.primaryUsd).toBe(0.005);
  });
});

// ---------------------------------------------------------------------------
// lookupModelPricing
// ---------------------------------------------------------------------------

describe("lookupModelPricing", () => {
  it("exact match returns correct pricing", () => {
    const p = lookupModelPricing("gpt-4o");
    expect(p.promptPer1kUsd).toBe(0.005);
    expect(p.completionPer1kUsd).toBe(0.015);
  });

  it("prefix match resolves versioned model ids", () => {
    const p = lookupModelPricing("gpt-4o-mini-2024-07-18");
    expect(p.promptPer1kUsd).toBe(0.00015);
  });

  it("unknown model returns fallback pricing (not zero)", () => {
    const p = lookupModelPricing("some-unknown-model-abc");
    expect(p.promptPer1kUsd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// calculateCost
// ---------------------------------------------------------------------------

describe("calculateCost", () => {
  it("text model: computes correct cost from token usage", () => {
    // gpt-4o: $0.005/1k prompt + $0.015/1k completion
    // 1000 prompt + 500 completion = 0.005 + 0.0075 = 0.0125
    const cost = calculateCost("gpt-4o", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    expect(cost.isEstimate).toBe(false);
    expect(cost.totalUsd).toBeCloseTo(0.0125, 6);
  });

  it("image model: returns perImageUsd regardless of tokens", () => {
    const cost = calculateCost("dall-e-3", {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(cost.isEstimate).toBe(false);
    expect(cost.totalUsd).toBe(0.04);
  });

  it("video model: returns perVideoUsd for ray-flash-2", () => {
    const cost = calculateCost("ray-flash-2", {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(cost.isEstimate).toBe(false);
    expect(cost.totalUsd).toBe(0.04);
  });

  it("video model: returns perVideoUsd for ray-2", () => {
    const cost = calculateCost("ray-2", {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(cost.totalUsd).toBe(0.14);
  });

  it("result is rounded to 6 decimal places", () => {
    const cost = calculateCost("gpt-4o-mini", {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    });
    const decimals = cost.totalUsd.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

describe("estimateCost", () => {
  it("always returns isEstimate=true", () => {
    const est = estimateCost("gpt-4o", "Hello world");
    expect(est.isEstimate).toBe(true);
  });

  it("returns a positive cost for non-empty text", () => {
    const est = estimateCost("gpt-4o", "Write me a haiku about the ocean.");
    expect(est.totalUsd).toBeGreaterThan(0);
  });

  it("returns zero cost for empty text", () => {
    const est = estimateCost("gpt-4o", "");
    expect(est.totalUsd).toBe(0);
  });

  it("video model returns fixed video cost regardless of text", () => {
    const est = estimateCost("ray-flash-2", "Generate a time-lapse of clouds");
    expect(est.totalUsd).toBe(0.04);
  });
});
