/**
 * @file tests/unit/serve-startup.test.ts
 *
 * Unit tests for the Render-aware serve binding resolver.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServeBinding } from "../../src/ai-powered/server/index.js";

describe("resolveServeBinding", () => {
  it("keeps the local localhost:3001 default when no deployment env vars are set", () => {
    expect(resolveServeBinding({}, {})).toEqual({ host: "127.0.0.1", port: 3001 });
  });

  it("uses PORT and 0.0.0.0 when a hosted deployment sets PORT", () => {
    expect(resolveServeBinding({}, { PORT: "10000" })).toEqual({
      host: "0.0.0.0",
      port: 10000,
    });
  });

  it("lets explicit CLI values override deployment env vars", () => {
    expect(
      resolveServeBinding({ host: "127.0.0.1", port: 3001 }, { HOST: "0.0.0.0", PORT: "10000" }),
    ).toEqual({ host: "127.0.0.1", port: 3001 });
  });

  it("rejects an invalid PORT value", () => {
    expect(() => resolveServeBinding({}, { PORT: "not-a-number" })).toThrow(
      /Invalid PORT value "not-a-number"/,
    );
  });
});

describe("render deployment config", () => {
  it("builds the web bundle before starting Render", () => {
    const renderYaml = readFileSync(path.resolve(process.cwd(), "render.yaml"), "utf8");

    expect(renderYaml).toContain("buildCommand: npm ci && npm run build && npm run build:web");
    expect(renderYaml).toContain("startCommand: npm start");
  });
});
