import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("web example loader", () => {
  it("keeps the bootstrap sequence booting after the FFmpeg util import", async () => {
    const html = await readFile(resolve("integrations/web-example/index.html"), "utf8");

    expect(html).toContain("@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
    expect(html).toContain("@ffmpeg/util@0.12.1/dist/esm/index.js");
    expect(html).toContain('appScript.src = "app.js";');
    expect(html.indexOf('appScript.src = "app.js";')).toBeGreaterThan(
      html.indexOf("@ffmpeg/util@0.12.1/dist/esm/index.js"),
    );
    expect(html).not.toMatch(/<section class="mode-section">/);
    expect(html).not.toContain('id="mode-select"');
    expect(html).not.toContain('id="proxy-url"');
    expect(html).not.toContain("Run npm run serve to start the proxy server.");
    expect(html).not.toContain('id="provider-select"');
    expect(html).not.toContain('id="api-key-input"');
    expect(html).not.toContain('id="btn-verify-settings"');
    expect(html).not.toContain('id="btn-save-settings"');
    expect(html).not.toContain('id="direct-budget"');
    expect(html).not.toContain('id="credential-status"');
    expect(html).not.toContain('id="direct-config"');
    expect(html).not.toContain("Enter a credential to verify or save.");

    const infoHtml = await readFile(resolve("integrations/web-example/info.html"), "utf8");
    expect(infoHtml).toContain('id="mode-select"');
    expect(infoHtml).toContain('id="proxy-url"');
    expect(infoHtml).toContain('data-info-panel="settings-configuration"');
  });
});
