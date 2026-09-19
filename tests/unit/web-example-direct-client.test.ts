/**
 * @file tests/unit/web-example-direct-client.test.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const appJsPath = path.resolve(process.cwd(), "integrations/web-example/app.js");
const source = readFileSync(appJsPath, "utf8");
const start = source.indexOf("function getClient()");
const end = source.indexOf("/* ── UI helpers ─────────────────────────────────────────── */");

if (start < 0) {
  throw new Error("Could not locate getClient in app.js");
}
if (end < 0) {
  throw new Error("Could not locate the UI helpers boundary in app.js");
}
if (end <= start) {
  throw new Error("Invalid getClient slice in app.js");
}

const block = source.slice(start, end);

function createStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => (data.has(key) ? data.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
}

function buildContext(options: {
  mode?: string;
  localValues?: Record<string, string>;
  sessionValues?: Record<string, string>;
}) {
  const localStorage = createStorage(options.localValues);
  const sessionStorage = createStorage(options.sessionValues);
  const createWebClient = vi.fn((config) => ({ config }));
  const context = {
    createWebClient,
    directConfigStorageKeys: {
      provider: "ai-powered:direct:provider",
      apiKeyPrefix: "ai-powered:direct:api-key:",
      budget: "ai-powered:direct:budget-usd",
    },
    DIRECT_PROVIDER_LABELS: {
      openai: "OpenAI",
      anthropic: "Anthropic",
      venice: "Venice",
      xai: "xAI",
      openrouter: "OpenRouter",
    },
    localStorage,
    modeSelect: { value: options.mode ?? "proxy" },
    proxyUrlInput: { value: "http://localhost:3001" },
    sessionStorage,
  };

  vm.createContext(context);
  vm.runInContext(block, context);

  return {
    createWebClient,
    getClient: (context as { getClient: () => unknown }).getClient,
    localStorage,
    sessionStorage,
  };
}

describe("web-example direct client storage", () => {
  it("reads the saved provider, API key, and budget from storage", () => {
    const { createWebClient, getClient } = buildContext({
      mode: "direct",
      localValues: {
        "ai-powered:direct:provider": "openai",
        "ai-powered:direct:api-key:openai": "sk-test-123",
        "ai-powered:direct:budget-usd": "12.5",
      },
    });

    expect(getClient()).toEqual({
      config: {
        mode: "direct",
        provider: "openai",
        apiKey: "sk-test-123",
        budgetUsd: 12.5,
      },
    });
    expect(createWebClient).toHaveBeenCalledWith({
      mode: "direct",
      provider: "openai",
      apiKey: "sk-test-123",
      budgetUsd: 12.5,
    });
  });

  it("fails closed when direct mode is selected without a stored API key", () => {
    const { createWebClient, getClient } = buildContext({
      mode: "direct",
      localValues: {
        "ai-powered:direct:provider": "openai",
      },
    });

    expect(() => getClient()).toThrow(/Settings \/ Configuration/);
    expect(createWebClient).not.toHaveBeenCalled();
  });
});
