/**
 * integrations/web-example/info.js
 *
 * Standalone info page for the web demo. Provides an overview tab plus the
 * Settings / Configuration tab for browser-stored connection and credential settings.
 */
(function () {
  "use strict";

  const SETTINGS = window.AiPoweredSettings;
  if (!SETTINGS) {
    document.body.textContent = "Settings module failed to load.";
    return;
  }
  const STORAGE_KEYS = SETTINGS.STORAGE_KEYS;

  const DEFAULT_PROVIDER = "openai";
  const DEFAULT_PROXY_URL = "http://localhost:3001";
  const PROVIDER_LABELS = SETTINGS.PROVIDER_LABELS;

  const KNOWN_PROVIDERS = new Set(Object.keys(PROVIDER_LABELS));
  const DIRECT_PROVIDER_BASE_URLS = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    venice: "https://api.venice.ai/api/v1",
    xai: "https://api.x.ai/v1",
    openrouter: "https://openrouter.ai/api/v1",
  };
  const DIRECT_PROVIDER_NAMES = new Set(Object.keys(DIRECT_PROVIDER_BASE_URLS));
  const directCredentialCache = new Map();
  const verifiedDraftCache = new Map();
  let credentialStorageState = "available";

  const aiPowered = window.AiPowered ?? window.AiPoweredInfoContent ?? {};
  const loadReadmeMarkdown =
    typeof aiPowered.loadReadmeMarkdown === "function"
      ? aiPowered.loadReadmeMarkdown.bind(aiPowered)
      : null;
  const renderMarkdownToSemanticHtml =
    typeof aiPowered.renderMarkdownToSemanticHtml === "function"
      ? aiPowered.renderMarkdownToSemanticHtml.bind(aiPowered)
      : null;
  const sanitizeRenderedHtml =
    typeof aiPowered.sanitizeRenderedHtml === "function"
      ? aiPowered.sanitizeRenderedHtml.bind(aiPowered)
      : (html) => html;

  const modeSelect = document.getElementById("mode-select");
  const proxyUrlInput = document.getElementById("proxy-url");
  const providerSelect = document.getElementById("provider-select");
  const credentialInput = document.getElementById("api-key-input");
  const directBudgetInput = document.getElementById("direct-budget");
  const verifyButton = document.getElementById("btn-verify-settings");
  const saveButton = document.getElementById("btn-save-settings");
  const credentialStatus = document.getElementById("credential-status");
  const resetButton = document.getElementById("btn-reset-settings");
  const readmeArticle = document.getElementById("readme-article");
  const readmeStatus = document.getElementById("readme-status");
  const tabButtons = Array.from(document.querySelectorAll(".info-tab-btn, .tab-btn"));
  const tabPanels = Array.from(document.querySelectorAll(".info-panel, .tab-panel"));

  function normalizeProvider(provider) {
    return typeof provider === "string" && KNOWN_PROVIDERS.has(provider)
      ? provider
      : DEFAULT_PROVIDER;
  }

  function normalizeMode(mode) {
    return mode === "direct" ? "direct" : "proxy";
  }

  function providerLabel(provider) {
    return PROVIDER_LABELS[provider] ?? provider;
  }

  function credentialStorageKey(provider) {
    return SETTINGS.credentialStorageKey(provider);
  }

  function setCredentialStatus(state, message) {
    if (!credentialStatus) return;
    credentialStatus.dataset.state = state;
    credentialStatus.textContent = message;
  }

  function setCredentialInvalid(invalid) {
    if (!credentialInput) return;
    credentialInput.setAttribute("aria-invalid", invalid ? "true" : "false");
  }

  function syncCredentialPlaceholder(provider) {
    if (!credentialInput) return;
    credentialInput.placeholder = `Enter the ${providerLabel(provider)} credential`;
  }

  function detectProxyUrlFallback() {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
    const detected = window.__AI_PROXY_URL__ || (isLocal ? null : window.location.origin);
    return detected || DEFAULT_PROXY_URL;
  }

  function safeGetItem(storage, key) {
    try {
      return storage.getItem(key);
    } catch {
      credentialStorageState = credentialStorageState === "available" ? "session" : credentialStorageState;
      return null;
    }
  }

  function safeSetItem(storage, key, value) {
    try {
      storage.setItem(key, value);
      credentialStorageState = "available";
      return true;
    } catch {
      if (credentialStorageState === "available") credentialStorageState = "session";
      return false;
    }
  }

  function safeRemoveItem(storage, key) {
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function syncConnectionFromStorage() {
    const rawStoredMode = safeGetItem(localStorage, STORAGE_KEYS.mode);
    const storedMode = normalizeMode(rawStoredMode);
    const storedProxyUrl = safeGetItem(localStorage, STORAGE_KEYS.proxyUrl);
    const proxyUrl = storedProxyUrl === null ? detectProxyUrlFallback() : storedProxyUrl;

    if (modeSelect) {
      modeSelect.value = storedMode;
    }
    if (proxyUrlInput) {
      proxyUrlInput.value = proxyUrl;
    }

    if (rawStoredMode !== storedMode) {
      safeSetItem(localStorage, STORAGE_KEYS.mode, storedMode);
    }
    if (storedProxyUrl === null) {
      safeSetItem(localStorage, STORAGE_KEYS.proxyUrl, proxyUrl);
    }
  }

  function resolveCredential(provider) {
    return verifiedDraftCache.get(provider) ?? directCredentialCache.get(provider) ?? "";
  }

  function loadCredential(provider) {
    const stored = SETTINGS.readCredential(provider);
    if (stored) {
      directCredentialCache.set(provider, stored);
      verifiedDraftCache.set(provider, stored);
      return stored;
    }

    return resolveCredential(provider);
  }

  function storeCredential(provider, value) {
    const key = credentialStorageKey(provider);
    const trimmed = value.trim();
    if (safeSetItem(localStorage, key, trimmed)) {
      safeRemoveItem(sessionStorage, key);
      directCredentialCache.set(provider, trimmed);
      verifiedDraftCache.set(provider, trimmed);
      return "local";
    }
    if (safeSetItem(sessionStorage, key, trimmed)) {
      directCredentialCache.set(provider, trimmed);
      verifiedDraftCache.set(provider, trimmed);
      credentialStorageState = "session";
      return "session";
    }

    directCredentialCache.set(provider, trimmed);
    verifiedDraftCache.set(provider, trimmed);
    credentialStorageState = "unavailable";
    return "memory";
  }

  function clearCredential(provider) {
    const key = credentialStorageKey(provider);
    directCredentialCache.delete(provider);
    verifiedDraftCache.delete(provider);
    safeRemoveItem(localStorage, key);
    safeRemoveItem(sessionStorage, key);
  }

  function syncCredentialStatus(provider) {
    if (!credentialInput) return;
    const value = credentialInput.value.trim();
    const savedValue = directCredentialCache.get(provider) ?? "";
    const verifiedValue = verifiedDraftCache.get(provider) ?? "";

    if (!value) {
      if (credentialStorageState === "available") {
        setCredentialStatus(
          "idle",
          `Enter the ${providerLabel(provider)} credential, then Verify or Save.`,
        );
      } else {
        setCredentialStatus(
          "warning",
          `Browser storage is unavailable. Enter and verify the ${providerLabel(provider)} credential to use it in this session.`,
        );
      }
      return;
    }

    if (value === savedValue) {
      if (credentialStorageState === "available") {
        setCredentialStatus(
          "saved",
          `${providerLabel(provider)} credential saved in this browser.`,
        );
      } else {
        setCredentialStatus(
          "warning",
          `${providerLabel(provider)} credential is saved for this session only because browser storage is unavailable.`,
        );
      }
      return;
    }

    if (value === verifiedValue) {
      if (credentialStorageState === "available") {
        setCredentialStatus(
          "verified",
          `${providerLabel(provider)} credential verified. Click Save to store it in this browser.`,
        );
      } else {
        setCredentialStatus(
          "warning",
          `${providerLabel(provider)} credential verified, but browser storage is unavailable. It will remain available for this session only.`,
        );
      }
      return;
    }

    if (credentialStorageState === "available") {
      setCredentialStatus(
        "idle",
        `${providerLabel(provider)} credential ready to verify or save.`,
      );
    } else {
      setCredentialStatus(
        "warning",
        `${providerLabel(provider)} credential ready to verify or save, but browser storage is unavailable.`,
      );
    }
  }

  function syncSettingsFromStorage() {
    const storedProvider = normalizeProvider(safeGetItem(localStorage, STORAGE_KEYS.provider));
    const storedBudget = safeGetItem(localStorage, STORAGE_KEYS.budget);

    syncConnectionFromStorage();

    if (providerSelect) {
      providerSelect.value = storedProvider;
    }
    if (directBudgetInput) {
      directBudgetInput.value = storedBudget ?? "";
    }
    if (credentialInput) {
      credentialInput.value = loadCredential(storedProvider);
      setCredentialInvalid(false);
      syncCredentialPlaceholder(storedProvider);
      syncCredentialStatus(storedProvider);
    }
  }

  function validateCredential(provider, rawValue) {
    const value = rawValue.trim();
    if (!value) {
      return {
        ok: false,
        message: `Enter the ${providerLabel(provider)} credential before verifying.`,
      };
    }

    if (provider === "pika" && value.length < 8) {
      return {
        ok: false,
        message: "Pika credentials look too short.",
      };
    }

    return { ok: true, value };
  }

  function buildDirectHeaders(provider, apiKey) {
    if (provider === "anthropic") {
      return {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      };
    }

    return { Authorization: `Bearer ${apiKey}` };
  }

  async function verifyDirectCredential(provider, apiKey) {
    if (!DIRECT_PROVIDER_NAMES.has(provider)) {
      throw new Error(
        `${providerLabel(provider)} credentials are not verified through the /models endpoint in this demo.`,
      );
    }

    const baseUrl = DIRECT_PROVIDER_BASE_URLS[provider];
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: buildDirectHeaders(provider, apiKey),
    });

    if (!response.ok) {
      throw new Error(
        `Unable to verify the ${providerLabel(provider)} credential against /models. The provider returned HTTP ${response.status}.`,
      );
    }
  }

  async function renderReadmeOverview() {
    if (!readmeArticle || !readmeStatus) return;
    readmeStatus.textContent = "Loading the live README from the repository…";

    if (!loadReadmeMarkdown || !renderMarkdownToSemanticHtml) {
      readmeStatus.textContent = "Live README rendering is unavailable in this build.";
      return;
    }

    try {
      const markdown = await loadReadmeMarkdown();
      const rendered = renderMarkdownToSemanticHtml(markdown);
      readmeArticle.innerHTML = sanitizeRenderedHtml(rendered);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      readmeArticle.innerHTML =
        "<p>Unable to load the live README right now.</p>" +
        '<p class="hint">Refresh the page or open the repository README directly.</p>';
      readmeArticle.setAttribute("data-readme-error", detail);
    }
  }

  function setActiveTab(tabName, updateHash = true) {
    for (const button of tabButtons) {
      const isActive = button.dataset.infoTab === tabName;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    }
    for (const panel of tabPanels) {
      panel.classList.toggle("hidden", panel.dataset.infoPanel !== tabName);
    }
    if (updateHash && window.location.hash !== `#${tabName}`) {
      window.history.replaceState(null, "", `#${tabName}`);
    }
  }

  function getTabFromHash() {
    const tab = window.location.hash.replace(/^#/, "");
    return tabButtons.some((button) => button.dataset.infoTab === tab) ? tab : "overview";
  }

  function persistProviderSelection() {
    if (!providerSelect) return;
    localStorage.setItem(STORAGE_KEYS.provider, normalizeProvider(providerSelect.value));
  }

  function persistBudget() {
    if (!directBudgetInput) return;
    localStorage.setItem(STORAGE_KEYS.budget, directBudgetInput.value.trim());
  }

  function persistModeSelection() {
    if (!modeSelect) return;
    localStorage.setItem(STORAGE_KEYS.mode, normalizeMode(modeSelect.value));
  }

  function persistProxyUrl() {
    if (!proxyUrlInput) return;
    localStorage.setItem(STORAGE_KEYS.proxyUrl, proxyUrlInput.value.trim());
  }

  function handleProviderChange() {
    persistProviderSelection();
    const provider = normalizeProvider(providerSelect?.value ?? DEFAULT_PROVIDER);
    if (credentialInput) {
      credentialInput.value = loadCredential(provider);
      setCredentialInvalid(false);
      syncCredentialPlaceholder(provider);
      syncCredentialStatus(provider);
    }
  }

  function handleModeChange() {
    persistModeSelection();
  }

  function handleProxyUrlInput() {
    persistProxyUrl();
  }

  function handleCredentialInput() {
    if (!credentialInput || !providerSelect) return;
    setCredentialInvalid(false);
    const provider = normalizeProvider(providerSelect.value);
    const value = credentialInput.value.trim();
    if (value) {
      setCredentialStatus(
        "idle",
        `${providerLabel(provider)} credential ready to verify or save.`,
      );
    } else {
      setCredentialStatus(
        "idle",
        `Enter a new ${providerLabel(provider)} credential.`,
      );
    }
  }

  async function handleVerifyClick() {
    if (!credentialInput || !providerSelect) return;
    const provider = normalizeProvider(providerSelect.value);
    const result = validateCredential(provider, credentialInput.value);
    if (!result.ok) {
      setCredentialInvalid(true);
      setCredentialStatus("error", result.message);
      return;
    }

    setCredentialInvalid(false);
    if (!DIRECT_PROVIDER_NAMES.has(provider)) {
      verifiedDraftCache.set(provider, result.value);
      setCredentialStatus(
        "warning",
        `${providerLabel(provider)} credentials are syntactically valid but cannot be live-verified here. Save to use them through the proxy.`,
      );
      return;
    }

    setCredentialStatus("idle", `Verifying the ${providerLabel(provider)} credential…`);
    try {
      await verifyDirectCredential(provider, result.value);
      verifiedDraftCache.set(provider, result.value);
      syncCredentialStatus(provider);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : `Unable to verify the ${providerLabel(provider)} credential.`;
      setCredentialInvalid(true);
      setCredentialStatus("error", message);
    }
  }

  async function handleSaveClick() {
    if (!credentialInput || !providerSelect) return;
    const provider = normalizeProvider(providerSelect.value);
    const result = validateCredential(provider, credentialInput.value);
    if (!result.ok) {
      setCredentialInvalid(true);
      setCredentialStatus("error", result.message);
      return;
    }

    setCredentialInvalid(false);
    const value = result.value;
    const verifiedValue = verifiedDraftCache.get(provider) ?? "";

    try {
      if (DIRECT_PROVIDER_NAMES.has(provider) && verifiedValue !== value) {
        setCredentialStatus("idle", `Verifying the ${providerLabel(provider)} credential…`);
        await verifyDirectCredential(provider, value);
        verifiedDraftCache.set(provider, value);
      }

      storeCredential(provider, value);
      credentialInput.value = value;
      if (DIRECT_PROVIDER_NAMES.has(provider)) {
        syncCredentialStatus(provider);
      } else {
        setCredentialStatus(
          "warning",
          `${providerLabel(provider)} credential saved. This provider is not live-verified in the browser.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : `Unable to verify the ${providerLabel(provider)} credential.`;
      setCredentialInvalid(true);
      setCredentialStatus("error", message);
    }
  }

  function handleReset() {
    localStorage.removeItem(STORAGE_KEYS.mode);
    localStorage.removeItem(STORAGE_KEYS.proxyUrl);
    localStorage.removeItem(STORAGE_KEYS.provider);
    localStorage.removeItem(STORAGE_KEYS.budget);
    for (const provider of DIRECT_PROVIDER_NAMES) {
      localStorage.removeItem(credentialStorageKey(provider));
      sessionStorage.removeItem(credentialStorageKey(provider));
    }
    directCredentialCache.clear();
    verifiedDraftCache.clear();
    syncSettingsFromStorage();
  }

  function handleStorageEvent(event) {
    if (!event.key) {
      syncSettingsFromStorage();
      return;
    }

    if (
      event.key === STORAGE_KEYS.mode ||
      event.key === STORAGE_KEYS.proxyUrl ||
      event.key === STORAGE_KEYS.provider ||
      event.key === STORAGE_KEYS.budget ||
      event.key.startsWith(STORAGE_KEYS.apiKeyPrefix)
    ) {
      syncSettingsFromStorage();
    }
  }

  if (modeSelect) {
    modeSelect.addEventListener("change", handleModeChange);
  }
  if (proxyUrlInput) {
    proxyUrlInput.addEventListener("input", handleProxyUrlInput);
  }
  if (providerSelect) {
    providerSelect.addEventListener("change", handleProviderChange);
  }
  if (credentialInput) {
    credentialInput.addEventListener("input", handleCredentialInput);
  }
  if (directBudgetInput) {
    directBudgetInput.addEventListener("input", persistBudget);
  }
  if (verifyButton) {
    verifyButton.addEventListener("click", handleVerifyClick);
  }
  if (saveButton) {
    saveButton.addEventListener("click", handleSaveClick);
  }
  if (resetButton) {
    resetButton.addEventListener("click", handleReset);
  }

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const tabName = button.dataset.infoTab;
      if (tabName) setActiveTab(tabName);
    });
  }

  window.addEventListener("hashchange", () => {
    setActiveTab(getTabFromHash(), false);
  });

  window.addEventListener("storage", handleStorageEvent);

  syncSettingsFromStorage();
  setActiveTab(getTabFromHash(), false);
  void renderReadmeOverview();
})();









