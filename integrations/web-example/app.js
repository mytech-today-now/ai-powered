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
  const directBudgetInput  = $("direct-budget");
  const proxyUrlInput         = $("proxy-url");
  // Pre-fill the proxy URL when served via a public tunnel (e.g. ngrok) so
  // remote visitors don't have to type the API URL manually.
  //
  // Priority order:
  //   1. window.__AI_PROXY_URL__  — injected by the Vite plugin when
  //      VITE_PROXY_URL is set (e.g. the -Ngrok flag in cycle-service.ps1).
  //   2. window.location.origin   — when the page is loaded from a non-localhost
  //      host the Vite dev-server IS the proxy (ngrok → Vite → :3001), so the
  //      page's own origin is the correct proxy base URL.
  //   3. HTML default ("http://localhost:3001") — local-only dev, no override.
  {
    const _host = window.location.hostname;
    const _isLocal = _host === "localhost" || _host === "127.0.0.1" || _host === "";
    const _detected = window.__AI_PROXY_URL__ || (_isLocal ? null : window.location.origin);
    if (_detected) proxyUrlInput.value = _detected;
  }
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

  // File upload controls (Text, Image, Video tabs)
  const fileUploadInput        = $("file-upload-input");
  const fileUploadStatus       = $("file-upload-status");
  const imageFileUploadInput   = $("image-file-upload-input");
  const imageFileUploadStatus  = $("image-file-upload-status");
  const imageFileThumbsEl      = $("image-file-thumbs");
  const videoFileUploadInput   = $("video-file-upload-input");
  const videoFileUploadStatus  = $("video-file-upload-status");
  const videoFileThumbsEl      = $("video-file-thumbs");

  const attachmentNoticeEl = $("attachment-notice");

  const costTotalEl        = $("cost-total");
  const tokensTotalEl      = $("tokens-total");
  const callsTotalEl       = $("calls-total");

  /* ── File upload state ──────────────────────────────────── */
  /** UUID token returned by POST /upload; attached to subsequent generation requests (text tab). */
  let currentFileRef = null;
  /** UUID tokens for image-tab multi-image uploads. */
  let imageFileRefs = [];
  /** UUID tokens for video-tab multi-image uploads (up to 2 for Luma AI). */
  let videoFileRefs = [];

  /**
   * Cached server capability: true when the proxy has PROXY_PUBLIC_BASE_URL set
   * (required for Luma AI image-to-video).  null = not yet fetched.
   */
  let serverLumaImageToVideoEnabled = null;

  /* ── Attachment state ───────────────────────────────────── */
  /** True when the user has a reference image attached; drives provider/model filtering. */
  let hasImageAttached = false;

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
   * Returns the model <select> element that corresponds to the currently
   * active tab.  Used by retriggerAttachmentDropdowns() to reload only the
   * visible model dropdown when the attachment state changes.
   *
   * Audio has two model selects (TTS + transcribe); return the TTS one as the
   * primary so loadModels is called at least once for the audio modality.
   */
  function activeModelSelect() {
    const tab = activeTab();
    if (tab === "image")      return imageModelSelect;
    if (tab === "audio")      return ttsModelSelect;
    if (tab === "video")      return videoModelSelect;
    if (tab === "structured") return structuredModelSelect;
    return textModelSelect; // "text" is the default
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
      (p) =>
        Array.isArray(p.modalities) &&
        p.modalities.includes(modality) &&
        (!hasImageAttached ||
          (Array.isArray(p.inputModalities) && p.inputModalities.includes("image"))),
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
    const budgetUsd = parseFloat(directBudgetInput?.value) || Infinity;
    return createWebClient({
      mode: "direct",
      provider: providerSelect.value,
      apiKey,
      budgetUsd,
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
    if (!dataUri) throw new Error("dataUriToBlob: empty data URI");
    const commaIdx  = dataUri.indexOf(",");
    const header    = commaIdx >= 0 ? dataUri.slice(0, commaIdx) : "";
    const b64       = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
    const mimeMatch = header.match(/:(.*?);/);
    if (!mimeMatch) {
      throw new Error("dataUriToBlob: not a data URI — received: " + dataUri.slice(0, 80));
    }
    return base64ToBlob(b64, mimeMatch[1]);
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
        msg = (Array.isArray(j.issues) && j.issues.length ? j.issues.join("; ") : j.error) || msg;
      } catch (_) {}
      const httpErr = new Error("Server error " + resp.status + ": " + msg);
      showGlobalError(httpErr.message);
      throw httpErr;
    }
    return resp.json();
  }

  async function proxyStream(endpoint, body) {
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    let resp;
    try {
      resp = await fetch(`${base}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error("Network error: " + err.message);
    }
    if (!resp.ok) {
      let msg = "Server error " + resp.status;
      try { const j = await resp.json(); msg = j.error ?? msg; } catch (_) {}
      throw new Error(msg);
    }
    return resp;   // caller reads resp.body
  }

  /**
   * Compresses and/or converts an image File before upload using an off-screen
   * canvas.  This solves two common mobile problems:
   *
   *   1. **HEIC/HEIF** — iOS cameras default to HEIC.  Safari can decode it via
   *      createImageBitmap(); the canvas then re-encodes it as JPEG.  Other
   *      browsers (Chrome/Android) can't decode HEIC, so we throw a clear error
   *      instead of sending a file the server will reject with a cryptic 415.
   *
   *   2. **Large files** — Modern phones produce 8-15 MB JPEGs.  Uploading them
   *      raw over an ngrok tunnel is slow and can time out.  We downsample to
   *      ≤ 2048 px on the long edge and re-encode at 85 % JPEG quality, which
   *      typically brings a 10 MB photo to under 1.5 MB with no visible loss.
   *
   * Files that are already ≤ 5 MiB AND are not HEIC/HEIF are returned unchanged.
   *
   * @param {File} file
   * @returns {Promise<File>} Possibly a new File compressed to JPEG.
   */
  async function compressImageForUpload(file) {
    const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB threshold
    const MAX_DIMENSION    = 2048;             // px on long edge
    const JPEG_QUALITY     = 0.85;

    const nameLower = file.name.toLowerCase();
    const isHeic    = file.type === "image/heic" || file.type === "image/heif" ||
                      nameLower.endsWith(".heic") || nameLower.endsWith(".heif");
    const isImage   = file.type.startsWith("image/");
    const isLarge   = file.size > MAX_UPLOAD_BYTES;

    // Non-images and small non-HEIC images pass through untouched.
    if (!isImage || (!isHeic && !isLarge)) return file;

    // canvas-based conversion (createImageBitmap is broadly supported:
    //   Chrome 50+, Firefox 42+, Safari 15+, Edge 79+).
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (_err) {
      if (isHeic) {
        throw new Error(
          "HEIC/HEIF photos are not supported by this browser. " +
          "On iOS, please use Safari 15+ or convert the photo to JPEG in the Photos app first.",
        );
      }
      // For other large images that fail to decode, pass through and let the
      // server validate — worst case the user gets a 50 MiB limit error.
      return file;
    }

    // Compute target dimensions preserving aspect ratio.
    const scale  = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width  = Math.round(bitmap.width  * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error("Canvas image compression failed.")); return; }
          // Rename HEIC → .jpg; keep original name for other compressed images.
          const outName = isHeic
            ? file.name.replace(/\.[^.]+$/, ".jpg")
            : file.name;
          resolve(new File([blob], outName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  }

  /**
   * Uploads a file to the proxy server's POST /upload endpoint.
   * Stores the returned fileRef token in `currentFileRef` for use in
   * subsequent generation requests.
   *
   * @param {File} file - The File object from an <input type="file"> element.
   * @returns {Promise<string>} The fileRef UUID token.
   */
  async function uploadFile(file) {
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    const provider = proxyProviderSelect.value || undefined;
    const formData = new FormData();
    formData.append("file", file);
    if (provider) formData.append("provider", provider);

    let resp;
    try {
      resp = await fetch(base + "/upload", { method: "POST", body: formData });
    } catch (_networkErr) {
      throw new Error(
        "Cannot reach proxy server at " + base + ". " +
        "Start it with: npm run serve",
      );
    }
    if (!resp.ok) {
      // Parse JSON error body (e.g. { error: "Unsupported file type…" }) so the
      // user sees a plain sentence rather than a raw JSON string.
      let msg = `Server error ${resp.status}`;
      try {
        const j = await resp.json();
        msg = j.error ?? msg;
      } catch (_) {
        try { msg = await resp.text() || msg; } catch (_2) {}
      }
      throw new Error(msg);
    }
    const { fileRef } = await resp.json();
    currentFileRef = fileRef;
    return fileRef;
  }

  /**
   * Wires a file <input> element to `uploadFile()`, updating a status <span>
   * with progress feedback and storing the resulting fileRef token.
   *
   * Before uploading, passes the selected file through compressImageForUpload()
   * to handle HEIC conversion and large-photo downsampling automatically.
   *
   * @param {HTMLInputElement|null} inputEl  - The file input element.
   * @param {HTMLElement|null}      statusEl - The status feedback element.
   * @param {Function|null}         onDone   - Optional callback invoked after upload completes (success or failure).
   */
  function wireFileUpload(inputEl, statusEl, onDone) {
    if (!inputEl || !statusEl) return;
    inputEl.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) {
        // File picker was dismissed without a selection — treat as removal.
        hasImageAttached = false;
        await retriggerAttachmentDropdowns();
        return;
      }
      statusEl.textContent = "Uploading…";
      try {
        const uploadReady = await compressImageForUpload(file);
        const wasCompressed = uploadReady !== file;
        if (wasCompressed) {
          const kb = Math.round(uploadReady.size / 1024);
          statusEl.textContent = `Compressing… (${kb} KB) uploading…`;
        }
        await uploadFile(uploadReady);
        statusEl.textContent = `✓ ${file.name} ready`;
        hasImageAttached = true;
      } catch (err) {
        statusEl.textContent = `✗ Upload failed: ${err.message}`;
        currentFileRef = null;
        hasImageAttached = false;
      }
      await retriggerAttachmentDropdowns();
      if (onDone) onDone();
    });
  }

  /**
   * Uploads a single file to POST /upload without updating `currentFileRef`.
   * Used by multi-file upload flows where refs are stored in per-tab arrays.
   *
   * @param {File} file
   * @returns {Promise<string>} The fileRef UUID token.
   */
  async function uploadFileRaw(file) {
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    const provider = proxyProviderSelect.value || undefined;
    const formData = new FormData();
    formData.append("file", file);
    if (provider) formData.append("provider", provider);
    let resp;
    try {
      resp = await fetch(base + "/upload", { method: "POST", body: formData });
    } catch (_) {
      throw new Error("Cannot reach proxy server at " + base + ". Start it with: npm run serve");
    }
    if (!resp.ok) {
      let msg = `Server error ${resp.status}`;
      try { const j = await resp.json(); msg = j.error ?? msg; } catch (_) {}
      throw new Error(msg);
    }
    const { fileRef } = await resp.json();
    return fileRef;
  }

  /**
   * Wires a multi-file <input> for image/video tabs.
   *
   * Each time the user selects files the entire list is cleared and re-uploaded.
   * A thumbnail gallery is rendered with per-item remove buttons so users can
   * deselect individual images before generating.
   *
   * @param {HTMLInputElement}  inputEl    - The file input (must have `multiple`).
   * @param {HTMLElement}       statusEl   - Status feedback <span>.
   * @param {HTMLElement}       thumbsEl   - Container for thumbnail previews.
   * @param {string[]}          refsArray  - Per-tab mutable array that receives UUID tokens.
   * @param {Function|null}     onDone     - Optional callback after upload cycle completes.
   */
  function wireMultiFileUpload(inputEl, statusEl, thumbsEl, refsArray, onDone) {
    if (!inputEl || !statusEl) return;

    function clearThumbs() {
      refsArray.length = 0;
      if (thumbsEl) { thumbsEl.innerHTML = ""; thumbsEl.classList.add("hidden"); }
    }

    function addThumb(file, fileRef) {
      if (!thumbsEl) return;
      const wrap = document.createElement("div");
      wrap.className = "file-thumb";
      wrap.dataset.fileRef = fileRef;

      const img = document.createElement("img");
      img.alt = file.name;
      const objUrl = URL.createObjectURL(file);
      img.src = objUrl;
      img.onload = () => URL.revokeObjectURL(objUrl);

      const btn = document.createElement("button");
      btn.className = "file-thumb-remove";
      btn.title = "Remove " + file.name;
      btn.textContent = "✕";
      btn.addEventListener("click", () => {
        const idx = refsArray.indexOf(fileRef);
        if (idx !== -1) refsArray.splice(idx, 1);
        wrap.remove();
        if (!thumbsEl.children.length) thumbsEl.classList.add("hidden");
        const count = refsArray.length;
        statusEl.textContent = count === 0 ? "No files attached"
          : count === 1 ? "1 file attached"
          : count + " files attached";
        hasImageAttached = refsArray.length > 0;
        if (onDone) onDone();
      });

      wrap.appendChild(img);
      wrap.appendChild(btn);
      thumbsEl.appendChild(wrap);
      thumbsEl.classList.remove("hidden");
    }

    inputEl.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      clearThumbs();
      if (!files.length) {
        statusEl.textContent = "No files attached";
        hasImageAttached = false;
        await retriggerAttachmentDropdowns();
        if (onDone) onDone();
        return;
      }
      statusEl.textContent = `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`;
      let successCount = 0;
      let lastErr = null;
      for (const file of files) {
        try {
          const uploadReady = await compressImageForUpload(file);
          const ref = await uploadFileRaw(uploadReady);
          refsArray.push(ref);
          addThumb(file, ref);
          successCount++;
        } catch (err) {
          lastErr = err;
        }
      }
      if (successCount === 0) {
        statusEl.textContent = `✗ Upload failed: ${lastErr?.message ?? "unknown error"}`;
        hasImageAttached = false;
      } else if (lastErr) {
        statusEl.textContent = `⚠ ${successCount} of ${files.length} uploaded`;
        hasImageAttached = true;
      } else {
        statusEl.textContent = successCount === 1 ? "1 file attached" : successCount + " files attached";
        hasImageAttached = true;
      }
      // Reset input so re-selecting the same files triggers a new change event.
      inputEl.value = "";
      await retriggerAttachmentDropdowns();
      if (onDone) onDone();
    });
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
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    try {
      const provider = providerHint !== undefined ? providerHint : proxyProviderSelect.value;
      let url = base + "/models?modality=" + modality;
      if (provider) url += "&provider=" + provider;
      if (hasImageAttached) url += "&accepts=image";
      let models = await fetch(url).then((r) => r.json());

      // T-22 fallback: Audio and Structured tabs have no image-aware models.
      // When the filtered list is empty (because &accepts=image yielded nothing),
      // reload without the image filter so the dropdown is never stranded empty.
      // The attachment notice ("image will be ignored") is shown separately via
      // updateAttachmentNotice(), which is called by switchTab and
      // retriggerAttachmentDropdowns after this function returns.
      if (hasImageAttached && Array.isArray(models) && models.length === 0) {
        const fallbackUrl = base + "/models?modality=" + modality +
          (provider ? "&provider=" + provider : "");
        models = await fetch(fallbackUrl).then((r) => r.json());
      }

      selectEl.innerHTML = '<option value="">Default</option>';
      models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        selectEl.appendChild(opt);
      });
    } catch (err) {
      if (selectEl.options.length === 1) {
        selectEl.options[0].text = "Default (server unreachable)";
      }
      if (err instanceof TypeError) {
        showGlobalError(
          `Cannot reach proxy at ${base} — models could not be loaded`
        );
      }
      // Non-TypeError errors (SyntaxError from non-JSON 502) are silent —
      // the provider list may still load; models failing alone is less critical.
    }
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
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    try {
      const data = await fetch(base + "/providers").then((r) => r.json());
      allProviders = data; // cache full list (including inactive) for modality filtering
      refreshProviderDropdown(TAB_MODALITY[activeTab()] ?? "text");
      refreshVideoProviderDropdown(); // populate the video-tab-specific dropdown
      clearGlobalError();
    } catch (err) {
      if (err instanceof TypeError) {
        showGlobalError(
          `Cannot reach proxy at ${base} — start it with: npm run serve`
        );
      } else {
        showGlobalError(`Proxy error while loading providers: ${err.message}`);
      }
    }
    await loadAllModels();
    await fetchServerCaps();
  }

  /**
   * Fetches GET /health and caches the lumaImageToVideoEnabled capability flag.
   * Called after providers load (proxy URL is known to be reachable at that point).
   */
  async function fetchServerCaps() {
    if (modeSelect.value !== "proxy") return;
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    try {
      const health = await fetch(base + "/health").then((r) => r.json());
      serverLumaImageToVideoEnabled = health.lumaImageToVideoEnabled ?? false;
    } catch {
      serverLumaImageToVideoEnabled = false;
    }
    updateLumaTunnelWarn();
  }

  /**
   * Shows or hides the Luma AI tunnel warning banner based on three conditions:
   *   1. The selected video provider is "lumaai"
   *   2. A reference image has been uploaded (currentFileRef is set)
   *   3. The server does NOT have PROXY_PUBLIC_BASE_URL configured
   */
  function updateLumaTunnelWarn() {
    const warn = document.getElementById("video-luma-tunnel-warn");
    if (!warn) return;
    const provider   = videoProviderSelect?.value || "";
    const hasFile    = videoFileRefs.length > 0;
    const needsTunnel = provider === "lumaai" && hasFile && serverLumaImageToVideoEnabled === false;
    warn.classList.toggle("hidden", !needsTunnel);
  }

  /**
   * Updates the attachment notice element based on the current `hasImageAttached`
   * state and the active tab's modality.
   *
   * - When `hasImageAttached` is true on a modality that supports image input
   *   (text / image / video): shows the filtering notice.
   * - When `hasImageAttached` is true on a modality that does NOT support image
   *   input (audio / structured): shows the "image will be ignored" fallback.
   * - When `hasImageAttached` is false: clears the notice.
   *
   * Called by T-20 attachment-state handlers after `hasImageAttached` is updated.
   */
  function updateAttachmentNotice() {
    if (!attachmentNoticeEl) return;
    if (!hasImageAttached) {
      attachmentNoticeEl.textContent = "";
      return;
    }
    const modality = TAB_MODALITY[activeTab()] ?? "text";
    const imageUnsupported = modality === "audio" || modality === "structured";
    attachmentNoticeEl.textContent = imageUnsupported
      ? "The attached image will be ignored for this modality."
      : "Showing only models that accept image input. Remove the attachment to see all models.";
  }

  /**
   * Re-populates the provider dropdown and the active tab's model dropdown to
   * reflect the current `hasImageAttached` state.  Called whenever the user
   * attaches or removes a reference image so that only models compatible with
   * the new input set are shown.
   *
   * Only runs when the app is in proxy mode and providers have been loaded;
   * a no-op otherwise so it is safe to call unconditionally.
   */
  async function retriggerAttachmentDropdowns() {
    if (modeSelect.value !== "proxy" || allProviders.length === 0) return;
    const modality = TAB_MODALITY[activeTab()] ?? "text";
    refreshProviderDropdown(modality);
    await loadModels(modality, activeModelSelect());
    updateAttachmentNotice();
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

  // Reload only video models when the video-tab provider changes;
  // also refresh the Luma tunnel warning since the provider affects whether it is needed.
  if (videoProviderSelect) {
    videoProviderSelect.addEventListener("change", () => {
      loadVideoModels(videoProviderSelect.value);
      updateLumaTunnelWarn();
    });
  }

  // Sync constraint dropdowns when the video model selection changes
  if (videoModelSelect) {
    videoModelSelect.addEventListener("change", () => {
      const descriptor = videoModelsCache.find((m) => m.id === videoModelSelect.value) ?? null;
      syncVideoConstraints(descriptor);
    });
  }

  // Wire file upload inputs (proxy-only feature — gracefully no-ops in direct mode).
  // The video upload passes updateLumaTunnelWarn as a callback so the warning
  // banner appears/disappears immediately after the image is attached or rejected.
  wireFileUpload(fileUploadInput,       fileUploadStatus);
  wireMultiFileUpload(imageFileUploadInput, imageFileUploadStatus, imageFileThumbsEl, imageFileRefs);
  wireMultiFileUpload(videoFileUploadInput, videoFileUploadStatus, videoFileThumbsEl, videoFileRefs, updateLumaTunnelWarn);

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
    // T-22: loadModels now falls back to the unfiltered list when hasImageAttached=true
    // yields an empty model list (e.g. Audio / Structured tabs).
    if (modeSelect.value === "proxy" && allProviders.length > 0) {
      refreshProviderDropdown(TAB_MODALITY[target] ?? "text");
      loadAllModels();
    }

    // T-22: Always sync the attachment notice on tab switch so that switching to
    // Audio or Structured while an image is attached immediately shows
    // "The attached image will be ignored for this modality." without waiting
    // for the async model reload to complete.
    updateAttachmentNotice();
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
    if (role === 'assistant') {
      createReplyToolbar(wrap, {
        modality: 'text', text: content,
        dataUrl: null, srcUrl: null,
        mimeType: 'text/plain', filename: 'ai-reply.txt'
      });
    }
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
        const model   = textModelSelect.value || undefined;
        const payload = { prompt: fullPrompt };
        if (model)          payload.model   = model;
        if (currentFileRef) payload.fileRef = currentFileRef;
        result = await proxyPost("/text", payload);
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
      createReplyToolbar(textOutput, {
        modality: 'text', text: reply,
        dataUrl: null, srcUrl: null,
        mimeType: 'text/plain', filename: 'ai-reply.txt'
      });

      setUsageText(textUsage, result.usage, result.cost);
      addUsage(result.usage, result.cost);
    } catch (err) {
      showError(textOutput, err);
      if (err?.name === "BudgetExceededError") {
        showGlobalError(
          `Budget exceeded: $${err.spentUsd.toFixed(4)} spent of ` +
          `$${err.budgetUsd.toFixed(2)} limit.`
        );
        return;
      }
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
        const provider = proxyProviderSelect.value || undefined;
        const model    = textModelSelect.value    || undefined;
        const payload  = { prompt: fullPrompt, stream: true };
        if (provider)       payload.provider = provider;
        if (model)          payload.model    = model;
        if (currentFileRef) payload.fileRef  = currentFileRef;
        const resp   = await proxyStream("/text", payload);
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
      createReplyToolbar(textOutput, {
        modality: 'text', text: accumulated,
        dataUrl: null, srcUrl: null,
        mimeType: 'text/plain', filename: 'ai-reply.txt'
      });
      addUsage(null, null); // streaming — no cost breakdown available
    } catch (err) {
      showError(textOutput, err);
      if (err?.name === "BudgetExceededError") {
        showGlobalError(
          `Budget exceeded: $${err.spentUsd.toFixed(4)} spent of ` +
          `$${err.budgetUsd.toFixed(2)} limit.`
        );
        return;
      }
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
        const imgPayload = {
          prompt,
          model:       imageModelSelect.value || undefined,
          aspectRatio: imgAspectRatio,
          width:       imgWidth,
          height:      imgHeight,
          quality:     imgQuality,
        };
        if (imageFileRefs.length === 1) {
          imgPayload.fileRef = imageFileRefs[0];
        } else if (imageFileRefs.length > 1) {
          imgPayload.fileRefs = imageFileRefs.slice();
        }
        imgResult = await proxyPost("/image", imgPayload);
        // Proxy may return a data URI ("data:image/png;base64,…"), a plain
        // URL ("https://…"), or raw base64 in b64_json — handle all three,
        // mirroring the same pattern used by the video handler below.
        if (imgResult.data && imgResult.data.startsWith("data:")) {
          blob = dataUriToBlob(imgResult.data);
        } else if (imgResult.data && /^https?:\/\//.test(imgResult.data)) {
          const imgResp = await fetch(imgResult.data);
          blob = await imgResp.blob();
        } else if (imgResult.b64_json) {
          blob = base64ToBlob(imgResult.b64_json, imgResult.mimeType || "image/png");
        } else {
          throw new Error("No image data returned from proxy.");
        }
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
      createReplyToolbar(imageOutput, {
        modality: 'image', text: null,
        dataUrl: (imgResult?.data?.startsWith('data:') ? imgResult.data : null),
        srcUrl: imgResult?.url ?? (imgResult?.data && /^https?:\/\//.test(imgResult.data) ? imgResult.data : url),
        mimeType: imgResult?.mimeType ?? blob.type ?? 'image/png',
        filename: 'ai-image.png'
      });
      addUsage(imgResult?.usage ?? null, imgResult?.cost ?? null);
      setUsageText(imageUsage, imgResult?.usage ?? null, imgResult?.cost ?? null);
      if (!imgResult?.usage?.totalTokens && !imgResult?.cost) {
        imageUsage.textContent = "Image generated · " + Math.round(blob.size / 1024) + " KB";
      } else {
        imageUsage.textContent += " · " + Math.round(blob.size / 1024) + " KB";
      }
    } catch (err) {
      showError(imageOutput, err);
      if (err?.name === "BudgetExceededError") {
        showGlobalError(
          `Budget exceeded: $${err.spentUsd.toFixed(4)} spent of ` +
          `$${err.budgetUsd.toFixed(2)} limit.`
        );
        return;
      }
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
      createReplyToolbar(ttsOutput, {
        modality: 'audio', text: null,
        dataUrl: null, srcUrl: url,
        mimeType: ttsResult?.mimeType ?? 'audio/mpeg', filename: 'ai-speech.mp3'
      });
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
      if (err?.name === "BudgetExceededError") {
        showGlobalError(
          `Budget exceeded: $${err.spentUsd.toFixed(4)} spent of ` +
          `$${err.budgetUsd.toFixed(2)} limit.`
        );
        return;
      }
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
      createReplyToolbar(transcribeOutput, {
        modality: 'text', text,
        dataUrl: null, srcUrl: null,
        mimeType: 'text/plain', filename: 'transcript.txt'
      });
      addUsage(transcribeResult?.usage ?? null, transcribeResult?.cost ?? null);
      setUsageText(audioUsage, transcribeResult?.usage ?? null, transcribeResult?.cost ?? null);
    } catch (err) {
      showError(transcribeOutput, err);
      if (err?.name === "BudgetExceededError") {
        showGlobalError(
          `Budget exceeded: $${err.spentUsd.toFixed(4)} spent of ` +
          `$${err.budgetUsd.toFixed(2)} limit.`
        );
        return;
      }
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
  let batchAbortController = null;

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

  /** Matches an optional modality tag at the end of a Markdown heading line. */
  const MODALITY_TAG_RE = /[\[(](video|image|text|audio)[\])]\s*$/i;

  /**
   * Extract the modality from a raw heading string.
   * Returns the matched tag value (lower-cased) or "video" if absent.
   * @param {string} heading
   * @returns {string}
   */
  function parseHeadingModality(heading) {
    const m = MODALITY_TAG_RE.exec(heading);
    return m ? m[1].toLowerCase() : "video";
  }

  /**
   * Parse a Markdown shot-list file.
   * Looks for headings as shot names and paragraph text as prompts.
   * Pattern: ## Shot N\nPrompt text…
   */
  function parseMdFile(text) {
    const items = [];
    const lines = text.split("\n");
    let currentName     = null;
    let currentModality = "video";
    let promptLines     = [];

    function flush() {
      if (!currentName) return;
      const prompt = promptLines.join(" ").replace(/\s+/g, " ").trim();
      if (prompt) items.push({ name: currentName, prompt, modality: currentModality });
      currentModality = "video";
      promptLines = [];
    }

    for (const raw of lines) {
      const line = raw.trim();
      const headingMatch = line.match(/^#{1,4}\s+(.+)/);
      if (headingMatch) {
        flush();
        const rawHeading = headingMatch[1].trim();
        currentModality  = parseHeadingModality(rawHeading);
        currentName      = rawHeading.replace(MODALITY_TAG_RE, "").trim();
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
      const base = proxyUrlInput.value.trim() || "http://localhost:3001";
      const url  = `${base}/pricing?modality=video&model=${encodeURIComponent(model)}`;
      const res  = await fetch(url, { signal: preflightAbortController.signal });
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

    if (items.some(it => !it._id)) console.warn('[showBatchPreflight] one or more items missing _id — check parse sites');

    const ul = document.createElement("ul");
    ul.className = "shot-preview-list";
    items.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "shot-preview-item";
      li.dataset.shotId = item._id; // used by runPreflightProviderChecks
      const modality = item.modality || "video";

      // Label + prompt excerpt (wrapped so the × button stays right-aligned)
      const labelSpan = document.createElement("span");
      labelSpan.className = "shot-preview-label";
      labelSpan.textContent = (i + 1) + ". " + item.name;
      const badge = document.createElement("span");
      badge.className = `modality-badge modality-badge--${modality}`;
      badge.textContent = modality;
      labelSpan.appendChild(badge);
      const em = document.createElement("em");
      em.textContent = item.prompt.length > 80 ? item.prompt.slice(0, 80) + "…" : item.prompt;
      labelSpan.appendChild(em);

      // Placeholder status icon for video items with images — updated asynchronously (AC-15)
      if (modality === "video" && item.images && item.images.length > 0) {
        const statusIcon = document.createElement("span");
        statusIcon.className = "shot-preflight-status";
        statusIcon.dataset.shotId = item._id;
        statusIcon.textContent = "⏳";
        statusIcon.title = "Checking provider compatibility…";
        statusIcon.style.cssText = "margin-left:.4em;font-size:.9em";
        labelSpan.appendChild(statusIcon);
      }

      li.appendChild(labelSpan);

      // Remove button
      const removeBtn = document.createElement("button");
      removeBtn.className = "shot-preview-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove this shot from the batch";
      removeBtn.dataset.id = item._id;
      removeBtn.addEventListener("click", function () {
        const id  = this.dataset.id;
        const idx = batchItems.findIndex(x => x._id === id);
        if (idx !== -1) { batchItems.splice(idx, 1); showBatchPreflight(batchItems); }
      });
      li.appendChild(removeBtn);

      ul.appendChild(li);
    });
    const p = document.createElement("p");
    p.innerHTML = "<strong>" + items.length + " shot" + (items.length !== 1 ? "s" : "") + "</strong> loaded and ready to process.";
    batchSummary.appendChild(p);
    batchSummary.appendChild(ul);
    btnBatchRun.disabled = false;
    btnBatchRun.title = "";

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

    // Fire provider pre-flight checks non-blocking (D3: client-side selectI2VProvider, no round-trip)
    runPreflightProviderChecks(items, ul).catch(() => { /* silently ignore if checks fail */ });
  }

  /**
   * Runs async I2V provider + URL reachability checks for each video shot
   * that declares an images[] array.  Updates per-shot status icons in-place.
   *
   * AC-15: Uses client-side selectI2VProvider (design D3) — server re-validates on submit.
   *
   * Status icons:
   *   ✅  All image URLs reachable and selected provider can handle the image count.
   *   ⚠️  Provider will route or truncate (amber) — still runnable.
   *   ❌  No live provider available OR at least one image URL unreachable — Run disabled.
   */
  async function runPreflightProviderChecks(items, listEl) {
    const videoImageItems = items.filter(
      item => (item.modality || "video") === "video" && item.images && item.images.length > 0,
    );
    if (!videoImageItems.length) return;

    // Fetch live video providers from the server (best-effort; empty list if unavailable)
    let liveProviders = [];
    if (modeSelect.value === "proxy") {
      const base = proxyUrlInput.value.trim() || "http://localhost:3001";
      try {
        const resp = await fetch(`${base}/providers`);
        if (resp.ok) {
          const all = await resp.json();
          liveProviders = all
            .filter(p => p.active && Array.isArray(p.modalities) && p.modalities.includes("video"))
            .map(p => p.id);
        }
      } catch { /* server unreachable — liveProviders remains [] */ }
    }

    // Dynamically import the ESM routing module (D3: mirrors server-side logic)
    let selectI2VProvider;
    try {
      const mod = await import("./smart-default.js");
      selectI2VProvider = mod.selectI2VProvider;
    } catch { return; /* module unavailable — skip checks silently */ }

    // Determine the provider currently selected in the video-tab UI
    const selectedProvider =
      (videoProviderSelect ? videoProviderSelect.value : null) ||
      (proxyProviderSelect ? proxyProviderSelect.value : null) ||
      "openai";

    let hasBlockingError = false;

    // Check all items in parallel for speed
    await Promise.all(videoImageItems.map(async (item) => {
      const urls = item.images;

      // HTTP HEAD checks — parallel per URL, 5 s timeout each
      const headResults = await Promise.all(urls.map(async (url) => {
        try {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 5000);
          const r = await fetch(url, { method: "HEAD", signal: ac.signal });
          clearTimeout(timer);
          return r.ok;
        } catch { return false; }
      }));
      const allUrlsOk = headResults.every(Boolean);
      const firstBadIdx = headResults.findIndex(ok => !ok);

      // Routing decision from client-side selectI2VProvider
      const routing = selectI2VProvider(selectedProvider, urls.length, liveProviders);
      const noLiveProvider = !liveProviders.length;

      // Derive icon + tooltip
      let icon, title, isBlocker = false;
      if (!allUrlsOk) {
        icon = "❌"; isBlocker = true;
        title = "Image URL unreachable: " + urls[firstBadIdx];
      } else if (noLiveProvider && urls.length > 0) {
        icon = "❌"; isBlocker = true;
        title = "No live video provider available — start the proxy with a valid API key";
      } else if (routing.warning) {
        icon = "⚠️";
        title = routing.warning;
        if (routing.alternativeProviders && routing.alternativeProviders.length) {
          title += " (alternatives: " + routing.alternativeProviders.join(", ") + ")";
        }
      } else {
        icon = "✅";
        title = "Provider: " + routing.provider + " · " + urls.length + " image(s) accepted";
      }

      if (isBlocker) hasBlockingError = true;

      // Update the status icon element already in the DOM
      const statusEl = listEl.querySelector('.shot-preflight-status[data-shot-id="' + item._id + '"]');
      if (statusEl) {
        statusEl.textContent = icon;
        statusEl.title = title;
        statusEl.style.color = isBlocker
          ? "var(--danger, #b91c1c)"
          : (icon === "⚠️" ? "var(--amber, #d97706)" : "");
      }
    }));

    // Disable the Run button when any shot has a hard error (AC-15)
    if (hasBlockingError) {
      btnBatchRun.disabled = true;
      btnBatchRun.title =
        "One or more shots have unreachable image URLs or no available provider. " +
        "Remove or fix them before running.";
    }
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
      batchItems.forEach(item => { item._id = item._id ?? crypto.randomUUID(); });
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
      batchItems.forEach(item => { item._id = item._id ?? crypto.randomUUID(); });
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

    // ── Routing metadata (from NDJSON routingMeta fields added by the batch handler) ──
    // These fields are only present when provider selection differed from the request
    // or when routing produced a warning / informational note (D6: absent ≠ null).
    if (result.providerUsed || result.warning || result.info || result.alternativeProviders?.length) {
      const metaSection = document.createElement("div");
      metaSection.className = "shot-routing-meta";
      metaSection.style.cssText =
        "margin-top:.5rem;padding:.4rem .6rem;border-radius:.35rem;" +
        "background:var(--surface2,#f1f5f9);font-size:.78rem;line-height:1.5;";

      if (result.providerUsed) {
        const row = document.createElement("p");
        row.style.margin = "0";
        row.innerHTML = "<strong>Provider used:</strong> " + escHtml(result.providerUsed);
        metaSection.appendChild(row);
      }

      if (result.warning) {
        const row = document.createElement("p");
        row.style.cssText = "margin:0;color:var(--amber,#b45309)";
        row.innerHTML = "⚠️ <strong>Warning:</strong> " + escHtml(result.warning);
        metaSection.appendChild(row);
      }

      if (result.info) {
        const row = document.createElement("p");
        row.style.cssText = "margin:0;color:var(--muted,#6b7280)";
        row.innerHTML = "ℹ️ " + escHtml(result.info);
        metaSection.appendChild(row);
      }

      if (result.alternativeProviders && result.alternativeProviders.length) {
        const row = document.createElement("p");
        row.style.margin = "0";
        row.innerHTML =
          "<strong>Alternatives:</strong> " +
          result.alternativeProviders.map(escHtml).join(", ");
        metaSection.appendChild(row);
      }

      body.appendChild(metaSection);
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

    batchAbortController = new AbortController();
    let batchCost = 0;
    let malformedCount = 0;
    let done_count = 0;
    btnBatchRun.disabled = true;
    btnCancelBatch.style.display = "inline-flex";

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
    batchProgressBar.classList.remove("progress-bar--error");
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
        // Image URLs for I2V routing — passed through verbatim; server trims to effectiveImageCount
        ...(item.images && item.images.length ? { images: item.images } : {}),
      })),
    };

    try {
      const resp = await fetch(proxyBase + "/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: batchAbortController.signal,
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
          } catch (_) { malformedCount++; }
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
      if (malformedCount > 0) {
        batchProgressLabel.textContent += ` · ⚠ ${malformedCount} malformed line(s) skipped`;
      }
      batchProgressBar.style.width   = "100%";
      if (batchCost > 0) {
        batchCostTally.classList.remove("hidden");
        batchCostTally.textContent = "Total batch cost: $" + batchCost.toFixed(6);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        batchProgressLabel.textContent =
          `Cancelled — ${done_count} of ${total} processed`;
      } else {
        showGlobalError("Batch failed: " + err.message);
        batchProgressBar.classList.add("progress-bar--error");
        batchProgress.classList.remove("hidden");
      }
    } finally {
      btnBatchRun.disabled = false;
      btnCancelBatch.style.display = "none";
    }
  }

  btnBatchRun.addEventListener("click", runBatch);

  const btnCancelBatch = document.getElementById("btn-cancel-batch");
  btnCancelBatch.addEventListener("click", () => {
    batchAbortController?.abort();
  });

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

    // Guard 3: Luma AI image-to-video requires PROXY_PUBLIC_BASE_URL to be set.
    // Fail fast before the API call so the user gets an actionable message immediately.
    const _videoProvider = videoProviderSelect?.value || "";
    if (_videoProvider === "lumaai" && videoFileRefs.length > 0 && serverLumaImageToVideoEnabled === false) {
      showError(
        videoOutput,
        new Error(
          "Luma AI image-to-video requires a public tunnel.\n" +
          "Restart the proxy with:  .\\scripts\\cycle-service.ps1 -Ngrok\n" +
          "Or set PROXY_PUBLIC_BASE_URL to your server's public address before starting.",
        ),
      );
      return;
    }

    setLoading([btnVideoGenerate], true);
    showSpinner(videoOutput, "Generating video — this may take a moment…");
    if (videoUsage) videoUsage.textContent = "";

    try {
      // Collect video controls from DOM elements (use optional chaining so the
      // handler is robust even if a control element is missing from the DOM).
      const videoOptions = {};
      const ar = videoAspectRatio?.value;
      if (ar)   videoOptions.aspectRatio = ar;
      const vidRes = videoResolution?.value;
      if (vidRes)  videoOptions.resolution  = vidRes;
      const qual = videoQuality?.value;
      if (qual) videoOptions.quality     = qual;
      const dur = Number(videoDuration?.value);
      if (dur > 0) videoOptions.duration = dur;
      const fpsVal = Number(videoFps?.value);
      if (fpsVal > 0) videoOptions.fps   = fpsVal;

      // Forward the video-tab-specific provider and model to the proxy so the
      // correct provider (e.g. Luma AI) is selected instead of the server default.
      // proxyPost() also injects the global provider when the payload lacks one.
      const videoProvider = videoProviderSelect?.value || undefined;
      const videoModel    = videoModelSelect?.value || undefined;
      if (videoProvider)  videoOptions.provider = videoProvider;
      if (videoModel)     videoOptions.model    = videoModel;
      // Attach the uploaded image references for image-to-video generation.
      if (videoFileRefs.length === 1) {
        videoOptions.fileRef = videoFileRefs[0];
      } else if (videoFileRefs.length > 1) {
        videoOptions.fileRefs = videoFileRefs.slice();
      }

      // Call proxyPost directly (like image/audio/structured tabs) so the request
      // is not funnelled through the pre-built UMD bundle, which would silently
      // drop the provider/model/fileRef fields added above.
      const videoResult = await proxyPost("/video", { prompt, ...videoOptions });

      // Convert the JSON response to a Blob.  The proxy may return:
      //   • data   – data URI  ("data:video/mp4;base64,…")  — Luma, mock
      //   • b64_json + mimeType – raw base64 with separate mime field
      //   • url    – public URL (fetch it client-side)
      let blob;
      if (videoResult.data) {
        blob = dataUriToBlob(videoResult.data);
      } else if (videoResult.b64_json) {
        blob = base64ToBlob(videoResult.b64_json, videoResult.mimeType || "video/mp4");
      } else if (videoResult.url) {
        const vidResp = await fetch(videoResult.url);
        blob = await vidResp.blob();
      } else {
        throw new Error("No video data returned from proxy.");
      }

      // Stub detection: mock providers return a tiny payload (≤ 6 decoded bytes).
      // Generate a real playable Canvas preview so the UI has something to show.
      if (blob.size <= 6) {
        showSpinner(videoOutput, "Encoding preview…");
        const placeholderBlob = await generatePlaceholderVideoBlob(prompt, 2000);
        const url = blobUrl("video", placeholderBlob);
        videoOutput.innerHTML = "";
        const video = document.createElement("video");
        video.className = "output-video";
        video.controls  = true;
        video.src       = url;
        videoOutput.appendChild(video);
        addUsage(null, null);
        setUsageText(videoUsage, null, null);
        if (videoUsage) videoUsage.textContent = "Video · " + Math.round(placeholderBlob.size / 1024) + " KB (preview)";
        return;
      }

      const url = blobUrl("video", blob);
      videoOutput.innerHTML = "";
      const video = document.createElement("video");
      video.className = "output-video";
      video.controls  = true;
      video.src       = url;
      videoOutput.appendChild(video);
      createReplyToolbar(videoOutput, {
        modality: 'video', text: null,
        dataUrl: videoResult?.data ?? null,
        srcUrl: videoResult?.url ?? null,
        mimeType: 'video/mp4', filename: 'ai-video.mp4'
      });
      addUsage(videoResult?.usage ?? null, videoResult?.cost ?? null);
      setUsageText(videoUsage, videoResult?.usage ?? null, videoResult?.cost ?? null);
      if (videoUsage) videoUsage.textContent = "Video · " + Math.round(blob.size / 1024) + " KB";
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
      if (err?.name === "BudgetExceededError") {
        showGlobalError(
          `Budget exceeded: $${err.spentUsd.toFixed(4)} spent of ` +
          `$${err.budgetUsd.toFixed(2)} limit.`
        );
        return;
      }
      showGlobalError("Structured generation failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading([btnStructuredGenerate], false);
    }
  }
  btnStructuredGenerate.addEventListener("click", handleStructuredGenerate);

  /* ── Live character counters ─────────────────────────────── */
  /**
   * Wires a live character counter to every <textarea> that has a
   * matching <span id="<textarea-id>-counter">.
   *
   * If the counter span has a data-maxlength attribute the display shows
   * "<current> / <max>" and the span gains:
   *   .char-counter--warn  when > 80 % of the limit is used
   *   .char-counter--over  when the limit is exceeded
   */
  function initCharCounters() {
    document.querySelectorAll("textarea").forEach(function (ta) {
      const counter = document.getElementById(ta.id + "-counter");
      if (!counter) return;
      const max = counter.dataset.maxlength ? parseInt(counter.dataset.maxlength, 10) : null;

      function update() {
        const len = ta.value.length;
        counter.textContent = max !== null ? len + " / " + max : len;
        if (max !== null) {
          counter.classList.toggle("char-counter--over", len > max);
          counter.classList.toggle("char-counter--warn", len > max * 0.8 && len <= max);
        }
      }

      ta.addEventListener("input", update);
      update(); // populate immediately with initial value
    });
  }

  initCharCounters();

  /* ── Reply Toolbar ─────────────────────────────────────────────── */

  /**
   * @typedef {Object} ReplyDescriptor
   * @property {'text'|'image'|'audio'|'video'} modality
   * @property {string|null} text     Raw reply text (text and transcript replies)
   * @property {string|null} dataUrl  base-64 data URL (blobs returned by provider)
   * @property {string|null} srcUrl   Remote HTTPS URL to the asset
   * @property {string|null} mimeType e.g. 'image/png', 'video/mp4', 'audio/mpeg'
   * @property {string|null} filename Suggested download filename, e.g. 'ai-reply.txt'
   */

  /**
   * Inject a floating action toolbar into the top-right corner of `container`.
   * @param {HTMLElement} container   The visible output wrapper element.
   * @param {ReplyDescriptor} descriptor
   */
  function createReplyToolbar(container, descriptor) {
    container.style.position = 'relative';

    const toolbar = document.createElement('div');
    toolbar.className = 'reply-toolbar';

    const { modality } = descriptor;
    const isSecure = window.isSecureContext;

    // Copy button
    if (modality === 'text' || modality === 'image' ||
        (modality === 'audio' && descriptor.text)) {
      const copyBtn = createToolbarBtn('⎘',
        modality === 'image' && !isSecure
          ? 'Copy unavailable (requires HTTPS)'
          : modality === 'audio' ? 'Copy transcript' : 'Copy reply',
        async () => { await copyReplyContent(descriptor, copyBtn); }
      );
      if (modality === 'image' && !isSecure) copyBtn.style.display = 'none';
      toolbar.appendChild(copyBtn);
    }

    // Save button
    const saveBtn = createToolbarBtn('⬇', 'Save reply',
      async () => { await saveReplyContent(descriptor, saveBtn); }
    );
    if (modality === 'video' && typeof isStubVideoData === 'function' &&
        isStubVideoData(descriptor.dataUrl)) {
      saveBtn.disabled = true;
      saveBtn.title = 'Save unavailable (stub data)';
    }
    toolbar.appendChild(saveBtn);

    // Search button (text only)
    if (modality === 'text') {
      const searchBar = createSearchBar(container);
      const searchBtn = createToolbarBtn('🔍', 'Search reply', () => {
        activateInlineSearch(container, searchBtn);
      });
      toolbar.appendChild(searchBtn);
      container.insertBefore(toolbar, container.firstChild);
      container.insertBefore(searchBar, toolbar.nextSibling);
      return;
    }

    container.insertBefore(toolbar, container.firstChild);
  }

  function createToolbarBtn(label, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'reply-toolbar-btn';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createSearchBar(container) {
    const bar = document.createElement('div');
    bar.className = 'reply-search-bar hidden';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'reply-search-input';
    input.placeholder = 'Regex search…';
    input.setAttribute('aria-label', 'Search within reply');

    const counter = document.createElement('span');
    counter.className = 'reply-search-counter';
    counter.setAttribute('aria-live', 'polite');
    counter.setAttribute('aria-atomic', 'true');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'reply-toolbar-btn';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close search');
    closeBtn.addEventListener('click', () => {
      bar.classList.add('hidden');
      clearSearchHighlights(container);
      counter.textContent = '';
    });

    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applySearchHighlights(container, input, counter), 500);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        bar.classList.add('hidden');
        clearSearchHighlights(container);
        counter.textContent = '';
      }
    });

    bar.appendChild(input);
    bar.appendChild(counter);
    bar.appendChild(closeBtn);
    return bar;
  }

  async function copyReplyContent(descriptor, btn) {
    try {
      if (descriptor.modality === 'text' || descriptor.modality === 'audio') {
        const text = descriptor.text ?? '';
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showToolbarFeedback(btn, '✓ Copied');
      } else if (descriptor.modality === 'image') {
        const blob = descriptor.dataUrl
          ? dataUrlToBlob(descriptor.dataUrl)
          : await fetch(descriptor.srcUrl).then(r => r.blob());
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        showToolbarFeedback(btn, '✓ Copied');
      }
    } catch (err) {
      console.error('[reply-toolbar] copy failed:', err);
      showToolbarFeedback(btn, '⚠ Failed');
    }
  }

  async function saveReplyContent(descriptor, btn) {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      let blob;
      if (descriptor.dataUrl) {
        blob = dataUrlToBlob(descriptor.dataUrl);
      } else if (descriptor.srcUrl) {
        const resp = await fetch(descriptor.srcUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        blob = await resp.blob();
      } else {
        showToolbarFeedback(btn, '⚠ No data'); return;
      }
      const filename = descriptor.filename ??
        `ai-reply.${mimeToExt(descriptor.mimeType ?? blob.type)}`;
      const file = new File([blob], filename, { type: blob.type });
      if (supportsShare([file])) {
        await navigator.share({ files: [file], title: filename });
      } else {
        triggerDownload(blob, filename);
      }
      showToolbarFeedback(btn, '✓ Saved');
    } catch (err) {
      console.error('[reply-toolbar] save failed:', err);
      showToolbarFeedback(btn, '⚠ Failed');
    }
  }

  function activateInlineSearch(container, searchBtn) {
    const bar = container.querySelector('.reply-search-bar');
    if (!bar) return;
    const isHidden = bar.classList.contains('hidden');
    if (isHidden) {
      bar.classList.remove('hidden');
      bar.querySelector('.reply-search-input')?.focus();
    } else {
      bar.classList.add('hidden');
      clearSearchHighlights(container);
      searchBtn.focus();
    }
  }

  function applySearchHighlights(container, input, counter) {
    clearSearchHighlights(container);
    const query = input.value.trim();
    input.classList.remove('reply-search-input--invalid');
    if (!query) { counter.textContent = ''; return; }

    let re;
    try { re = new RegExp(query, 'gi'); }
    catch {
      input.classList.add('reply-search-input--invalid');
      counter.textContent = '⚠ invalid regex'; return;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('.reply-toolbar, .reply-search-bar')) continue;
      nodes.push(node);
    }

    let total = 0;
    for (const textNode of nodes) {
      const text = textNode.nodeValue;
      const matches = [...text.matchAll(re)];
      if (!matches.length) continue;
      total += matches.length;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of matches) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement('mark');
        mark.className = 'reply-search-highlight';
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
    counter.textContent = total ? `${total} match${total === 1 ? '' : 'es'}` : 'no matches';
  }

  function clearSearchHighlights(container) {
    container.querySelectorAll('mark.reply-search-highlight').forEach(mark => {
      mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark);
    });
    container.querySelectorAll('*').forEach(el => {
      try { el.normalize(); } catch { /* ignore */ }
    });
  }

  function showToolbarFeedback(btn, message, durationMs = 1800) {
    const orig = btn.textContent;
    btn.textContent = message;
    btn.classList.add('reply-toolbar-btn--feedback');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('reply-toolbar-btn--feedback');
      btn.disabled = false;
    }, durationMs);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function dataUrlToBlob(dataUrl) {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function mimeToExt(mimeType) {
    const map = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
      'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
      'audio/wav': 'wav', 'video/mp4': 'mp4', 'video/webm': 'webm',
      'text/plain': 'txt',
    };
    return map[mimeType] ?? 'bin';
  }

  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  function supportsShare(files) {
    if (typeof navigator.share !== 'function') return false;
    if (files && typeof navigator.canShare === 'function') {
      return navigator.canShare({ files });
    }
    return true;
  }

})(); // end IIFE

