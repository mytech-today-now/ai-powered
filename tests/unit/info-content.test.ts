/**
 * @file tests/unit/info-content.test.ts
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import {
  DISCOVERY_FALLBACK_POSTS,
  loadDiscoveryPosts,
  loadReadmeMarkdown,
  normalizeDiscoveryPosts,
  renderMarkdownToSemanticHtml,
  sanitizeRenderedHtml,
} from "../../src/ai-powered/web/info-content.js";

describe("info content helpers", () => {
  it("renders semantic markdown and sanitizes remote HTML", () => {
    const rendered = renderMarkdownToSemanticHtml("# Workbench\n\n- fast\n- durable\n\n`code`\n");

    expect(rendered).toContain('<article class="rendered-markdown">');
    expect(rendered).toContain("<h1>Workbench</h1>");
    expect(rendered).toContain("<ul>");
    expect(rendered).toContain("<code>code</code>");

    const sanitized = sanitizeRenderedHtml(
      '<article class="rendered-markdown"><script>alert(1)</script><a href="/docs">Docs</a><img src="/cover.png" /></article>',
      "https://example.com/base/",
    );

    expect(sanitized).not.toContain("<script>");
    expect(sanitized).toContain('href="https://example.com/docs"');
    expect(sanitized).toContain('src="https://example.com/cover.png"');
  });

  it("normalizes discovery posts and keeps the mytech.today context", () => {
    const posts = normalizeDiscoveryPosts([
      {
        title: { rendered: "<strong>Proxy</strong> Troubleshooting" },
        excerpt: { rendered: "<p>GraphQL and Charles Proxy walkthrough</p>" },
        link: "https://mytech.today/proxy-troubleshooting/",
        date: "2025-01-02",
        _embedded: {
          "wp:featuredmedia": [{ source_url: "https://cdn.example.test/cover.jpg" }],
        },
      },
    ]);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: "Proxy Troubleshooting",
      url: "https://mytech.today/proxy-troubleshooting/",
      excerpt: "GraphQL and Charles Proxy walkthrough",
      relevance: "Useful for request inspection, debugging, and proxy-first workflows.",
      date: "2025-01-02",
      source: "mytech.today",
      imageUrl: "https://cdn.example.test/cover.jpg",
    });
  });

  it("loads the proxied README and falls back to discovery defaults", async () => {
    const readmeFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/info/readme");
      return new Response("# Demo README\n\nHello browser workbench.", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      });
    });

    const markdown = await loadReadmeMarkdown({
      fetchImpl: readmeFetch as unknown as typeof fetch,
      cache: null,
    });
    expect(markdown).toContain("Demo README");
    expect(readmeFetch).toHaveBeenCalledOnce();

    const fallbackFetch = vi.fn(async () => new Response("not json", { status: 200 }));
    const discovery = await loadDiscoveryPosts({
      fetchImpl: fallbackFetch as unknown as typeof fetch,
      cache: null,
    });

    expect(discovery).toEqual(DISCOVERY_FALLBACK_POSTS);
    expect(fallbackFetch).toHaveBeenCalledOnce();
  });
});
