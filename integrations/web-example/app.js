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

  // Global error toast
  const globalErrorToast = $("global-error-toast");
  const globalErrorMsg   = $("global-error-msg");
  const globalErrorClose = $("global-error-close");

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
  const batchCostTally     = $("batch-cost-tally");
  const batchShots         = $("batch-shots");
  const btnDownloadResults = $("btn-download-results");
  const btnDownloadZip     = $("btn-download-zip");
  const zipStatusEl        = $("zip-status");

  // Batch constraint controls (default values applied to all shots)
  const batchAspectRatioEl = $("batch-aspect-ratio");
  const batchResolutionEl  = $("batch-resolution");
  const batchQualityEl     = $("batch-quality");
  const batchDurationEl    = $("batch-duration");
  const batchFpsEl         = $("batch-fps");

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
  const videoProviderSelect   = $("video-provider-select"); // video-tab-specific provider picker
  const structuredModelSelect = $("structured-model-select");

  // Image size controls (added for img-cntrl)
  const imageRatioCategory  = $("image-ratio-category");
  const imageAspectRatio    = $("image-aspect-ratio");
  const imageQuality        = $("image-quality");
  const imageCustomDims     = $("image-custom-dims");
  const imageWidthInput     = $("image-width");
  const imageHeightInput    = $("image-height");
  const imageDimsHint       = $("image-dims-hint");

  // Video size / duration controls (added for img-cntrl)
  const videoAspectRatio    = $("video-aspect-ratio");
  const videoResolution     = $("video-resolution");
  const videoQuality        = $("video-quality");
  const videoDuration       = $("video-duration");
  const videoFps            = $("video-fps");

  const costTotalEl        = $("cost-total");
  const tokensTotalEl      = $("tokens-total");
  const callsTotalEl       = $("calls-total");

  /* ── Provider cache (populated by loadProviders) ────────── */
  let allProviders = []; // All providers from /providers, including inactive

  /* ── Video model capability cache (populated by loadVideoModels) ── */
  let videoModelsCache = []; // Full ModelDescriptor objects for the active video provider

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

  /**
   * Repopulates the video-tab-specific provider dropdown with only video-capable
   * providers.  Preserves the current selection if it is still valid.
   * Called after loadProviders() so that allProviders is already populated.
   */
  function refreshVideoProviderDropdown() {
    if (!videoProviderSelect) return;
    const prev = videoProviderSelect.value;
    videoProviderSelect.innerHTML = '<option value="">Default</option>';
    const compatible = allProviders.filter(
      (p) => Array.isArray(p.modalities) && p.modalities.includes("video"),
    );
    compatible.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.active ? p.name + " ★" : p.name;
      opt.title = p.active ? "API key configured" : "No API key set — add to .env to enable";
      videoProviderSelect.appendChild(opt);
    });
    if ([...videoProviderSelect.options].some((o) => o.value === prev)) {
      videoProviderSelect.value = prev;
    }
  }

  /* ── Video constraint syncing ───────────────────────────── */

  /**
   * Filters a <select> element to only show options whose values are in
   * `allowed`.  Options not in the list are hidden; the "Default" (value="")
   * option is always kept visible.  If the current selection is hidden the
   * element resets to "".
   *
   * @param {HTMLSelectElement|null} selectEl - Target dropdown (may be null).
   * @param {string[]|number[]}      allowed  - Allowed values (compared as strings).
   */
  function _filterSelect(selectEl, allowed) {
    if (!selectEl) return;
    const allowedSet = new Set(allowed.map(String));
    let anyVisible = false;
    [...selectEl.options].forEach((opt) => {
      if (!opt.value) { opt.hidden = false; return; } // always keep "Default"
      opt.hidden = !allowedSet.has(opt.value);
      if (!opt.hidden) anyVisible = true;
    });
    // Reset to Default if current selection is now hidden
    if (selectEl.value && !allowedSet.has(selectEl.value)) {
      selectEl.value = "";
    }
    // If no valid option is visible, also hide the whole control row gracefully
    return anyVisible;
  }

  /**
   * Restores all options in a <select> to visible (removes filtering).
   *
   * @param {HTMLSelectElement|null} selectEl - Target dropdown (may be null).
   */
  function _clearSelectFilter(selectEl) {
    if (!selectEl) return;
    [...selectEl.options].forEach((opt) => { opt.hidden = false; });
  }

  /**
   * Syncs the video constraint dropdowns (aspect ratio, resolution, fps,
   * quality) to the capabilities of the given model descriptor.  When no
   * descriptor is provided (e.g. "Default" model selected), all options are
   * restored.
   *
   * Applies to both the Single Video and Batch constraint controls.
   *
   * @param {object|null} descriptor - Full ModelDescriptor from the server.
   */
  function syncVideoConstraints(descriptor) {
    const aspectSelects  = [videoAspectRatio, batchAspectRatioEl].filter(Boolean);
    const resolutionSelects = [videoResolution, batchResolutionEl].filter(Boolean);
    const fpsSelects     = [videoFps, batchFpsEl].filter(Boolean);
    const qualitySelects = [videoQuality, batchQualityEl].filter(Boolean);

    if (!descriptor) {
      // No specific model — show all options
      [...aspectSelects, ...resolutionSelects, ...fpsSelects, ...qualitySelects]
        .forEach(_clearSelectFilter);
      return;
    }

    if (descriptor.aspectRatios && descriptor.aspectRatios.length > 0) {
      aspectSelects.forEach((s) => _filterSelect(s, descriptor.aspectRatios));
    } else {
      aspectSelects.forEach(_clearSelectFilter);
    }

    if (descriptor.resolutions && descriptor.resolutions.length > 0) {
      resolutionSelects.forEach((s) => _filterSelect(s, descriptor.resolutions));
    } else {
      resolutionSelects.forEach(_clearSelectFilter);
    }

    if (descriptor.fpsOptions && descriptor.fpsOptions.length > 0) {
      fpsSelects.forEach((s) => _filterSelect(s, descriptor.fpsOptions));
    } else {
      fpsSelects.forEach(_clearSelectFilter);
    }

    if (descriptor.qualityOptions && descriptor.qualityOptions.length > 0) {
      qualitySelects.forEach((s) => _filterSelect(s, descriptor.qualityOptions));
    } else {
      qualitySelects.forEach(_clearSelectFilter);
    }
  }

  /**
   * Loads video models for the given provider hint, populates the video model
   * dropdown, caches the full descriptors, and syncs constraint dropdowns to
   * the current (or default) model selection.
   *
   * @param {string} [providerHint] - Provider id for the video-tab picker (may be "").
   */
  async function loadVideoModels(providerHint) {
    try {
      const base = proxyUrlInput.value.trim() || "http://localhost:3001";
      const provider = providerHint !== undefined ? providerHint : (videoProviderSelect?.value ?? "");
      let url = base + "/models?modality=video";
      if (provider) url += "&provider=" + provider;
      const models = await fetch(url).then((r) => r.json());
      videoModelsCache = Array.isArray(models) ? models : [];

      if (videoModelSelect) {
        videoModelSelect.innerHTML = '<option value="">Default</option>';
        videoModelsCache.forEach((m) => {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.name || m.id;
          videoModelSelect.appendChild(opt);
        });
      }
    } catch (_) {
      videoModelsCache = [];
    }
    // Sync constraints for current model selection (may be "Default")
    const current = videoModelSelect?.value || "";
    const descriptor = videoModelsCache.find((m) => m.id === current) ?? null;
    syncVideoConstraints(descriptor);
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
    if (!el) return;
    el.innerHTML = "";
    const s = document.createElement("span");
    s.className   = "error-msg";
    s.textContent = "Error: " + (err instanceof Error ? err.message : String(err));
    el.appendChild(s);
  }

  /**
   * Show a dismissible sticky banner at the top of the page for system-level
   * errors that may not be visible in any output panel (e.g., server unreachable,
   * wrong mode selected for a feature). Auto-dismisses after 15 s.
   */
  function showGlobalError(msg) {
    if (!globalErrorToast || !globalErrorMsg) return;
    globalErrorMsg.textContent = msg;
    globalErrorToast.classList.remove("hidden");
    clearTimeout(showGlobalError._timer);
    showGlobalError._timer = setTimeout(clearGlobalError, 15000);
  }
  showGlobalError._timer = null;

  function clearGlobalError() {
    if (globalErrorToast) globalErrorToast.classList.add("hidden");
  }

  if (globalErrorClose) {
    globalErrorClose.addEventListener("click", clearGlobalError);
  }

  // Catch unhandled promise rejections that escape individual try/catch blocks
  window.addEventListener("unhandledrejection", (event) => {
    const msg = event.reason instanceof Error
      ? event.reason.message
      : String(event.reason ?? "Unknown error");
    showGlobalError("Unexpected error: " + msg);
  });

  // Catch synchronous runtime exceptions (e.g., ReferenceError, TypeError)
  window.onerror = function (_msg, _src, _line, _col, error) {
    const msg = error instanceof Error
      ? error.message
      : String(_msg || "Unknown runtime error");
    showGlobalError("Runtime error: " + msg);
  };

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

  /* ── Image size control helpers (img-cntrl) ─────────────── */

  /**
   * Calculates pixel dimensions from an aspect ratio string and a base
   * resolution (applied to the longer axis).  Uses floor-rounding to match
   * AspectRatioService behaviour on the server.
   *
   * Examples:
   *   calcDims("16:9", 1080) → { w: 1920, h: 1080 }
   *   calcDims("9:16", 1080) → { w: 607,  h: 1080 }
   *   calcDims("1:1",  1024) → { w: 1024, h: 1024 }
   *
   * @param {string} ratio - Ratio string in "W:H" format.
   * @param {number} base  - Longer-side pixel length (default 1024).
   * @returns {{ w: number, h: number }|null}
   */
  function calcDims(ratio, base = 1024) {
    const parts = ratio.split(":");
    if (parts.length !== 2) return null;
    const rw = parseFloat(parts[0]);
    const rh = parseFloat(parts[1]);
    if (!rw || !rh || rw <= 0 || rh <= 0) return null;
    if (rw >= rh) {
      return { w: base, h: Math.floor(base * rh / rw) };
    }
    return { w: Math.floor(base * rw / rh), h: base };
  }

  /** Aspect ratio values that belong to each image category. */
  const RATIO_CATEGORIES = {
    square:    ["1:1"],
    landscape: ["4:3", "16:9", "3:2"],
    portrait:  ["3:4", "9:16", "2:3"],
  };

  /**
   * Filters the image-aspect-ratio <select> to only show ratios that belong to
   * the selected category.  "Any" and "Custom" leave all options visible.
   */
  function filterRatioOptions() {
    const cat     = imageRatioCategory.value;
    const allowed = RATIO_CATEGORIES[cat] || null; // null = no filter
    [...imageAspectRatio.options].forEach((opt) => {
      if (!opt.value) return; // always keep the "Default" option
      opt.hidden = allowed ? !allowed.includes(opt.value) : false;
    });
    // If the currently-selected ratio is now hidden, reset to "Default"
    const sel = imageAspectRatio.options[imageAspectRatio.selectedIndex];
    if (sel && sel.hidden) imageAspectRatio.value = "";
  }

  /**
   * Keeps the custom-dimensions row and the dimension-hint <span> in sync
   * with the current category / aspect-ratio selection.
   *
   * Behaviour:
   *  - Category = "Custom"   → show row, enable inputs, hint = entered px.
   *  - Preset ratio selected → show row (read-only), hint = calculated px.
   *  - Neither               → hide row, clear hint.
   */
  function syncImageDimsPanel() {
    filterRatioOptions();
    const cat     = imageRatioCategory.value;
    const ratio   = imageAspectRatio.value;
    const isCustom = cat === "custom";

    if (isCustom) {
      imageCustomDims.classList.remove("hidden");
      imageWidthInput.disabled  = false;
      imageHeightInput.disabled = false;
      const w = parseInt(imageWidthInput.value, 10);
      const h = parseInt(imageHeightInput.value, 10);
      imageDimsHint.textContent = (w > 0 && h > 0) ? w + " × " + h + " px" : "";
    } else if (ratio) {
      imageCustomDims.classList.remove("hidden");
      imageWidthInput.disabled  = true;
      imageHeightInput.disabled = true;
      imageWidthInput.value     = "";
      imageHeightInput.value    = "";
      const dims = calcDims(ratio);
      imageDimsHint.textContent = dims ? dims.w + " × " + dims.h + " px (est.)" : "";
    } else {
      imageCustomDims.classList.add("hidden");
      imageWidthInput.disabled  = true;
      imageHeightInput.disabled = true;
      imageDimsHint.textContent = "";
    }
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

  /* ── Mock video stub detection & Canvas placeholder ─────────── */

  /**
   * Returns true if `dataUri` is the mock provider's 4-byte stub.
   * The stub is "data:video/mp4;base64,AAAAAA==" — only 4 bytes of payload.
   */
  function isStubVideoData(dataUri) {
    if (!dataUri) return false;
    const b64 = dataUri.replace(/^data:[^,]+,/, "").replace(/=/g, "");
    return b64.length <= 8; // ≤ 4 decoded bytes → definitely a stub
  }

  /**
   * Draw an animated preview frame on `canvas` at time `elapsed` / `durationMs`.
   * Shows the prompt text, a progress bar, and the ai-powered brand mark.
   */
  function _drawFrame(ctx, w, h, label, elapsed, durationMs) {
    const progress = Math.min(elapsed / durationMs, 1);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#6366f1";
    ctx.fillRect(0, h - 18, w * progress, 18);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 13px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🎬 " + label.slice(0, 42), w / 2, h / 2 - 10);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px system-ui,sans-serif";
    ctx.fillText("ai-powered · mock preview", w / 2, h / 2 + 14);
    ctx.fillStyle = "#6366f1";
    ctx.font = "bold 11px system-ui,sans-serif";
    ctx.fillText(Math.round(progress * 100) + "%", w / 2, h - 4);
  }

  /**
   * Generate a short animated WebM video blob via Canvas + MediaRecorder.
   *
   * @param {string} label      Text to embed (prompt summary).
   * @param {number} durationMs Recording length in ms (default 2000).
   * @returns {Promise<Blob>}
   */
  function generatePlaceholderVideoBlob(label, durationMs) {
    durationMs = durationMs || 2000;
    return new Promise(function (resolve, reject) {
      const W = 320, H = 180;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");

      const mimeType = (
        ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
          .find(function (t) { return MediaRecorder.isTypeSupported(t); })
      ) || "video/webm";

      let stream, recorder;
      try {
        stream   = canvas.captureStream(25);
        recorder = new MediaRecorder(stream, { mimeType });
      } catch (e) { return reject(e); }

      const chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.onerror = reject;

      recorder.start(100);
      const start = performance.now();
      function frame() {
        const elapsed = performance.now() - start;
        _drawFrame(ctx, W, H, label, elapsed, durationMs);
        if (elapsed < durationMs) { requestAnimationFrame(frame); }
        else { recorder.stop(); }
      }
      requestAnimationFrame(frame);
    });
  }

  /**
   * Append a `<video>` element and a download link to `container`.
   *
   * @param {HTMLElement} container  Parent element to append into.
   * @param {string}      url        Object URL for the video blob.
   * @param {Blob}        blob       The video blob (used for size display).
   * @param {string}      name       Base filename (without extension).
   * @param {string}      ext        File extension, e.g. "webm" or "mp4".
   */
  function appendShotVideo(container, url, blob, name, ext) {
    const vid = document.createElement("video");
    vid.className = "shot-video";
    vid.controls  = true;
    vid.src       = url;
    container.appendChild(vid);

    const actions = document.createElement("div");
    actions.className = "shot-actions";
    const dlLink = document.createElement("a");
    dlLink.className   = "shot-dl-link";
    dlLink.href        = url;
    dlLink.download    = name.replace(/[^a-z0-9_\-]/gi, "_") + "." + ext;
    dlLink.textContent = "⬇ Download (" + Math.round(blob.size / 1024) + " KB)";
    actions.appendChild(dlLink);
    container.appendChild(actions);
  }

  /* ── Proxy fetch helpers ─────────────────────────────────── */
  async function proxyPost(endpoint, body) {
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    const provider = proxyProviderSelect.value || undefined;
    const payload = { ...body };
    if (provider && !payload.provider) payload.provider = provider;

    let resp;
    try {
      resp = await fetch(base + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (_networkErr) {
      const err = new Error(
        "Cannot reach proxy server at " + base + ". " +
        "Start it with: npm run serve",
      );
      showGlobalError(err.message);
      throw err;
    }

    if (!resp.ok) {
      let msg = resp.statusText;
      try {
        const j = await resp.json();
        msg = j.error || (Array.isArray(j.issues) ? j.issues.join("; ") : null) || msg;
      } catch (_) {}
      const httpErr = new Error("Server error " + resp.status + ": " + msg);
      showGlobalError(httpErr.message);
      throw httpErr;
    }
    return resp.json();
  }

  /**
   * Fetches models for the given modality from the proxy server and populates
   * the given <select> element.
   *
   * @param {string}      modality        - "text" | "image" | "audio" | "video" | "structured"
   * @param {HTMLElement} selectEl        - The <select> to populate.
   * @param {string}      [providerHint]  - Explicit provider id to pass to /models?provider=.
   *                                        Overrides the global proxyProviderSelect when given.
   */
  async function loadModels(modality, selectEl, providerHint) {
    try {
      const base = proxyUrlInput.value.trim() || "http://localhost:3001";
      const provider = providerHint !== undefined ? providerHint : proxyProviderSelect.value;
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
      // Video uses its own per-tab provider dropdown + capability-aware loader.
      loadVideoModels(videoProviderSelect?.value ?? ""),
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
      refreshVideoProviderDropdown(); // populate the video-tab-specific dropdown
    } catch (_) { /* server not running — keep Default */ }
    await loadAllModels();
  }

  /* ── JSZip availability helper ──────────────────────────── */
  /**
   * Polls window.JSZip until it is available or the timeout expires.
   * @param {number} maxMs      - Maximum wait in milliseconds (default 3000).
   * @param {number} intervalMs - Poll interval in milliseconds (default 100).
   * @returns {Promise<true>}
   */
  async function waitForJSZip(maxMs = 3000, intervalMs = 100) {
    const deadline = Date.now() + maxMs;
    return new Promise((resolve, reject) => {
      (function poll() {
        if (typeof window.JSZip === "function") { resolve(true); return; }
        if (Date.now() >= deadline) { reject(new Error("JSZip did not load in time.")); return; }
        setTimeout(poll, intervalMs);
      })();
    });
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

  // Reload models when global provider selection changes
  proxyProviderSelect.addEventListener("change", loadAllModels);

  // Reload only video models when the video-tab provider changes
  if (videoProviderSelect) {
    videoProviderSelect.addEventListener("change", () => {
      loadVideoModels(videoProviderSelect.value);
    });
  }

  // Sync constraint dropdowns when the video model selection changes
  if (videoModelSelect) {
    videoModelSelect.addEventListener("change", () => {
      const descriptor = videoModelsCache.find((m) => m.id === videoModelSelect.value) ?? null;
      syncVideoConstraints(descriptor);
    });
  }

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

  // ── Video sub-tab switcher ──────────────────────────────────────────────
  function switchVideoTab(target) {
    document.querySelectorAll(".video-tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.vtab === target);
      b.setAttribute("aria-selected", b.dataset.vtab === target ? "true" : "false");
    });
    document.querySelectorAll(".video-sub-panel").forEach((p) => {
      p.classList.toggle("hidden", p.dataset.vtab !== target);
    });
  }

  document.querySelectorAll(".video-tab-btn").forEach((b) =>
    b.addEventListener("click", () => switchVideoTab(b.dataset.vtab))
  );

  switchVideoTab("batch"); // Batch is the default active sub-tab

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
      showGlobalError("Text generation failed: " + (err instanceof Error ? err.message : String(err)));
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
      showGlobalError("Text streaming failed: " + (err instanceof Error ? err.message : String(err)));
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
        const isCustom      = imageRatioCategory.value === "custom";
        const imgAspectRatio = imageAspectRatio.value   || undefined;
        const imgQuality     = imageQuality.value       || undefined;
        const imgWidth       = isCustom ? (parseInt(imageWidthInput.value,  10) || undefined) : undefined;
        const imgHeight      = isCustom ? (parseInt(imageHeightInput.value, 10) || undefined) : undefined;
        imgResult = await proxyPost("/image", {
          prompt,
          model:       imageModelSelect.value || undefined,
          aspectRatio: imgAspectRatio,
          width:       imgWidth,
          height:      imgHeight,
          quality:     imgQuality,
        });
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
      showGlobalError("Image generation failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading([btnImageGenerate], false);
    }
  }
  btnImageGenerate.addEventListener("click", handleImageGenerate);

  // Wire image size controls — real-time dimension preview and category filter
  imageRatioCategory.addEventListener("change", syncImageDimsPanel);
  imageAspectRatio.addEventListener("change", syncImageDimsPanel);
  imageWidthInput.addEventListener("input", syncImageDimsPanel);
  imageHeightInput.addEventListener("input", syncImageDimsPanel);

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
      showGlobalError("Speech synthesis failed: " + (err instanceof Error ? err.message : String(err)));
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
      showGlobalError("Transcription failed: " + (err instanceof Error ? err.message : String(err)));
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
      } else if (line) {
        // Skip horizontal rules and metadata
        if (/^---+$/.test(line) || /^\*\*[^*]+\*\*:/.test(line)) continue;
        // Auto-assign name for text appearing before the first heading
        if (currentName === null) {
          currentName = "Shot " + (items.length + 1);
        }
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

  let preflightAbortController = null;

  async function fetchPreflightCostEstimate(count, model) {
    if (modeSelect.value !== "proxy") return null;
    if (preflightAbortController) preflightAbortController.abort();
    preflightAbortController = new AbortController();
    try {
      const url = `/pricing?modality=video&model=${encodeURIComponent(model)}`;
      const res = await fetch(url, { signal: preflightAbortController.signal });
      if (!res.ok) return null;
      const data = await res.json();
      const rate = data?.perVideoUsd ?? data?.pricePerUnit;
      if (typeof rate !== "number") return null;
      return { total: (rate * count).toFixed(6), rate: rate.toFixed(6), count };
    } catch { return null; }
  }

  function showBatchPreflight(items) {
    // Remove any stale cost estimate before re-rendering
    const staleEst = batchSummary.querySelector(".batch-estimate");
    if (staleEst) staleEst.remove();

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

      // Label + prompt excerpt (wrapped so the × button stays right-aligned)
      const labelSpan = document.createElement("span");
      labelSpan.className = "shot-preview-label";
      labelSpan.textContent = (i + 1) + ". " + item.name + " [" + modality + "]";
      const em = document.createElement("em");
      em.textContent = item.prompt.length > 80 ? item.prompt.slice(0, 80) + "…" : item.prompt;
      labelSpan.appendChild(em);
      li.appendChild(labelSpan);

      // Remove button
      const removeBtn = document.createElement("button");
      removeBtn.className = "shot-preview-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove this shot from the batch";
      removeBtn.addEventListener("click", function () {
        batchItems.splice(i, 1);
        showBatchPreflight(batchItems);
      });
      li.appendChild(removeBtn);

      ul.appendChild(li);
    });
    const p = document.createElement("p");
    p.innerHTML = "<strong>" + items.length + " shot" + (items.length !== 1 ? "s" : "") + "</strong> loaded and ready to process.";
    batchSummary.appendChild(p);
    batchSummary.appendChild(ul);
    btnBatchRun.disabled = false;

    // Fire cost estimate non-blocking; append result when available
    const estimateModel = videoModelSelect.value || "";
    fetchPreflightCostEstimate(items.length, estimateModel).then((est) => {
      if (!est) return;
      const estEl = document.createElement("p");
      estEl.className = "batch-estimate";
      estEl.textContent =
        "Estimated cost: $" + est.total +
        "  (" + est.count + " clips \xd7 $" + est.rate + " each, est.)";
      batchSummary.appendChild(estEl);
    });
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

  // Refresh preflight cost estimate when the video model selection changes
  videoModelSelect.addEventListener("change", () => {
    if (batchItems.length) showBatchPreflight(batchItems);
  });

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
      if (isStubVideoData(result.result.data)) {
        // Stub data from mock provider — generate a real playable preview via Canvas
        const spinEl = document.createElement("span");
        spinEl.className   = "spinner-msg";
        spinEl.textContent = "Encoding preview…";
        body.appendChild(spinEl);

        const shotName = result.name || ("shot-" + result.index);
        generatePlaceholderVideoBlob(result.prompt || shotName, 2000)
          .then(function (blob) {
            const url = URL.createObjectURL(blob);
            spinEl.remove();
            appendShotVideo(body, url, blob, shotName, "webm");
          })
          .catch(function () {
            spinEl.textContent = "Preview unavailable (mock stub)";
          });
      } else {
        // Real provider data — use it directly
        const blob = dataUriToBlob(result.result.data);
        const url  = URL.createObjectURL(blob);
        const shotName = result.name || ("shot-" + result.index);
        appendShotVideo(body, url, blob, shotName, "mp4");
      }
    } else if (result.status === "ok") {
      const note = document.createElement("p");
      note.style.cssText = "color:var(--muted);font-size:.8rem";
      note.textContent = "Generated (no binary preview available)";
      body.appendChild(note);
    }

    const costUsd = result.result?.cost?.totalUsd;
    if (typeof costUsd === "number" && isFinite(costUsd)) {
      const costEl = document.createElement("p");
      costEl.className = "shot-cost";
      costEl.textContent = "Cost: $" + costUsd.toFixed(6);
      body.appendChild(costEl);
    }

    card.appendChild(body);
    return card;
  }

  /* ── RESULTS HTML PAGE GENERATOR ─────────────────────────── */

  function buildResultsHtml(results) {
    const totalCost = results.reduce((sum, r) =>
      sum + (typeof r.result?.cost?.totalUsd === "number" ? r.result.cost.totalUsd : 0), 0);
    const costSegment = totalCost > 0 ? " · Total cost: $" + totalCost.toFixed(6) : "";

    const shotCards = results.map((r) => {
      const videoTag = (r.status === "ok" && r.modality === "video" && r.result?.data)
        ? `<video controls style="width:100%;max-height:360px;display:block;background:#000" src="${r.result.data}"></video>`
        : (r.status === "error"
          ? `<p style="color:#b91c1c;font-weight:500">Error: ${escHtml(r.error || "")}</p>`
          : `<p style="color:#64748b">Generated (no binary preview)</p>`);
      const costBadge = (r.status === "ok" && typeof r.result?.cost?.totalUsd === "number")
        ? `<span class="shot-cost-badge">$${r.result.cost.totalUsd.toFixed(6)}</span>`
        : "";
      return `
    <div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;padding:.5rem .75rem;background:#fff;border-bottom:1px solid #e2e8f0">
        <strong style="font-size:.85rem">${escHtml(r.name || ("Shot " + (r.index + 1)))}</strong>
        <span style="font-size:.75rem;color:${r.status === "ok" ? "#16a34a" : "#b91c1c"}">${r.status === "ok" ? "✓ Generated" : "✗ Error"}</span>${costBadge}
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
.summary{font-size:.82rem;color:#64748b;margin-bottom:1.25rem}
.shot-cost-badge{float:right;font-size:.8rem;color:#6b7280}</style>
</head>
<body>
<h1>Batch Results — ai-powered</h1>
<p class="summary">Generated ${results.length} shot${results.length !== 1 ? "s" : ""} · ${new Date().toLocaleString()}${costSegment}</p>
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
    // Clear any previous status message at the start of each attempt.
    zipStatusEl.textContent = "";

    // Wait for JSZip to be available (defence-in-depth: handles late-arriving scripts).
    try {
      await waitForJSZip();
    } catch (err) {
      zipStatusEl.textContent = "Unable to create ZIP: " + err.message;
      return;
    }

    // Nothing to zip — silent no-op.
    if (!batchResultItems.length) return;

    try {
      const zip = new window.JSZip();

      for (const r of batchResultItems) {
        if (r.status !== "ok" || r.modality !== "video" || !r.result?.data) continue;
        // Strip data-URI prefix if present; add raw bytes to avoid double-encoding.
        const b64  = r.result.data.replace(/^data:[^,]+,/, "");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const filename = (r.name || ("shot-" + r.index)).replace(/[^a-z0-9_\-]/gi, "_") + ".mp4";
        zip.file(filename, bytes);
      }

      // Include the HTML results summary page in the archive.
      zip.file("results.html", buildResultsHtml(batchResultItems));

      const blob = await zip.generateAsync({ type: "blob" });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), {
        href: url,
        download: "batch-videos.zip",
      });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      zipStatusEl.textContent = "ZIP generation failed: " + (err.message || String(err));
    }
  });

  /* ── BATCH RUNNER ─────────────────────────────────────────── */

  async function runBatch() {
    if (!batchItems.length) return;
    if (modeSelect.value !== "proxy") {
      alert("Batch processing requires proxy mode. Please switch to Proxy mode.");
      return;
    }

    let batchCost = 0;

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
    batchCostTally.classList.add("hidden");

    const proxyBase = (proxyUrlInput.value || "http://localhost:3001").replace(/\/$/, "");
    // Use the video-tab-specific provider (not the global one) for batch video runs.
    const provider  = (videoProviderSelect?.value || proxyProviderSelect.value) || undefined;
    const model     = videoModelSelect.value || undefined;

    // Batch constraint defaults — read once and spread into every item
    const batchAspectRatio = batchAspectRatioEl?.value || undefined;
    const batchResolution  = batchResolutionEl?.value  || undefined;
    const batchQuality     = batchQualityEl?.value     || undefined;
    const batchDuration    = batchDurationEl?.value
      ? parseFloat(batchDurationEl.value) || undefined
      : undefined;
    const batchFps         = batchFpsEl?.value
      ? parseInt(batchFpsEl.value, 10) || undefined
      : undefined;

    const payload = {
      items: batchItems.map((item) => ({
        // Identity fields — always from the shot item
        modality: item.modality || "video",
        name:     item.name,
        prompt:   item.prompt,
        // Connection overrides — from UI globals
        ...(provider ? { provider } : {}),
        ...(model    ? { model }    : {}),
        // Global batch constraint defaults (lowest precedence)
        ...(batchAspectRatio ? { aspectRatio: batchAspectRatio } : {}),
        ...(batchResolution  ? { resolution:  batchResolution  } : {}),
        ...(batchQuality     ? { quality:     batchQuality     } : {}),
        ...(batchDuration    ? { duration:    batchDuration    } : {}),
        ...(batchFps         ? { fps:         batchFps         } : {}),
        // Per-shot values override globals — applied last so they always win
        ...(item.aspectRatio !== undefined ? { aspectRatio: item.aspectRatio } : {}),
        ...(item.resolution  !== undefined ? { resolution:  item.resolution  } : {}),
        ...(item.quality     !== undefined ? { quality:     item.quality     } : {}),
        ...(item.duration    !== undefined ? { duration:    item.duration    } : {}),
        ...(item.fps         !== undefined ? { fps:         item.fps         } : {}),
        ...(item.width       !== undefined ? { width:       item.width       } : {}),
        ...(item.height      !== undefined ? { height:      item.height      } : {}),
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
            const clipCost = result.result?.cost?.totalUsd;
            if (typeof clipCost === "number") {
              batchCost += clipCost;
              batchCostTally.classList.remove("hidden");
              batchCostTally.textContent = "Batch cost so far: $" + batchCost.toFixed(6);
            }
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
          const clipCost = result.result?.cost?.totalUsd;
          if (typeof clipCost === "number") {
            batchCost += clipCost;
            batchCostTally.classList.remove("hidden");
            batchCostTally.textContent = "Batch cost so far: $" + batchCost.toFixed(6);
          }
        } catch (_) {}
      }

      batchProgressLabel.textContent = "Complete — " + batchResultItems.length + " of " + total + " processed";
      batchProgressBar.style.width   = "100%";
      if (batchCost > 0) {
        batchCostTally.classList.remove("hidden");
        batchCostTally.textContent = "Total batch cost: $" + batchCost.toFixed(6);
      }
    } catch (err) {
      batchProgressLabel.textContent = "Error: " + (err.message || err);
      batchProgress.classList.remove("hidden");
    }
  }

  btnBatchRun.addEventListener("click", runBatch);

  /* ── VIDEO TAB ───────────────────────────────────────────── */
  async function handleVideoGenerate() {
    // Guard 1: prompt must be non-empty
    const prompt = videoPromptEl ? videoPromptEl.value.trim() : "";
    if (!prompt) {
      showError(videoOutput, new Error("Please enter a prompt before generating."));
      return;
    }

    // Guard 2: video generation is proxy-only — fail fast with a clear message
    if (modeSelect.value !== "proxy") {
      const modeMsg =
        "Proxy mode required - start the server with: node dist/ai-powered/cli/index.js serve";
      showGlobalError(modeMsg);
      showError(videoOutput, new Error(modeMsg));
      return;
    }

    setLoading([btnVideoGenerate], true);
    showSpinner(videoOutput, "Generating video — this may take a moment…");
    if (videoUsage) videoUsage.textContent = "";

    try {
      let blob;
      let vidResult = null;

      // Use optional chaining on all control refs so the handler is robust
      // even if a control element is missing from the DOM.
      const vidAspectRatio = videoAspectRatio?.value    || undefined;
      const vidResolution  = videoResolution?.value     || undefined;
      const vidQuality     = videoQuality?.value        || undefined;
      const vidDuration    = videoDuration?.value ? parseFloat(videoDuration.value) || undefined : undefined;
      const vidFps         = videoFps?.value      ? parseInt(videoFps.value, 10)    || undefined : undefined;

      vidResult = await proxyPost("/video", {
        prompt,
        // Explicit provider ensures the video-tab picker is honoured even when
        // the global proxy provider is set to a non-video provider.
        provider:    videoProviderSelect?.value || undefined,
        model:       videoModelSelect?.value || undefined,
        aspectRatio: vidAspectRatio,
        resolution:  vidResolution,
        quality:     vidQuality,
        duration:    vidDuration,
        fps:         vidFps,
      });

      if (vidResult.data && isStubVideoData(vidResult.data)) {
        // Mock stub — generate a real playable preview via Canvas
        showSpinner(videoOutput, "Encoding preview…");
        blob = await generatePlaceholderVideoBlob(prompt, 2000);
      } else if (vidResult.data) {
        blob = dataUriToBlob(vidResult.data);
      } else {
        // Provider returned no binary data at all
        videoOutput.innerHTML =
          '<p style="padding:1rem;color:var(--text-muted)">✓ Video generated (no binary preview available)</p>';
        addUsage(vidResult?.usage ?? null, vidResult?.cost ?? null);
        setUsageText(videoUsage, vidResult?.usage ?? null, vidResult?.cost ?? null);
        return;
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
        if (videoUsage) videoUsage.textContent = "Video · " + Math.round(blob.size / 1024) + " KB";
      } else {
        if (videoUsage) videoUsage.textContent += " · " + Math.round(blob.size / 1024) + " KB";
      }
    } catch (err) {
      showError(videoOutput, err);
      showGlobalError("Video generation failed: " + (err instanceof Error ? err.message : String(err)));
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
      showGlobalError("Structured generation failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading([btnStructuredGenerate], false);
    }
  }
  btnStructuredGenerate.addEventListener("click", handleStructuredGenerate);

})(); // end IIFE

