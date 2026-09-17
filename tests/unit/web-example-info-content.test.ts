/**
 * @file tests/unit/web-example-info-content.test.ts
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function renderInfoContent(): void {
  document.body.innerHTML = "";
}

async function loadInfoContent(): Promise<void> {
  vi.resetModules();
  await import("../../integrations/web-example/info-content.js");
}

beforeEach(() => {
  renderInfoContent();
});

afterEach(() => {
  delete (window as unknown as { AiPoweredInfoContent?: unknown }).AiPoweredInfoContent;
  vi.restoreAllMocks();
});

describe("web-example info content helpers", () => {
  it("renders semantic markdown and strips unsafe markup", async () => {
    await loadInfoContent();

    const infoContent = (
      window as unknown as {
        AiPoweredInfoContent: {
          renderMarkdownToSemanticHtml(markdown: string, baseUrl?: string): string;
          sanitizeRenderedHtml(html: string, baseUrl?: string): string;
        };
      }
    ).AiPoweredInfoContent;

    const html = infoContent.renderMarkdownToSemanticHtml(
      "# Title\n\nParagraph with **bold**, `code`, [link](./docs.md), and ![alt](./img.png).\n\n- One\n- Two\n\n| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\n\n> Quote",
      "https://example.com/base/readme.md",
    );
    const sanitized = infoContent.sanitizeRenderedHtml(
      `${html}<script>alert('xss')</script>`,
      "https://example.com/base/readme.md",
    );

    expect(sanitized).toContain('<article class="rendered-markdown">');
    expect(sanitized).toContain("<h1>Title</h1>");
    expect(sanitized).toContain("<strong>bold</strong>");
    expect(sanitized).toContain("<code>code</code>");
    expect(sanitized).toContain('href="https://example.com/base/docs.md"');
    expect(sanitized).toContain('src="https://example.com/base/img.png"');
    expect(sanitized).toContain("<ul><li>One</li><li>Two</li></ul>");
    expect(sanitized).toContain("<table>");
    expect(sanitized).toContain("<blockquote><p>Quote</p></blockquote>");
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
    expect(sanitized).toContain('loading="lazy"');
    expect(sanitized).not.toContain("<script>");
  });

  it("loads the GitHub README first and falls back locally when needed", async () => {
    await loadInfoContent();

    const infoContent = (
      window as unknown as {
        AiPoweredInfoContent: {
          loadReadmeMarkdown(options?: { fetchImpl?: typeof fetch }): Promise<string>;
        };
      }
    ).AiPoweredInfoContent;

    const fetchCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (
        url ===
        "https://raw.githubusercontent.com/mytech-today-now/ai-powered/refs/heads/main/README.md"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () => "# ai-powered\n\nHello from GitHub.",
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const markdown = await infoContent.loadReadmeMarkdown({ fetchImpl: fetchMock as typeof fetch });

    expect(markdown).toBe("# ai-powered\n\nHello from GitHub.");
    expect(fetchCalls).toEqual([
      "https://raw.githubusercontent.com/mytech-today-now/ai-powered/refs/heads/main/README.md",
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the local /info/readme route when GitHub is unavailable", async () => {
    await loadInfoContent();

    const infoContent = (
      window as unknown as {
        AiPoweredInfoContent: {
          loadReadmeMarkdown(options?: { fetchImpl?: typeof fetch }): Promise<string>;
        };
      }
    ).AiPoweredInfoContent;

    const fetchCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (
        url ===
        "https://raw.githubusercontent.com/mytech-today-now/ai-powered/refs/heads/main/README.md"
      ) {
        return {
          ok: false,
          status: 503,
          text: async () => "",
        } as Response;
      }
      if (url === "/info/readme") {
        return {
          ok: true,
          status: 200,
          text: async () => "# Local README\n\nFallback copy.",
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const markdown = await infoContent.loadReadmeMarkdown({ fetchImpl: fetchMock as typeof fetch });

    expect(markdown).toBe("# Local README\n\nFallback copy.");
    expect(fetchCalls).toEqual([
      "https://raw.githubusercontent.com/mytech-today-now/ai-powered/refs/heads/main/README.md",
      "/info/readme",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
