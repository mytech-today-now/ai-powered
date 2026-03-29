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
  const proxyUrlInput      = $("proxy-url");
  const providerSelect     = $("provider-select");
  const apiKeyInput        = $("api-key-input");

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

  const structuredPromptEl    = $("structured-prompt");
  const btnStructuredGenerate = $("btn-structured-generate");
  const structuredOutput      = $("structured-output");
  const structuredUsage       = $("structured-usage");

  const costTotalEl        = $("cost-total");
  const tokensTotalEl      = $("tokens-total");
  const callsTotalEl       = $("calls-total");

  /* ── Cost / usage tracking ──────────────────────────────── */
  let totalCost   = 0;
  let totalTokens = 0;
  let totalCalls  = 0;

  const COST_PER_TOKEN = {
    openai:    5e-6,
    anthropic: 7.5e-6,
    venice:    1e-6,
    xai:       5e-6,
    proxy:     5e-6,
  };

  function currentProvider() {
    return modeSelect.value === "direct" ? providerSelect.value : "proxy";
  }

  function addUsage(usage) {
    totalCalls++;
    if (usage && usage.totalTokens) {
      const rate = COST_PER_TOKEN[currentProvider()] || 5e-6;
      totalTokens += usage.totalTokens;
      totalCost   += usage.totalTokens * rate;
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

  function setUsageText(el, usage) {
    if (!el || !usage) return;
    el.textContent =
      "Tokens: " + usage.totalTokens +
      " (↑" + usage.promptTokens + " ↓" + usage.completionTokens + ")";
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

  /* ── Mode toggle ─────────────────────────────────────────── */
  function applyModeUi() {
    const isProxy = modeSelect.value === "proxy";
    proxyConfig.classList.toggle("hidden", !isProxy);
    directConfig.classList.toggle("hidden", isProxy);
  }
  modeSelect.addEventListener("change", applyModeUi);
  applyModeUi();

  /* ── Tab switching ───────────────────────────────────────── */
  function switchTab(target) {
    tabBtns.forEach((b) => {
      const on = b.dataset.tab === target;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    tabPanels.forEach((p) => p.classList.toggle("hidden", p.id !== "panel-" + target));
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
      const client       = getClient();
      const fullPrompt   = buildHistoryPrompt();
      const result       = await client.generateText(fullPrompt);
      const reply        = result.content;

      appendSession("assistant", reply);
      addBubble("assistant", reply);

      textOutput.innerHTML = "";
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent  = reply;
      textOutput.appendChild(p);

      setUsageText(textUsage, result.usage);
      addUsage(result.usage);
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
      const client    = getClient();
      const fullPrompt = buildHistoryPrompt();
      for await (const chunk of client.streamText(fullPrompt)) {
        accumulated += chunk;
        outP.textContent      = accumulated;
        assistantP.textContent = accumulated;
        sessionHistory.scrollTop = sessionHistory.scrollHeight;
      }
      appendSession("assistant", accumulated);
      // streaming doesn't return usage stats; count the call only
      addUsage(null);
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
      const blob = await getClient().generateImage(prompt);
      const url  = blobUrl("image", blob);
      imageOutput.innerHTML = "";
      const img = document.createElement("img");
      img.className = "output-image";
      img.alt = prompt;
      img.src = url;
      imageOutput.appendChild(img);
      addUsage(null);
      imageUsage.textContent = "Image generated · " + Math.round(blob.size / 1024) + " KB";
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
      const blob = await getClient().synthesizeSpeech(text);
      const url  = blobUrl("audio", blob);
      ttsOutput.innerHTML = "";
      const audio = document.createElement("audio");
      audio.className = "output-audio";
      audio.controls  = true;
      audio.src       = url;
      ttsOutput.appendChild(audio);
      audio.play().catch(() => {});
      addUsage(null);
      audioUsage.textContent = "Audio · " + Math.round(blob.size / 1024) + " KB";
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
      const text = await getClient().transcribeAudio(selectedAudioBlob);
      transcribeOutput.innerHTML = "";
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent  = text;
      transcribeOutput.appendChild(p);
      addUsage(null);
    } catch (err) {
      showError(transcribeOutput, err);
    } finally {
      setLoading([btnTranscribe], false);
    }
  }
  btnTranscribe.addEventListener("click", handleTranscribe);

  /* ── VIDEO TAB ───────────────────────────────────────────── */
  async function handleVideoGenerate() {
    const prompt = videoPromptEl.value.trim();
    if (!prompt) return;
    setLoading([btnVideoGenerate], true);
    showSpinner(videoOutput, "Generating video — this may take a moment…");
    videoUsage.textContent = "";
    try {
      const blob = await getClient().generateVideo(prompt);
      const url  = blobUrl("video", blob);
      videoOutput.innerHTML = "";
      const video = document.createElement("video");
      video.className = "output-video";
      video.controls  = true;
      video.src       = url;
      videoOutput.appendChild(video);
      addUsage(null);
      videoUsage.textContent = "Video · " + Math.round(blob.size / 1024) + " KB";
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
      const result = await getClient().generateStructured(prompt);
      renderJson(structuredOutput, result.data);
      addUsage(null);
      structuredUsage.textContent =
        "Provider: " + (result.provider || "—") + " · Model: " + (result.model || "—");
    } catch (err) {
      structuredOutput.classList.remove("json-output");
      showError(structuredOutput, err);
    } finally {
      setLoading([btnStructuredGenerate], false);
    }
  }
  btnStructuredGenerate.addEventListener("click", handleStructuredGenerate);

})(); // end IIFE

