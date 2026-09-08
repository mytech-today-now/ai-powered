/**
 * @file tests/unit/selective-models-browser.test.ts
 * @vitest-environment jsdom
 *
 * Browser-level regression coverage for the model picker / accepts=image path
 * and structured /models error handling.
 *
 * Mirrors the loadModels() logic from integrations/web-example/app.js:
 *   - only append accepts=image when the selected provider advertises image input
 *   - retry without accepts=image when the filtered list is empty
 *   - keep the Default option present and selected after repopulation
 *   - preserve the current dropdown contents on structured HTTP errors
 *   - surface an inline warning near the affected select for accessible errors
 */

import { afterEach, describe, it, expect } from "vitest";

interface ProviderMeta {
  id: string;
  inputModalities?: string[];
}

interface ModelMeta {
  id: string;
  name?: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function jsonResponse(body: unknown): FetchResponse {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function errorResponse(status: number, body: unknown): FetchResponse {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function providerSupportsInputModality(
  providerId: string,
  inputModality: string,
  allProviders: ProviderMeta[],
): boolean {
  const provider = allProviders.find((p) => p.id === providerId);
  return (
    Array.isArray(provider?.inputModalities) && provider.inputModalities.includes(inputModality)
  );
}

function makeSelect(): HTMLSelectElement {
  return document.createElement("select");
}

function makeModelSelect(initialModels: ModelMeta[] = []): HTMLSelectElement {
  const sel = document.createElement("select");
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default";
  sel.appendChild(defaultOption);
  for (const model of initialModels) {
    const opt = document.createElement("option");
    opt.value = model.id;
    opt.textContent = model.name || model.id;
    sel.appendChild(opt);
  }
  return sel;
}

function makeModelRow(
  selectId: string,
  initialModels: ModelMeta[] = [],
): {
  row: HTMLDivElement;
  select: HTMLSelectElement;
} {
  const row = document.createElement("div");
  row.className = "model-row";

  const label = document.createElement("label");
  label.htmlFor = selectId;
  label.textContent = "Model:";

  const select = makeModelSelect(initialModels);
  select.id = selectId;

  row.append(label, select);
  document.body.appendChild(row);
  return { row, select };
}

function getModelWarningAnchor(selectEl: HTMLSelectElement): HTMLElement | null {
  return selectEl.closest(".model-row, .video-settings-bar");
}

function showModelWarning(selectEl: HTMLSelectElement, message: string): void {
  const anchor = getModelWarningAnchor(selectEl);
  if (!anchor) return;
  const sibling = anchor.nextElementSibling;
  if (sibling && sibling.classList.contains("model-warning")) sibling.remove();

  const p = document.createElement("p");
  p.className = "warn-box model-warning";
  p.setAttribute("role", "status");
  p.setAttribute("aria-live", "polite");
  p.textContent = message;
  anchor.insertAdjacentElement("afterend", p);
}

function clearModelWarning(selectEl: HTMLSelectElement): void {
  const anchor = getModelWarningAnchor(selectEl);
  if (!anchor) return;
  const sibling = anchor.nextElementSibling;
  if (sibling && sibling.classList.contains("model-warning")) sibling.remove();
}

function formatModelWarning(modality: string, provider: string, error: unknown): string {
  const errorRecord =
    error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const code = typeof errorRecord?.code === "string" ? ` (${errorRecord.code})` : "";
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof errorRecord?.message === "string"
          ? errorRecord.message
          : typeof errorRecord?.error === "string"
            ? errorRecord.error
            : "Model list unavailable.";
  return `Could not refresh ${modality} models for ${provider || "default provider"}${code}: ${detail} Keeping the current selection until the server recovers.`;
}

afterEach(() => {
  document.body.innerHTML = "";
});

async function loadModelsLikeApp(
  modality: string,
  selectEl: HTMLSelectElement,
  provider: string,
  hasImageAttached: boolean,
  allProviders: ProviderMeta[],
  fetchImpl: (url: string) => Promise<FetchResponse>,
): Promise<string[]> {
  const base = "http://localhost:3001";
  const acceptsImage =
    hasImageAttached && providerSupportsInputModality(provider, "image", allProviders);
  let url = `${base}/models?modality=${modality}`;
  if (provider) url += `&provider=${provider}`;
  if (acceptsImage) url += "&accepts=image";

  const urls = [url];
  let resp: FetchResponse;
  try {
    resp = await fetchImpl(url);
  } catch {
    clearModelWarning(selectEl);
    if (selectEl.options.length === 1) {
      selectEl.options[0].textContent = "Default (server unreachable)";
    }
    return urls;
  }

  let models: unknown;
  try {
    models = await resp.json();
  } catch {
    if (!resp.ok) {
      showModelWarning(
        selectEl,
        formatModelWarning(modality, provider, {
          error: `Server returned HTTP ${resp.status} while loading models.`,
        }),
      );
    } else {
      showModelWarning(
        selectEl,
        formatModelWarning(modality, provider, {
          error: "Unexpected response while loading models.",
        }),
      );
    }
    return urls;
  }

  if (!resp.ok) {
    showModelWarning(selectEl, formatModelWarning(modality, provider, models));
    return urls;
  }

  if (acceptsImage && Array.isArray(models) && models.length === 0) {
    const fallbackUrl =
      `${base}/models?modality=${modality}` + (provider ? `&provider=${provider}` : "");
    urls.push(fallbackUrl);
    try {
      resp = await fetchImpl(fallbackUrl);
    } catch {
      clearModelWarning(selectEl);
      if (selectEl.options.length === 1) {
        selectEl.options[0].textContent = "Default (server unreachable)";
      }
      return urls;
    }
    try {
      models = await resp.json();
    } catch {
      if (!resp.ok) {
        showModelWarning(
          selectEl,
          formatModelWarning(modality, provider, {
            error: `Server returned HTTP ${resp.status} while loading models.`,
          }),
        );
      } else {
        showModelWarning(
          selectEl,
          formatModelWarning(modality, provider, {
            error: "Unexpected response while loading models.",
          }),
        );
      }
      return urls;
    }
    if (!resp.ok) {
      showModelWarning(selectEl, formatModelWarning(modality, provider, models));
      return urls;
    }
  }

  if (!Array.isArray(models)) {
    showModelWarning(selectEl, formatModelWarning(modality, provider, models));
    return urls;
  }

  clearModelWarning(selectEl);
  selectEl.innerHTML = '<option value="">Default</option>';
  for (const m of models as ModelMeta[]) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name || m.id;
    selectEl.appendChild(opt);
  }

  return urls;
}

describe("loadModels browser regression", () => {
  it("populates the picker when no attachment is present", async () => {
    const select = makeSelect();
    const providers: ProviderMeta[] = [{ id: "venice", inputModalities: ["image"] }];
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse([
        { id: "qwen-2.5-vl", name: "Qwen 2.5 VL" },
        { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
      ]);
    };

    await loadModelsLikeApp("text", select, "venice", false, providers, fetchImpl);

    expect(urls).toEqual(["http://localhost:3001/models?modality=text&provider=venice"]);
    expect(select.options).toHaveLength(3);
    expect(select.options[0]?.value).toBe("");
    expect(select.options[0]?.disabled).toBe(false);
    expect(select.value).toBe("");
    expect([...select.options].map((opt) => opt.textContent)).toEqual([
      "Default",
      "Qwen 2.5 VL",
      "Llama 3.3 70B",
    ]);
  });

  it("retries without accepts=image when the filtered list is empty", async () => {
    const select = makeSelect();
    const providers: ProviderMeta[] = [{ id: "venice", inputModalities: ["image"] }];
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes("accepts=image")) return jsonResponse([]);
      return jsonResponse([
        { id: "qwen-2.5-vl", name: "Qwen 2.5 VL" },
        { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
      ]);
    };

    await loadModelsLikeApp("image", select, "venice", true, providers, fetchImpl);

    expect(urls[0]).toContain("&accepts=image");
    expect(urls[1]).not.toContain("&accepts=image");
    expect(select.options).toHaveLength(3);
    expect(select.options[0]?.value).toBe("");
    expect(select.options[0]?.disabled).toBe(false);
    expect(select.value).toBe("");
  });

  it("skips accepts=image for providers without image input and still populates", async () => {
    const select = makeSelect();
    const providers: ProviderMeta[] = [{ id: "runway", inputModalities: [] }];
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse([{ id: "gen4.5", name: "Runway Gen-4.5" }]);
    };

    await loadModelsLikeApp("video", select, "runway", true, providers, fetchImpl);

    expect(urls).toEqual(["http://localhost:3001/models?modality=video&provider=runway"]);
    expect(urls[0]).not.toContain("accepts=image");
    expect(select.options).toHaveLength(2);
    expect(select.options[0]?.value).toBe("");
    expect(select.options[0]?.disabled).toBe(false);
    expect(select.value).toBe("");
  });

  it("shows an inline provider error for structured 503 payloads", async () => {
    const { row, select } = makeModelRow("structured-model-select", [
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "gpt-4o", name: "GPT-4o" },
    ]);
    select.value = "gpt-4o-mini";
    const initialOptions = [...select.options].map((opt) => opt.value);

    const providers: ProviderMeta[] = [{ id: "openai", inputModalities: ["text"] }];
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return errorResponse(503, {
        error: "Provider could not be constructed.",
        code: "PROVIDER_SETUP_ERROR",
      });
    };

    await loadModelsLikeApp("structured", select, "openai", false, providers, fetchImpl);

    expect(urls).toEqual(["http://localhost:3001/models?modality=structured&provider=openai"]);
    expect([...select.options].map((opt) => opt.value)).toEqual(initialOptions);
    expect(select.value).toBe("gpt-4o-mini");

    const warning = row.nextElementSibling as HTMLElement | null;
    expect(warning).not.toBeNull();
    expect(warning?.classList.contains("model-warning")).toBe(true);
    expect(warning?.getAttribute("role")).toBe("status");
    expect(warning?.getAttribute("aria-live")).toBe("polite");
    expect(warning?.textContent).toContain("PROVIDER_SETUP_ERROR");
    expect(warning?.textContent).toContain("Provider could not be constructed.");
    expect(warning?.textContent).not.toContain("Cannot reach proxy");
  });

  it("still shows the current unreachable-proxy fallback on a true network failure", async () => {
    const { row, select } = makeModelRow("text-model-select");
    const providers: ProviderMeta[] = [];
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      throw new Error("ECONNREFUSED");
    };

    await loadModelsLikeApp("text", select, "openai", false, providers, fetchImpl);

    expect(urls).toEqual(["http://localhost:3001/models?modality=text&provider=openai"]);
    expect(select.options).toHaveLength(1);
    expect(select.options[0]?.textContent).toBe("Default (server unreachable)");
    expect(row.nextElementSibling).toBeNull();
  });

  it("repopulates the audio select normally", async () => {
    const { row, select } = makeModelRow("tts-model-select");
    const providers: ProviderMeta[] = [{ id: "openai", inputModalities: ["text"] }];
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse([
        { id: "tts-1", name: "TTS-1" },
        { id: "tts-1-hd", name: "TTS-1 HD" },
      ]);
    };

    await loadModelsLikeApp("audio", select, "openai", true, providers, fetchImpl);

    expect(urls).toEqual(["http://localhost:3001/models?modality=audio&provider=openai"]);
    expect(urls[0]).not.toContain("accepts=image");
    expect(select.options).toHaveLength(3);
    expect([...select.options].map((opt) => opt.value)).toEqual(["", "tts-1", "tts-1-hd"]);
    expect(row.nextElementSibling).toBeNull();
  });

  it("repopulates the structured select normally", async () => {
    const { row, select } = makeModelRow("structured-model-select");
    const providers: ProviderMeta[] = [{ id: "openai", inputModalities: ["text"] }];
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse([
        { id: "schema-v1", name: "Schema V1" },
        { id: "schema-v2", name: "Schema V2" },
      ]);
    };

    await loadModelsLikeApp("structured", select, "openai", true, providers, fetchImpl);

    expect(urls).toEqual(["http://localhost:3001/models?modality=structured&provider=openai"]);
    expect(urls[0]).not.toContain("accepts=image");
    expect(select.options).toHaveLength(3);
    expect([...select.options].map((opt) => opt.value)).toEqual(["", "schema-v1", "schema-v2"]);
    expect(row.nextElementSibling).toBeNull();
  });
});
