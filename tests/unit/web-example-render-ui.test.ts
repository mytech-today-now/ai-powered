/**
 * @file tests/unit/web-example-render-ui.test.ts
 *
 * Regression coverage for the shared proxy UI copy used by proxy-hosted
 * deployments.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(process.cwd(), "integrations/web-example");
const indexHtml = readFileSync(path.join(webRoot, "index.html"), "utf8");
const appJs = readFileSync(path.join(webRoot, "app.js"), "utf8");

describe("web-example proxy UI", () => {
  it("describes the Luma warning in terms of a generic public HTTPS URL", () => {
    expect(indexHtml).toContain("Public HTTPS URL required.");
    expect(indexHtml).toContain("PROXY_PUBLIC_BASE_URL");
    expect(indexHtml).not.toContain("ngrok");
    expect(indexHtml).not.toContain("Render service URL");
    expect(indexHtml).not.toContain("-Ngrok");
  });

  it("keeps the runtime Luma error generic instead of host-specific", () => {
    expect(appJs).toContain("Luma AI image-to-video requires a public HTTPS URL.");
    expect(appJs).not.toContain("Render service URL");
    expect(appJs).not.toContain("cycle-service.ps1 -Ngrok");
    expect(appJs).not.toContain("ngrok tunnel");
  });
  it("uses the requested header, history placement, and aligned control markup", () => {
    expect(indexHtml).toContain("<h1>AI-Powered</h1>");
    expect(indexHtml).toContain(
      '<a class="header-attribution" href="https://mytech.today">by myTech.Today</a>',
    );

    const mainEnd = indexHtml.indexOf("</main>");
    const historyStart = indexHtml.indexOf('<section id="history-panel-wrap"');
    expect(mainEnd).toBeGreaterThanOrEqual(0);
    expect(historyStart).toBeGreaterThan(mainEnd);

    for (const id of [
      "text-provider-select",
      "text-model-select",
      "image-provider-select",
      "image-model-select",
      "audio-provider-select",
      "tts-model-select",
      "video-provider-select",
      "video-model-select",
      "structured-provider-select",
      "structured-model-select",
    ]) {
      expect(indexHtml).toContain('id="' + id + '"');
    }

    const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual([...new Set(ids)]);
  });
});
