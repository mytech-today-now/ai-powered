/**
 * @file src/ai-powered/web/info-content.ts
 *
 * Remote content helpers for the info page.
 */

/// <reference lib="dom" />

export interface DiscoveryPost {
  title: string;
  url: string;
  excerpt: string;
  relevance: string;
  date?: string;
  source?: string;
  imageUrl?: string;
}

export interface RemoteCacheLike {
  getCache<T>(key: string): Promise<T | null>;
  setCache<T>(key: string, value: T): Promise<void>;
}

export interface RemoteLoadOptions {
  fetchImpl?: typeof fetch;
  cache?: RemoteCacheLike | null;
}

export const README_SOURCE_URL =
  "https://raw.githubusercontent.com/mytech-today-now/ai-powered/refs/heads/main/README.md";
export const DISCOVERY_SOURCE_URL = "https://mytech.today/wp-json/wp/v2/posts?per_page=8&_embed=1";
export const README_CACHE_KEY = "ai-powered:remote:readme";
export const DISCOVERY_CACHE_KEY = "ai-powered:remote:discovery";

export const DISCOVERY_FALLBACK_POSTS: DiscoveryPost[] = [
  {
    title: "MyTech Today GitHub repositories",
    url: "https://mytech.today/mytech-today-github-repositories/",
    excerpt:
      "A practical entry point for the broader MyTech Today repository ecosystem and the stories surrounding it.",
    relevance:
      "Useful for understanding the product and content ecosystem that this browser demo belongs to.",
    source: "mytech.today",
  },
  {
    title: "Master troubleshooting tools: GraphQL, Charles Proxy, and Postman",
    url: "https://mytech.today/master-troubleshooting-tools-graphql-developer-tools-charles-proxy-and-postman/",
    excerpt:
      "Hands-on debugging and network analysis techniques that map well to proxy-first browser workflows.",
    relevance:
      "Directly relevant to proxy mode, request inspection, and the debugging workflow around the web demo.",
    source: "mytech.today",
  },
  {
    title: "Continue Ollama: fully local AI coding in VS Code",
    url: "https://mytech.today/continue-ollama-fully-local-ai-coding-in-vs-code/",
    excerpt:
      "Local-first AI tooling guidance that complements the browser demo's developer-facing workflow.",
    relevance:
      "Good background for local or self-hosted AI workflows and browser-safe client patterns.",
    source: "mytech.today",
  },
  {
    title: "Locked out of Google Workspace? Here's how we fixed it",
    url: "https://mytech.today/locked-out-of-google-workspace-heres-how-we-fixed-it/",
    excerpt:
      "A troubleshooting story that highlights practical incident response and recovery habits.",
    relevance:
      "Useful for the security, recovery, and operational discipline behind production-ready browser tools.",
    source: "mytech.today",
  },
  {
    title: "Master Google Analytics today",
    url: "https://mytech.today/master-google-analytics-today/",
    excerpt: "Analytics planning and measurement guidance for product and content teams.",
    relevance:
      "Helpful when a browser surface needs clear telemetry, usage tracking, or adoption signals.",
    source: "mytech.today",
  },
  {
    title: "Setting up a Heroku deployment with Jenkins",
    url: "https://mytech.today/setting-up-a-heroku-deployment-with-jenkins/",
    excerpt:
      "A deployment workflow article that pairs well with release automation and environment management.",
    relevance:
      "Relevant for release discipline, deployment pipelines, and keeping the browser demo shippable.",
    source: "mytech.today",
  },
];

async function readTextFromUrls(
  fetchImpl: typeof fetch,
  urls: string[],
  init?: RequestInit,
): Promise<string> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetchImpl(url, init);
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to load remote content.");
}

function normalizeExcerpt(value: string | undefined): string {
  const text = stripHtml(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeEntities(value: string): string {
  const textarea = globalThis.document?.createElement("textarea");
  if (!textarea) return value;
  textarea.innerHTML = value;
  return textarea.value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return parsed.href;
  } catch {
    return baseUrl;
  }
}

function resolveAbsoluteUrl(rawUrl: string, baseUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#")) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isFenceLine(line: string): boolean {
  return /^```/.test(line.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function inlineMarkdown(input: string, baseUrl: string): string {
  let value = escapeHtml(input);

  value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    const src = resolveAbsoluteUrl(String(url), baseUrl);
    return `<img alt="${escapeHtml(String(alt))}" src="${escapeHtml(src)}" loading="lazy" referrerpolicy="no-referrer" />`;
  });

  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
    const href = resolveAbsoluteUrl(String(url), baseUrl);
    const attrs = href.startsWith("#")
      ? `href="${escapeHtml(href)}"`
      : `href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`;
    return `<a ${attrs}>${String(text)}</a>`;
  });

  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  value = value.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  value = value.replace(/_([^_]+)_/g, "<em>$1</em>");

  return value;
}

function renderTable(header: string, rows: string[], baseUrl: string): string {
  const headerCells = header
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  const bodyRows = rows.map((row) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean),
  );

  const thead = `<thead><tr>${headerCells
    .map((cell) => `<th>${inlineMarkdown(cell, baseUrl)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${bodyRows
    .map(
      (cells) =>
        `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell, baseUrl)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function renderParagraph(lines: string[], baseUrl: string): string {
  return `<p>${inlineMarkdown(lines.join(" ").trim(), baseUrl)}</p>`;
}

function renderList(lines: string[], baseUrl: string): string {
  const ordered = /^\s*\d+\.\s+/.test(lines[0] ?? "");
  const tag = ordered ? "ol" : "ul";
  const items = lines.map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "").trim());
  return `<${tag}>${items.map((item) => `<li>${inlineMarkdown(item, baseUrl)}</li>`).join("")}</${tag}>`;
}

function renderBlockquote(lines: string[], baseUrl: string): string {
  const text = lines
    .map((line) => line.replace(/^\s*>\s?/, "").trim())
    .join(" ")
    .trim();
  return `<blockquote><p>${inlineMarkdown(text, baseUrl)}</p></blockquote>`;
}

export function renderMarkdownToSemanticHtml(
  markdown: string,
  baseUrl = README_SOURCE_URL,
): string {
  const source = sanitizeBaseUrl(baseUrl);
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index++;
      continue;
    }

    if (isFenceLine(line)) {
      const fenceMatch = line.match(/^```(\w+)?/);
      const language = fenceMatch?.[1] ?? "";
      index++;
      const body: string[] = [];
      while (index < lines.length && !isFenceLine(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index++;
      }
      if (index < lines.length) index++;
      parts.push(
        `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(
          body.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    if (isHeadingLine(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      const level = Math.min(6, match?.[1]?.length ?? 1);
      parts.push(`<h${level}>${inlineMarkdown(match?.[2] ?? "", source)}</h${level}>`);
      index++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      parts.push("<hr />");
      index++;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoteLines.push(lines[index] ?? "");
        index++;
      }
      parts.push(renderBlockquote(quoteLines, source));
      continue;
    }

    if (isListLine(line)) {
      const listLines: string[] = [];
      while (index < lines.length && isListLine(lines[index] ?? "")) {
        listLines.push(lines[index] ?? "");
        index++;
      }
      parts.push(renderList(listLines, source));
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    if (line.includes("|") && isTableSeparator(nextLine)) {
      const header = line;
      const body: string[] = [];
      index += 2;
      while (
        index < lines.length &&
        (lines[index] ?? "").includes("|") &&
        (lines[index] ?? "").trim()
      ) {
        body.push(lines[index] ?? "");
        index++;
      }
      parts.push(renderTable(header, body, source));
      continue;
    }

    const paragraphLines: string[] = [line];
    index++;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim()) break;
      if (
        isFenceLine(current) ||
        isHeadingLine(current) ||
        current.trim().startsWith(">") ||
        isListLine(current)
      ) {
        break;
      }
      const next = lines[index + 1] ?? "";
      if (current.includes("|") && isTableSeparator(next)) break;
      paragraphLines.push(current);
      index++;
    }
    parts.push(renderParagraph(paragraphLines, source));
  }

  return `<article class="rendered-markdown">${parts.join("")}</article>`;
}

export function sanitizeRenderedHtml(html: string, baseUrl = README_SOURCE_URL): string {
  const parser = globalThis.DOMParser ? new DOMParser() : null;
  if (!parser || !globalThis.document) return html;
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return html;

  root.querySelectorAll("*").forEach((el) => {
    const element = el as HTMLElement;
    if (["SCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(element.tagName)) {
      element.remove();
      return;
    }
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith("on")) {
        element.removeAttribute(attr.name);
      }
    }
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute("href") ?? "";
      const resolved = resolveAbsoluteUrl(href, baseUrl);
      element.setAttribute("href", resolved);
      if (!resolved.startsWith("#")) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (element instanceof HTMLImageElement) {
      const src = element.getAttribute("src") ?? "";
      element.setAttribute("src", resolveAbsoluteUrl(src, baseUrl));
      element.setAttribute("loading", "lazy");
      element.setAttribute("referrerpolicy", "no-referrer");
    }
  });

  return root.innerHTML;
}

export function normalizeDiscoveryPosts(raw: unknown): DiscoveryPost[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const post = entry as Record<string, unknown>;
      const title = decodeEntities(
        stripHtml(
          String(
            (post["title"] as { rendered?: string } | undefined)?.rendered ?? post["title"] ?? "",
          ),
        ),
      ).trim();
      const excerpt = normalizeExcerpt(
        String(
          (post["excerpt"] as { rendered?: string } | undefined)?.rendered ?? post["excerpt"] ?? "",
        ),
      );
      const url = String(post["link"] ?? post["url"] ?? "").trim();
      if (!title || !url) return null;
      const imageUrl = (
        post["_embedded"] as { ["wp:featuredmedia"]?: Array<{ source_url?: string }> } | undefined
      )?.["wp:featuredmedia"]?.[0]?.source_url;
      const normalized: DiscoveryPost = {
        title,
        url,
        excerpt,
        relevance: buildRelevanceNote(title, excerpt),
        source: "mytech.today",
      };
      const date = String(post["date"] ?? post["modified"] ?? "").trim();
      if (date) normalized.date = date;
      if (imageUrl) normalized.imageUrl = imageUrl;
      return normalized;
    })
    .filter((value): value is DiscoveryPost => value !== null);
}

export function buildRelevanceNote(title: string, excerpt = ""): string {
  const blob = `${title} ${excerpt}`.toLowerCase();
  const notes: Array<[RegExp, string]> = [
    [
      /proxy|charles|postman|graphql|developer tools/,
      "Useful for request inspection, debugging, and proxy-first workflows.",
    ],
    [
      /local|ollama|offline|self-hosted/,
      "Relevant to local-first model routing and browser-safe offline patterns.",
    ],
    [
      /security|workspace|incident|access/,
      "Good background for security, recovery, and safe browser operations.",
    ],
    [
      /analytics|measurement|tracking/,
      "Helpful for product telemetry, adoption, and usage visibility.",
    ],
    [
      /deployment|jenkins|heroku|release/,
      "Useful when release automation or environment setup matters.",
    ],
    [
      /github|repositories|code|coding/,
      "Close to the browser demo's developer-facing product story.",
    ],
  ];
  for (const [pattern, note] of notes) {
    if (pattern.test(blob)) return note;
  }
  return "Relevant to the browser demo's product, workflow, or operational context.";
}

export async function loadRemoteText(
  urls: string[],
  options: RemoteLoadOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const cacheKey = urls[0] ?? "";
  if (options.cache) {
    const cached = await options.cache.getCache<string>(cacheKey);
    if (cached) return cached;
  }
  const text = await readTextFromUrls(fetchImpl, urls);
  if (options.cache && cacheKey) {
    await options.cache.setCache(cacheKey, text);
  }
  return text;
}

export async function loadReadmeMarkdown(options: RemoteLoadOptions = {}): Promise<string> {
  return loadRemoteText([README_SOURCE_URL, "/info/readme"], options);
}

export async function loadDiscoveryPosts(
  options: RemoteLoadOptions = {},
): Promise<DiscoveryPost[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const cacheKey = DISCOVERY_CACHE_KEY;
  if (options.cache) {
    const cached = await options.cache.getCache<DiscoveryPost[]>(cacheKey);
    if (cached?.length) return cached;
  }

  try {
    const raw = await readTextFromUrls(fetchImpl, ["/info/posts", DISCOVERY_SOURCE_URL]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
    const normalized = normalizeDiscoveryPosts(parsed);
    if (normalized.length > 0 && options.cache) {
      await options.cache.setCache(cacheKey, normalized);
    }
    return normalized.length > 0 ? normalized : DISCOVERY_FALLBACK_POSTS;
  } catch {
    return DISCOVERY_FALLBACK_POSTS;
  }
}
