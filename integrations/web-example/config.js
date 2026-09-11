(function () {
  "use strict";

  const STORAGE_KEYS = {
    provider: "ai-powered:direct:provider",
    apiKey: "ai-powered:direct:api-key",
    budget: "ai-powered:direct:budget-usd",
  };

  const providerSelect = document.getElementById("provider-select");
  const apiKeyInput = document.getElementById("api-key-input");
  const directBudgetInput = document.getElementById("direct-budget");
  const statusEl = document.getElementById("config-status");
  const btnBackDemo = document.getElementById("btn-back-demo");
  const btnResetConfig = document.getElementById("btn-reset-config");
  const btnSaveConfig = document.getElementById("btn-save-config");

  function setStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
  }

  function loadFromStorage() {
    if (providerSelect) {
      providerSelect.value = localStorage.getItem(STORAGE_KEYS.provider) || "openai";
    }
    if (apiKeyInput) {
      apiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || "";
    }
    if (directBudgetInput) {
      directBudgetInput.value = localStorage.getItem(STORAGE_KEYS.budget) || "";
    }
  }

  function persistToStorage(message = "Saved locally") {
    if (providerSelect) {
      localStorage.setItem(STORAGE_KEYS.provider, providerSelect.value || "");
    }
    if (apiKeyInput) {
      localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value.trim());
    }
    if (directBudgetInput) {
      localStorage.setItem(STORAGE_KEYS.budget, directBudgetInput.value.trim());
    }
    setStatus(message);
  }

  function resetConfig() {
    localStorage.removeItem(STORAGE_KEYS.provider);
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    localStorage.removeItem(STORAGE_KEYS.budget);
    loadFromStorage();
    setStatus("Reset to defaults");
  }

  if (providerSelect) {
    providerSelect.addEventListener("change", () => persistToStorage());
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", () => persistToStorage());
  }

  if (directBudgetInput) {
    directBudgetInput.addEventListener("input", () => persistToStorage());
  }

  if (btnSaveConfig) {
    btnSaveConfig.addEventListener("click", () => persistToStorage());
  }

  if (btnResetConfig) {
    btnResetConfig.addEventListener("click", resetConfig);
  }

  if (btnBackDemo) {
    btnBackDemo.addEventListener("click", () => {
      window.location.href = "index.html";
    });
  }

  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    if (Object.values(STORAGE_KEYS).includes(event.key)) {
      loadFromStorage();
      setStatus("Synced from another tab");
    }
  });

  loadFromStorage();
})();
