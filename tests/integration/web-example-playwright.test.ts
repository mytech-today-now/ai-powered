import express from "express";
import { chromium } from "playwright";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const webRoot = path.resolve(process.cwd(), "integrations/web-example");
const githubReadmeUrl =
  "https://raw.githubusercontent.com/mytech-today-now/ai-powered/refs/heads/main/README.md";
let distRoot = "";
let server: Server | undefined;
let baseUrl = "";
let previousWebRoot: string | undefined;
let previousDistRoot: string | undefined;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function startServer(app: express.Express): Promise<Server> {
  return await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
}

async function loadInfoPage(githubOk: boolean): Promise<{
  chrome: string;
  readme: string;
  readmeRequests: string[];
}> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    const requestUrls: string[] = [];
    page.on("request", (request) => {
      requestUrls.push(request.url());
    });

    await page.route(githubReadmeUrl, async (route) => {
      if (githubOk) {
        await route.fulfill({
          status: 200,
          contentType: "text/markdown; charset=utf-8",
          body: "# ai-powered\n\nHello from GitHub.",
        });
        return;
      }

      await route.fulfill({
        status: 503,
        contentType: "text/plain; charset=utf-8",
        body: "GitHub unavailable",
      });
    });

    await page.goto(`${baseUrl}/info.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.getElementById("readme-status"));

    const readme = normalizeText(await page.locator("#readme-article").innerText());
    const header = normalizeText(await page.locator(".app-header").innerText());
    const overviewHeader = normalizeText(
      await page.locator('[data-info-panel="overview"] .info-panel-header').innerText(),
    );
    const tabBar = normalizeText(await page.locator(".tab-bar").innerText());

    await page.getByRole("tab", { name: "Settings / Configuration" }).click();
    const settingsPanel = normalizeText(
      await page.locator('[data-info-panel="settings-configuration"]').innerText(),
    );

    const chrome = [header, overviewHeader, tabBar, settingsPanel].join(" | ");
    const readmeRequests = requestUrls.filter(
      (url) => url === githubReadmeUrl || url.endsWith("/info/readme"),
    );

    await context.close();
    return { chrome, readme, readmeRequests };
  } finally {
    await browser.close();
  }
}

describe("web-example playwright smoke", () => {
  beforeAll(async () => {
    previousWebRoot = process.env.AI_POWERED_WEB_ROOT;
    previousDistRoot = process.env.AI_POWERED_DIST_WEB_ROOT;
    process.env.AI_POWERED_WEB_ROOT = webRoot;
    distRoot = await mkdtemp(path.join(tmpdir(), "ai-powered-playwright-dist-web-"));
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

  it("keeps the info-page GUI stable when the README comes from GitHub or local fallback", async () => {
    const github = await loadInfoPage(true);
    const fallback = await loadInfoPage(false);

    expect(github.readmeRequests).toEqual([githubReadmeUrl]);
    expect(fallback.readmeRequests).toEqual([githubReadmeUrl, `${baseUrl}/info/readme`]);
    expect(github.readme).toContain("Hello from GitHub.");
    expect(fallback.readme).toContain("Unified AI client and CLI");
    expect(github.chrome).toBe(fallback.chrome);
  });
});
