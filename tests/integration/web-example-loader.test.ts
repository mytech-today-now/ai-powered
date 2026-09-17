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
    expect(html).toMatch(/<section class="mode-section" hidden aria-hidden="true">/);
    expect(html).toContain('id="mode-select"');
    expect(html).toContain('id="proxy-url"');
  });
});
