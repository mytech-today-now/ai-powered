/**
 * @file tests/unit/web-example-info.test.ts
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AiPoweredContentStub = {
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
          <div class="connection-config proxy-config">
            <div class="direct-row settings-credential-row">
              <label for="mode-select">Mode:</label>
              <select id="mode-select">
                <option value="proxy">Proxy (recommended)</option>
                <option value="direct">Direct (dev only)</option>
              </select>
              <label for="proxy-url">Proxy URL:</label>
              <input
                id="proxy-url"
                type="text"
                value="http://localhost:3001"
                placeholder="http://localhost:3001"
                spellcheck="false"
              />
            </div>
            <p class="hint">Proxy mode keeps provider keys on the server.</p>
            <label for="caller-credential-type">Caller credential type:</label>
            <select id="caller-credential-type">
              <option value="agent-key">Agent API key</option>
              <option value="bearer">Bearer JWT</option>
              <option value="api-key">Service API key</option>
            </select>
            <label for="caller-credential-input">Caller credential:</label>
            <input id="caller-credential-input" type="password" aria-describedby="caller-credential-status" />
            <button id="btn-save-caller-credential" type="button">Save caller credential</button>
            <button id="btn-clear-caller-credential" type="button">Clear</button>
            <span id="caller-credential-status" role="status" aria-live="polite" aria-atomic="true"></span>
          </div>
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
            <a id="open-app-link" class="btn btn-ghost" href="index.html">Open app</a>
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
  await import("../../integrations/web-example/settings.js");
  await import("../../integrations/web-example/info.js");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getSettingsElements() {
  return {
    modeSelect: document.getElementById("mode-select") as HTMLSelectElement,
    proxyUrlInput: document.getElementById("proxy-url") as HTMLInputElement,
    providerSelect: document.getElementById("provider-select") as HTMLSelectElement,
    credentialInput: document.getElementById("api-key-input") as HTMLInputElement,
    callerCredentialType: document.getElementById("caller-credential-type") as HTMLSelectElement,
    callerCredentialInput: document.getElementById("caller-credential-input") as HTMLInputElement,
    saveCallerCredentialButton: document.getElementById(
      "btn-save-caller-credential",
    ) as HTMLButtonElement,
    clearCallerCredentialButton: document.getElementById(
      "btn-clear-caller-credential",
    ) as HTMLButtonElement,
    callerCredentialStatus: document.getElementById("caller-credential-status") as HTMLSpanElement,
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
  Object.defineProperty(window, "__AI_PROXY_URL__", {
    configurable: true,
    value: "http://localhost:3001",
    writable: true,
  });
  renderInfoDom();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(window, "AiPoweredInfoContent", {
    configurable: true,
    value: {
      loadReadmeMarkdown: vi.fn().mockResolvedValue("# ai-powered\n\nLive README content."),
      renderMarkdownToSemanticHtml: vi.fn(
        (markdown: string) =>
          `<article class="rendered-markdown"><h1>${markdown.includes("ai-powered") ? "ai-powered" : "README"}</h1><p>Live README content.</p></article>`,
      ),
      sanitizeRenderedHtml: vi.fn((html: string) => html),
    } satisfies AiPoweredContentStub,
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  delete (window as unknown as { AiPoweredInfoContent?: AiPoweredContentStub })
    .AiPoweredInfoContent;
  delete (window as unknown as { AiPowered?: unknown }).AiPowered;
  delete (window as unknown as { AiPoweredSettings?: unknown }).AiPoweredSettings;
  delete (window as unknown as { __AI_PROXY_URL__?: string }).__AI_PROXY_URL__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web-example info page", () => {
  it("renders the live README and exposes the unified connection controls", async () => {
    const infoContent = (
      window as unknown as {
        AiPoweredInfoContent: AiPoweredContentStub;
      }
    ).AiPoweredInfoContent;
    expect((window as unknown as { AiPowered?: unknown }).AiPowered).toBeUndefined();

    await mountInfoPage();
    await settle();

    const {
      modeSelect,
      proxyUrlInput,
      providerSelect,
      credentialInput,
      verifyButton,
      saveButton,
      status,
    } = getSettingsElements();

    expect(infoContent.loadReadmeMarkdown).toHaveBeenCalledOnce();
    expect(infoContent.renderMarkdownToSemanticHtml).toHaveBeenCalledWith(
      "# ai-powered\n\nLive README content.",
    );
    expect(infoContent.sanitizeRenderedHtml).toHaveBeenCalled();
    expect(document.getElementById("readme-article")?.innerHTML).toContain("Live README content.");
    expect(document.getElementById("readme-status")).toBeNull();
    expect(document.getElementById("pika-api-key-input")).toBeNull();
    expect(modeSelect.value).toBe("proxy");
    expect(proxyUrlInput.value).toBe("http://localhost:3001");
    expect(modeSelect.querySelector('option[value="proxy"]')).not.toBeNull();
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
    expect(providerSelect.querySelector('option[value="pika"]')).not.toBeNull();
  });

  it("verifies the selected provider against /models before saving the provider-scoped key", async () => {
    const fetchMock = vi.mocked(window.fetch);
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    await mountInfoPage();
    await settle();

    const {
      modeSelect,
      proxyUrlInput,
      providerSelect,
      credentialInput,
      verifyButton,
      saveButton,
      status,
    } = getSettingsElements();

    modeSelect.value = "direct";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(window.localStorage.getItem("ai-powered:connection:mode")).toBe("direct");

    proxyUrlInput.value = "https://ai-powered-proxy.onrender.com";
    proxyUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(window.localStorage.getItem("ai-powered:connection:proxy-url")).toBe(
      "https://ai-powered-proxy.onrender.com",
    );

    providerSelect.value = "openrouter";
    providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(credentialInput.value).toBe("");
    expect(credentialInput.placeholder).toContain("OpenRouter credential");
    expect(status.dataset.state).toBe("idle");
    expect(status.textContent).toContain("Enter the OpenRouter credential, then Verify or Save.");

    credentialInput.value = "sk-or-v1-valid12345";
    credentialInput.dispatchEvent(new Event("input", { bubbles: true }));

    verifyButton.click();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer sk-or-v1-valid12345" },
    });
    expect(status.dataset.state).toBe("verified");
    expect(status.textContent).toContain("OpenRouter credential verified.");
    expect(window.localStorage.getItem("ai-powered:direct:api-key:openrouter")).toBeNull();

    saveButton.click();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("ai-powered:direct:api-key:openrouter")).toBe(
      "sk-or-v1-valid12345",
    );
    expect(status.dataset.state).toBe("saved");
    expect(status.textContent).toContain("OpenRouter credential saved in this browser.");

    providerSelect.value = "pika";
    providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(credentialInput.value).toBe("");
    expect(credentialInput.placeholder).toContain("Pika credential");
    expect(status.dataset.state).toBe("idle");
    expect(status.textContent).toContain("Enter the Pika credential, then Verify or Save.");
  });

  it("rejects empty credentials and leaves failed verifications unsaved", async () => {
    const fetchMock = vi.mocked(window.fetch);
    fetchMock.mockResolvedValue(new Response("", { status: 401, statusText: "Unauthorized" }));

    await mountInfoPage();
    await settle();

    const { credentialInput, verifyButton, status } = getSettingsElements();

    verifyButton.click();
    await settle();
    expect(status.dataset.state).toBe("error");
    expect(status.textContent).toContain("Enter the OpenAI credential before verifying.");
    expect(credentialInput.getAttribute("aria-invalid")).toBe("true");

    credentialInput.value = "not-a-real-key";
    credentialInput.dispatchEvent(new Event("input", { bubbles: true }));
    verifyButton.click();
    await settle();

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer not-a-real-key" },
    });
    expect(status.dataset.state).toBe("error");
    expect(status.textContent).toContain("Unable to verify the OpenAI credential against /models.");
    expect(window.localStorage.getItem("ai-powered:direct:api-key:openai")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:pika-api-key")).toBeNull();
  });

  it("restores persisted settings, syncs storage updates, and resets everything", async () => {
    window.localStorage.setItem("ai-powered:connection:mode", "direct");
    window.localStorage.setItem(
      "ai-powered:connection:proxy-url",
      "https://ai-powered-proxy.onrender.com",
    );
    window.localStorage.setItem("ai-powered:direct:provider", "openrouter");
    window.localStorage.setItem("ai-powered:direct:api-key:openrouter", "sk-or-v1-persisted");
    window.localStorage.setItem("ai-powered:direct:budget-usd", "3.50");

    await mountInfoPage();
    await settle();

    let { modeSelect, proxyUrlInput, providerSelect, credentialInput, budgetInput, status } =
      getSettingsElements();
    expect(modeSelect.value).toBe("direct");
    expect(proxyUrlInput.value).toBe("https://ai-powered-proxy.onrender.com");
    expect(providerSelect.value).toBe("openrouter");
    expect(credentialInput.value).toBe("sk-or-v1-persisted");
    expect(budgetInput.value).toBe("3.50");
    expect(status.dataset.state).toBe("saved");
    expect(status.textContent).toContain("OpenRouter credential saved in this browser.");

    window.localStorage.setItem("ai-powered:connection:mode", "proxy");
    window.localStorage.setItem("ai-powered:connection:proxy-url", "");
    dispatchStorageEvent("ai-powered:connection:mode", "proxy");
    dispatchStorageEvent("ai-powered:connection:proxy-url", "");
    await settle();

    ({ modeSelect, proxyUrlInput, providerSelect, credentialInput, budgetInput, status } =
      getSettingsElements());
    expect(modeSelect.value).toBe("proxy");
    expect(proxyUrlInput.value).toBe("");
    expect(providerSelect.value).toBe("openrouter");
    expect(credentialInput.value).toBe("sk-or-v1-persisted");
    expect(budgetInput.value).toBe("3.50");
    expect(status.dataset.state).toBe("saved");
    expect(status.textContent).toContain("OpenRouter credential saved in this browser.");

    const resetButton = getSettingsElements().resetButton;
    resetButton.click();
    await settle();
    expect(window.localStorage.getItem("ai-powered:connection:mode")).toBe("proxy");
    expect(window.localStorage.getItem("ai-powered:connection:proxy-url")).toBe(
      "http://localhost:3001",
    );
    expect(window.localStorage.getItem("ai-powered:direct:provider")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:api-key:openrouter")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:pika-api-key")).toBeNull();
    expect(window.localStorage.getItem("ai-powered:direct:budget-usd")).toBeNull();
    expect(getSettingsElements().modeSelect.value).toBe("proxy");
    expect(getSettingsElements().proxyUrlInput.value).toBe("http://localhost:3001");
    expect(getSettingsElements().providerSelect.value).toBe("openai");
    expect(getSettingsElements().credentialInput.value).toBe("");
  });

  it("stores caller identity separately and exposes only trusted caller headers", async () => {
    await mountInfoPage();
    await settle();

    const {
      callerCredentialType,
      callerCredentialInput,
      saveCallerCredentialButton,
      callerCredentialStatus,
    } = getSettingsElements();
    callerCredentialType.value = "api-key";
    callerCredentialInput.value = "service-caller-secret";
    callerCredentialInput.dispatchEvent(new Event("input", { bubbles: true }));
    saveCallerCredentialButton.click();
    await settle();

    expect(window.localStorage.getItem("ai-powered:proxy:caller-credential")).toBe(
      "service-caller-secret",
    );
    expect(window.localStorage.getItem("ai-powered:proxy:caller-credential-type")).toBe("api-key");
    expect(callerCredentialStatus.getAttribute("role")).toBe("status");
    expect(callerCredentialInput.getAttribute("aria-describedby")).toContain(
      "caller-credential-status",
    );

    const settings = (
      window as unknown as {
        AiPoweredSettings: {
          proxyHeaders: (provider: string, proxyUrl: string) => Record<string, string>;
        };
      }
    ).AiPoweredSettings;
    expect(settings.proxyHeaders("openai", "http://localhost:3001")).toMatchObject({
      "X-AI-API-Key": "service-caller-secret",
    });
    expect(settings.proxyHeaders("openai", "https://untrusted.example")).toEqual({
      "Content-Type": "application/json",
    });
    expect(
      JSON.stringify(settings.proxyHeaders("openai", "https://untrusted.example")),
    ).not.toContain("service-caller-secret");
  });

  it("keeps the settings return link same-origin and relative", async () => {
    window.history.replaceState(
      null,
      "",
      "/info.html?returnTo=%2Findex.html%3Ftab%3Dvideo%23single%26prompt%3Dkept#settings-configuration",
    );
    await mountInfoPage();
    await settle();

    const link = document.getElementById("open-app-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/index.html?tab=video#single&prompt=kept");
    expect(new URL(link.href).origin).toBe(window.location.origin);
  });
});
