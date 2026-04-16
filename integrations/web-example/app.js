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
  const btnDownloadCombined  = $("btn-download-combined");
  const combinedVideoSection = $("combined-video-section");
  const combinedVideoStatus  = $("combined-video-status");
  const combinedVideoPlayer  = $("combined-video-player");

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

  // Per-tab provider selects (added for fallback-model — one per modality tab)
  const textProviderSelect       = $("text-provider-select");
  const imageProviderSelect      = $("image-provider-select");
  const audioProviderSelect      = $("audio-provider-select");
  const structuredProviderSelect = $("structured-provider-select");

  /**
   * Unified lookup: modality → provider <select> element.
   * Used by PROVIDER_SELECTS iteration in change-listener wiring and
   * page-load restore (initTabSelections).
   */
  const PROVIDER_SELECTS = {
    text:       textProviderSelect,
    image:      imageProviderSelect,
    audio:      audioProviderSelect,
    video:      videoProviderSelect,
    structured: structuredProviderSelect,
  };

  /**
   * Unified lookup: modality → model <select> element.
   * Audio modality maps to the transcription model select per spec
   * (modality-provider-model/spec.md — the single authoritative model
   * select for the audio tab's provider+model pair).  The TTS model
   * select (ttsModelSelect) remains independently populated.
   */
  const MODEL_SELECTS = {
    text:       textModelSelect,
    image:      imageModelSelect,
    audio:      transcribeModelSelect,
    video:      videoModelSelect,
    structured: structuredModelSelect,
  };

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

  /**
   * Per-tab provider + model state (fallback-model — Design D1).
   * A single Map enables uniform iteration across all modalities without
   * maintaining 10 individual module-level variables.
   *
   * Keys:   "text" | "image" | "audio" | "video" | "structured"
   * Values: { provider: string, model: string }
   *
   * Fully populated by initTabSelections() before the first user interaction.
   * All API call functions read from tabState.get(modality) exclusively.
   */
  const tabState = new Map();

  /* ── localStorage persistence helpers (fallback-model) ─── */

  /**
   * Persist the resolved provider + model for a modality to localStorage.
   *
   * Both keys are written synchronously in the same call (REQ-LS-01 — no
   * partial writes). Key schema:
   *   ai-powered:provider:<modality>  →  provider id string
   *   ai-powered:model:<modality>     →  model id string
   *
   * @param {string} modality  One of "text" | "image" | "audio" | "video" | "structured".
   * @param {string} provider  Provider id (e.g. "openai").
   * @param {string} model     Model id (e.g. "gpt-4o").
   */
  function persistSelection(modality, provider, model) {
    localStorage.setItem(`ai-powered:provider:${modality}`, provider);
    localStorage.setItem(`ai-powered:model:${modality}`,    model);
  }

  /**
   * Restore a previously persisted provider + model pair for a modality.
   *
   * Returns `null` when either key is absent (first visit or cleared storage),
   * allowing the caller to fall back to the default provider + cheapest model
   * (REQ-LS-02, REQ-LS-05).
   *
   * @param {string} modality  One of "text" | "image" | "audio" | "video" | "structured".
   * @returns {{ provider: string, model: string }|null}
   */
  function restoreSelection(modality) {
    const provider = localStorage.getItem(`ai-powered:provider:${modality}`);
    const model    = localStorage.getItem(`ai-powered:model:${modality}`);
    if (!provider || !model) return null;
    return { provider, model };
  }

  /**
   * Return the id of the cheapest model in `modelList`, or `null` for an empty
   * list (REQ-PM-03, Design D2).
   *
   * Sorts a shallow copy of the list ascending by `costPerUnit`.  Models with
   * `null` or `undefined` `costPerUnit` are treated as `Infinity` so unknown-cost
   * models sort last — avoiding accidental selection of expensive preview models.
   * The sort is stable: models with identical cost retain their original order.
   *
   * Tests:
   *   T-PM-04  correct sort order (lower costPerUnit wins)
   *   T-PM-05  null costPerUnit sorts after any finite cost
   *   T-PM-06  empty list returns null
   *
   * @param {Array<{id: string, costPerUnit?: number|null}>} modelList
   * @returns {string|null}
   */
  function autoSelectCheapest(modelList) {
    if (!modelList || modelList.length === 0) return null;
    const sorted = [...modelList].sort((a, b) => {
      const ca = (a.costPerUnit != null) ? a.costPerUnit : Infinity;
      const cb = (b.costPerUnit != null) ? b.costPerUnit : Infinity;
      return ca - cb;
    });
    return sorted[0].id;
  }

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
   * Populates a provider <select> element with providers that support the
   * given modality. Preserves the current selection if it is still valid.
   *
   * @param {HTMLSelectElement} selectEl  Target <select> element (may be null).
   * @param {string}            modality  Modality string used to filter allProviders.
   */
  function populateProviderSelect(selectEl, modality) {
    if (!selectEl) return;
    const prev = selectEl.value;
    selectEl.innerHTML = '<option value="">Default</option>';
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
      selectEl.appendChild(opt);
    });
    if ([...selectEl.options].some((o) => o.value === prev)) {
      selectEl.value = prev;
    }
  }

  /** @see populateProviderSelect */
  function refreshProviderDropdown(modality) {
    populateProviderSelect(proxyProviderSelect, modality);
  }

  /** @see populateProviderSelect */
  function refreshVideoProviderDropdown() {
    populateProviderSelect(videoProviderSelect, "video");
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
   *
   * @param {string} message
   * @param {"error"|"warning"|"info"} [severity="error"]
   */
  function showGlobalError(message, severity = "error") {
    if (!globalErrorToast || !globalErrorMsg) return;
    globalErrorMsg.textContent = message;
    globalErrorToast.className = `global-error global-error--${severity}`;
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

  /* ── ProxyError ──────────────────────────────────────────── */
  class ProxyError extends Error {
    /**
     * @param {number} statusCode  HTTP status code from the proxy
     * @param {string} message     Human-readable error text from the JSON body
     */
    constructor(statusCode, message) {
      super(message);
      this.name = "ProxyError";
      this.statusCode = statusCode;
    }
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
      let msg = `Server error ${resp.status}`;
      try {
        const j = await resp.json();
        msg = j.error ?? j.message ?? msg;
      } catch (_) {}
      throw new ProxyError(resp.status, msg);
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
      let msg = `Server error ${resp.status}`;
      try { const j = await resp.json(); msg = j.error ?? j.message ?? msg; } catch (_) {}
      throw new ProxyError(resp.status, msg);
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

  /**
   * Fetch models for a single modality from the proxy, repopulate that tab's
   * model `<select>`, auto-select the cheapest option, and persist the choice.
   *
   * Design D5 — decomposed replacement for `loadAllModels()`:
   *   - Reads the provider from `tabState.get(modality).provider`.
   *   - Only touches `MODEL_SELECTS[modality]`; sibling tabs are never altered.
   *   - Empty model list → single disabled placeholder "No compatible models"
   *     (REQ-PM-02; see Example G in selector-examples.md).
   *   - Calls `autoSelectCheapest` and writes the result into both `tabState`
   *     and `localStorage` via `persistSelection` (REQ-PM-03, REQ-LS-01).
   *   - Video special-case: updates `videoModelsCache` and calls
   *     `syncVideoConstraints` so aspect-ratio / resolution / FPS / quality
   *     dropdowns stay consistent with the newly selected model.
   *
   * @param {string} modality  "text" | "image" | "audio" | "video" | "structured"
   */
  async function loadTabModels(modality) {
    if (modeSelect.value !== "proxy") return;

    const base     = proxyUrlInput.value.trim() || "http://localhost:3001";
    const state    = tabState.get(modality) ?? {};
    const provider = state.provider || "";
    const modelSel = MODEL_SELECTS[modality];
    if (!modelSel) return;

    let modelList = [];
    try {
      let url = `${base}/models?modality=${modality}`;
      if (provider) url += `&provider=${encodeURIComponent(provider)}`;
      const data = await fetch(url).then((r) => r.json());
      // Server returns a plain array; guard against wrapped { models: [] } shape.
      modelList = Array.isArray(data) ? data : (data.models ?? []);
    } catch (_) {
      // Network error — modelList stays empty; placeholder rendered below.
    }

    // Video: update the descriptor cache before repopulating the select so that
    // syncVideoConstraints can look up the newly selected model immediately.
    if (modality === "video") {
      videoModelsCache = modelList;
    }

    // Repopulate model <select> (REQ-PM-02 — compatible models only)
    modelSel.innerHTML = "";
    if (modelList.length === 0) {
      const placeholder = document.createElement("option");
      placeholder.value    = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "No compatible models";
      modelSel.appendChild(placeholder);
    } else {
      for (const m of modelList) {
        const opt = document.createElement("option");
        opt.value       = m.id;
        opt.textContent = m.name || m.id;
        modelSel.appendChild(opt);
      }
    }

    // Auto-select cheapest model (REQ-PM-03)
    const cheapest = autoSelectCheapest(modelList);
    const model    = cheapest ?? "";
    modelSel.value = model;

    // Video: sync constraint dropdowns (aspect ratio, resolution, FPS, quality)
    // to the newly selected model's capabilities.  Programmatic .value assignment
    // does not fire a DOM change event, so we call syncVideoConstraints directly.
    if (modality === "video") {
      const descriptor = videoModelsCache.find((m) => m.id === model) ?? null;
      syncVideoConstraints(descriptor);
    }

    // Persist updated state (REQ-LS-01 — atomic dual write)
    tabState.set(modality, { provider, model });
    persistSelection(modality, provider, model);
  }

  /**
   * Page-load restore loop — runs once after `allProviders` is populated.
   *
   * For each modality tab (PHASE-3, TASK-11):
   *   1. Populate the per-tab provider <select> with compatible options.
   *   2. restoreSelection(m) — read saved pair from localStorage (REQ-LS-02).
   *   3. Validate saved provider against allProviders (REQ-LS-03) — warn and
   *      fall back to the first active compatible provider (or "openai") when
   *      the saved provider is no longer in the registry.
   *   4. Fetch compatible models via GET /models?modality=m&provider=p.
   *   5. Validate saved model against the fetched list (REQ-LS-04) — warn and
   *      autoSelectCheapest when the saved model is absent (stale-model guard).
   *   6. Populate the model <select>, set its value, update tabState, and
   *      overwrite localStorage so future page loads start clean (REQ-LS-05).
   *
   * Video modality also updates videoModelsCache and calls syncVideoConstraints
   * so constraint dropdowns (aspect-ratio, resolution, FPS, quality) match
   * the restored model's capabilities.
   *
   * Tests: T-PM-09 (full restore), T-PM-10 (stale guard), S-04, S-05.
   */
  async function initTabSelections() {
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";

    for (const modality of ["text", "image", "audio", "video", "structured"]) {
      const providerSel = PROVIDER_SELECTS[modality];
      const modelSel    = MODEL_SELECTS[modality];

      // Step 1 — populate the per-tab provider <select> with modality-filtered options.
      if (providerSel) populateProviderSelect(providerSel, modality);

      // Step 2 — attempt to restore saved pair from localStorage (REQ-LS-02).
      const saved = restoreSelection(modality);

      // Step 3 — resolve provider: validate or fall back (REQ-LS-03, REQ-LS-05).
      // Default: first active provider that supports this modality, or "openai".
      const defaultProvider =
        allProviders.find(
          (p) => Array.isArray(p.modalities) && p.modalities.includes(modality) && p.active !== false
        )?.id ?? "openai";

      let provider = defaultProvider;
      if (saved) {
        const isKnown = allProviders.some((p) => p.id === saved.provider);
        if (isKnown) {
          provider = saved.provider;
        } else {
          console.warn(
            `[fallback-model] Saved provider "${saved.provider}" not found for` +
            ` modality "${modality}"; falling back to default.`
          );
          // provider remains defaultProvider; stale key overwritten via persistSelection below.
        }
      }

      // Reflect resolved provider in the <select>.
      if (providerSel) providerSel.value = provider;
      tabState.set(modality, { provider, model: "" });

      // Step 4 — fetch compatible model list for the resolved provider.
      let modelList = [];
      try {
        const url  = `${base}/models?modality=${modality}&provider=${encodeURIComponent(provider)}`;
        const data = await fetch(url).then((r) => r.json());
        modelList  = Array.isArray(data) ? data : (data.models ?? []);
      } catch (_) {
        // Network error — modelList stays empty; placeholder rendered below.
      }

      // Video: update descriptor cache before populating the select so that
      // syncVideoConstraints can look up the selected model immediately.
      if (modality === "video") videoModelsCache = modelList;

      // Populate model <select> (mirrors loadTabModels population logic).
      if (modelSel) {
        modelSel.innerHTML = "";
        if (modelList.length === 0) {
          const placeholder = document.createElement("option");
          placeholder.value       = "";
          placeholder.disabled    = true;
          placeholder.selected    = true;
          placeholder.textContent = "No compatible models";
          modelSel.appendChild(placeholder);
        } else {
          for (const m of modelList) {
            const opt = document.createElement("option");
            opt.value       = m.id;
            opt.textContent = m.name || m.id;
            modelSel.appendChild(opt);
          }
        }
      }

      // Step 5 — resolve model: restore saved value or auto-select cheapest.
      let model = autoSelectCheapest(modelList) ?? "";
      if (saved && modelList.some((m) => m.id === saved.model)) {
        model = saved.model; // valid saved model — restore it (T-PM-09).
      } else if (saved && saved.model) {
        // Saved model absent from current list — stale-model guard (REQ-LS-04).
        console.warn(
          `[fallback-model] Saved model "${saved.model}" not found for provider` +
          ` "${provider}" modality "${modality}"; falling back to cheapest.`
        );
        // model is already set to cheapest above; persistSelection below overwrites it.
      }

      // Step 6 — render selectors, commit state, seed/repair localStorage.
      if (modelSel) modelSel.value = model;

      if (modality === "video") {
        const descriptor = videoModelsCache.find((m) => m.id === model) ?? null;
        syncVideoConstraints(descriptor);
      }

      tabState.set(modality, { provider, model });
      persistSelection(modality, provider, model); // REQ-LS-01, REQ-LS-05 seed
    }
  }

  async function loadProviders() {
    if (modeSelect.value !== "proxy") return;
    const base = proxyUrlInput.value.trim() || "http://localhost:3001";
    try {
      const data = await fetch(base + "/providers").then((r) => r.json());
      allProviders = data; // cache full list (including inactive) for modality filtering
      refreshProviderDropdown(TAB_MODALITY[activeTab()] ?? "text");
      // TASK-13 (Phase 4): Populate all five per-tab provider <select> elements as
      // soon as the provider list is available (REQ-PM-01, S-01, S-02, S-03).
      // initTabSelections() below sets each .value after restoring or defaulting;
      // we populate options here first so those assignments find a non-empty list.
      for (const [modality, providerSel] of Object.entries(PROVIDER_SELECTS)) {
        if (providerSel) populateProviderSelect(providerSel, modality);
      }
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
    // Restore saved provider+model selections for every modality, validate them
    // against the live provider/model lists, and seed localStorage on first visit
    // (TASK-11 — replaces the per-modality loadTabModels batch from TASK-08).
    await initTabSelections();
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

  // Reload models when the global provider selection changes.
  // Per-tab provider selects wired in TASK-09 supersede this listener for
  // individual tabs.  While both exist, scope the reload to the active tab
  // only so no sibling tab is affected (Design D5 — no cross-tab pollution).
  proxyProviderSelect.addEventListener("change", () => {
    loadTabModels(TAB_MODALITY[activeTab()] ?? "text");
  });

  // ── Per-tab provider change listeners (TASK-09) ──────────────────────────────
  // One listener per modality.  When the user picks a different provider:
  //   1. Clear model in tabState immediately (no stale value leaks during load).
  //   2. Fetch + repopulate only that tab's model select via loadTabModels.
  //   3. loadTabModels auto-selects the cheapest model and persists the pair.
  //      (REQ-PM-02, REQ-PM-03, REQ-PM-06, T-PM-07, T-PM-08, T-PM-12)
  //
  // Supersedes the former video-only provider listener. The video modality
  // receives an additional updateLumaTunnelWarn() call because the provider
  // determines whether the Luma reverse-tunnel banner should be shown.
  for (const [modality, providerSel] of Object.entries(PROVIDER_SELECTS)) {
    if (!providerSel) continue;
    providerSel.addEventListener("change", async () => {
      const newProvider = providerSel.value;
      // Clear model immediately so no stale value is visible while models load.
      tabState.set(modality, { provider: newProvider, model: "" });
      await loadTabModels(modality);
      // tabState + localStorage are updated with the cheapest model by loadTabModels.
      if (modality === "video") updateLumaTunnelWarn();
    });
  }

  // ── Per-tab model change listeners (TASK-10) ─────────────────────────────────
  // One listener per modality.  When the user picks a different model (manual
  // override after auto-select):
  //   1. Read the current provider from tabState so the pair stays in sync.
  //   2. Update tabState with the new model.
  //   3. Persist both values atomically (REQ-LS-01, REQ-PM-06, Example B).
  //
  // Supersedes the former video-only model listener. The video modality
  // receives an additional syncVideoConstraints() call because aspect-ratio,
  // resolution, FPS, and quality dropdowns must reflect the selected model's
  // capabilities.  Programmatic .value assignment does not fire a DOM change
  // event, so the sync must be triggered explicitly here.
  for (const [modality, modelSel] of Object.entries(MODEL_SELECTS)) {
    if (!modelSel) continue;
    modelSel.addEventListener("change", () => {
      const current = tabState.get(modality) ?? {};
      const newModel = modelSel.value;
      tabState.set(modality, { provider: current.provider ?? "", model: newModel });
      persistSelection(modality, current.provider ?? "", newModel);
      if (modality === "video") {
        const descriptor = videoModelsCache.find((m) => m.id === newModel) ?? null;
        syncVideoConstraints(descriptor);
      }
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
    // Then reload models scoped to the newly activated tab only (Design D5 — no
    // cross-tab pollution; replaces old loadAllModels() that reloaded every tab).
    // T-22: loadTabModels falls back to an empty placeholder list when no models
    // are compatible (e.g. Audio / Structured tabs with certain providers).
    if (modeSelect.value === "proxy" && allProviders.length > 0) {
      refreshProviderDropdown(TAB_MODALITY[target] ?? "text");
      loadTabModels(target);
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

  /* ── Archive storage helpers (localStorage, persistent) ─────── */

  const ARCHIVE_KEY = "ai-demo-archive";

  function getArchive() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    }
    catch (_) { return []; }
  }

  function saveArchive(entries) {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(entries));
  }

  /**
   * Prepends entry to the archive. On QuotaExceededError, silently trims the
   * oldest entry and retries until the write succeeds or the array is empty.
   * Returns true on success, false if even an empty archive cannot hold the entry.
   */
  function prependToArchive(entry) {
    const entries = getArchive();
    entries.unshift(entry);
    while (true) {
      try { saveArchive(entries); return true; }
      catch (e) {
        if (e.name !== "QuotaExceededError" || entries.length === 0) return false;
        entries.pop();
      }
    }
  }

  /**
   * Returns the first 80 characters of the first user message, trimmed.
   * Appends "\u2026" if the message exceeded 80 characters.
   * Falls back to "Untitled conversation" if the first user message is absent or empty.
   */
  function makeArchiveTitle(messages) {
    const first = messages.find((m) => m.role === "user");
    if (!first || !first.content.trim()) return "Untitled conversation";
    const t = first.content.trim();
    return t.length > 80 ? t.slice(0, 80) + "\u2026" : t;
  }

  /**
   * Converts an ISO-8601 timestamp to a human-readable relative string.
   * Recomputed at render time — not stored — so it stays accurate across sessions.
   *
   * Buckets:
   *   < 60 s      → "just now"
   *   1–59 min    → "N minutes ago"
   *   1–23 h      → "N hours ago"
   *   24–47 h     → "yesterday"
   *   2–6 days    → "N days ago"
   *   7+ days     → toLocaleDateString (year, month, day)
   */
  function relativeTime(isoString) {
    const s = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (s < 60)     return "just now";
    if (s < 3600)   return Math.floor(s / 60)   + " minutes ago";
    if (s < 86400)  return Math.floor(s / 3600)  + " hours ago";
    if (s < 172800) return "yesterday";
    if (s < 604800) return Math.floor(s / 86400) + " days ago";
    return new Date(isoString).toLocaleDateString(undefined,
      { year: "numeric", month: "long", day: "numeric" });
  }

  /**
   * Reveals the history-panel warning bar with the provided message.
   * Null-safe: silently returns if the element is absent from the DOM
   * (e.g. in layouts that omit the history panel).
   * The element carries aria-live="polite" so screen readers announce it.
   */
  function showHistoryPanelWarning(msg) {
    const el = document.getElementById("history-panel-warning");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  /* ── History panel render ────────────────────────────────────── */

  /**
   * Re-renders the full history panel from the current archive state.
   * Called after every soft-reset, per-row delete, Clear All, and on page load.
   * Null-safe: returns silently when any required DOM element is absent.
   * Preserves the expanded/collapsed state by reading aria-expanded before
   * clearing body.innerHTML.
   */
  function renderHistoryPanel() {
    const entries  = getArchive();
    const countEl  = document.getElementById("history-count");
    const body     = document.getElementById("history-panel-body");
    const toggle   = document.getElementById("btn-history-toggle");
    if (!body || !countEl || !toggle) return;

    const expanded  = toggle.getAttribute("aria-expanded") === "true";
    const chevronEl = document.getElementById("history-chevron");
    countEl.textContent = String(entries.length);
    if (chevronEl) chevronEl.textContent = expanded ? "\u25be" : "\u25b8";
    body.innerHTML      = "";

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className   = "history-empty";
      empty.textContent = "No archived conversations yet.";
      body.appendChild(empty);
      return;
    }
    entries.forEach((entry) => body.appendChild(buildHistoryRow(entry)));
  }

  /**
   * Converts an archive entry into numbered plain text suitable for
   * copying or saving.  Format:
   *   #N You: <user message>
   *   #N Assistant: <assistant reply>
   *   (blank line between exchanges)
   *
   * If the last exchange has no assistant reply (odd message count),
   * the #N Assistant line is omitted for that exchange.
   *
   * @param   {ArchiveEntry} entry
   * @returns {string}
   */
  function buildFullTranscriptText(entry) {
    const lines = [];
    let n = 0;
    for (let i = 0; i < entry.messages.length; i += 2) {
      n++;
      const u = entry.messages[i];
      const a = entry.messages[i + 1]; // undefined if odd message count
      lines.push('#' + n + ' You: ' + u.content);
      if (a) lines.push('#' + n + ' Assistant: ' + a.content);
      lines.push(''); // blank line between exchanges
    }
    return lines.join('\n').trimEnd();
  }

  /**
   * Derives a filesystem-safe slug from an archive entry title.
   * Steps applied in order:
   *   1. Lowercase
   *   2. Replace runs of whitespace with a single hyphen
   *   3. Strip every character that is not a-z, 0-9, or hyphen
   *
   * @param   {string} title
   * @returns {string}  slug (may be empty for all-non-ASCII input)
   */
  function buildTitleSlug(title) {
    return title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
  }

  /**
   * Builds and returns a single history row DOM element for one archive entry.
   * Structure:
   *   div.history-row[role=listitem][data-id]
   *     div.history-row-summary
   *       button.history-chevron[aria-expanded=false]   — click toggles transcript
   *       span.history-meta                             — message count + relative time
   *       button.history-delete[aria-label=…]           — click opens inline confirm bar
   *     div.history-transcript.hidden                   — one .bubble per message
   *
   * Reuses .bubble / .bubble-label CSS classes from the live chat area — no new selectors.
   * No inline colour literals.
   */
  function buildHistoryRow(entry) {
    // ── Precompute pure-text values (used by both toolbars) ───────
    const fullText  = buildFullTranscriptText(entry);
    const titleSlug = buildTitleSlug(entry.title);

    // ── Root row element ──────────────────────────────────────────
    const row = document.createElement("div");
    row.className    = "history-row";
    row.setAttribute("role",    "listitem");
    row.setAttribute("data-id", entry.id);

    // ── Summary bar ───────────────────────────────────────────────
    const summary = document.createElement("div");
    summary.className = "history-row-summary";

    // Chevron toggle button
    const chevron = document.createElement("button");
    chevron.className = "history-chevron";
    chevron.setAttribute("aria-expanded", "false");
    chevron.textContent = "\u25b8 " + entry.title;

    // Meta line: message count + archived timestamp
    const meta = document.createElement("span");
    meta.className   = "history-meta";
    meta.textContent = entry.messages.length + " messages \u00b7 Archived " +
                       relativeTime(entry.archivedAt);

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.className  = "history-delete";
    delBtn.textContent = "Delete";
    delBtn.setAttribute("aria-label", "Delete conversation: " + entry.title);

    summary.appendChild(chevron);
    summary.appendChild(meta);
    summary.appendChild(delBtn);

    // ── Transcript (hidden by default) ────────────────────────────
    const transcript = document.createElement("div");
    transcript.className = "history-transcript hidden";

    // Whole-transcript toolbar (⎘ Copy / ⬇ Save / 🔍 Search) ─────
    // Injected before the message loop so it becomes firstChild of
    // div.history-transcript (above all exchange divs).  Decision 4.
    createReplyToolbar(transcript, {
      modality: 'text',
      text:     fullText,
      dataUrl:  null,
      srcUrl:   null,
      mimeType: 'text/plain',
      filename: 'archived-' + titleSlug + '.txt',
    });

    // ── Message loop: paired exchanges ───────────────────────────
    // Each iteration handles one user↔assistant pair wrapped in
    // div.history-exchange[data-exchange=N].  exchNum is 1-based (Decision 3).
    // data-exchange is always set via setAttribute to ensure string type (Decision 8).
    let exchNum = 0;
    for (let i = 0; i < entry.messages.length; i += 2) {
      exchNum++;
      const userMsg = entry.messages[i];
      const asstMsg = entry.messages[i + 1]; // undefined on odd message count

      // Exchange wrapper ────────────────────────────────────────────
      const exchDiv = document.createElement('div');
      exchDiv.className = 'history-exchange';
      exchDiv.setAttribute('data-exchange', String(exchNum));

      // Exchange number label ───────────────────────────────────────
      const numSpan = document.createElement('span');
      numSpan.className   = 'history-exchange-number';
      numSpan.textContent = '#' + exchNum;
      numSpan.setAttribute('aria-label', 'Exchange ' + exchNum);
      exchDiv.appendChild(numSpan);

      // User bubble (no toolbar — Decision 5) ──────────────────────
      const userBubble = document.createElement('div');
      userBubble.className = 'bubble bubble-user';
      const userLabel = document.createElement('span');
      userLabel.className   = 'bubble-label';
      userLabel.textContent = 'You';
      const userP = document.createElement('p');
      userP.textContent = userMsg.content;
      userBubble.appendChild(userLabel);
      userBubble.appendChild(userP);
      exchDiv.appendChild(userBubble);

      // Assistant bubble + per-reply toolbar (only when reply exists — Decision 7)
      if (asstMsg) {
        const asstBubble = document.createElement('div');
        asstBubble.className = 'bubble bubble-assistant';
        const asstLabel = document.createElement('span');
        asstLabel.className   = 'bubble-label';
        asstLabel.textContent = 'Assistant';
        const asstP = document.createElement('p');
        asstP.textContent = asstMsg.content;
        asstBubble.appendChild(asstLabel);
        asstBubble.appendChild(asstP);

        // Per-reply toolbar becomes asstBubble.firstChild (called before append)
        createReplyToolbar(asstBubble, {
          modality: 'text',
          text:     asstMsg.content,
          dataUrl:  null,
          srcUrl:   null,
          mimeType: 'text/plain',
          filename: 'archived-reply-' + exchNum + '.txt',
        });

        exchDiv.appendChild(asstBubble);
      }

      transcript.appendChild(exchDiv);
    }

    // ── Chevron click: toggle transcript visibility ───────────────
    chevron.addEventListener("click", () => {
      const isExpanded = chevron.getAttribute("aria-expanded") === "true";
      chevron.setAttribute("aria-expanded", String(!isExpanded));
      chevron.textContent = (!isExpanded ? "\u25be" : "\u25b8") + " " + entry.title;
      transcript.classList.toggle("hidden", isExpanded);
    });

    // ── Delete click: open inline confirm bar ─────────────────────
    delBtn.addEventListener("click", () => handleDeleteEntry(entry.id, row));

    row.appendChild(summary);
    row.appendChild(transcript);
    return row;
  }

  /**
   * Appends an inline confirmation bar inside rowEl for per-row delete.
   * Uses an inline bar rather than a native confirm() dialog — non-blocking and
   * contextual. (Clear All uses native confirm() because it is a high-stakes,
   * infrequent action where the native dialog adds intentional friction.)
   *
   * Cancel: removes the bar; archive unchanged.
   * Confirm: filters entry by id, saves updated archive, re-renders panel.
   * No inline colour literals.
   */
  function handleDeleteEntry(id, rowEl) {
    const confirmBar = document.createElement("div");
    confirmBar.className   = "history-confirm-bar";
    confirmBar.textContent = "Delete this conversation? This cannot be undone. ";

    const yes = document.createElement("button");
    yes.className   = "btn btn--ghost btn--danger";
    yes.textContent = "Confirm";

    const no = document.createElement("button");
    no.className   = "btn btn--ghost";
    no.textContent = "Cancel";

    confirmBar.appendChild(yes);
    confirmBar.appendChild(no);
    rowEl.appendChild(confirmBar);

    no.addEventListener("click",  () => confirmBar.remove());
    yes.addEventListener("click", () => {
      const remaining = getArchive().filter((e) => e.id !== id);
      saveArchive(remaining);
      renderHistoryPanel();
    });
  }

  /* ── New Conversation (soft-reset) ──────────────────────────── */

  let _newConvDebounced = false;

  /**
   * Shows a transient tooltip below #btn-new-conversation for 2 000 ms.
   * Any pre-existing tooltip is removed first to prevent stacking.
   */
  function showNewConvTooltip(msg) {
    const existing = document.querySelector(".new-conv-tip");
    if (existing) existing.remove();
    const tip = document.createElement("div");
    tip.className   = "new-conv-tip";
    tip.textContent = msg;
    btnNewConversation.insertAdjacentElement("afterend", tip);
    setTimeout(() => tip.remove(), 2000);
  }

  /**
   * Soft-reset handler — 7-step sequence:
   *  1. Debounce guard (200 ms window, prevents double-archive on rapid clicks).
   *  2. Read active messages; show tooltip and bail if session is empty.
   *  3. Build archive entry with deep-copied messages and crypto.randomUUID() id.
   *  4. Persist via prependToArchive; show warning if storage is unrecoverable.
   *  5. Clear active session from sessionStorage.
   *  6. Reset all visible UI elements (chat, output, usage, scroll).
   *  7. Re-render history panel so the new entry appears at the top.
   */
  function handleNewConversation() {
    // Step 1 — debounce
    if (_newConvDebounced) return;
    _newConvDebounced = true;
    setTimeout(() => { _newConvDebounced = false; }, 200);

    // Step 2 — empty-session guard
    const msgs = getSessionMessages();
    if (msgs.length === 0) {
      showNewConvTooltip("Nothing to archive \u2014 start typing first.");
      return;
    }

    // Step 3 — build archive entry
    const entry = {
      id:         crypto.randomUUID(),
      startedAt:  new Date().toISOString(),
      archivedAt: new Date().toISOString(),
      title:      makeArchiveTitle(msgs),
      messages:   JSON.parse(JSON.stringify(msgs)),
    };

    // Step 4 — persist; warn on unrecoverable overflow
    const saved = prependToArchive(entry);
    if (!saved) {
      showHistoryPanelWarning(
        "\u26a0 Storage full \u2014 this conversation could not be archived. " +
        "Consider clearing old history.");
    }

    // Step 5 — clear active session
    sessionStorage.removeItem(SESSION_KEY);

    // Step 6 — reset UI
    sessionHistory.innerHTML = "";
    textOutput.innerHTML     = "";
    textUsage.textContent    = "";
    sessionHistory.scrollTop = 0;

    // Step 7 — re-render history panel
    renderHistoryPanel();
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

  // New Conversation — archive current session then soft-reset
  const btnNewConversation = $("btn-new-conversation");
  btnNewConversation.addEventListener("click", handleNewConversation);

  // History panel toggle — flip aria-expanded and show/hide body
  const btnHistoryToggle = $("btn-history-toggle");
  const historyPanelBody = $("history-panel-body");
  btnHistoryToggle.addEventListener("click", () => {
    const expanded = btnHistoryToggle.getAttribute("aria-expanded") === "true";
    btnHistoryToggle.setAttribute("aria-expanded", String(!expanded));
    historyPanelBody.classList.toggle("hidden", expanded);
  });

  // Clear All — native confirm dialog with count interpolation
  const btnHistoryClearAll = $("btn-history-clear-all");
  btnHistoryClearAll.addEventListener("click", () => {
    const count = getArchive().length;
    if (count === 0) return;
    if (confirm(
      "Delete all " + count + " archived conversation" +
      (count === 1 ? "" : "s") + "? This cannot be undone."
    )) {
      localStorage.removeItem(ARCHIVE_KEY);
      renderHistoryPanel();
    }
  });

  // Restore history on load
  renderSessionHistory();
  renderHistoryPanel();

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
        // TASK-12: Read provider + model from tabState (REQ-PM-01, S-09).
        const { provider: tabProvider, model: tabModel } = tabState.get("text") ?? {};
        const payload = { prompt: fullPrompt };
        if (tabProvider)    payload.provider = tabProvider;
        if (tabModel)       payload.model    = tabModel;
        if (currentFileRef) payload.fileRef  = currentFileRef;
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
      if (err instanceof ProxyError) {
        switch (err.statusCode) {
          case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
          case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
          case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
          default:  showGlobalError(`${err.message}`, "error");
        }
      } else {
        showGlobalError(err.message ?? "Unexpected error", "error");
      }
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
        // TASK-12: Read provider + model from tabState instead of proxyProviderSelect (REQ-PM-01, S-09).
        const { provider: tabProvider, model: tabModel } = tabState.get("text") ?? {};
        const payload  = { prompt: fullPrompt, stream: true };
        if (tabProvider)    payload.provider = tabProvider;
        if (tabModel)       payload.model    = tabModel;
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
      if (err instanceof ProxyError) {
        switch (err.statusCode) {
          case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
          case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
          case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
          default:  showGlobalError(`${err.message}`, "error");
        }
      } else {
        showGlobalError(err.message ?? "Unexpected error", "error");
      }
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
        // TASK-12: Read provider + model from tabState (REQ-PM-01, S-09).
        const { provider: imgProvider, model: imgModel } = tabState.get("image") ?? {};
        const imgPayload = {
          prompt,
          provider:    imgProvider    || undefined,
          model:       imgModel       || undefined,
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
      if (err instanceof ProxyError) {
        switch (err.statusCode) {
          case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
          case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
          case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
          default:  showGlobalError(`${err.message}`, "error");
        }
      } else {
        showGlobalError(err.message ?? "Unexpected error", "error");
      }
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
        // TASK-12: Read audio provider from tabState. TTS model comes from its own
        // dedicated select (ttsModelSelect) which is separate from the transcription
        // model select tracked in tabState.get("audio").model (REQ-PM-01, S-09).
        const { provider: audioProvider } = tabState.get("audio") ?? {};
        ttsResult = await proxyPost("/audio/speak", {
          text,
          provider: audioProvider     || undefined,
          model:    ttsModelSelect.value || undefined,
        });
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
      if (err instanceof ProxyError) {
        switch (err.statusCode) {
          case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
          case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
          case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
          default:  showGlobalError(`${err.message}`, "error");
        }
      } else {
        showGlobalError(err.message ?? "Unexpected error", "error");
      }
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
        // TASK-12: Read provider + model from tabState["audio"] (REQ-PM-01, S-09).
        // tabState.get("audio").model mirrors transcribeModelSelect.value (MODEL_SELECTS["audio"]).
        const { provider: audioProvider, model: audioModel } = tabState.get("audio") ?? {};
        transcribeResult = await proxyPost("/audio/transcribe", {
          audioBase64,
          // Forward the Blob's MIME type so the proxy can pass it to Whisper,
          // giving the model the correct file-format hint for video containers
          // (.mp4, .mkv, .mov, .avi, .webm) and audio-only formats.
          // selectedAudioBlob.type is an empty string for programmatically
          // constructed Blobs — omit the field in that case so the server falls
          // back to its "audio/webm" default.
          mimeType:  selectedAudioBlob.type || undefined,
          provider:  audioProvider          || undefined,
          model:     audioModel             || undefined,
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
      if (err instanceof ProxyError) {
        switch (err.statusCode) {
          case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
          case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
          case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
          default:  showGlobalError(`${err.message}`, "error");
        }
      } else {
        showGlobalError(err.message ?? "Unexpected error", "error");
      }
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

  /** Cached combined-video Blob produced by stitchVideos(). Null until stitched. */
  let combinedVideoBlob = null;
  /** Cached data URI for the combined video (used for download). Null until stitched. */
  let combinedVideoDataUri = null;

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

    // ── Combined video reset (AC-19) ─────────────────────────
    combinedVideoBlob    = null;
    combinedVideoDataUri = null;
    if (btnDownloadCombined)  btnDownloadCombined.hidden  = true;
    if (combinedVideoPlayer)  combinedVideoPlayer.src     = "";
    if (combinedVideoSection) combinedVideoSection.hidden = true;
    if (combinedVideoStatus)  combinedVideoStatus.textContent = "";
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

  /**
   * Async because it may embed a combined-video data URI (REQ-BCV-08, AC-14).
   * All callers must await this function.
   *
   * When combinedVideoDataUri is set, a "Combined Video" section is prepended
   * above the per-shot cards so the exported HTML plays offline with no server.
   *
   * @param {object[]} results - Array of batch result objects.
   * @returns {Promise<string>}
   */
  async function buildResultsHtmlAsync(results) {
    const totalCost = results.reduce((sum, r) =>
      sum + (typeof r.result?.cost?.totalUsd === "number" ? r.result.cost.totalUsd : 0), 0);
    const costSegment = totalCost > 0 ? " · Total cost: $" + totalCost.toFixed(6) : "";

    // Optional combined-video section (AC-14 / REQ-BCV-08)
    const okVideoCount = results.filter(
      (r) => r.status === "ok" && r.modality === "video" && r.result?.data
    ).length;
    const combinedSection = combinedVideoDataUri
      ? `<div style="margin-bottom:1.5rem;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:.45rem .75rem;background:#fff;border-bottom:1px solid #e2e8f0">
    <strong style="font-size:.85rem">Combined Video — all ${okVideoCount} shot${okVideoCount !== 1 ? "s" : ""}</strong>
  </div>
  <div style="padding:.6rem .75rem;background:#f8fafc">
    <video controls style="width:100%;max-height:420px;display:block;background:#000" src="${combinedVideoDataUri}"></video>
  </div>
</div>`
      : "";

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
${combinedSection}${shotCards}
</body></html>`;
  }

  function escHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  /* ── DOWNLOAD HANDLERS ────────────────────────────────────── */

  btnDownloadResults.addEventListener("click", async () => {
    if (!batchResultItems.length) return;
    // buildResultsHtmlAsync is async (AC-14 / REQ-BCV-08): must be awaited.
    const html  = await buildResultsHtmlAsync(batchResultItems);
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

      // Include combined video in the archive if it was stitched (AC-15 / REQ-BCV-09)
      if (combinedVideoBlob) {
        const combinedBytes = new Uint8Array(await combinedVideoBlob.arrayBuffer());
        zip.file("combined.mp4", combinedBytes);
      }

      // Include the HTML results summary page in the archive (async: may embed combined video).
      zip.file("results.html", await buildResultsHtmlAsync(batchResultItems));

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

  /* ── COMBINED VIDEO DOWNLOAD HANDLER ────────────────────── */

  if (btnDownloadCombined) {
    btnDownloadCombined.addEventListener("click", () => {
      if (!combinedVideoBlob) return;
      const url = URL.createObjectURL(combinedVideoBlob);
      const a   = Object.assign(document.createElement("a"), {
        href:     url,
        download: "combined-video.mp4",
      });
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  /* ── STITCH VIDEOS ────────────────────────────────────────── */

  /**
   * Concatenate all successful video clips in `resultItems` into a single
   * combined MP4 using ffmpeg.wasm (stream-copy, no re-encode).
   *
   * Guard order (returns null on any failure):
   *   1. Filter for valid video clips — requires ≥ 2.
   *   2. SharedArrayBuffer must exist (cross-origin isolation required).
   *   3. window._FFmpeg and window._toBlobURL must be defined (CDN loaded).
   *   4. Estimated decoded size must be ≤ 500 MB (base64 × 0.75 heuristic).
   *
   * On success: updates combinedVideoBlob / combinedVideoDataUri, shows the
   * combined-video-section, sets the player src, and reveals the download btn.
   *
   * Design D4: -c copy only — no re-encode. Mixed resolution will fail and the
   * error is caught and reported via combinedVideoStatus.
   * Design D6: 0.75 factor for base64 → bytes is ~1 % accurate for large files;
   * avoids doubling memory by doing a pre-load size check rather than decoding.
   *
   * REQ-BCV-05 | AC-11,12,16,17,18,21
   *
   * @param {object[]} resultItems  - Array of batch result objects from the NDJSON stream.
   * @returns {Promise<Blob|null>}
   */
  async function stitchVideos(resultItems) {
    // ── Guard 1: filter valid video clips ───────────────────
    const clips = (resultItems || []).filter(
      (r) => r.status === "ok" && r.modality === "video" && r.result?.data
    );
    if (clips.length < 2) {
      if (combinedVideoStatus) combinedVideoStatus.textContent = "";
      if (combinedVideoSection) combinedVideoSection.hidden = true;
      if (btnDownloadCombined)  btnDownloadCombined.hidden  = true;
      return null;
    }

    // ── Guard 2: SharedArrayBuffer (REQ-BCV-11, AC-21) ───────
    // SharedArrayBuffer is only available when the page is served with:
    //   Cross-Origin-Opener-Policy: same-origin
    //   Cross-Origin-Embedder-Policy: require-corp
    // The Vite dev server (npm run dev:web) sets these automatically.
    // If you are seeing this message, open the app via `npm run dev:web`
    // instead of opening index.html directly from the file system.
    if (typeof SharedArrayBuffer === "undefined") {
      if (combinedVideoStatus) {
        combinedVideoStatus.textContent =
          "Combined video unavailable — open the app via \u2018npm run dev:web\u2019 " +
          "so the server can supply the required COOP/COEP isolation headers.";
      }
      if (combinedVideoSection) combinedVideoSection.hidden = false;
      return null;
    }

    // ── Guard 3: CDN helpers must be loaded ───────────────────
    if (!window._FFmpeg || !window._toBlobURL) {
      if (combinedVideoStatus) {
        combinedVideoStatus.textContent =
          "Combined video unavailable — ffmpeg.wasm CDN script not loaded.";
      }
      if (combinedVideoSection) combinedVideoSection.hidden = false;
      return null;
    }

    // ── Guard 4: size pre-check (Design D6: base64 × 0.75 ≈ bytes) ─
    const SIZE_LIMIT = 500 * 1024 * 1024; // 500 MB
    const estimatedBytes = clips.reduce((sum, r) => {
      const b64 = r.result.data.replace(/^data:[^,]+,/, "");
      return sum + b64.length * 0.75;
    }, 0);
    if (estimatedBytes > SIZE_LIMIT) {
      if (combinedVideoStatus) {
        combinedVideoStatus.textContent =
          "Combined video skipped — estimated decoded size exceeds 500 MB.";
      }
      if (combinedVideoSection) combinedVideoSection.hidden = false;
      return null;
    }

    // ── Show section and initial status ───────────────────────
    if (combinedVideoSection) combinedVideoSection.hidden = false;
    if (combinedVideoPlayer)  combinedVideoPlayer.src     = "";
    if (btnDownloadCombined)  btnDownloadCombined.hidden  = true;
    if (combinedVideoStatus)  combinedVideoStatus.textContent = "Loading ffmpeg.wasm…";

    const FFmpeg    = window._FFmpeg;
    const toBlobURL = window._toBlobURL;
    const ffmpeg    = new FFmpeg();

    // Forward progress events to the status span
    ffmpeg.on("progress", ({ progress }) => {
      if (combinedVideoStatus) {
        const pct = Math.min(Math.round(progress * 100), 100);
        combinedVideoStatus.textContent = "Stitching " + pct + "%…";
      }
    });

    try {
      // Load ffmpeg.wasm core from CDN (pinned to @0.12.6 for stability)
      const BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL:   await toBlobURL(BASE_URL + "/ffmpeg-core.js",   "text/javascript"),
        wasmURL:   await toBlobURL(BASE_URL + "/ffmpeg-core.wasm", "application/wasm"),
      });

      if (combinedVideoStatus) combinedVideoStatus.textContent = "Writing clips…";

      // Write each clip as clipN.mp4 inside the ffmpeg virtual FS
      const concatLines = [];
      for (let i = 0; i < clips.length; i++) {
        const r   = clips[i];
        const b64 = r.result.data.replace(/^data:[^,]+,/, "");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const name  = "clip" + i + ".mp4";
        await ffmpeg.writeFile(name, bytes);
        concatLines.push("file '" + name + "'");
      }

      // Write the concat manifest
      const listTxt = new TextEncoder().encode(concatLines.join("\n") + "\n");
      await ffmpeg.writeFile("list.txt", listTxt);

      if (combinedVideoStatus) combinedVideoStatus.textContent = "Stitching…";

      // Concatenate using stream-copy — no re-encode (Design D4)
      await ffmpeg.exec([
        "-f", "concat",
        "-safe", "0",
        "-i", "list.txt",
        "-c", "copy",
        "combined.mp4",
      ]);

      // Read output and build Blob
      const data = await ffmpeg.readFile("combined.mp4");
      const blob = new Blob([data.buffer], { type: "video/mp4" });

      // Cache and display
      combinedVideoBlob    = blob;
      combinedVideoDataUri = null; // not materialised as data URI (memory efficiency)

      const url = URL.createObjectURL(blob);
      if (combinedVideoPlayer) {
        combinedVideoPlayer.src = url;
      }
      if (btnDownloadCombined) btnDownloadCombined.hidden = false;
      if (combinedVideoStatus) {
        combinedVideoStatus.textContent =
          "Ready · " + Math.round(blob.size / (1024 * 1024) * 10) / 10 + " MB";
      }

      return blob;
    } catch (err) {
      if (combinedVideoStatus) {
        combinedVideoStatus.textContent =
          "Stitch failed: " + (err.message || String(err));
      }
      combinedVideoBlob    = null;
      combinedVideoDataUri = null;
      if (btnDownloadCombined) btnDownloadCombined.hidden = true;
      return null;
    }
  }

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

    // Reset combined video state before each new run (AC-11, REQ-BCV-06)
    combinedVideoBlob    = null;
    combinedVideoDataUri = null;
    if (btnDownloadCombined)  btnDownloadCombined.hidden  = true;
    if (combinedVideoSection) combinedVideoSection.hidden = true;
    if (combinedVideoStatus)  combinedVideoStatus.textContent = "";
    if (combinedVideoPlayer)  combinedVideoPlayer.src     = "";

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
    // TASK-12: Read provider + model from tabState["video"] (REQ-PM-01, S-09).
    // tabState is the single source of truth; DOM selects no longer consulted.
    const { provider, model } = tabState.get("video") ?? {};

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

      // ── Stitch combined video (REQ-BCV-06, REQ-BCV-07, AC-11,12,16,17,18) ─
      const successCount = batchResultItems.filter(
        (r) => r.status === "ok" && r.modality === "video" && r.result?.data
      ).length;

      if (successCount >= 2) {
        // Show section early so the user sees progress feedback (AC-12, AC-16)
        if (combinedVideoSection) combinedVideoSection.hidden = false;
        try {
          const stitchedBlob = await stitchVideos(batchResultItems);
          if (stitchedBlob) {
            // Materialise data URI for offline HTML export (TASK-13 / REQ-BCV-08)
            combinedVideoDataUri = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(/** @type {string} */ (reader.result));
              reader.readAsDataURL(stitchedBlob);
            });
            if (combinedVideoStatus) {
              combinedVideoStatus.textContent =
                "✓ " + successCount + " shots stitched · " +
                Math.round(stitchedBlob.size / (1024 * 1024) * 10) / 10 + " MB";
            }
            if (btnDownloadCombined) btnDownloadCombined.hidden = false;
          }
          // On null return: stitchVideos already updated combinedVideoStatus with the reason
        } catch (stitchErr) {
          // AC-18: surface stitch errors without disrupting the batch result display
          if (combinedVideoStatus) {
            combinedVideoStatus.textContent =
              "Stitch failed: " + (stitchErr.message || String(stitchErr));
          }
        }
      }
      // successCount < 2: section + button remain hidden (AC-17)
    } catch (err) {
      if (err.name === "AbortError") {
        batchProgressLabel.textContent =
          `Cancelled — ${done_count} of ${total} processed`;
      } else {
        if (err instanceof ProxyError) {
          switch (err.statusCode) {
            case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
            case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
            case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
            default:  showGlobalError(`${err.message}`, "error");
          }
        } else {
          showGlobalError(err.message ?? "Unexpected error", "error");
        }
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

      // TASK-12: Read provider + model from tabState["video"] so the correct
      // provider (e.g. Luma AI) is forwarded to the proxy (REQ-PM-01, S-09).
      // tabState is the single source of truth — direct DOM reads removed.
      const { provider: videoProvider, model: videoModel } = tabState.get("video") ?? {};
      if (videoProvider) videoOptions.provider = videoProvider;
      if (videoModel)    videoOptions.model    = videoModel;
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
      if (err instanceof ProxyError) {
        switch (err.statusCode) {
          case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
          case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
          case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
          default:  showGlobalError(`${err.message}`, "error");
        }
      } else {
        showGlobalError(err.message ?? "Unexpected error", "error");
      }
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
        // TASK-12: Read provider + model from tabState["structured"] (REQ-PM-01, S-09).
        const { provider: structProvider, model: structModel } = tabState.get("structured") ?? {};
        result = await proxyPost("/structured", {
          prompt,
          provider: structProvider || undefined,
          model:    structModel    || undefined,
        });
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
      if (err instanceof ProxyError) {
        switch (err.statusCode) {
          case 402: showGlobalError("Budget exceeded — increase your budget in Settings or stop generating.", "warning"); break;
          case 429: showGlobalError("Rate limited — wait a moment before retrying.", "info"); break;
          case 503: showGlobalError("All AI providers are unavailable — wait a few minutes before retrying.", "warning"); break;
          default:  showGlobalError(`${err.message}`, "error");
        }
      } else {
        showGlobalError(err.message ?? "Unexpected error", "error");
      }
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

  /* ── Voice-to-text helpers ───────────────────────────────── */

  /**
   * Formats elapsed seconds as a M:SS string.
   * Example: formatMicTime(74) => '1:14'.
   * Spec bd-grbn: .mic-timer SHALL display this format while recording.
   *
   * @param {number} secs - Non-negative integer seconds elapsed.
   * @returns {string} Formatted time string.
   */
  function formatMicTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  /**
   * Injects a <p class="mic-error"> message below the closest .input-group
   * ancestor of btn. Replaces any existing .mic-error already positioned there.
   * Auto-removes after 5 seconds.
   * Spec bd-ymk4: permission-denied, NotFoundError, and network error messages.
   *
   * @param {HTMLElement} btn - The .btn-mic that triggered the error.
   * @param {string}      msg - Human-readable error text to display.
   */
  function showMicError(btn, msg) {
    const group = btn.closest('.input-group');
    if (!group) return;
    // Remove any prior error placed immediately after this input group.
    const sibling = group.nextElementSibling;
    if (sibling && sibling.classList.contains('mic-error')) sibling.remove();
    const p = document.createElement('p');
    p.className   = 'mic-error';
    p.textContent = msg;
    group.insertAdjacentElement('afterend', p);
    setTimeout(() => { if (p.parentNode) p.remove(); }, 5000);
  }

  /**
   * Appends trimmed text to a textarea with a single-space separator when the
   * textarea already has content, then dispatches an 'input' event so all
   * existing char-counter and change listeners fire.
   * Spec bd-v23w: 'Hello world' SHALL be appended with space separator.
   *
   * @param {HTMLTextAreaElement} ta   - Target textarea element.
   * @param {string}              text - Text to append (will be trimmed).
   */
  function appendTranscript(ta, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    ta.value = ta.value.length > 0 ? ta.value + ' ' + trimmed : trimmed;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Converts an audio Blob to base64 and posts it to the proxy
   * POST /audio/transcribe endpoint, returning the transcript string.
   * Used exclusively by the proxy-mode path in initMicButtons().
   * Spec bd-87rh: assembles Blob → transcribes via proxyPost.
   * Spec bd-i37y / Design D3: provider + model are read from tabState.get('audio')
   * at call time so a provider switch made between recording sessions takes effect
   * immediately — no stale closure values.
   *
   * @param {Blob} blob - Audio Blob recorded by MediaRecorder.
   * @returns {Promise<string>} Transcribed text.
   */
  async function transcribeMicBlob(blob) {
    const audioBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(/** @type {string} */ (reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Failed to read audio data.'));
      reader.readAsDataURL(blob);
    });
    // Design D3: read tabState at call time, not at definition time, so any
    // provider/model switch the user makes is honoured on the very next transcription.
    const { provider, model } = tabState.get('audio') ?? {};
    const result = await proxyPost('/audio/transcribe', {
      audioBase64,
      mimeType: blob.type || undefined,
      provider: provider  || undefined,
      model:    model     || undefined,
    });
    return result.text ?? '';
  }

  /**
   * Wires all .btn-mic buttons with independent per-button closure state for
   * voice-to-text recording.  Design D1: one closure per button → no shared
   * mutable state between buttons; stopping one SHALL NOT affect others.
   *
   * Proxy mode (bd-87rh, modeSelect.value === 'proxy'):
   *   getUserMedia → MediaRecorder (webm/ogg) → chunks → Blob →
   *   size-check (< 500 B → error) → transcribeMicBlob → appendTranscript.
   *
   * Direct mode (bd-778j, all other modes):
   *   SpeechRecognition with continuous:true, interimResults:true → live
   *   interim overlay → final commit via appendTranscript.
   *
   * Edge cases covered (bd-7g46):
   *   • blob < 500 B           → 'Recording too short'
   *   • getUserMedia denied     → permission-denied message
   *   • getUserMedia no device  → no-mic message
   *   • proxyPost failure       → 'Transcription failed: <detail>'
   *   • SpeechRecognition N/A   → proxy-or-Chrome instruction
   *   • All error paths reset .recording CSS class and timer.
   *
   * Spec bd-l8by: invalid data-target values are silently skipped.
   * Spec bd-95zq: called immediately on page load.
   */
  function initMicButtons() {
    document.querySelectorAll('.btn-mic').forEach((btn) => {
      const targetId = btn.dataset.target;
      if (!targetId) return;
      const ta = document.getElementById(targetId);
      if (!ta) return; // silently skip unknown target

      // ── Per-button closure state (Design D1) ─────────────
      const state = {
        recognition:   null,   // SpeechRecognition instance (direct mode)
        mediaRecorder: null,   // MediaRecorder instance (proxy mode)
        stream:        null,   // getUserMedia MediaStream (proxy mode)
        chunks:        [],     // recorded audio chunks (proxy mode)
        proxyError:    false,  // true when recorder.onerror fired; suppresses onstop errors
        timerInterval: null,   // setInterval handle
        elapsedSeconds: 0,
        isRecording:   false,
      };

      const timerEl = btn.querySelector('.mic-timer');

      function startTimer() {
        state.elapsedSeconds = 0;
        if (timerEl) timerEl.textContent = formatMicTime(0);
        state.timerInterval = setInterval(() => {
          state.elapsedSeconds++;
          if (timerEl) timerEl.textContent = formatMicTime(state.elapsedSeconds);
        }, 1000);
      }

      function stopTimer() {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
        if (timerEl) timerEl.textContent = '';
      }

      function setRecordingUi(recording) {
        state.isRecording = recording;
        btn.classList.toggle('recording', recording);
        btn.title = recording ? 'Stop recording' : 'Record voice input';
      }

      // Tears down direct-mode recognition or proxy-mode stream+recorder and
      // resets all UI state.  Safe to call multiple times (idempotent).
      function stopRecording() {
        setRecordingUi(false);
        stopTimer();
        if (state.recognition) {
          try { state.recognition.stop(); } catch (_) { /* ignore double-stop */ }
          state.recognition = null;
        }
        if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
          try { state.mediaRecorder.stop(); } catch (_) {}
        }
        state.mediaRecorder = null;
        if (state.stream) {
          state.stream.getTracks().forEach((t) => t.stop());
          state.stream = null;
        }
        state.chunks = [];
      }

      btn.addEventListener('click', async () => {
        // ── Stop path ─────────────────────────────────────
        if (state.isRecording) {
          if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
            // Proxy mode: trigger onstop which handles blob assembly + transcription.
            state.mediaRecorder.stop();
          } else {
            // Direct mode (or proxy recorder already inactive): full teardown.
            stopRecording();
          }
          return;
        }

        // ── Proxy mode: MediaRecorder → POST /audio/transcribe ──────
        if (modeSelect.value === 'proxy') {
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (err) {
            // bd-7g46 edge cases (2) and (3)
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
              showMicError(btn, 'Microphone access was denied. Allow microphone in browser settings and try again.');
            } else if (err.name === 'NotFoundError') {
              showMicError(btn, 'No microphone found. Connect a microphone and try again.');
            } else {
              showMicError(btn, 'Could not access microphone: ' + (err.message ?? err.name));
            }
            return;
          }

          // Prefer opus → webm → ogg; fall back to browser default.
          const mimeType = (
            ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
              .find((t) => MediaRecorder.isTypeSupported(t))
          ) || '';

          let recorder;
          try {
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
          } catch (err) {
            stream.getTracks().forEach((t) => t.stop());
            showMicError(btn, 'Could not start recording: ' + (err.message ?? String(err)));
            return;
          }

          state.stream        = stream;
          state.chunks        = [];
          state.proxyError    = false;
          state.mediaRecorder = recorder;

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) state.chunks.push(e.data);
          };

          recorder.onstop = async () => {
            // Release microphone and reset recorder refs immediately.
            if (state.stream) {
              state.stream.getTracks().forEach((t) => t.stop());
              state.stream = null;
            }
            state.mediaRecorder = null;
            setRecordingUi(false);
            stopTimer();

            // Skip blob processing when recorder.onerror already reported an error.
            if (state.proxyError) {
              state.proxyError = false;
              state.chunks = [];
              return;
            }

            const blob = new Blob(state.chunks, { type: mimeType || 'audio/webm' });
            state.chunks = [];

            // bd-7g46 edge case (1): blob too small → no usable audio captured.
            if (blob.size < 500) {
              showMicError(btn, 'Recording too short. Hold the button longer and speak clearly.');
              return;
            }

            // bd-7g46 edge case (4): proxyPost failure → user-visible message.
            try {
              const text = await transcribeMicBlob(blob);
              if (text) appendTranscript(ta, text);
            } catch (err) {
              showMicError(btn, 'Transcription failed: ' + (err.message ?? String(err)));
            }
          };

          recorder.onerror = (e) => {
            // Flag so onstop skips blob processing (error already displayed here).
            state.proxyError = true;
            showMicError(btn, 'Recording error: ' + (e.error?.message ?? 'unknown'));
            // Reset UI immediately; onstop will do final state cleanup.
            setRecordingUi(false);
            stopTimer();
          };

          setRecordingUi(true);
          startTimer();
          recorder.start(250); // request data every 250 ms for timely onstop assembly
          return;
        }

        // ── Direct mode: Web Speech API ─────────────────────────────
        // bd-7g46 edge case (5): SpeechRecognition unavailable.
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) {
          showMicError(btn,
            'Voice input requires proxy mode or Chrome/Edge with microphone access. ' +
            'Switch to proxy mode, or open this page in Chrome/Edge and allow the microphone.');
          return;
        }

        setRecordingUi(true);
        startTimer();

        const recognition      = new SpeechRec();
        recognition.continuous     = true;
        recognition.interimResults = true;
        recognition.lang           = 'en-US';
        state.recognition          = recognition;

        // committedLength marks the boundary between finalized and interim text
        // in ta.value, enabling live interim overlay without duplicating finals.
        let committedLength = ta.value.length;

        recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              // Reset to committed boundary, removing any interim overlay, then
              // commit the finalized phrase.
              ta.value = ta.value.slice(0, committedLength);
              appendTranscript(ta, result[0].transcript);
              committedLength = ta.value.length;
            } else {
              interim += result[0].transcript;
            }
          }
          // Live interim preview (Spec AC-17).
          if (interim) {
            const sep = committedLength > 0 ? ' ' : '';
            ta.value = ta.value.slice(0, committedLength) + sep + interim;
          }
        };

        recognition.onerror = (event) => {
          // bd-7g46 edge cases (2) and (3) for direct-mode.
          let msg;
          if (event.error === 'not-allowed' || event.error === 'permission-denied') {
            msg = 'Microphone access was denied. Allow microphone in browser settings and try again.';
          } else if (event.error === 'audio-capture') {
            msg = 'No microphone found. Connect a microphone and try again.';
          } else {
            msg = 'Speech recognition error: ' + event.error;
          }
          showMicError(btn, msg);
          stopRecording(); // resets .recording CSS + timer
        };

        // Fired when recognition stops (explicit stop or browser auto-end).
        recognition.onend = () => {
          if (state.isRecording) stopRecording();
        };

        recognition.start();
      });
    });
  }

  // Spec bd-95zq: initMicButtons() SHALL be called during page initialisation.
  initMicButtons();

})(); // end IIFE

