import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const webRoot = path.resolve(process.cwd(), "integrations/web-example");
let distRoot = "";
let server: Server | undefined;
let baseUrl = "";
let previousWebRoot: string | undefined;
let previousDistRoot: string | undefined;

async function startServer(app: express.Express): Promise<Server> {
  return await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
}

async function request(pathname: string): Promise<Response> {
  return await fetch(`${baseUrl}${pathname}`);
}

describe("homepage routing", () => {
  beforeAll(async () => {
    previousWebRoot = process.env.AI_POWERED_WEB_ROOT;
    previousDistRoot = process.env.AI_POWERED_DIST_WEB_ROOT;
    process.env.AI_POWERED_WEB_ROOT = webRoot;
    distRoot = await mkdtemp(path.join(tmpdir(), "ai-powered-dist-web-"));
    await writeFile(
      path.join(distRoot, "ai-powered.umd.js"),
      "window.AiPowered = { createWebClient() { return {}; } };",
    );
    await writeFile(path.join(distRoot, "jszip.min.js"), "window.JSZip = {};\n");
    process.env.AI_POWERED_DIST_WEB_ROOT = distRoot;

    const { createServer } = await import("../../src/ai-powered/server/index.js");
    const app = createServer({ mock: true, configOverrides: {} } as never);
    server = await startServer(app);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to a port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await rm(distRoot, { recursive: true, force: true });
    if (previousWebRoot === undefined) {
      delete process.env.AI_POWERED_WEB_ROOT;
    } else {
      process.env.AI_POWERED_WEB_ROOT = previousWebRoot;
    }
    if (previousDistRoot === undefined) {
      delete process.env.AI_POWERED_DIST_WEB_ROOT;
    } else {
      process.env.AI_POWERED_DIST_WEB_ROOT = previousDistRoot;
    }
  }, 30000);

  it("serves the homepage shell at / with the primary CTA", async () => {
    const res = await request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    );
    expect(html).toContain("cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
    expect(html).toContain("cdn.jsdelivr.net/npm/ai-powered/dist-web/ai-powered.umd.js");
    expect(html).toContain("cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
    expect(html).toContain("ai-powered · web demo");
    expect(html).toContain("btn-text-generate");
    expect(html).toContain("btn-structured-generate");
  });

  it.each(["/login", "/register", "/guest-demo", "/auth/callback"])(
    "serves the app shell for %s",
    async (pathname) => {
      const res = await request(pathname);
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(html).toContain("btn-text-generate");
    },
  );

  it("serves the info page with the shared stylesheet and shell wrapper", async () => {
    const res = await request("/info.html");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('<link rel="stylesheet" href="styles.css" />');
    expect(html).toContain('class="info-shell"');
    expect(html).toContain('data-info-tab="settings-configuration"');
    expect(html).toContain('<script src="info-content.js"></script>');
    expect(html).not.toContain("dist-web/ai-powered.umd.js");
  });

  it("keeps config.html redirecting to the settings tab", async () => {
    const res = await request("/config.html");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("info.html#settings-configuration");
  });

  it("serves the browser helpers needed by the info page", async () => {
    const appJs = await request("/app.js");
    const infoContent = await request("/info-content.js");
    const styles = await request("/styles.css");
    const umd = await request("/dist-web/ai-powered.umd.js");
    const jszip = await request("/dist-web/jszip.min.js");

    expect(appJs.status).toBe(200);
    expect(await appJs.text()).toContain("window.AiPowered");
    expect(infoContent.status).toBe(200);
    expect(await infoContent.text()).toContain("AiPoweredInfoContent");
    expect(styles.status).toBe(200);
    expect(await styles.text()).toContain(".app-header");
    expect(umd.status).toBe(200);
    expect(await umd.text()).toContain("createWebClient");
    expect(jszip.status).toBe(200);
    expect(await jszip.text()).toContain("window.JSZip");
  });

  it("keeps API routes alive", async () => {
    const res = await request("/health");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("style-src 'none'");
    expect(body).toMatchObject({ status: "ok" });
  });
});
