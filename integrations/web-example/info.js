/**
 * integrations/web-example/info.js
 *
 * Standalone info page for README, discovery, and settings.
 */
(function () {
  "use strict";

  if (typeof window.AiPowered === "undefined") {
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:monospace;color:#b91c1c"><strong>Error:</strong> ai-powered bundle not found.</div>';
    return;
  }

  const {
    createBrowserRecordStore,
    createStyleController,
    loadDiscoveryPosts,
    loadReadmeMarkdown,
    renderMarkdownToSemanticHtml,
    sanitizeRenderedHtml,
    DEFAULT_UI_KEYS,
  } = window.AiPowered;

  const $ = (id) => document.getElementById(id);
  const store = createBrowserRecordStore();
  const styleController = createStyleController({ document });

  const readmeStatus = $("readme-status");
  const discoveryStatus = $("discovery-status");
  const settingsStatus = $("settings-status");
  const readmeContent = $("readme-content");
  const discoveryGrid = $("discovery-grid");
  const storageSummary = $("storage-summary");
  const btnResetAll = $("btn-reset-all");
  const infoStyleBadge = $("info-style-badge");
  const infoVersionBadge = $("info-version-badge");
  const infoTabBtns = document.querySelectorAll(".info-tab-btn");
  const infoPanels = document.querySelectorAll(".info-panel");

  const infoTabKey = DEFAULT_UI_KEYS.infoTab;
  function readActiveInfoTab() {
    try {
      return window.localStorage.getItem(infoTabKey) || "readme";
    } catch {
      return "readme";
    }
  }

  const activeTab = readActiveInfoTab();

  function syncStyleBadge(style = styleController.style) {
    if (!infoStyleBadge) return;
    infoStyleBadge.textContent = style.label;
    infoStyleBadge.title = `Rotate style from ${style.label}`;
    infoStyleBadge.setAttribute("aria-label", `Rotate style. Current style: ${style.label}`);
  }

  syncStyleBadge();
  if (infoStyleBadge) {
    infoStyleBadge.addEventListener("click", () => {
      const nextStyle = styleController.rotate();
      syncStyleBadge(nextStyle);
    });
  }

  if (infoVersionBadge) {
    const version = window.AiPowered.__WEB_MODULE_VERSION__;
    infoVersionBadge.textContent = version ? `v${version}` : "UMD";
  }

  function setActiveTab(tabId) {
    infoTabBtns.forEach((btn) => {
      const isActive = btn.dataset.infoTab === tabId;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
    infoPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== `info-panel-${tabId}`);
    });
    try {
      window.localStorage.setItem(infoTabKey, tabId);
    } catch {
      /* ignore preference failures */
    }
  }

  async function renderReadme() {
    if (readmeStatus) readmeStatus.textContent = "Loading...";
    try {
      const markdown = await loadReadmeMarkdown({ cache: store });
      const html = renderMarkdownToSemanticHtml(markdown, "https://github.com/mytech-today-now/ai-powered/blob/main/README.md");
      readmeContent.innerHTML = sanitizeRenderedHtml(html, "https://github.com/mytech-today-now/ai-powered/blob/main/README.md");
      if (readmeStatus) readmeStatus.textContent = `${markdown.split("\n").length} lines`;
    } catch (error) {
      readmeContent.innerHTML =
        `<article class="rendered-markdown"><p>Unable to load the README right now. ${error instanceof Error ? error.message : String(error)}</p></article>`;
      if (readmeStatus) readmeStatus.textContent = "Unavailable";
    }
  }

  function renderDiscoveryPosts(posts) {
    discoveryGrid.innerHTML = "";
    for (const post of posts) {
      const card = document.createElement("article");
      card.className = "discovery-card";

      if (post.imageUrl) {
        const figure = document.createElement("figure");
        figure.className = "discovery-figure";
        const img = document.createElement("img");
        img.src = post.imageUrl;
        img.alt = post.title;
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        figure.appendChild(img);
        card.appendChild(figure);
      }

      const body = document.createElement("div");
      body.className = "discovery-body";

      const title = document.createElement("h3");
      const link = document.createElement("a");
      link.href = post.url;
      link.textContent = post.title;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      title.appendChild(link);

      const excerpt = document.createElement("p");
      excerpt.className = "discovery-excerpt";
      excerpt.textContent = post.excerpt;

      const relevance = document.createElement("p");
      relevance.className = "discovery-relevance";
      relevance.textContent = post.relevance;

      body.append(title, excerpt, relevance);
      card.appendChild(body);
      discoveryGrid.appendChild(card);
    }
  }

  async function renderDiscovery() {
    if (discoveryStatus) discoveryStatus.textContent = "Loading...";
    try {
      const posts = await loadDiscoveryPosts({ cache: store });
      renderDiscoveryPosts(posts);
      if (discoveryStatus) discoveryStatus.textContent = `${posts.length} posts`;
    } catch (error) {
      renderDiscoveryPosts([]);
      if (discoveryStatus) discoveryStatus.textContent = "Unavailable";
      discoveryGrid.innerHTML =
        `<article class="discovery-card"><div class="discovery-body"><p>${error instanceof Error ? error.message : String(error)}</p></div></article>`;
    }
  }

  async function renderSettings() {
    const summary = await store.getSummary();
    storageSummary.innerHTML = "";

    const summaryList = document.createElement("div");
    summaryList.className = "storage-summary-grid";

    const items = [
      ["Backend", summary.backend],
      ["Records", String(summary.totalRecords)],
      ["Text", String(summary.countsByModality.text)],
      ["Image", String(summary.countsByModality.image)],
      ["Audio", String(summary.countsByModality.audio)],
      ["Video", String(summary.countsByModality.video)],
      ["Structured", String(summary.countsByModality.structured)],
      ["Cache entries", String(summary.cacheKeys.length)],
      ["Local keys", String(summary.localStorageKeys.length)],
      ["Session keys", String(summary.sessionStorageKeys.length)],
    ];

    for (const [label, value] of items) {
      const item = document.createElement("div");
      item.className = "storage-summary-item";
      const key = document.createElement("span");
      key.className = "storage-summary-key";
      key.textContent = label;
      const val = document.createElement("strong");
      val.textContent = value;
      item.append(key, val);
      summaryList.appendChild(item);
    }

    storageSummary.appendChild(summaryList);

    if (summary.warning) {
      const warning = document.createElement("p");
      warning.className = "warn-box";
      warning.textContent = summary.warning;
      storageSummary.appendChild(warning);
    }

    const cacheList = document.createElement("div");
    cacheList.className = "storage-cache-list";
    if (summary.cacheKeys.length === 0) {
      const empty = document.createElement("p");
      empty.className = "storage-cache-empty";
      empty.textContent = "No cached remote content yet.";
      cacheList.appendChild(empty);
    } else {
      for (const key of summary.cacheKeys) {
        const row = document.createElement("div");
        row.className = "storage-cache-item";
        row.textContent = key;
        cacheList.appendChild(row);
      }
    }
    storageSummary.appendChild(cacheList);
    if (settingsStatus) settingsStatus.textContent = summary.backend === "indexeddb" ? "IndexedDB active" : "Memory fallback";
  }

  async function refreshActivePanel(tabId) {
    setActiveTab(tabId);
    if (tabId === "readme" && readmeContent.childElementCount === 0) {
      await renderReadme();
    }
    if (tabId === "discover" && discoveryGrid.childElementCount === 0) {
      await renderDiscovery();
    }
    if (tabId === "settings" && storageSummary.childElementCount === 0) {
      await renderSettings();
    }
  }

  infoTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.infoTab || "readme";
      refreshActivePanel(tabId);
    });
  });

  btnResetAll.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Reset all app-owned browser state? This clears the workbench records, cache, theme, and session state.",
    );
    if (!confirmed) return;
    btnResetAll.disabled = true;
    if (settingsStatus) settingsStatus.textContent = "Resetting...";
    try {
      await store.resetAll();
      try {
        window.localStorage.removeItem(infoTabKey);
      } catch {
        /* ignore preference failures */
      }
      window.location.reload();
    } catch (error) {
      if (settingsStatus) settingsStatus.textContent = "Reset failed";
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      btnResetAll.disabled = false;
    }
  });

  setActiveTab(activeTab);
  void renderReadme();
  void renderDiscovery();
  void renderSettings();
})();
