/**
 * integrations/web-example/info-content.js
 *
 * Browser-safe fallback helpers for the info page Overview tab.
 *
 * This mirrors the README loader and markdown renderer used by the web bundle
 * so the info page keeps working when dist-web assets are not deployed.
 */
(function () {
  "use strict";

  const README_SOURCE_URL =
    "https://raw.githubusercontent.com/mytech-today-now/ai-powered/refs/heads/main/README.md";

  async function readTextFromUrls(fetchImpl, urls, init) {
    let lastError = null;
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sanitizeBaseUrl(baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      return parsed.href;
    } catch {
      return baseUrl;
    }
  }

  function resolveAbsoluteUrl(rawUrl, baseUrl) {
    const trimmed = String(rawUrl).trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("#")) return trimmed;
    try {
      return new URL(trimmed, baseUrl).href;
    } catch {
      return trimmed;
    }
  }

  function isListLine(line) {
    return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
  }

  function isHeadingLine(line) {
    return /^#{1,6}\s+/.test(line);
  }

  function isFenceLine(line) {
    return /^```/.test(line.trim());
  }

  function isTableSeparator(line) {
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
  }

  function inlineMarkdown(input, baseUrl) {
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

  function renderTable(header, rows, baseUrl) {
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

  function renderParagraph(lines, baseUrl) {
    return `<p>${inlineMarkdown(lines.join(" ").trim(), baseUrl)}</p>`;
  }

  function renderList(lines, baseUrl) {
    const ordered = /^\s*\d+\.\s+/.test(lines[0] ?? "");
    const tag = ordered ? "ol" : "ul";
    const items = lines.map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "").trim());
    return `<${tag}>${items.map((item) => `<li>${inlineMarkdown(item, baseUrl)}</li>`).join("")}</${tag}>`;
  }

  function renderBlockquote(lines, baseUrl) {
    const text = lines
      .map((line) => line.replace(/^\s*>\s?/, "").trim())
      .join(" ")
      .trim();
    return `<blockquote><p>${inlineMarkdown(text, baseUrl)}</p></blockquote>`;
  }

  function renderMarkdownToSemanticHtml(markdown, baseUrl = README_SOURCE_URL) {
    const source = sanitizeBaseUrl(baseUrl);
    const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
    const parts = [];
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
        const body = [];
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
        const quoteLines = [];
        while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
          quoteLines.push(lines[index] ?? "");
          index++;
        }
        parts.push(renderBlockquote(quoteLines, source));
        continue;
      }

      if (isListLine(line)) {
        const listLines = [];
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
        const body = [];
        index += 2;
        while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
          body.push(lines[index] ?? "");
          index++;
        }
        parts.push(renderTable(header, body, source));
        continue;
      }

      const paragraphLines = [line];
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

  function sanitizeRenderedHtml(html, baseUrl = README_SOURCE_URL) {
    const parser = globalThis.DOMParser ? new DOMParser() : null;
    if (!parser || !globalThis.document) return html;
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return html;

    root.querySelectorAll("*").forEach((el) => {
      if (["SCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(el.tagName)) {
        el.remove();
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith("on")) {
          el.removeAttribute(attr.name);
        }
      }
      if (el.tagName === "A") {
        const href = el.getAttribute("href") ?? "";
        const resolved = resolveAbsoluteUrl(href, baseUrl);
        el.setAttribute("href", resolved);
        if (!resolved.startsWith("#")) {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
      }
      if (el.tagName === "IMG") {
        const src = el.getAttribute("src") ?? "";
        el.setAttribute("src", resolveAbsoluteUrl(src, baseUrl));
        el.setAttribute("loading", "lazy");
        el.setAttribute("referrerpolicy", "no-referrer");
      }
    });

    return root.innerHTML;
  }

  async function loadRemoteText(urls, options = {}) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const cacheKey = urls[0] ?? "";
    if (options.cache) {
      const cached = await options.cache.getCache(cacheKey);
      if (cached) return cached;
    }
    const text = await readTextFromUrls(fetchImpl, urls);
    if (options.cache && cacheKey) {
      await options.cache.setCache(cacheKey, text);
    }
    return text;
  }

  async function loadReadmeMarkdown(options = {}) {
    return loadRemoteText([README_SOURCE_URL, "/info/readme"], options);
  }

  globalThis.AiPoweredInfoContent = {
    README_SOURCE_URL,
    loadReadmeMarkdown,
    renderMarkdownToSemanticHtml,
    sanitizeRenderedHtml,
  };
})();

