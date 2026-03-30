/**
 * integrations/web-example/app.js
 *
 * Self-contained demo for the ai-powered/web UMD bundle.
 * No build step required — loaded after dist-web/ai-powered.umd.js.
 *
 * window.AiPowered exposes: createWebClient, __WEB_MODULE_VERSION__
 */
(function () {
  "use strict";

  /* ── Guard: UMD bundle must be loaded first ─────────────── */
  if (
    typeof window.AiPowered === "undefined" ||
    typeof window.AiPowered.createWebClient !== "function"
  ) {
    document.body.innerHTML =
      '<div style="padding:2rem;color:#b91c1c;font-family:monospace">' +
      "<strong>Error:</strong> UMD bundle not found.<br>" +
      "Run <code>npm run build:web</code> to generate " +
      "<code>dist-web/ai-powered.umd.js</code>, then reload.</div>";
    return;
  }

  const { createWebClient } = window.AiPowered;

  /* ── DOM references ─────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);

  const libVersionEl       = $("lib-version");
  const modeSelect         = $("mode-select");
  const proxyConfig        = $("proxy-config");
  const directConfig       = $("direct-config");
  const proxyUrlInput         = $("proxy-url");
  const proxyProviderSelect   = $("proxy-provider-select");
  const providerSelect        = $("provider-select");
  const apiKeyInput           = $("api-key-input");

  const tabBtns            = document.querySelectorAll(".tab-btn");
  const tabPanels          = document.querySelectorAll(".tab-panel");

  const textPromptEl       = $("text-prompt");
  const btnTextGenerate    = $("btn-text-generate");
  const btnTextStream      = $("btn-text-stream");
  const textOutput         = $("text-output");
  const textUsage          = $("text-usage");
  const sessionHistory     = $("session-history");
  const btnSessionClear    = $("btn-session-clear");

  const imagePromptEl      = $("image-prompt");
  const btnImageGenerate   = $("btn-image-generate");
  const imageOutput        = $("image-output");
  const imageUsage         = $("image-usage");

  const ttsTextEl          = $("tts-text");
  const btnTtsSpeak        = $("btn-tts-speak");
  const ttsOutput          = $("tts-output");
  const audioFileInput     = $("audio-file-input");
  const audioFilename      = $("audio-filename");
  const btnTranscribe      = $("btn-transcribe");
  const transcribeOutput   = $("transcribe-output");
  const audioUsage         = $("audio-usage");

  const videoPromptEl      = $("video-prompt");
  const btnVideoGenerate   = $("btn-video-generate");
  const videoOutput        = $("video-output");
  const videoUsage         = $("video-usage");

  // Batch UI elements
  const batchDropZone      = $("batch-drop-zone");
  const batchFileInput     = $("batch-file-input");
  const batchFilename      = $("batch-filename");
  const batchPreflight     = $("batch-preflight");
  const batchSummary       = $("batch-summary");
  const btnBatchClear      = $("btn-batch-clear");
  const btnBatchRun        = $("btn-batch-run");
  const batchProgress      = $("batch-progress");
  const batchProgressLabel = $("batch-progress-label");
  const batchProgressCtr   = $("batch-progress-counter");
  const batchProgressBar   = $("batch-progress-bar");
  const batchResults       = $("batch-results");
  const batchShots         = $("batch-shots");
  const btnDownloadResults = $("btn-download-results");
  const btnDownloadZip     = $("btn-download-zip");

  const structuredPromptEl    = $("structured-prompt");
  const btnStructuredGenerate = $("btn-structured-generate");
  const structuredOutput      = $("structured-output");
  const structuredUsage       = $("structured-usage");

  // Per-tab model selects (proxy mode)
  const textModelSelect       = $("text-model-select");
  const imageModelSelect      = $("image-model-select");
  const ttsModelSelect        = $("tts-model-select");
  const transcribeModelSelect = $("transcribe-model-select");
  const videoModelSelect      = $("video-model-select");
  const structuredModelSelect = $("structured-model-select");

  const costTotalEl        = $("cost-total");
  const tokensTotalEl      = $("tokens-total");
  const callsTotalEl       = $("calls-total");

  /* ── Provider cache (populated by loadProviders) ────────── */
  let allProviders = []; // All providers from /providers, including inactive

  /** Modality that each tab represents. */
  const TAB_MODALITY = {
    text:       "text",
    image:      "image",
    audio:      "audio",
    video:      "video",
    structured: "structured",
  };

  /** Returns the data-tab value of the currently active tab button. */
  function activeTab() {
    const btn = [...tabBtns].find((b) => b.classList.contains("active"));
    return btn ? btn.dataset.tab : "text";
  }

  /**
   * Repopulates the provider dropdown to only show providers that support
   * the given modality.  Mock is always shown when it supports the modality,
   * even if the server reports it as inactive (it needs no API key).
   * Preserves the current selection if it is still valid.
   */
  function refreshProviderDropdown(modality) {
    const prev = proxyProviderSelect.value;
    proxyProviderSelect.innerHTML = '<option value="">Default</option>';
    const compatible = allProviders.filter(
      (p) => Array.isArray(p.modalities) && p.modalities.includes(modality),
    );
    compatible.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.active ? p.name + " ★" : p.name;
      opt.title = p.active ? "API key configured" : "No API key set — add to .env to enable";
      proxyProviderSelect.appendChild(opt);
    });
    // Preserve previous selection if still in the list, otherwise reset to Default
    if ([...proxyProviderSelect.options].some((o) => o.value === prev)) {
      proxyProviderSelect.value = prev;
    }
  }

  /* ── Cost / usage tracking ──────────────────────────────── */
  let totalCost   = 0;
  let totalTokens = 0;
  let totalCalls  = 0;

  /**
   * Accumulate usage and cost for a completed call.
   *
   * @param {object|null} usage - Usage object from the server (may be null for streaming).
   * @param {object|null} cost  - CostBreakdown from the server: { totalUsd, isEstimate }.
   *                             When provided, totalUsd is used directly.  This is model-
   *                             and modality-aware (video → perVideoUsd, image → perImageUsd,
   *                             audio → perMinuteUsd, text → per-token rate).
   */
  function addUsage(usage, cost) {
    totalCalls++;
    if (usage && usage.totalTokens) {
      totalTokens += usage.totalTokens;
    }
    if (cost && typeof cost.totalUsd === "number") {
      totalCost += cost.totalUsd;
    }
    costTotalEl.textContent   = "$" + totalCost.toFixed(6);
    tokensTotalEl.textContent = totalTokens.toLocaleString();
    callsTotalEl.textContent  = totalCalls.toString();
  }

  /* ── Client factory ─────────────────────────────────────── */
  function getClient() {
    if (modeSelect.value === "proxy") {
      return createWebClient({
        mode: "proxy",
        proxyUrl: proxyUrlInput.value.trim() || "http://localhost:3001",
      });
    }
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) throw new Error("API key is required for Direct mode.");
    return createWebClient({
      mode: "direct",
      provider: providerSelect.value,
      apiKey,
    });
  }

  /* ── UI helpers ─────────────────────────────────────────── */
  function setLoading(buttons, loading) {
    [].concat(buttons).forEach((b) => { if (b) b.disabled = loading; });
  }

  function showSpinner(el, msg) {
    el.innerHTML = "";
    const s = document.createElement("span");
    s.className   = "spinner-msg";
    s.textContent = msg || "Working…";
    el.appendChild(s);
  }

  function showError(el, err) {
    el.innerHTML = "";
    const s = document.createElement("span");
    s.className   = "error-msg";
    s.textContent = "Error: " + (err instanceof Error ? err.message : String(err));
    el.appendChild(s);
  }

  /**
   * Render usage + cost metadata beneath a result panel.
   *
   * @param {HTMLElement|null} el    - Target element.
   * @param {object|null}      usage - TokenUsage (may be zeroed for video/image).
   * @param {object|null}      cost  - CostBreakdown { totalUsd, isEstimate }.
   */
  function setUsageText(el, usage, cost) {
    if (!el) return;
    const parts = [];
    if (usage) {
      parts.push(
        "Tokens: " + usage.totalTokens +
        " (↑" + usage.promptTokens + " ↓" + usage.completionTokens + ")",
      );
    }
    if (cost && typeof cost.totalUsd === "number") {
      parts.push(
        "Cost: $" + cost.totalUsd.toFixed(6) +
        (cost.isEstimate ? " (est.)" : ""),
      );
    }
    el.textContent = parts.join(" · ");
  }

  /* ── JSON syntax highlighter ────────────────────────────── */
  function highlightJson(json) {
    return json
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(
        /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
        (m) => {
          const cls =
            /^"/.test(m)    ? (/:$/.test(m) ? "json-key" : "json-string")
            : /true|false/.test(m) ? "json-bool"
            : /null/.test(m)       ? "json-null"
            : "json-number";
          return '<span class="' + cls + '">' + m + "</span>";
        }
      );
  }

  function renderJson(el, data) {
    el.innerHTML = "";
    try {
      const pre  = document.createElement("pre");
      pre.className = "json-pre";
      const code = document.createElement("code");
      code.innerHTML = highlightJson(JSON.stringify(data, null, 2));
      pre.appendChild(code);
      el.appendChild(pre);
    } catch (_) {
      el.textContent = String(data);
    }
  }

  /* ── Blob → object-URL helpers (revoke old one) ─────────── */
  const _urls = { image: null, audio: null, video: null };
  function blobUrl(type, blob) {
    if (_urls[type]) URL.revokeObjectURL(_urls[type]);
    _urls[type] = URL.createObjectURL(blob);
    return _urls[type];
  }

  /* ── Data URI / base64 → Blob helpers ──────────────────── */
  function dataUriToBlob(dataUri) {
    const [header, data] = dataUri.split(",");
    const mime = header.match(/:(.*?);/)[1];
    return base64ToBlob(data, mime);
  }

  function base64ToBlob(b64, mimeType) {
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mimeType });
  }

  /* ── Proxy fetch helpers ─────────────────────────────────── */
  async function proxyPost(endpoint, body) {
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    const provider = proxyProviderSelect.value || undefined;
    const payload = { ...body };
    if (provider && !payload.provider) payload.provider = provider;
    const resp = await fetch(base + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let msg = resp.statusText;
      try { const j = await resp.json(); msg = j.error || msg; } catch (_) {}
      throw new Error("HTTP " + resp.status + " " + resp.statusText + ": " + JSON.stringify({ error: msg }));
    }
    return resp.json();
  }

  async function loadModels(modality, selectEl) {
    try {
      const base = proxyUrlInput.value.trim() || "http://localhost:3001";
      const provider = proxyProviderSelect.value;
      let url = base + "/models?modality=" + modality;
      if (provider) url += "&provider=" + provider;
      const models = await fetch(url).then((r) => r.json());
      selectEl.innerHTML = '<option value="">Default</option>';
      models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        selectEl.appendChild(opt);
      });
    } catch (_) { /* server not running — leave as Default */ }
  }

  async function loadAllModels() {
    if (modeSelect.value !== "proxy") return;
    await Promise.all([
      loadModels("text",       textModelSelect),
      loadModels("image",      imageModelSelect),
      loadModels("audio",      ttsModelSelect),
      loadModels("audio",      transcribeModelSelect),
      loadModels("video",      videoModelSelect),
      loadModels("structured", structuredModelSelect),
    ]);
  }

  async function loadProviders() {
    if (modeSelect.value !== "proxy") return;
    try {
      const base = proxyUrlInput.value.trim() || "http://localhost:3001";
      const data = await fetch(base + "/providers").then((r) => r.json());
      allProviders = data; // cache full list (including inactive) for modality filtering
      refreshProviderDropdown(TAB_MODALITY[activeTab()] ?? "text");
    } catch (_) { /* server not running — keep Default */ }
    await loadAllModels();
  }

  /* ── Mode toggle ─────────────────────────────────────────── */
  function applyModeUi() {
    const isProxy = modeSelect.value === "proxy";
    proxyConfig.classList.toggle("hidden", !isProxy);
    directConfig.classList.toggle("hidden", isProxy);
    if (isProxy) loadProviders();
  }
  modeSelect.addEventListener("change", applyModeUi);

  // Reload providers when proxy URL changes (debounced)
  let _proxyUrlTimer = null;
  proxyUrlInput.addEventListener("input", () => {
    clearTimeout(_proxyUrlTimer);
    _proxyUrlTimer = setTimeout(loadProviders, 600);
  });

  // Reload models when provider selection changes
  proxyProviderSelect.addEventListener("change", loadAllModels);

  applyModeUi();

  /* ── Tab switching ───────────────────────────────────────── */
  function switchTab(target) {
    tabBtns.forEach((b) => {
      const on = b.dataset.tab === target;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    tabPanels.forEach((p) => p.classList.toggle("hidden", p.id !== "panel-" + target));

    // Update provider dropdown to only show providers that support this tab's modality.
    // Then reload models so the model selects reflect the (possibly new) provider.
    if (modeSelect.value === "proxy" && allProviders.length > 0) {
      refreshProviderDropdown(TAB_MODALITY[target] ?? "text");
      loadAllModels();
    }
  }
  tabBtns.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  /* ── Library version badge ───────────────────────────────── */
  const ver = window.AiPowered.__WEB_MODULE_VERSION__;
  libVersionEl.textContent = ver ? "v" + ver : "UMD";

  /* ── Session history (Text tab) ──────────────────────────── */
  const SESSION_KEY = "ai-demo-session";

  function getSessionMessages() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]"); }
    catch (_) { return []; }
  }

  function saveSessionMessages(msgs) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(msgs));
  }

  function addBubble(role, content) {
    const wrap = document.createElement("div");
    wrap.className = "bubble bubble-" + role;
    const lbl = document.createElement("span");
    lbl.className   = "bubble-label";
    lbl.textContent = role === "user" ? "You" : "Assistant";
    const p = document.createElement("p");
    p.textContent = content;
    wrap.appendChild(lbl);
    wrap.appendChild(p);
    sessionHistory.appendChild(wrap);
    sessionHistory.scrollTop = sessionHistory.scrollHeight;
    return p; // for streaming updates
  }

  function renderSessionHistory() {
    sessionHistory.innerHTML = "";
    getSessionMessages().forEach((m) => addBubble(m.role, m.content));
  }

  function appendSession(role, content) {
    const msgs = getSessionMessages();
    msgs.push({ role, content });
    saveSessionMessages(msgs);
  }

  function buildHistoryPrompt() {
    return getSessionMessages()
      .map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.content)
      .join("\n");
  }

  btnSessionClear.addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionHistory.innerHTML = "";
    textOutput.innerHTML = "";
    textUsage.textContent = "";
  });

  // Restore history on load
  renderSessionHistory();

  /* ── TEXT TAB ─────────────────────────────────────────────── */
  async function handleTextGenerate() {
    const prompt = textPromptEl.value.trim();
    if (!prompt) return;
    setLoading([btnTextGenerate, btnTextStream], true);
    showSpinner(textOutput, "Generating…");
    textUsage.textContent = "";

    appendSession("user", prompt);
    addBubble("user", prompt);

    try {
      const fullPrompt = buildHistoryPrompt();
      let result;
      if (modeSelect.value === "proxy") {
        const model = textModelSelect.value || undefined;
        result = await proxyPost("/text", { prompt: fullPrompt, model });
      } else {
        result = await getClient().generateText(fullPrompt);
      }
      const reply = result.content;

      appendSession("assistant", reply);
      addBubble("assistant", reply);

      textOutput.innerHTML = "";
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent  = reply;
      textOutput.appendChild(p);

      setUsageText(textUsage, result.usage, result.cost);
      addUsage(result.usage, result.cost);
    } catch (err) {
      showError(textOutput, err);
    } finally {
      setLoading([btnTextGenerate, btnTextStream], false);
    }
  }

  async function handleTextStream() {
    const prompt = textPromptEl.value.trim();
    if (!prompt) return;
    setLoading([btnTextGenerate, btnTextStream], true);
    textOutput.innerHTML = "";
    textUsage.textContent = "";

    appendSession("user", prompt);
    addBubble("user", prompt);
    const assistantP = addBubble("assistant", "");

    const outP = document.createElement("p");
    outP.style.margin = "0";
    textOutput.appendChild(outP);

    let accumulated = "";
    try {
      const fullPrompt = buildHistoryPrompt();
      if (modeSelect.value === "proxy") {
        const base = proxyUrlInput.value.trim() || "http://localhost:3001";
        const provider = proxyProviderSelect.value || undefined;
        const model    = textModelSelect.value    || undefined;
        const payload  = { prompt: fullPrompt, stream: true };
        if (provider) payload.provider = provider;
        if (model)    payload.model    = model;
        const resp = await fetch(base + "/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          let msg = resp.statusText;
          try { const j = await resp.json(); msg = j.error || msg; } catch (_) {}
          throw new Error("HTTP " + resp.status + " " + resp.statusText + ": " + JSON.stringify({ error: msg }));
        }
        const reader = resp.body.getReader();
        const dec    = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += dec.decode(value, { stream: true });
          outP.textContent       = accumulated;
          assistantP.textContent = accumulated;
          sessionHistory.scrollTop = sessionHistory.scrollHeight;
        }
      } else {
        for await (const chunk of getClient().streamText(fullPrompt)) {
          accumulated += chunk;
          outP.textContent       = accumulated;
          assistantP.textContent = accumulated;
          sessionHistory.scrollTop = sessionHistory.scrollHeight;
        }
      }
      appendSession("assistant", accumulated);
      addUsage(null, null); // streaming — no cost breakdown available
    } catch (err) {
      showError(textOutput, err);
      assistantP.textContent = "[error]";
    } finally {
      setLoading([btnTextGenerate, btnTextStream], false);
    }
  }

  btnTextGenerate.addEventListener("click", handleTextGenerate);
  btnTextStream.addEventListener("click", handleTextStream);

  /* ── IMAGE TAB ───────────────────────────────────────────── */
  async function handleImageGenerate() {
    const prompt = imagePromptEl.value.trim();
    if (!prompt) return;
    setLoading([btnImageGenerate], true);
    showSpinner(imageOutput, "Generating image…");
    imageUsage.textContent = "";
    try {
      let blob;
      let imgResult = null;
      if (modeSelect.value === "proxy") {
        imgResult = await proxyPost("/image", { prompt, model: imageModelSelect.value || undefined });
        blob = dataUriToBlob(imgResult.data);
      } else {
        blob = await getClient().generateImage(prompt);
      }
      const url = blobUrl("image", blob);
      imageOutput.innerHTML = "";
      const img = document.createElement("img");
      img.className = "output-image";
      img.alt = prompt;
      img.src = url;
      imageOutput.appendChild(img);
      addUsage(imgResult?.usage ?? null, imgResult?.cost ?? null);
      setUsageText(imageUsage, imgResult?.usage ?? null, imgResult?.cost ?? null);
      if (!imgResult?.usage?.totalTokens && !imgResult?.cost) {
        imageUsage.textContent = "Image generated · " + Math.round(blob.size / 1024) + " KB";
      } else {
        imageUsage.textContent += " · " + Math.round(blob.size / 1024) + " KB";
      }
    } catch (err) {
      showError(imageOutput, err);
    } finally {
      setLoading([btnImageGenerate], false);
    }
  }
  btnImageGenerate.addEventListener("click", handleImageGenerate);

  /* ── AUDIO TAB — TTS ─────────────────────────────────────── */
  async function handleTtsSpeak() {
    const text = ttsTextEl.value.trim();
    if (!text) return;
    setLoading([btnTtsSpeak], true);
    showSpinner(ttsOutput, "Synthesizing speech…");
    try {
      let blob;
      let ttsResult = null;
      if (modeSelect.value === "proxy") {
        ttsResult = await proxyPost("/audio/speak", { text, model: ttsModelSelect.value || undefined });
        blob = base64ToBlob(ttsResult.audio, ttsResult.mimeType || "audio/mpeg");
      } else {
        blob = await getClient().synthesizeSpeech(text);
      }
      const url = blobUrl("audio", blob);
      ttsOutput.innerHTML = "";
      const audio = document.createElement("audio");
      audio.className = "output-audio";
      audio.controls  = true;
      audio.src       = url;
      ttsOutput.appendChild(audio);
      audio.play().catch(() => {});
      addUsage(ttsResult?.usage ?? null, ttsResult?.cost ?? null);
      setUsageText(audioUsage, ttsResult?.usage ?? null, ttsResult?.cost ?? null);
      if (!ttsResult?.cost) {
        audioUsage.textContent = "Audio · " + Math.round(blob.size / 1024) + " KB";
      } else {
        audioUsage.textContent += " · " + Math.round(blob.size / 1024) + " KB";
      }
    } catch (err) {
      showError(ttsOutput, err);
    } finally {
      setLoading([btnTtsSpeak], false);
    }
  }
  btnTtsSpeak.addEventListener("click", handleTtsSpeak);

  /* ── AUDIO TAB — File transcription ─────────────────────── */
  let selectedAudioBlob = null;
  audioFileInput.addEventListener("change", () => {
    const file = audioFileInput.files[0];
    if (!file) { selectedAudioBlob = null; btnTranscribe.disabled = true; return; }
    selectedAudioBlob = file;
    audioFilename.textContent = file.name + " (" + Math.round(file.size / 1024) + " KB)";
    btnTranscribe.disabled = false;
  });

  async function handleTranscribe() {
    if (!selectedAudioBlob) return;
    setLoading([btnTranscribe], true);
    showSpinner(transcribeOutput, "Transcribing…");
    try {
      let text;
      let transcribeResult = null;
      if (modeSelect.value === "proxy") {
        const audioBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(selectedAudioBlob);
        });
        transcribeResult = await proxyPost("/audio/transcribe", {
          audioBase64,
          model: transcribeModelSelect.value || undefined,
        });
        text = transcribeResult.text;
      } else {
        text = await getClient().transcribeAudio(selectedAudioBlob);
      }
      transcribeOutput.innerHTML = "";
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent  = text;
      transcribeOutput.appendChild(p);
      addUsage(transcribeResult?.usage ?? null, transcribeResult?.cost ?? null);
      setUsageText(audioUsage, transcribeResult?.usage ?? null, transcribeResult?.cost ?? null);
    } catch (err) {
      showError(transcribeOutput, err);
    } finally {
      setLoading([btnTranscribe], false);
    }
  }
  btnTranscribe.addEventListener("click", handleTranscribe);

  /* ── BATCH STATE ─────────────────────────────────────────── */
  /** Array of parsed shot items: { name, prompt, modality? } */
  let batchItems = [];
  /** Array of completed result objects from the NDJSON stream. */
  let batchResultItems = [];

  /* ── BATCH FILE PARSERS ───────────────────────────────────── */

  /**
   * Parse a JSON/JSONL file into an array of shot items.
   * Accepts:
   *  - JSON array of objects with at least a `prompt` field
   *  - JSON object with a `shots` or `items` array
   *  - JSONL (one JSON object per line)
   */
  function parseJsonFile(text) {
    const items = [];
    const trimmed = text.trim();
    // Try as a JSON value first
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed)
          ? parsed
          : (parsed.shots || parsed.items || [parsed]);
        for (const entry of arr) {
          const prompt = String(entry.prompt || entry.description || entry.text || "").trim();
          if (prompt) {
            items.push({
              name: String(entry.name || entry.shot || entry.title || ("Shot " + (items.length + 1))).trim(),
              prompt,
              modality: String(entry.modality || "video"),
            });
          }
        }
        return items;
      } catch (_) { /* fall through to JSONL */ }
    }
    // JSONL: one JSON object per line
    for (const line of trimmed.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      try {
        const entry = JSON.parse(l);
        const prompt = String(entry.prompt || entry.description || entry.text || "").trim();
        if (prompt) {
          items.push({
            name: String(entry.name || entry.shot || ("Shot " + (items.length + 1))).trim(),
            prompt,
            modality: String(entry.modality || "video"),
          });
        }
      } catch (_) { /* skip invalid lines */ }
    }
    return items;
  }

  /**
   * Parse a Markdown shot-list file.
   * Looks for headings as shot names and paragraph text as prompts.
   * Pattern: ## Shot N\nPrompt text…
   */
  function parseMdFile(text) {
    const items = [];
    const lines = text.split("\n");
    let currentName = null;
    let promptLines = [];

    function flush() {
      if (!currentName) return;
      const prompt = promptLines.join(" ").replace(/\s+/g, " ").trim();
      if (prompt) items.push({ name: currentName, prompt, modality: "video" });
      promptLines = [];
    }

    for (const raw of lines) {
      const line = raw.trim();
      const headingMatch = line.match(/^#{1,4}\s+(.+)/);
      if (headingMatch) {
        flush();
        currentName = headingMatch[1].trim();
      } else if (line && currentName !== null) {
        // Skip horizontal rules and metadata
        if (/^---+$/.test(line) || /^\*\*[^*]+\*\*:/.test(line)) continue;
        promptLines.push(line);
      }
    }
    flush();

    // Fallback: if no headings found, treat each non-empty line as a prompt
    if (items.length === 0) {
      for (const raw of lines) {
        const line = raw.trim();
        if (line && !line.startsWith("#")) {
          items.push({ name: "Shot " + (items.length + 1), prompt: line, modality: "video" });
        }
      }
    }
    return items;
  }

  /** Read a File and parse it into batchItems based on extension. */
  function loadBatchFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const text = reader.result;
        const ext = file.name.split(".").pop().toLowerCase();
        try {
          const items = ext === "md" ? parseMdFile(text) : parseJsonFile(text);
          resolve(items);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  }

  /* ── BATCH UI HELPERS ─────────────────────────────────────── */

  function showBatchPreflight(items) {
    batchPreflight.classList.remove("hidden");
    batchProgress.classList.add("hidden");
    batchResults.classList.add("hidden");
    batchSummary.innerHTML = "";

    if (!items.length) {
      batchSummary.innerHTML = "<span style='color:var(--danger)'>No valid shots found in file.</span>";
      btnBatchRun.disabled = true;
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "shot-preview-list";
    items.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "shot-preview-item";
      const modality = item.modality || "text";
      li.textContent = (i + 1) + ". " + item.name + " [" + modality + "]";
      const em = document.createElement("em");
      em.textContent = item.prompt.length > 80 ? item.prompt.slice(0, 80) + "…" : item.prompt;
      li.appendChild(em);
      ul.appendChild(li);
    });
    const p = document.createElement("p");
    p.innerHTML = "<strong>" + items.length + " shot" + (items.length !== 1 ? "s" : "") + "</strong> loaded and ready to process.";
    batchSummary.appendChild(p);
    batchSummary.appendChild(ul);
    btnBatchRun.disabled = false;
  }

  function clearBatch() {
    batchItems = [];
    batchResultItems = [];
    batchFileInput.value = "";
    batchFilename.textContent = "No file selected";
    batchPreflight.classList.add("hidden");
    batchProgress.classList.add("hidden");
    batchResults.classList.add("hidden");
    batchShots.innerHTML = "";
    batchSummary.innerHTML = "";
    btnBatchRun.disabled = true;
  }

  /* ── DROP ZONE WIRE-UP ────────────────────────────────────── */

  batchDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    batchDropZone.classList.add("drag-over");
  });
  batchDropZone.addEventListener("dragleave", () => {
    batchDropZone.classList.remove("drag-over");
  });
  batchDropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    batchDropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (!file) return;
    batchFilename.textContent = file.name;
    try {
      batchItems = await loadBatchFile(file);
      showBatchPreflight(batchItems);
    } catch (err) {
      batchSummary.innerHTML = "<span style='color:var(--danger)'>Parse error: " + (err.message || err) + "</span>";
      batchPreflight.classList.remove("hidden");
    }
  });
  batchFileInput.addEventListener("change", async () => {
    const file = batchFileInput.files[0];
    if (!file) return;
    batchFilename.textContent = file.name;
    try {
      batchItems = await loadBatchFile(file);
      showBatchPreflight(batchItems);
    } catch (err) {
      batchSummary.innerHTML = "<span style='color:var(--danger)'>Parse error: " + (err.message || err) + "</span>";
      batchPreflight.classList.remove("hidden");
    }
  });
  btnBatchClear.addEventListener("click", clearBatch);

  /* ── SHOT CARD RENDERER ───────────────────────────────────── */

  function renderShotCard(result) {
    const card = document.createElement("div");
    card.className = "shot-card";
    card.id = "shot-card-" + result.index;

    const hdr = document.createElement("div");
    hdr.className = "shot-card-header";
    const title = document.createElement("span");
    title.className = "shot-card-title";
    title.textContent = (result.name || ("Shot " + (result.index + 1)));
    const meta = document.createElement("span");
    meta.className = "shot-card-meta";
    meta.textContent = result.status === "ok" ? "✓ Generated" : "✗ Error";
    meta.style.color = result.status === "ok" ? "#16a34a" : "var(--danger)";
    hdr.appendChild(title);
    hdr.appendChild(meta);
    card.appendChild(hdr);

    const body = document.createElement("div");
    body.className = "shot-card-body";

    const promptEl = document.createElement("p");
    promptEl.className = "shot-prompt";
    promptEl.textContent = result.prompt;
    body.appendChild(promptEl);

    if (result.status === "error") {
      const errEl = document.createElement("p");
      errEl.className = "shot-error";
      errEl.textContent = "Error: " + result.error;
      body.appendChild(errEl);
    } else if (result.modality === "video" && result.result?.data) {
      const blob = dataUriToBlob(result.result.data);
      const url  = URL.createObjectURL(blob);
      const vid  = document.createElement("video");
      vid.className = "shot-video";
      vid.controls  = true;
      vid.src       = url;
      body.appendChild(vid);

      const actions = document.createElement("div");
      actions.className = "shot-actions";
      const dlLink = document.createElement("a");
      dlLink.className  = "shot-dl-link";
      dlLink.href       = url;
      dlLink.download   = (result.name || ("shot-" + result.index)) + ".mp4";
      dlLink.textContent = "⬇ Download";
      actions.appendChild(dlLink);
      body.appendChild(actions);
    } else if (result.status === "ok") {
      const note = document.createElement("p");
      note.style.cssText = "color:var(--muted);font-size:.8rem";
      note.textContent = "Generated (no binary preview available)";
      body.appendChild(note);
    }

    card.appendChild(body);
    return card;
  }

  /* ── RESULTS HTML PAGE GENERATOR ─────────────────────────── */

  function buildResultsHtml(results) {
    const shotCards = results.map((r) => {
      const videoTag = (r.status === "ok" && r.modality === "video" && r.result?.data)
        ? `<video controls style="width:100%;max-height:360px;display:block;background:#000" src="${r.result.data}"></video>`
        : (r.status === "error"
          ? `<p style="color:#b91c1c;font-weight:500">Error: ${escHtml(r.error || "")}</p>`
          : `<p style="color:#64748b">Generated (no binary preview)</p>`);
      return `
    <div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;padding:.5rem .75rem;background:#fff;border-bottom:1px solid #e2e8f0">
        <strong style="font-size:.85rem">${escHtml(r.name || ("Shot " + (r.index + 1)))}</strong>
        <span style="font-size:.75rem;color:${r.status === "ok" ? "#16a34a" : "#b91c1c"}">${r.status === "ok" ? "✓ Generated" : "✗ Error"}</span>
      </div>
      <div style="padding:.6rem .75rem;background:#f8fafc">
        <p style="font-size:.8rem;color:#64748b;margin:0 0 .4rem">${escHtml(r.prompt)}</p>
        ${videoTag}
      </div>
    </div>`;
    }).join("\n");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Batch Results — ai-powered</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;padding:1.5rem}
h1{font-size:1.2rem;margin:0 0 1rem}
.summary{font-size:.82rem;color:#64748b;margin-bottom:1.25rem}</style>
</head>
<body>
<h1>Batch Results — ai-powered</h1>
<p class="summary">Generated ${results.length} shot${results.length !== 1 ? "s" : ""} · ${new Date().toLocaleString()}</p>
${shotCards}
</body></html>`;
  }

  function escHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  /* ── DOWNLOAD HANDLERS ────────────────────────────────────── */

  btnDownloadResults.addEventListener("click", () => {
    if (!batchResultItems.length) return;
    const html  = buildResultsHtml(batchResultItems);
    const blob  = new Blob([html], { type: "text/html" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href      = url;
    a.download  = "batch-results.html";
    a.click();
    URL.revokeObjectURL(url);
  });

  btnDownloadZip.addEventListener("click", async () => {
    if (!batchResultItems.length) return;
    if (typeof JSZip === "undefined") {
      alert("JSZip library not loaded. Check your internet connection.");
      return;
    }
    const zip = new JSZip();
    for (const r of batchResultItems) {
      if (r.status === "ok" && r.modality === "video" && r.result?.data) {
        const b64 = r.result.data.replace(/^data:[^,]+,/, "");
        const filename = (r.name || ("shot-" + r.index)).replace(/[^a-z0-9_\-]/gi, "_") + ".mp4";
        zip.file(filename, b64, { base64: true });
      }
    }
    // Also include the HTML results page
    zip.file("results.html", buildResultsHtml(batchResultItems));
    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url     = URL.createObjectURL(content);
      const a       = document.createElement("a");
      a.href        = url;
      a.download    = "batch-videos.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("ZIP generation failed: " + (err.message || err));
    }
  });

  /* ── BATCH RUNNER ─────────────────────────────────────────── */

  async function runBatch() {
    if (!batchItems.length) return;
    if (modeSelect.value !== "proxy") {
      alert("Batch processing requires proxy mode. Please switch to Proxy mode.");
      return;
    }

    const total = batchItems.length;
    batchResultItems = [];
    batchShots.innerHTML = "";

    // Switch to progress view
    batchPreflight.classList.add("hidden");
    batchProgress.classList.remove("hidden");
    batchResults.classList.add("hidden");
    batchProgressLabel.textContent = "Processing…";
    batchProgressCtr.textContent   = "0 / " + total;
    batchProgressBar.style.width   = "0%";

    const proxyBase = (proxyUrlInput.value || "http://localhost:3001").replace(/\/$/, "");
    const provider  = proxyProviderSelect.value || undefined;
    const model     = videoModelSelect.value || undefined;

    const payload = {
      items: batchItems.map((item) => ({
        modality: item.modality || "video",
        name:     item.name,
        prompt:   item.prompt,
        ...(provider ? { provider } : {}),
        ...(model    ? { model }    : {}),
      })),
    };

    try {
      const resp = await fetch(proxyBase + "/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let msg = resp.statusText;
        try { const j = await resp.json(); msg = j.error || msg; } catch (_) {}
        throw new Error("HTTP " + resp.status + ": " + msg);
      }

      // Read NDJSON stream
      const reader = resp.body.getReader();
      const dec    = new TextDecoder();
      let buf      = "";
      let done_count = 0;

      // Show results panel immediately so cards populate live
      batchResults.classList.remove("hidden");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop(); // Keep partial last line in buffer
        for (const line of lines) {
          const l = line.trim();
          if (!l) continue;
          try {
            const result = JSON.parse(l);
            batchResultItems.push(result);
            batchShots.appendChild(renderShotCard(result));
            addUsage(result.result?.usage ?? null, result.result?.cost ?? null);
            done_count++;
            const pct = Math.round((done_count / total) * 100);
            batchProgressBar.style.width   = pct + "%";
            batchProgressCtr.textContent   = done_count + " / " + total;
            batchProgressLabel.textContent = done_count < total ? "Processing…" : "Complete!";
          } catch (_) { /* skip malformed lines */ }
        }
      }
      // Handle any trailing data in buffer
      if (buf.trim()) {
        try {
          const result = JSON.parse(buf.trim());
          batchResultItems.push(result);
          batchShots.appendChild(renderShotCard(result));
          addUsage(result.result?.usage ?? null, result.result?.cost ?? null);
        } catch (_) {}
      }

      batchProgressLabel.textContent = "Complete — " + batchResultItems.length + " of " + total + " processed";
      batchProgressBar.style.width   = "100%";
    } catch (err) {
      batchProgressLabel.textContent = "Error: " + (err.message || err);
      batchProgress.classList.remove("hidden");
    }
  }

  btnBatchRun.addEventListener("click", runBatch);

  /* ── VIDEO TAB ───────────────────────────────────────────── */
  async function handleVideoGenerate() {
    const prompt = videoPromptEl.value.trim();
    if (!prompt) return;
    setLoading([btnVideoGenerate], true);
    showSpinner(videoOutput, "Generating video — this may take a moment…");
    videoUsage.textContent = "";
    try {
      let blob;
      let vidResult = null;
      if (modeSelect.value === "proxy") {
        vidResult = await proxyPost("/video", { prompt, model: videoModelSelect.value || undefined });
        if (vidResult.data) {
          blob = dataUriToBlob(vidResult.data);
        } else {
          // Mock provider (and future providers) may return no binary data yet.
          videoOutput.innerHTML =
            '<p style="padding:1rem;color:var(--text-muted)">✓ Video generated successfully (mock — no binary preview available)</p>';
          addUsage(vidResult?.usage ?? null, vidResult?.cost ?? null);
          setUsageText(videoUsage, vidResult?.usage ?? null, vidResult?.cost ?? null);
          if (!vidResult?.cost) videoUsage.textContent = "Mock video · 0 KB";
          return;
        }
      } else {
        blob = await getClient().generateVideo(prompt);
      }
      const url = blobUrl("video", blob);
      videoOutput.innerHTML = "";
      const video = document.createElement("video");
      video.className = "output-video";
      video.controls  = true;
      video.src       = url;
      videoOutput.appendChild(video);
      addUsage(vidResult?.usage ?? null, vidResult?.cost ?? null);
      setUsageText(videoUsage, vidResult?.usage ?? null, vidResult?.cost ?? null);
      if (!vidResult?.cost) {
        videoUsage.textContent = "Video · " + Math.round(blob.size / 1024) + " KB";
      } else {
        videoUsage.textContent += " · " + Math.round(blob.size / 1024) + " KB";
      }
    } catch (err) {
      showError(videoOutput, err);
    } finally {
      setLoading([btnVideoGenerate], false);
    }
  }
  btnVideoGenerate.addEventListener("click", handleVideoGenerate);

  /* ── STRUCTURED TAB ──────────────────────────────────────── */
  async function handleStructuredGenerate() {
    const prompt = structuredPromptEl.value.trim();
    if (!prompt) return;
    setLoading([btnStructuredGenerate], true);
    showSpinner(structuredOutput, "Generating structured output…");
    structuredUsage.textContent = "";
    structuredOutput.classList.add("json-output");
    try {
      let result;
      if (modeSelect.value === "proxy") {
        result = await proxyPost("/structured", { prompt, model: structuredModelSelect.value || undefined });
      } else {
        result = await getClient().generateStructured(prompt);
      }
      renderJson(structuredOutput, result.data);
      addUsage(result?.usage ?? null, result?.cost ?? null);
      const providerModel = "Provider: " + (result.provider || "—") + " · Model: " + (result.model || "—");
      setUsageText(structuredUsage, result?.usage ?? null, result?.cost ?? null);
      structuredUsage.textContent = (structuredUsage.textContent
        ? structuredUsage.textContent + " · "
        : "") + providerModel;
    } catch (err) {
      structuredOutput.classList.remove("json-output");
      showError(structuredOutput, err);
    } finally {
      setLoading([btnStructuredGenerate], false);
    }
  }
  btnStructuredGenerate.addEventListener("click", handleStructuredGenerate);

})(); // end IIFE

