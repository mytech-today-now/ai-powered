/**
 * @file tests/unit/web-example-info.test.ts
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AiPoweredStub = {
  loadReadmeMarkdown: ReturnType<typeof vi.fn>;
  renderMarkdownToSemanticHtml: ReturnType<typeof vi.fn>;
  sanitizeRenderedHtml: ReturnType<typeof vi.fn>;
};

function renderInfoDom(): void {
  document.body.innerHTML = `
    <div class="info-shell">
      <nav class="info-tabs" role="tablist" aria-label="Info sections">
        <button class="info-tab-btn active" data-info-tab="overview" role="tab" aria-selected="true" type="button">Overview</button>
        <button class="info-tab-btn" data-info-tab="settings-configuration" role="tab" aria-selected="false" type="button">Settings / Configuration</button>
      </nav>
      <main class="info-main">
        <section class="info-panel" data-info-panel="overview" role="tabpanel">
          <article id="readme-article" class="info-article rendered-markdown" aria-live="polite">
            <p id="readme-status">Loading the live README from the repository…</p>
          </article>
        </section>
        <section class="info-panel hidden" data-info-panel="settings-configuration" role="tabpanel">
          <div class="connection-config direct-config">
            <div class="direct-row settings-credential-row">
              <label for="provider-select">Provider:</label>
              <select id="provider-select">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="venice">Venice</option>
                <option value="xai">xAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="pika">Pika</option>
              </select>
              <label for="api-key-input">Credential:</label>
              <input
                id="api-key-input"
                type="password"
                placeholder="Enter the selected provider credential"
                spellcheck="false"
                autocomplete="off"
              />
              <div class="settings-credential-actions">
                <button id="btn-verify-settings" class="btn btn-ghost" type="button">Verify</button>
                <button id="btn-save-settings" class="btn btn-primary" type="button">Save</button>
                <span
                  id="credential-status"
                  class="info-status credential-status"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  data-state="idle"
                >
                  Enter the OpenAI credential, then Verify or Save.
                </span>
              </div>
            </div>
            <div class="direct-row">
              <label for="direct-budget">Budget (USD):</label>
              <input id="direct-budget" type="number" />
            </div>
            <button id="btn-reset-settings" type="button">Reset</button>
            <a class="btn btn-ghost" href="index.html">Open app</a>
            <div class="security-warning">
              ⚠ WARNING: Direct mode exposes your API key in browser DevTools and network traffic.
              Never use a production key here. Use proxy mode in production environments.
            </div>
            <p class="hint">
              Changes are stored locally in this browser and will update the main app in other
              tabs on the same origin.
            </p>
          </div>
        </section>
      </main>
    </div>
  `;
}

async function mountInfoPage(): Promise<void> {
  vi.resetModules();
  await import("../../integrations/web-example/info.js");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getSettingsElements() {
  return {
    providerSelect: document.getElementById("provider-select") as HTMLSelectElement,
    credentialInput: document.getElementById("api-key-input") as HTMLInputElement,
    budgetInput: document.getElementById("direct-budget") as HTMLInputElement,
    verifyButton: document.getElementById("btn-verify-settings") as HTMLButtonElement,
    saveButton: document.getElementById("btn-save-settings") as HTMLButtonElement,
    status: document.getElementById("credential-status") as HTMLSpanElement,
    resetButton: document.getElementById("btn-reset-settings") as HTMLButtonElement,
  };
}

function dispatchStorageEvent(key: string, newValue: string | null): void {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue,
      storageArea: window.localStorage,
      url: window.location.href,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  renderInfoDom();
  Object.defineProperty(window, "AiPowered", {
    configurable: true,
    value: {
      loadReadmeMarkdown: vi.fn().mockResolvedValue("# ai-powered\n\nLive README content."),
      renderMarkdownToSemanticHtml: vi.fn(
        (markdown: string) =>
          `<article class="rendered-markdown"><h1>${markdown.includes("ai-powered") ? "ai-powered" : "README"}</h1><p>Live README content.</p></article>`,
      ),
      sanitizeRenderedHtml: vi.fn((html: string) => html),
    } satisfies AiPoweredStub,
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  delete (window as unknown as { AiPowered?: AiPoweredStub }).AiPowered;
  vi.restoreAllMocks();
});

describe("web-example info page", () => {
  it("renders the live README and exposes the unified credential controls", async () => {
    const aiPowered = (window as unknown as { AiPowered: AiPoweredStub }).AiPowered;

    await mountInfoPage();
    await settle();

    const { providerSelect, credentialInput, verifyButton, saveButton, status } =
      getSettingsElements();

    expect(aiPowered.loadReadmeMarkdown).toHaveBeenCalledOnce();
    expect(aiPowered.renderMarkdownToSemanticHtml).toHaveBeenCalledWith(
      "# ai-powered\n\nLive README content.",
    );
    expect(aiPowered.sanitizeRenderedHtml).toHaveBeenCalled();
    expect(document.getElementById("readme-article")?.innerHTML).toContain("Live README content.");
    expect(document.getElementById("readme-status")).toBeNull();
    expect(document.getElementById("pika-api-key-input")).toBeNull();
    expect(providerSelect.querySelector('option[value="pika"]')).not.toBeNull();
    expect(verifyButton.type).toBe("button");
    expect(saveButton.type).toBe("button");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.dataset.state).toBe("idle");
    expect(status.textContent).toContain("Enter the OpenAI credential, then Verify or Save.");
    expect(document.body.textContent).not.toContain(
      "OpenRouter uses the selected provider credential",
    );
    expect(document.body.textContent).not.toContain(
      "Pika is stored separately for the demo's video workflow settings",
    );
    expect(credentialInput.placeholder).toContain("OpenAI credential");
  });

  it("verifies and saves a provider credential, then clears the field when switching providers", async () => {
    await mountInfoPage();
    await settle();

    const { providerSelect, credentialInput, verifyButton, saveButton, status } =
      getSettingsElements();

    providerSelect.value = "openrouter";
    providerSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(credentialInput.value).toBe("");
    expect(status.dataset.state).toBe("idle");
    expect(status.textContent).toContain("Enter a new OpenRouter credential.");

    credentialInput.value = "sk-or-v1-valid12345";
    credentialInput.dispatchEvent(new Event("input", { bubbles: true }));

    verifyButton.click();
    expect(status.dataset.state).toBe("verified");
    expect(status.textContent).toContain("OpenRouter credential verified.");
    expect(window.localStorage.getItem("ai-powered:direct:api-key")).toBeNull();

    saveButton.click();
    expect(window.localStorage.getItem("ai-powered:direct:api-key")).toBe("sk-or-v1-valid12345");
    expect(status.dataset.state).toBe("saved");
    expect(status.textContent).toContain("OpenRouter credential saved in this browser.");

    providerSelect.value = "pika";
    providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(credentialInput.value).toBe("");
    expect(credentialInput.placeholder).toContain("Pika credential");
    expect(status.dataset.state).toBe("idle");
    expect(status.textContent).toContain("Enter a new Pika credential.");

    providerSelect.value = "openrouter";
    providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(credentialInput.value).toBe("");
    expect(status.dataset.state).toBe("idle");
  });

  it("rejects empty and malformed credentials without saving them", async () => {
    await mountInfoPage();
    await settle();

    const { credentialInput, verifyButton, saveButton, status } = getSettingsElements();

    verifyButton.click();
    expect(status.dataset.state).toBe("error");
    expect(status.textContent).toContain("Enter the OpenAI credential before verifying.");
    expect(credentialInput.getAttribute("aria-invalid")).toBe("true");

    credentialInput.value = "not-a-real-key";
    credentialInput.dispatchEvent(new Event("input", { bubbles: true }));
    saveButton.click();

    expect(status.dataset.state).toBe("error");
    expect(status.textContent).toContain("OpenAI credentials usually start with sk-.");
    expect(window.localStorage.getItem("ai-powered:direct:api-key")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:pika-api-key")).toBeNull();
  });

  it("restores persisted credentials on reload and syncs storage updates from another tab", async () => {
    window.localStorage.setItem("ai-powered:direct:provider", "openrouter");
    window.localStorage.setItem("ai-powered:direct:api-key", "sk-or-v1-persisted");
    window.localStorage.setItem("ai-powered:direct:budget-usd", "3.50");

    await mountInfoPage();
    await settle();

    let { providerSelect, credentialInput, budgetInput, status } = getSettingsElements();
    expect(providerSelect.value).toBe("openrouter");
    expect(credentialInput.value).toBe("sk-or-v1-persisted");
    expect(budgetInput.value).toBe("3.50");
    expect(status.dataset.state).toBe("saved");
    expect(status.textContent).toContain("OpenRouter credential saved in this browser.");

    window.localStorage.setItem("ai-powered:direct:provider", "pika");
    window.localStorage.setItem("ai-powered:direct:pika-api-key", "pika-secret-01");
    dispatchStorageEvent("ai-powered:direct:provider", "pika");
    dispatchStorageEvent("ai-powered:direct:pika-api-key", "pika-secret-01");
    await settle();

    ({ providerSelect, credentialInput, budgetInput, status } = getSettingsElements());
    expect(providerSelect.value).toBe("pika");
    expect(credentialInput.value).toBe("pika-secret-01");
    expect(budgetInput.value).toBe("3.50");
    expect(status.dataset.state).toBe("saved");
    expect(status.textContent).toContain("Pika credential saved in this browser.");

    const resetButton = getSettingsElements().resetButton;
    resetButton.click();
    expect(window.localStorage.getItem("ai-powered:direct:provider")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:api-key")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:pika-api-key")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:budget-usd")).toBeNull();
    expect(getSettingsElements().providerSelect.value).toBe("openai");
    expect(getSettingsElements().credentialInput.value).toBe("");
  });
});
