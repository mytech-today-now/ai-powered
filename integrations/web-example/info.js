/**
 * integrations/web-example/info.js
 *
 * Standalone info page for the web demo. Provides an overview tab plus the
 * Settings / Configuration tab for browser-stored provider credentials.
 */
(function () {
  "use strict";

  const STORAGE_KEYS = {
    provider: "ai-powered:direct:provider",
    apiKey: "ai-powered:direct:api-key",
    pikaApiKey: "ai-powered:direct:pika-api-key",
    budget: "ai-powered:direct:budget-usd",
  };

  const DEFAULT_PROVIDER = "openai";
  const PROVIDER_LABELS = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    venice: "Venice",
    xai: "xAI",
    openrouter: "OpenRouter",
    pika: "Pika",
  };

  const KNOWN_PROVIDERS = new Set(Object.keys(PROVIDER_LABELS));

  const aiPowered = window.AiPowered ?? {};
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

  const providerSelect = document.getElementById("provider-select");
  const credentialInput = document.getElementById("api-key-input");
  const directBudgetInput = document.getElementById("direct-budget");
  const verifyButton = document.getElementById("btn-verify-settings");
  const saveButton = document.getElementById("btn-save-settings");
  const credentialStatus = document.getElementById("credential-status");
  const resetButton = document.getElementById("btn-reset-settings");
  const readmeArticle = document.getElementById("readme-article");
  const readmeStatus = document.getElementById("readme-status");
  const tabButtons = Array.from(document.querySelectorAll(".info-tab-btn"));
  const tabPanels = Array.from(document.querySelectorAll(".info-panel"));

  function normalizeProvider(provider) {
    return typeof provider === "string" && KNOWN_PROVIDERS.has(provider)
      ? provider
      : DEFAULT_PROVIDER;
  }

  function providerLabel(provider) {
    return PROVIDER_LABELS[provider] ?? provider;
  }

  function credentialStorageKey(provider) {
    return provider === "pika" ? STORAGE_KEYS.pikaApiKey : STORAGE_KEYS.apiKey;
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

  function readStoredCredential(provider) {
    return localStorage.getItem(credentialStorageKey(provider)) ?? "";
  }

  function syncSettingsFromStorage({ clearCredential = false } = {}) {
    const storedProvider = normalizeProvider(localStorage.getItem(STORAGE_KEYS.provider));
    const storedBudget = localStorage.getItem(STORAGE_KEYS.budget);
    const storedCredential = readStoredCredential(storedProvider);

    if (providerSelect) {
      providerSelect.value = storedProvider;
    }
    if (directBudgetInput) {
      directBudgetInput.value = storedBudget ?? "";
    }
    if (credentialInput) {
      credentialInput.value = clearCredential ? "" : storedCredential;
      setCredentialInvalid(false);
      syncCredentialPlaceholder(storedProvider);
    }

    if (clearCredential) {
      setCredentialStatus(
        "idle",
        `Enter a new ${providerLabel(storedProvider)} credential.`,
      );
      return;
    }

    if (storedCredential.trim()) {
      setCredentialStatus(
        "saved",
        `${providerLabel(storedProvider)} credential saved in this browser.`,
      );
    } else {
      setCredentialStatus(
        "idle",
        `Enter the ${providerLabel(storedProvider)} credential, then Verify or Save.`,
      );
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

    switch (provider) {
      case "anthropic":
        if (!value.startsWith("sk-ant-")) {
          return {
            ok: false,
            message: "Anthropic credentials usually start with sk-ant-.",
          };
        }
        break;
      case "openrouter":
        if (!value.startsWith("sk-or-v1-")) {
          return {
            ok: false,
            message: "OpenRouter credentials usually start with sk-or-v1-.",
          };
        }
        break;
      case "openai":
        if (!value.startsWith("sk-") || value.startsWith("sk-ant-") || value.startsWith("sk-or-v1-")) {
          return {
            ok: false,
            message: "OpenAI credentials usually start with sk-.",
          };
        }
        break;
      case "venice":
        if (!value.startsWith("ven-")) {
          return {
            ok: false,
            message: "Venice credentials usually start with ven-.",
          };
        }
        break;
      case "xai":
        if (!value.startsWith("xai-")) {
          return {
            ok: false,
            message: "xAI credentials usually start with xai-.",
          };
        }
        break;
      case "pika":
        if (value.length < 8) {
          return {
            ok: false,
            message: "Pika credentials look too short.",
          };
        }
        break;
      default:
        break;
    }

    return { ok: true, value };
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

  function handleProviderChange() {
    persistProviderSelection();
    syncSettingsFromStorage({ clearCredential: true });
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

  function handleVerifyClick() {
    if (!credentialInput || !providerSelect) return;
    const provider = normalizeProvider(providerSelect.value);
    const result = validateCredential(provider, credentialInput.value);
    if (!result.ok) {
      setCredentialInvalid(true);
      setCredentialStatus("error", result.message);
      return;
    }

    setCredentialInvalid(false);
    setCredentialStatus("verified", `${providerLabel(provider)} credential verified.`);
  }

  function handleSaveClick() {
    if (!credentialInput || !providerSelect) return;
    const provider = normalizeProvider(providerSelect.value);
    const result = validateCredential(provider, credentialInput.value);
    if (!result.ok) {
      setCredentialInvalid(true);
      setCredentialStatus("error", result.message);
      return;
    }

    localStorage.setItem(credentialStorageKey(provider), result.value);
    setCredentialInvalid(false);
    credentialInput.value = result.value;
    setCredentialStatus("saved", `${providerLabel(provider)} credential saved in this browser.`);
  }

  function handleReset() {
    localStorage.removeItem(STORAGE_KEYS.provider);
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    localStorage.removeItem(STORAGE_KEYS.pikaApiKey);
    localStorage.removeItem(STORAGE_KEYS.budget);
    syncSettingsFromStorage();
  }

  function handleStorageEvent(event) {
    if (!event.key) {
      syncSettingsFromStorage();
      return;
    }

    if (Object.values(STORAGE_KEYS).includes(event.key)) {
      syncSettingsFromStorage();
    }
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

