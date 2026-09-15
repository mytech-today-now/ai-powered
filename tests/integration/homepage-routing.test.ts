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

    const { createRouter } = await import("../../src/ai-powered/server/routes.js");
    const app = express();
    app.use(createRouter({ mock: true, configOverrides: {} } as never));
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

  it("serves static browser assets without falling back to HTML", async () => {
    const appJs = await request("/app.js");
    const styles = await request("/styles.css");
    const umd = await request("/dist-web/ai-powered.umd.js");
    const jszip = await request("/dist-web/jszip.min.js");

    expect(appJs.status).toBe(200);
    expect(await appJs.text()).toContain("window.AiPowered");
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
    expect(body).toMatchObject({ status: "ok" });
  });
});
