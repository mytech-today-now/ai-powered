/**
 * integrations/web-example/main.js
 *
 * Minimal demo wired to the Vite dev server (npm run dev:web).
 * `ai-powered/web` is resolved via the alias in vite.config.ts:
 *   → src/ai-powered/web/index.ts  (with HMR in dev, built bundle in prod)
 */

import { createWebClient } from "ai-powered/web";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const proxyUrlInput = /** @type {HTMLInputElement} */ (document.getElementById("proxy-url"));
const promptInput   = /** @type {HTMLTextAreaElement} */ (document.getElementById("prompt"));
const btnGenerate   = /** @type {HTMLButtonElement} */ (document.getElementById("btn-generate"));
const btnStream     = /** @type {HTMLButtonElement} */ (document.getElementById("btn-stream"));
const output        = /** @type {HTMLDivElement} */ (document.getElementById("output"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClient() {
  return createWebClient({
    mode: "proxy",
    proxyUrl: proxyUrlInput.value.trim() || "http://localhost:3001",
  });
}

function setLoading(loading) {
  btnGenerate.disabled = loading;
  btnStream.disabled   = loading;
}

// ---------------------------------------------------------------------------
// Generate (non-streaming)
// ---------------------------------------------------------------------------

btnGenerate.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) { output.textContent = "Please enter a prompt."; return; }

  setLoading(true);
  output.textContent = "Generating…";

  try {
    const client = getClient();
    const result = await client.generateText(prompt);
    output.textContent = result.content;
  } catch (err) {
    output.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    setLoading(false);
  }
});

// ---------------------------------------------------------------------------
// Stream (SSE via /stream endpoint)
// ---------------------------------------------------------------------------

btnStream.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) { output.textContent = "Please enter a prompt."; return; }

  setLoading(true);
  output.textContent = "";

  try {
    const proxyUrl = proxyUrlInput.value.trim() || "http://localhost:3001";
    const res = await fetch(`${proxyUrl}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok) {
      const body = await res.text();
      output.textContent = `Server error ${res.status}: ${body.slice(0, 300)}`;
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { output.textContent = "No response body."; return; }

    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;
        try {
          const evt = JSON.parse(payload);
          if (typeof evt.delta === "string") output.textContent += evt.delta;
        } catch {
          // ignore malformed SSE
        }
      }
    }
  } catch (err) {
    output.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    setLoading(false);
  }
});

