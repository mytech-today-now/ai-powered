/**
 * @file tests/unit/config.test.ts
 *
 * Unit tests for: AiConfigSchema, maskApiKey, renderTemplate, loadConfig
 * flag-layering, and ConversationSession.  All tests run with AI_MOCK=true
 * (set by vitest.config.ts) — no API credentials required.
 */

import { AiConfigSchema, ConfigError, loadConfig } from "../../src/ai-powered/core.js";
import { maskApiKey } from "../../src/ai-powered/utils.js";
import { renderTemplate, getBuiltInTemplate } from "../../src/ai-powered/templates/builtins.js";
import { ConversationSession } from "../../src/ai-powered/client.js";

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

