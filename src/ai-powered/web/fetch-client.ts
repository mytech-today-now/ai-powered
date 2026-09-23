/**
 * @file src/ai-powered/web/fetch-client.ts
 *
 * Browser-safe AI client using only Web Standard APIs.
 *
 * ZERO references to Node.js built-ins (fs, path, process, os, crypto,
 * child_process, Buffer) — verified by Vite bundle analysis.
 *
 * All binary results (images, audio, video) are returned as `Blob` objects
 * suitable for `URL.createObjectURL()`.  Text streaming is exposed as a
 * `ReadableStream<string>` with SSE parsing.
 */

import { withRetryFetch, CircuitBreaker } from "../shared/resilience.js";
import { estimateCost } from "../shared/cost.js";
import { BudgetExceededError } from "../types.js";

type WebRequestClass = "safe-read" | "generation";

/** Internal signal used to let the breaker observe a final 429/503 while the
 * public caller still receives the original Response for normal error mapping. */
class RetryableResponseError extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status}`);
    this.name = "RetryableResponseError";
  }
}

// ---------------------------------------------------------------------------
// Call options
// ---------------------------------------------------------------------------

/** Per-call overrides forwarded to the provider or proxy. */
export interface WebCallOptions {
  /** AbortSignal to cancel the request mid-flight. */
  signal?: AbortSignal;
  /** Sampling temperature (0–2). */
  temperature?: number;
  /** Maximum response tokens. */
  maxTokens?: number;
  /** System prompt for this call only. */
  systemPrompt?: string;
  /** Provider override forwarded to proxy mode. */
  provider?: string;
  /** Model override forwarded to proxy mode or direct-mode helpers. */
  model?: string;
  /** Single upload reference returned by POST /upload. */
  fileRef?: string;
  /** Request-scoped provider credential sent in a dedicated header in proxy mode. */
  providerCredential?: string | Record<string, string>;
}

/** Music-generation controls accepted by WebAiClient.generateMusic(). */
export interface WebMusicOptions extends WebCallOptions {
  lyrics?: string;
  instrumental?: boolean;
  duration?: number;
  seed?: number;
}

/** Image-generation controls accepted by WebAiClient.generateImage(). */
export interface WebImageOptions extends WebCallOptions {
  aspectRatio?: string;
  width?: number;
  height?: number;
  quality?: string;
  /** Multiple upload references returned by POST /upload. */
  fileRefs?: string[];
}

/** Video-generation controls accepted by WebAiClient.generateVideo(). */
export interface WebVideoOptions extends WebCallOptions {
  aspectRatio?: string;
  resolution?: string;
  quality?: "draft" | "standard" | "high";
  duration?: number;
  fps?: number;
  /**
   * UUID token returned by POST /upload.  When present, the corresponding
   * file is resolved server-side and injected as an image reference into the
   * video generation request (image-to-video).
   */
  fileRef?: string;
  /** UUID tokens returned by POST /upload for multi-media generation. */
  fileRefs?: string[];
  /** Public image URLs for image-to-video models. */
  images?: string[];
  /** Provider-specific video options. */
  negativePrompt?: string;
  seed?: number;
  transitionDuration?: number;
  pikaffect?: string;
  modifyRegionRoi?: string;
  modifyRegionMask?: string;
  /** Override the provider for this request (e.g. "lumaai"). */
  provider?: string;
  /** Override the model for this request (e.g. "ray-2"). */
  model?: string;
}

// ---------------------------------------------------------------------------
// Result types (browser-compatible — no Buffer, no Node types)
// ---------------------------------------------------------------------------

/** Usage token counts for a text-generation call. */
export interface WebTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Cost breakdown for a call (server-provided). */
export interface WebCostBreakdown {
  totalUsd: number;
  isEstimate: boolean;
}

/** Result of a text-generation call. */
export interface WebTextResult {
  content: string;
  model: string;
  provider: string;
  finishReason?: string;
  usage?: WebTokenUsage;
  cost?: WebCostBreakdown;
}

/** Result of a structured-output call. */
export interface WebStructuredResult<T = unknown> {
  data: T;
  model: string;
  provider: string;
  cost?: WebCostBreakdown;
}

/** Result of a browser music call. */
export interface WebMusicResult {
  audio: Blob;
  model: string;
  provider: string;
  title?: string;
  lyrics?: string;
  durationSeconds?: number;
  cost?: WebCostBreakdown;
}

/** Minimal model descriptor returned from listModels(). */
export interface WebModelInfo {
  id: string;
  name: string;
  capabilities: string[];
  costPerUnit?: number | null;
  [key: string]: unknown;
  inputCapabilities?: string[];
  resolutions?: string[];
  durationRange?: { min: number; max: number; default?: number };
  options?: Array<Record<string, unknown>>;
  inputRequirements?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Client options (discriminated union — proxy | direct)
// ---------------------------------------------------------------------------

/**
 * Proxy mode: all requests are forwarded through your own server.
 * The API key never leaves the server — recommended for production.
 */
export interface WebProxyOptions {
  mode: "proxy";
  /** Origin of the proxy server, e.g. "http://localhost:3000". */
  proxyUrl: string;
  /** Named config profile to activate on the server. */
  profile?: string;
  /** Optional request credential supplied by a trusted browser settings surface. */
  providerCredential?: string | Record<string, string>;
}

/**
 * Direct mode: the browser calls the provider API directly.
 *
 * ⚠ WARNING: your API key is visible in DevTools and network traffic.
 * Use proxy mode in production. A non-suppressible DOM banner is rendered.
 */
export interface WebDirectOptions {
  mode: "direct";
  provider: "openai" | "anthropic" | "venice" | "xai" | "openrouter";
  apiKey: string;
  model?: string;
}

/** Resilience options applicable to all WebAiClient modes. */
export interface WebResilienceOptions {
  /** Maximum number of retry attempts on 429/503. Default: 3. */
  maxRetries?: number;
  /** Base delay (ms) for Full Jitter backoff. Default: 500. */
  backoffBase?: number;
  /** Maximum delay cap (ms) for Full Jitter backoff. Default: 8000. */
  backoffCap?: number;
}

/** Budget options applicable to all WebAiClient modes. */
export interface WebBudgetOptions {
  /**
   * Maximum cumulative estimated/returned spend in USD for this client instance.
   * Default: Infinity (no cap). When the running total meets or exceeds this
   * value, the next applicable call throws BudgetExceededError before any
   * fetch is issued. In proxy mode this is a browser-local UX guard; the
   * proxy must enforce any authoritative multi-user billing or quota policy.
   */
  budgetUsd?: number;
  /**
   * Fraction of budgetUsd at which a console.warn is emitted (default 0.8).
   * The warning is logged only; no banner is shown. The hard stop is
   * BudgetExceededError when the full limit is reached.
   */
  warnFraction?: number;
}

export type WebClientOptions = (WebProxyOptions | WebDirectOptions) &
  WebResilienceOptions &
  WebBudgetOptions;

// ---------------------------------------------------------------------------
// Provider base URLs (direct mode)
// ---------------------------------------------------------------------------

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  venice: "https://api.venice.ai/api/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

// ---------------------------------------------------------------------------
// Default models per provider (used when opts.model is omitted in direct mode)
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<string, Partial<Record<string, string>>> = {
  openai: { text: "gpt-4o", image: "dall-e-3", audio: "whisper-1", structured: "gpt-4o" },
  anthropic: { text: "claude-opus-4-5", structured: "claude-3-5-sonnet-20241022" },
  venice: { text: "llama-3.3-70b", image: "fluently-xl", structured: "llama-3.3-70b" },
  xai: { text: "grok-2-1212", structured: "grok-2-1212" },
  openrouter: {
    text: "openrouter/auto",
    image: "openrouter/auto",
    audio: "openrouter/auto",
    structured: "openrouter/auto",
  },
};

const ANTHROPIC_MAX_TOKENS_DEFAULT = 4096;

interface DirectTextRequestContext {
  baseUrl: string;
  model: string;
  prompt: string;
  options: WebCallOptions | undefined;
  stream: boolean;
}

interface DirectTextRequest {
  endpoint: string;
  body: Record<string, unknown>;
}

interface DirectStreamEvent {
  text?: string;
  done?: boolean;
}

interface DirectTextAdapter {
  buildRequest(context: DirectTextRequestContext): DirectTextRequest;
  parseStreamEvent(payload: Record<string, unknown>): DirectStreamEvent | undefined;
}

const OPENAI_COMPATIBLE_DIRECT_TEXT_ADAPTER: DirectTextAdapter = {
  buildRequest({ baseUrl, model, prompt, options, stream }): DirectTextRequest {
    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = { model, messages };
    if (stream) body["stream"] = true;
    if (options?.temperature !== undefined) body["temperature"] = options.temperature;
    if (options?.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;
    return { endpoint: `${baseUrl}/chat/completions`, body };
  },

  parseStreamEvent(payload): DirectStreamEvent | undefined {
    const choices = payload["choices"] as Array<{ delta?: { content?: unknown } }> | undefined;
    const delta = choices?.[0]?.delta?.content;
    return typeof delta === "string" && delta.length > 0 ? { text: delta } : undefined;
  },
};

// ---------------------------------------------------------------------------
const OPENAI_IMAGE_INPUT_MODEL_IDS = new Set([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-image-1",
]);

const XAI_IMAGE_INPUT_MODEL_IDS = new Set(["grok-vision-beta", "grok-imagine-video"]);

function inferDirectModeInputCapabilities(
  provider: string,
  modelId: string,
): WebModelInfo["inputCapabilities"] | undefined {
  if (provider === "openai" && OPENAI_IMAGE_INPUT_MODEL_IDS.has(modelId)) {
    return ["image"];
  }

  if (provider === "xai" && XAI_IMAGE_INPUT_MODEL_IDS.has(modelId)) {
    return ["image"];
  }

  return undefined;
}

const ANTHROPIC_DIRECT_TEXT_ADAPTER: DirectTextAdapter = {
  buildRequest({ baseUrl, model, prompt, options, stream }): DirectTextRequest {
    if (
      options?.temperature !== undefined &&
      (options.temperature < 0 || options.temperature > 1)
    ) {
      throw new Error("Anthropic direct mode supports temperature between 0 and 1.");
    }

    const maxTokens = options?.maxTokens ?? ANTHROPIC_MAX_TOKENS_DEFAULT;
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
      throw new Error("Anthropic direct mode requires maxTokens to be a positive integer.");
    }

    const body: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: maxTokens,
    };
    if (options?.systemPrompt !== undefined) body["system"] = options.systemPrompt;
    if (options?.temperature !== undefined) body["temperature"] = options.temperature;
    if (stream) body["stream"] = true;
    return { endpoint: `${baseUrl}/messages`, body };
  },

  parseStreamEvent(payload): DirectStreamEvent | undefined {
    if (payload["type"] === "message_stop") return { done: true };
    if (payload["type"] !== "content_block_delta") return undefined;

    const delta = payload["delta"];
    if (!delta || typeof delta !== "object" || Array.isArray(delta)) return undefined;
    const text = (delta as { type?: unknown; text?: unknown }).text;
    const type = (delta as { type?: unknown }).type;
    return type === "text_delta" && typeof text === "string" ? { text } : undefined;
  },
};

function directProviderBaseUrl(provider: string): string {
  const baseUrl = PROVIDER_BASE_URLS[provider];
  if (!baseUrl) throw new Error("Unsupported direct provider: " + provider);
  return baseUrl;
}

function directTextAdapter(provider: string): DirectTextAdapter {
  return provider === "anthropic"
    ? ANTHROPIC_DIRECT_TEXT_ADAPTER
    : OPENAI_COMPATIBLE_DIRECT_TEXT_ADAPTER;
}

// DOM security banner (direct mode — non-suppressible)
// ---------------------------------------------------------------------------

function renderSecurityBanner(): void {
  // Use globalThis to avoid requiring "dom" in the tsconfig lib.
  // The DOM globals are available at runtime in a browser environment.
  type MinimalDoc = {
    getElementById(id: string): unknown;
    createElement(tag: string): {
      id: string;
      setAttribute(n: string, v: string): void;
      style: { cssText: string };
      textContent: string | null;
    };
    body: { prepend(node: unknown): void };
  };
  const doc = (globalThis as Record<string, unknown>)["document"] as MinimalDoc | undefined;
  if (!doc) return;
  if (doc.getElementById("__ai_powered_security_warning__")) return;
  const banner = doc.createElement("div");
  banner.id = "__ai_powered_security_warning__";
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
    "background:#b91c1c;color:#fff;font-family:monospace;font-size:13px;" +
    "font-weight:bold;padding:8px 16px;text-align:center;" +
    "letter-spacing:0.02em;box-shadow:0 2px 8px rgba(0,0,0,0.4)";
  banner.textContent =
    "\u26a0 WARNING: Direct mode exposes your API key. Use proxy mode in production.";
  doc.body.prepend(banner);
}

// ---------------------------------------------------------------------------
// Internal message type for session history
// ---------------------------------------------------------------------------

export interface WebMessage {
  role: "user" | "assistant";
  content: string;
}

const SESSION_STORAGE_STATUS_ID = "__ai_powered_session_storage_status__";
const SESSION_STORAGE_STATUS_TEXT =
  "Conversation history is temporary in this browser. Session storage is unavailable, so this session stays in memory.";

type MinimalStatusElement = {
  hidden: boolean;
  id: string;
  tabIndex: number;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { cssText: string };
};

type MinimalDocument = {
  getElementById(id: string): MinimalStatusElement | null;
  createElement(tag: string): MinimalStatusElement;
  body: { appendChild(node: unknown): void };
};

type MinimalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const SESSION_HISTORY_CACHE = new Map<string, WebMessage[]>();
const SESSION_STORAGE_FAILURES = new Set<string>();

function cloneHistory(history: WebMessage[]): WebMessage[] {
  return history.map((msg) => ({ role: msg.role, content: msg.content }));
}

function normalizeHistory(raw: unknown): { history: WebMessage[]; ok: boolean } {
  if (!Array.isArray(raw)) return { history: [], ok: false };

  const history: WebMessage[] = [];
  let ok = true;

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      ok = false;
      continue;
    }

    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      history.push({ role, content });
      continue;
    }
    ok = false;
  }

  return { history, ok };
}

function getMinimalDocument(): MinimalDocument | undefined {
  const doc = (globalThis as Record<string, unknown>)["document"] as MinimalDocument | undefined;
  if (!doc) return undefined;
  if (typeof doc.getElementById !== "function") return undefined;
  return doc;
}

function getSessionStorage(): MinimalStorage | undefined {
  try {
    const storage = (globalThis as Record<string, unknown>)["sessionStorage"] as
      MinimalStorage | undefined;
    if (!storage) return undefined;
    if (typeof storage.getItem !== "function") return undefined;
    return storage;
  } catch {
    return undefined;
  }
}

function updateSessionStorageWarning(): void {
  const doc = getMinimalDocument();
  if (!doc) return;

  let warning = doc.getElementById(SESSION_STORAGE_STATUS_ID);
  if (SESSION_STORAGE_FAILURES.size === 0) {
    if (warning) {
      warning.textContent = "";
      warning.hidden = true;
      warning.tabIndex = -1;
    }
    return;
  }

  if (!warning) {
    warning = doc.createElement("p");
    warning.id = SESSION_STORAGE_STATUS_ID;
    warning.setAttribute("role", "status");
    warning.setAttribute("aria-live", "polite");
    warning.setAttribute("aria-atomic", "true");
    warning.tabIndex = 0;
    warning.style.cssText =
      "position:fixed;right:1rem;bottom:1rem;z-index:2147483646;" +
      "max-width:min(90vw,32rem);margin:0;padding:0.75rem 1rem;border-radius:0.75rem;" +
      "border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-family:system-ui,sans-serif;" +
      "font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,0.18)";
    doc.body.appendChild(warning);
  }

  warning.hidden = false;
  warning.tabIndex = 0;
  warning.textContent = SESSION_STORAGE_STATUS_TEXT;
}

function markSessionStorageFailure(sessionId: string): void {
  SESSION_STORAGE_FAILURES.add(sessionId);
  updateSessionStorageWarning();
}

function markSessionStorageHealthy(sessionId: string): void {
  SESSION_STORAGE_FAILURES.delete(sessionId);
  updateSessionStorageWarning();
}

function readPersistedHistory(storageKey: string): {
  history: WebMessage[];
  status: "ok" | "missing" | "failed";
} {
  const storage = getSessionStorage();
  if (!storage) return { history: [], status: "failed" };

  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return { history: [], status: "missing" };

    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeHistory(parsed);
    return {
      history: normalized.history,
      status: normalized.ok ? "ok" : "failed",
    };
  } catch {
    return { history: [], status: "failed" };
  }
}

function persistHistory(storageKey: string, history: WebMessage[]): boolean {
  const storage = getSessionStorage();
  if (!storage) return false;

  try {
    storage.setItem(storageKey, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

function clearPersistedHistory(storageKey: string): boolean {
  const storage = getSessionStorage();
  if (!storage) return false;

  try {
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

function formatHistoryPrompt(history: WebMessage[]): string {
  return history
    .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// BrowserConversationSession
// ---------------------------------------------------------------------------

/**
 * Lightweight multi-turn session backed by `sessionStorage` with an in-memory
 * fallback when browser storage is malformed or blocked.
 *
 * History is keyed as `ai-session:<id>` and persisted for the tab lifetime.
 * Each call to `send()` prepends the accumulated history so the model has
 * full context, then appends both the user prompt and assistant reply.
 */
export class BrowserConversationSession {
  private readonly storageKey: string;
  private history: WebMessage[];

  constructor(
    private readonly sessionId: string,
    private readonly client: WebAiClient,
  ) {
    this.storageKey = `ai-session:${sessionId}`;
    this.history = this.loadHistory();
  }

  /** Retrieve the full conversation history from sessionStorage. */
  getHistory(): WebMessage[] {
    return cloneHistory(this.history);
  }

  /** Append a message to the persistent history. */
  private appendMessage(msg: WebMessage): void {
    this.history = [...this.history, { role: msg.role, content: msg.content }];
    SESSION_HISTORY_CACHE.set(this.sessionId, cloneHistory(this.history));
    if (persistHistory(this.storageKey, this.history)) {
      markSessionStorageHealthy(this.sessionId);
    } else {
      markSessionStorageFailure(this.sessionId);
    }
  }

  /** Load the initial history from sessionStorage or the in-memory fallback cache. */
  private loadHistory(): WebMessage[] {
    const persisted = readPersistedHistory(this.storageKey);
    if (persisted.status === "ok") {
      const history = cloneHistory(persisted.history);
      SESSION_HISTORY_CACHE.set(this.sessionId, history);
      markSessionStorageHealthy(this.sessionId);
      return history;
    }

    const cached = SESSION_HISTORY_CACHE.get(this.sessionId);
    if (persisted.status === "missing") {
      if (SESSION_STORAGE_FAILURES.has(this.sessionId) && cached) {
        markSessionStorageFailure(this.sessionId);
        return cloneHistory(cached);
      }
      return [];
    }

    const history = cloneHistory(cached ?? persisted.history);
    SESSION_HISTORY_CACHE.set(this.sessionId, history);
    markSessionStorageFailure(this.sessionId);
    return history;
  }

  /** Format the current history into the single-turn prompt shape. */
  private buildHistoryPrompt(): string {
    return formatHistoryPrompt(this.history);
  }

  /**
   * Send a user message, building on the accumulated history.
   * Returns the assistant reply text and persists both turns.
   */
  async send(userMessage: string, options?: WebCallOptions): Promise<string> {
    this.appendMessage({ role: "user", content: userMessage });
    const result = await this.client.generateText(this.buildHistoryPrompt(), options);
    const reply = result.content;
    this.appendMessage({ role: "assistant", content: reply });
    return reply;
  }

  /** Stream the assistant reply, persisting both turns on completion. */
  async *stream(userMessage: string, options?: WebCallOptions): AsyncIterable<string> {
    this.appendMessage({ role: "user", content: userMessage });
    const chunks: string[] = [];
    for await (const chunk of this.client.streamText(this.buildHistoryPrompt(), options)) {
      chunks.push(chunk);
      yield chunk;
    }
    this.appendMessage({ role: "assistant", content: chunks.join("") });
  }

  /** Clear session history from sessionStorage. */
  clear(): void {
    this.history = [];
    SESSION_HISTORY_CACHE.set(this.sessionId, []);
    if (clearPersistedHistory(this.storageKey)) {
      markSessionStorageHealthy(this.sessionId);
    } else {
      markSessionStorageFailure(this.sessionId);
    }
  }
}

// ---------------------------------------------------------------------------
// WebAiClient
// ---------------------------------------------------------------------------

/**
 * Browser-safe AI client.
 *
 * Works in two modes:
 *  - **proxy** – forwards requests to your own server (API key stays server-side).
 *  - **direct** – calls the provider API from the browser (API key exposed!).
 *
 * All methods use only Web Standard APIs: `fetch`, `ReadableStream`,
 * `TextDecoder`, `Blob`, `URL`, `sessionStorage`.
 */
export class WebAiClient {
  private readonly opts: WebClientOptions;
  private readonly _breaker: CircuitBreaker;
  private _spentUsd = 0;
  private readonly _budgetUsd: number;
  private readonly _warnFraction: number;

  constructor(opts: WebClientOptions) {
    this.opts = opts;
    this._breaker = new CircuitBreaker();
    this._budgetUsd = opts.budgetUsd ?? Infinity;
    this._warnFraction = opts.warnFraction ?? 0.8;
    if (opts.mode === "direct") {
      console.warn(
        "[ai-powered] Direct mode is active. Your API key is visible in browser " +
          "DevTools. Use proxy mode in production.",
      );
      renderSecurityBanner();
    }
  }

  /** Current cumulative spend in USD for this client instance. */
  get spentUsd(): number {
    return this._spentUsd;
  }

  /** Throws BudgetExceededError before issuing a fetch if limit is reached. */
  private _checkBudget(estimatedUsd = 0): void {
    if (this._spentUsd + estimatedUsd >= this._budgetUsd) {
      throw new BudgetExceededError(this._spentUsd + estimatedUsd, this._budgetUsd);
    }
  }

  /** Accumulates actual cost and emits a console.warn if threshold is crossed. */
  private _accumulateCost(result: { cost?: { totalUsd: number } }): void {
    const cost = result.cost?.totalUsd ?? 0;
    this._spentUsd += cost;
    if (this._budgetUsd < Infinity && this._spentUsd / this._budgetUsd >= this._warnFraction) {
      console.warn(
        `[WebAiClient] Budget warning: $${this._spentUsd.toFixed(4)} of ` +
          `$${this._budgetUsd.toFixed(2)} used ` +
          `(${((this._spentUsd / this._budgetUsd) * 100).toFixed(1)}%)`,
      );
    }
  }

  /** Check a projected call cost and return the same estimate for post-call accounting. */
  private _checkProjectedBudget(model: string, promptText: string): number {
    const projected = this._estimateProjectedCost(model, promptText);
    this._checkBudget(projected);
    return projected;
  }

  /** Account for a successful call when the provider has no cost envelope. */
  private _accumulateEstimatedCost(estimatedUsd: number): void {
    this._accumulateCost({ cost: { totalUsd: estimatedUsd } });
  }

  /** Read a finite, non-negative cost from a proxy result without treating absence as free. */
  private _readProxyCost(payload: unknown): WebCostBreakdown | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const cost = (payload as { cost?: unknown }).cost;
    if (!cost || typeof cost !== "object") return undefined;
    const totalUsd = (cost as { totalUsd?: unknown }).totalUsd;
    if (typeof totalUsd !== "number" || !Number.isFinite(totalUsd) || totalUsd < 0) {
      return undefined;
    }
    const isEstimate = (cost as { isEstimate?: unknown }).isEstimate;
    return { totalUsd, isEstimate: isEstimate === true };
  }

  /** Account for one successful proxy provider response exactly once. */
  private _accumulateProxyCost(payload: unknown, operation: string): void {
    const cost = this._readProxyCost(payload);
    if (!cost) {
      const message =
        `Proxy ${operation} response did not include a finite cost. ` +
        "The provider charge is unknown; configure the proxy to return cost metadata.";
      console.warn(`[WebAiClient] ${message}`);
      if (this._budgetUsd < Infinity) {
        throw new WebProxyError(message, "PROXY_COST_UNKNOWN");
      }
      return;
    }

    this._accumulateCost({ cost });
    if (this._budgetUsd < Infinity && this._spentUsd > this._budgetUsd) {
      throw new BudgetExceededError(this._spentUsd, this._budgetUsd);
    }
  }

  /** Browser-safe estimate helper shared with the server-side cost model. */
  private _estimateProjectedCost(model: string, promptText: string): number {
    try {
      return estimateCost(model, promptText).totalUsd;
    } catch {
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Build base URL for proxy mode. */
  private get proxyBase(): string {
    if (this.opts.mode !== "proxy") throw new Error("Not in proxy mode");
    return this.opts.proxyUrl.replace(/\/$/, "");
  }

  /** Build Authorization header value for direct mode. */
  private directAuthHeader(): string {
    if (this.opts.mode !== "direct") throw new Error("Not in direct mode");
    const { provider, apiKey } = this.opts;
    if (provider === "anthropic") return ""; // uses x-api-key instead
    return `Bearer ${apiKey}`;
  }

  /** Build request headers for direct mode. */
  private directHeaders(): Record<string, string> {
    if (this.opts.mode !== "direct") throw new Error("Not in direct mode");
    const { provider, apiKey } = this.opts;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  /** Resolve the model to use: call option → direct-mode default → provider default. */
  private resolveModel(modality: string, callModel?: string): string {
    if (callModel) return callModel;
    if (this.opts.mode === "direct") {
      return this.opts.model ?? DEFAULT_MODELS[this.opts.provider]?.[modality] ?? "";
    }
    return "";
  }

  private setBodyField(body: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined) body[key] = value;
  }

  private addProxyRoutingFields(body: Record<string, unknown>, options?: WebCallOptions): void {
    this.setBodyField(body, "provider", options?.provider);
    this.setBodyField(body, "model", options?.model);
    this.setBodyField(body, "fileRef", options?.fileRef);
  }

  private proxyHeaders(options?: WebCallOptions): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.mode !== "proxy") return headers;
    let trusted = false;
    try {
      const target = new URL(this.proxyBase);
      const current = typeof location === "undefined" ? "" : location.origin;
      trusted =
        target.hostname === "localhost" ||
        target.hostname === "127.0.0.1" ||
        target.origin === current;
    } catch {
      // Invalid proxy URLs remain untrusted.
    }
    if (!trusted) return headers;
    const credential = options?.providerCredential ?? this.opts.providerCredential;
    if (credential === undefined) return headers;
    const payload = typeof credential === "string" ? { apiKey: credential } : credential;
    headers["X-AI-Provider-Credentials"] = btoa(
      unescape(encodeURIComponent(JSON.stringify(payload))),
    );
    return headers;
  }

  private addProxyImageFields(body: Record<string, unknown>, options?: WebImageOptions): void {
    this.addProxyRoutingFields(body, options);
    this.setBodyField(body, "fileRefs", options?.fileRefs);
    this.setBodyField(body, "aspectRatio", options?.aspectRatio);
    this.setBodyField(body, "width", options?.width);
    this.setBodyField(body, "height", options?.height);
    this.setBodyField(body, "quality", options?.quality);
  }

  private addProxyVideoFields(body: Record<string, unknown>, options?: WebVideoOptions): void {
    this.addProxyRoutingFields(body, options);
    this.setBodyField(body, "fileRefs", options?.fileRefs);
    this.setBodyField(body, "images", options?.images);
    this.setBodyField(body, "aspectRatio", options?.aspectRatio);
    this.setBodyField(body, "resolution", options?.resolution);
    this.setBodyField(body, "quality", options?.quality);
    this.setBodyField(body, "duration", options?.duration);
    this.setBodyField(body, "fps", options?.fps);
    this.setBodyField(body, "negativePrompt", options?.negativePrompt);
    this.setBodyField(body, "seed", options?.seed);
    this.setBodyField(body, "transitionDuration", options?.transitionDuration);
    this.setBodyField(body, "pikaffect", options?.pikaffect);
    this.setBodyField(body, "modifyRegionRoi", options?.modifyRegionRoi);
    this.setBodyField(body, "modifyRegionMask", options?.modifyRegionMask);
  }

  /**
   * Parse a fetch Response that may be an error.
   * Throws a descriptive Error for non-2xx responses.
   */
  private async assertOk(res: Response, provider?: string): Promise<void> {
    if (res.ok) return;
    const body = await res.text().catch(() => "");
    let message = body.trim();
    let code = "PROXY_ERROR";
    if (message) {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (
          provider === "anthropic" &&
          parsed["error"] &&
          typeof parsed["error"] === "object" &&
          !Array.isArray(parsed["error"]) &&
          typeof (parsed["error"] as Record<string, unknown>)["message"] === "string"
        ) {
          message = (parsed["error"] as Record<string, unknown>)["message"] as string;
        } else if (typeof parsed["error"] === "string") {
          message = parsed["error"];
        } else if (typeof parsed["message"] === "string") {
          message = parsed["message"];
        }
        if (typeof parsed["code"] === "string") code = parsed["code"];
      } catch {
        // Keep the raw text body when the error payload is not JSON.
      }
    }
    throw new WebProxyError(message || `HTTP ${res.status}`, code, res.status);
  }

  /**
   * Executes a fetch thunk through the per-instance circuit breaker. Safe reads
   * use bounded Full Jitter retries; generation requests are single-attempt by
   * default because they have no idempotency contract. Forwards `signal` so
   * callers can cancel mid-flight or during a read backoff delay.
   */
  private fetchWithResilience(
    fn: () => Promise<Response>,
    signal?: AbortSignal,
    requestClass: WebRequestClass = "generation",
  ): Promise<Response> {
    // Build RetryOptions conditionally to satisfy exactOptionalPropertyTypes:
    // passing `undefined` for an optional field is a type error with that flag.
    const retryOpts: import("../shared/resilience.js").RetryOptions = {
      allowRetries: requestClass === "safe-read",
      ...(this.opts.maxRetries !== undefined && { maxRetries: this.opts.maxRetries }),
      ...(this.opts.backoffBase !== undefined && { backoffBase: this.opts.backoffBase }),
      ...(this.opts.backoffCap !== undefined && { backoffCap: this.opts.backoffCap }),
    };
    return this._breaker
      .call(
        async () => {
          const response = await withRetryFetch(fn, retryOpts, signal);
          if (response.status === 429 || response.status === 503) {
            throw new RetryableResponseError(response);
          }
          return response;
        },
        signal !== undefined ? { signal } : {},
      )
      .catch((error: unknown) => {
        if (error instanceof RetryableResponseError) return error.response;
        throw error;
      });
  }

  /**
   * Shared direct-mode text helper.
   *
   * The structured-output path reuses this so the pre-call estimate is applied
   * exactly once and still uses the original prompt for budgeting.
   */
  private async _generateDirectText(
    prompt: string,
    options?: WebCallOptions,
    budgetPromptText = prompt,
  ): Promise<WebTextResult> {
    if (this.opts.mode !== "direct") {
      throw new Error("Not in direct mode");
    }
    const { provider } = this.opts;
    const model = this.resolveModel("text", options?.model);
    const request = directTextAdapter(provider).buildRequest({
      baseUrl: directProviderBaseUrl(provider),
      model,
      prompt,
      options,
      stream: false,
    });

    this._checkBudget(this._estimateProjectedCost(model, budgetPromptText));
    const res = await this.fetchWithResilience(
      () =>
        fetch(request.endpoint, {
          method: "POST",
          headers: this.directHeaders(),
          body: JSON.stringify(request.body),
          signal: options?.signal ?? null,
        }),
      options?.signal,
    );
    await this.assertOk(res, provider);

    if (provider === "anthropic") {
      const data = (await res.json()) as {
        content: Array<{ type: string; text?: string }>;
        model: string;
        stop_reason?: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
      if (!Array.isArray(data.content)) {
        throw new Error("Malformed Anthropic response: missing content blocks.");
      }
      const textBlocks = data.content.filter(
        (b): b is { type: "text"; text: string } =>
          b?.type === "text" && typeof b.text === "string",
      );
      const text = textBlocks.map((b) => b.text).join("");
      if (textBlocks.length === 0) {
        throw new Error("Malformed Anthropic response: missing text content block.");
      }
      const anthropicResult: WebTextResult = {
        content: text,
        model: data.model,
        provider,
        ...(data.stop_reason !== undefined && { finishReason: data.stop_reason }),
        ...(data.usage !== undefined && {
          usage: {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          },
        }),
      };
      this._accumulateCost(anthropicResult);
      return anthropicResult;
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string }; finish_reason?: string }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const choice = data.choices[0];
    const openaiResult: WebTextResult = {
      content: choice?.message.content ?? "",
      model: data.model,
      provider,
      ...(choice?.finish_reason !== undefined && { finishReason: choice.finish_reason }),
      ...(data.usage !== undefined && {
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
      }),
    };
    this._accumulateCost(openaiResult);
    return openaiResult;
  }

  // -------------------------------------------------------------------------
  // generateText
  // -------------------------------------------------------------------------

  /** Generate text from a prompt. */
  async generateText(prompt: string, options?: WebCallOptions): Promise<WebTextResult> {
    if (this.opts.mode === "proxy") {
      this._checkProjectedBudget(options?.model ?? "", prompt);
      const body: Record<string, unknown> = { prompt };
      this.addProxyRoutingFields(body, options);
      if (options?.temperature !== undefined) body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined) body["maxTokens"] = options.maxTokens;
      if (options?.systemPrompt !== undefined) body["systemPrompt"] = options.systemPrompt;
      if (this.opts.profile) body["profile"] = this.opts.profile;

      const res = await this.fetchWithResilience(
        () =>
          fetch(`${this.proxyBase}/text`, {
            method: "POST",
            headers: this.proxyHeaders(options),
            body: JSON.stringify(body),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      const data = (await res.json()) as {
        content?: string;
        text?: string;
        model?: string;
        provider?: string;
        finishReason?: string;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
        cost?: { totalUsd: number; isEstimate: boolean };
      };
      const result: WebTextResult = {
        content: data.content ?? data.text ?? "",
        model: data.model ?? "",
        provider: data.provider ?? "",
        ...(data.finishReason !== undefined && { finishReason: data.finishReason }),
        ...(data.usage !== undefined && { usage: data.usage }),
        ...(data.cost !== undefined && { cost: data.cost }),
      };
      this._accumulateProxyCost(data, "text");
      return result;
    }

    // Direct mode — OpenAI-compatible chat completions (all four providers use this format)
    return this._generateDirectText(prompt, options);
  }

  // -------------------------------------------------------------------------
  // streamText — SSE parsing
  // -------------------------------------------------------------------------

  /**
   * Stream text deltas as an `AsyncIterable<string>`.
   *
   * In proxy mode the server returns `text/plain` chunks directly.
   * In direct mode the provider returns `text/event-stream` SSE (`data: {...}`).
   */
  async *streamText(prompt: string, options?: WebCallOptions): AsyncIterable<string> {
    if (this.opts.mode === "proxy") {
      const projectedCost = this._checkProjectedBudget(options?.model ?? "", prompt);
      const body: Record<string, unknown> = { prompt, stream: true };
      this.addProxyRoutingFields(body, options);
      if (options?.temperature !== undefined) body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined) body["maxTokens"] = options.maxTokens;
      if (options?.systemPrompt !== undefined) body["systemPrompt"] = options.systemPrompt;
      if (this.opts.profile) body["profile"] = this.opts.profile;

      const res = await this.fetchWithResilience(
        () =>
          fetch(`${this.proxyBase}/text`, {
            method: "POST",
            headers: this.proxyHeaders(options),
            body: JSON.stringify(body),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);

      const reader = res.body?.getReader();
      if (!reader) {
        this._accumulateEstimatedCost(projectedCost);
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
      this._accumulateEstimatedCost(projectedCost);
      return;
    }

    // Direct mode — SSE stream from provider
    const { provider } = this.opts;
    const model = this.resolveModel("text", options?.model);
    const request = directTextAdapter(provider).buildRequest({
      baseUrl: directProviderBaseUrl(provider),
      model,
      prompt,
      options,
      stream: true,
    });
    this._checkBudget(this._estimateProjectedCost(model, prompt));

    const res = await this.fetchWithResilience(
      () =>
        fetch(request.endpoint, {
          method: "POST",
          headers: this.directHeaders(),
          body: JSON.stringify(request.body),
          signal: options?.signal ?? null,
        }),
      options?.signal,
    );
    await this.assertOk(res, provider);

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;
        try {
          const evt = JSON.parse(payload) as Record<string, unknown>;
          const streamEvent = directTextAdapter(provider).parseStreamEvent(evt);
          if (streamEvent?.text !== undefined) yield streamEvent.text;
          if (streamEvent?.done) return;
        } catch {
          // Malformed SSE chunk — skip
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // generateImage
  // -------------------------------------------------------------------------

  /**
   * Generate an image and return it as a `Blob` (use `URL.createObjectURL()`).
   * In proxy mode the server JSON response may contain `url`, `b64_json`, or
   * `data` (data URI from `ImageResult`) — all three formats are handled.
   */
  async generateImage(prompt: string, options?: WebImageOptions): Promise<Blob> {
    if (this.opts.mode === "proxy") {
      this._checkProjectedBudget(options?.model ?? "", prompt);
      const body: Record<string, unknown> = { prompt };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      this.addProxyImageFields(body, options);
      const res = await this.fetchWithResilience(
        () =>
          fetch(`${this.proxyBase}/image`, {
            method: "POST",
            headers: this.proxyHeaders(options),
            body: JSON.stringify(body),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      const data = (await res.json()) as {
        url?: string;
        b64_json?: string;
        data?: string;
        mimeType?: string;
      };
      this._accumulateProxyCost(data, "image");
      if (data.url) {
        // Capture into const so TypeScript preserves the string narrowing inside the closure.
        const imgUrl = data.url;
        const imgRes = await this.fetchWithResilience(
          () => fetch(imgUrl, { signal: options?.signal ?? null }),
          options?.signal,
          "safe-read",
        );
        return imgRes.blob();
      }
      if (data.b64_json) {
        const bytes = Uint8Array.from(atob(data.b64_json), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "image/png" });
      }
      // ImageResult.data is a data URI (e.g. "data:image/png;base64,...")
      if (data.data) {
        const commaIdx = data.data.indexOf(",");
        const header = commaIdx >= 0 ? data.data.slice(0, commaIdx) : "";
        const b64 = commaIdx >= 0 ? data.data.slice(commaIdx + 1) : data.data;
        const mime = header.match(/:(.*?);/)?.[1] ?? data.mimeType ?? "image/png";
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: mime });
      }
      throw new Error("generateImage: no image data in proxy response");
    }

    // Direct mode — OpenAI / Venice images endpoint
    const { provider, apiKey } = this.opts;
    if (provider === "openrouter") {
      const model = this.resolveModel("image", options?.model);
      this._checkBudget(this._estimateProjectedCost(model, prompt));
      const res = await this.fetchWithResilience(
        () =>
          fetch(`${PROVIDER_BASE_URLS[provider]}/images`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              prompt,
              response_format: "b64_json",
            }),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      const imageResult = (await res.json()) as {
        data?:
          Array<{ b64_json?: string; url?: string; data?: string; mimeType?: string }> | string;
        b64_json?: string;
        url?: string;
        mimeType?: string;
      };
      const item = Array.isArray(imageResult.data) ? imageResult.data[0] : undefined;
      const b64 = item?.b64_json ?? imageResult.b64_json;
      if (b64) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "image/png" });
      }
      const imageUrl = item?.url ?? imageResult.url;
      if (imageUrl) {
        const directImgUrl = imageUrl;
        const imgRes = await this.fetchWithResilience(
          () => fetch(directImgUrl, { signal: options?.signal ?? null }),
          options?.signal,
          "safe-read",
        );
        return imgRes.blob();
      }
      const dataUri =
        item?.data ?? (typeof imageResult.data === "string" ? imageResult.data : undefined);
      if (dataUri) {
        const commaIdx = dataUri.indexOf(",");
        const header = commaIdx >= 0 ? dataUri.slice(0, commaIdx) : "";
        const b64 = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
        const mime = header.match(/:(.*?);/)?.[1] ?? imageResult.mimeType ?? "image/png";
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: mime });
      }
      throw new Error("generateImage: no image data in provider response");
    }
    const model = this.resolveModel("image", options?.model);
    this._checkBudget(this._estimateProjectedCost(model, prompt));
    const res = await this.fetchWithResilience(
      () =>
        fetch(`${PROVIDER_BASE_URLS[provider]}/images/generations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, prompt, response_format: "b64_json" }),
          signal: options?.signal ?? null,
        }),
      options?.signal,
    );
    await this.assertOk(res);
    const data = (await res.json()) as {
      data: Array<{ b64_json?: string; url?: string }>;
    };
    const item = data.data[0];
    if (item?.b64_json) {
      const bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: "image/png" });
    }
    if (item?.url) {
      // Capture into const so TypeScript preserves the string narrowing inside the closure.
      const directImgUrl = item.url;
      const imgRes = await this.fetchWithResilience(
        () => fetch(directImgUrl, { signal: options?.signal ?? null }),
        options?.signal,
        "safe-read",
      );
      return imgRes.blob();
    }
    throw new Error("generateImage: no image data in provider response");
  }

  // -------------------------------------------------------------------------
  // transcribeAudio
  // -------------------------------------------------------------------------

  /**
   * Transcribe audio.  Pass a `Blob` (e.g. from MediaRecorder) and receive text.
   * In direct mode only OpenAI / Venice (Whisper) is supported.
   */
  async transcribeAudio(audio: Blob, options?: WebCallOptions): Promise<string> {
    if (this.opts.mode === "proxy") {
      this._checkProjectedBudget(options?.model ?? "", String(audio.size));
      // Convert Blob to base64 for the JSON body the proxy server expects.
      const buffer = await audio.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const b64 = btoa(binary);

      const body: Record<string, unknown> = {
        audioBase64: b64,
        // Forward the Blob MIME type when available so the proxy can pass it through.
        mimeType: audio.type || undefined,
      };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      this.addProxyRoutingFields(body, options);
      const res = await this.fetchWithResilience(
        () =>
          fetch(`${this.proxyBase}/audio/transcribe`, {
            method: "POST",
            headers: this.proxyHeaders(options),
            body: JSON.stringify(body),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      const data = (await res.json()) as {
        text?: string;
        transcript?: string;
        cost?: WebCostBreakdown;
      };
      this._accumulateProxyCost(data, "audio transcription");
      return data.text ?? data.transcript ?? "";
    }

    // Direct mode — multipart form upload to Whisper endpoint.
    // Derive the filename extension from the Blob's MIME type so Whisper
    // receives the correct file hint for video containers and audio formats.
    const { provider, apiKey } = this.opts;
    if (provider === "openrouter") {
      const model = this.resolveModel("audio", options?.model);
      this._checkBudget(this._estimateProjectedCost(model, audio.type || "audio/webm"));
      const buffer = await audio.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const b64 = btoa(binary);
      const directMimeType = audio.type || "audio/webm";
      const res = await this.fetchWithResilience(
        () =>
          fetch(`${PROVIDER_BASE_URLS[provider]}/audio/transcriptions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              file: b64,
              input: b64,
              audio: b64,
              mime_type: directMimeType,
              mimeType: directMimeType,
            }),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      const data = (await res.json()) as { text?: string; transcript?: string };
      return data.text ?? data.transcript ?? "";
    }
    const model = this.resolveModel("audio", options?.model);
    const directMimeType = audio.type || "audio/webm";
    const directExt = directMimeType.split("/")[1]?.split(";")[0] ?? "webm";
    const form = new FormData();
    form.append("file", audio, `media.${directExt}`);
    form.append("model", model || "whisper-1");

    const res = await this.fetchWithResilience(
      () =>
        fetch(`${PROVIDER_BASE_URLS[provider]}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: options?.signal ?? null,
        }),
      options?.signal,
    );
    await this.assertOk(res);
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  }

  // -------------------------------------------------------------------------
  // synthesizeSpeech
  // -------------------------------------------------------------------------

  /** Synthesize speech and return the audio as a `Blob` (audio/mpeg or audio/wav). */
  async synthesizeSpeech(text: string, options?: WebCallOptions): Promise<Blob> {
    if (this.opts.mode === "proxy") {
      this._checkProjectedBudget(options?.model ?? "", text);
      const body: Record<string, unknown> = { text };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      this.addProxyRoutingFields(body, options);
      const res = await this.fetchWithResilience(
        () =>
          fetch(`${this.proxyBase}/audio/speak`, {
            method: "POST",
            headers: this.proxyHeaders(options),
            body: JSON.stringify(body),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      // Proxy returns { audio: "<base64>" }
      const data = (await res.json()) as { audio?: string; cost?: WebCostBreakdown };
      this._accumulateProxyCost(data, "speech synthesis");
      if (data.audio) {
        const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "audio/mpeg" });
      }
      throw new Error("synthesizeSpeech: no audio in proxy response");
    }

    // Direct mode — OpenAI TTS endpoint
    const { provider, apiKey } = this.opts;
    const model = options?.model ?? this.opts.model ?? "tts-1";
    this._checkBudget(this._estimateProjectedCost(model, text));
    const res = await this.fetchWithResilience(
      () =>
        fetch(`${PROVIDER_BASE_URLS[provider]}/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, input: text, voice: "alloy" }),
          signal: options?.signal ?? null,
        }),
      options?.signal,
    );
    await this.assertOk(res);
    return res.blob();
  }

  // -------------------------------------------------------------------------
  // generateVideo
  // -------------------------------------------------------------------------

  /** Generate video and return it as a `Blob`. Only supported via proxy. */
  async generateVideo(prompt: string, options?: WebVideoOptions): Promise<Blob> {
    if (this.opts.mode === "proxy") {
      this._checkProjectedBudget(options?.model ?? "", prompt);
      const body: Record<string, unknown> = { prompt };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      this.addProxyVideoFields(body, options);
      const res = await this.fetchWithResilience(
        () =>
          fetch(`${this.proxyBase}/video`, {
            method: "POST",
            headers: this.proxyHeaders(options),
            body: JSON.stringify(body),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      const data = (await res.json()) as {
        url?: string;
        b64_json?: string;
        data?: string;
        mimeType?: string;
      };
      this._accumulateProxyCost(data, "video");
      if (data.url) {
        // Capture into const so TypeScript preserves the string narrowing inside the closure.
        const vidUrl = data.url;
        const vidRes = await this.fetchWithResilience(
          () => fetch(vidUrl, { signal: options?.signal ?? null }),
          options?.signal,
          "safe-read",
        );
        return vidRes.blob();
      }
      if (data.b64_json) {
        const bytes = Uint8Array.from(atob(data.b64_json), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "video/mp4" });
      }
      // VideoResult.data is a data URI (e.g. "data:video/mp4;base64,...")
      if (data.data) {
        const commaIdx = data.data.indexOf(",");
        const header = commaIdx >= 0 ? data.data.slice(0, commaIdx) : "";
        const b64 = commaIdx >= 0 ? data.data.slice(commaIdx + 1) : data.data;
        const mime = header.match(/:(.*?);/)?.[1] ?? data.mimeType ?? "video/mp4";
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: mime });
      }
      throw new Error("generateVideo: no video data in proxy response");
    }
    const model = options?.model ?? this.opts.model ?? "";
    this._checkBudget(this._estimateProjectedCost(model, prompt));
    throw new Error("generateVideo is not supported in direct mode. Use proxy mode instead.");
  }

  // -------------------------------------------------------------------------
  // generateMusic
  // -------------------------------------------------------------------------

  /** Generate music through the proxy and return a playable audio Blob. */
  async generateMusic(prompt: string, options?: WebMusicOptions): Promise<WebMusicResult> {
    if (this.opts.mode !== "proxy") {
      throw new Error("generateMusic is not supported in direct mode. Use proxy mode instead.");
    }
    this._checkProjectedBudget(options?.model ?? "", prompt);
    const body: Record<string, unknown> = { prompt };
    this.addProxyRoutingFields(body, options);
    if (this.opts.profile) body["profile"] = this.opts.profile;
    if (options?.lyrics !== undefined) body["lyrics"] = options.lyrics;
    if (options?.instrumental !== undefined) body["instrumental"] = options.instrumental;
    if (options?.duration !== undefined) body["duration"] = options.duration;
    if (options?.seed !== undefined) body["seed"] = options.seed;

    const res = await this.fetchWithResilience(
      () =>
        fetch(`${this.proxyBase}/music`, {
          method: "POST",
          headers: this.proxyHeaders(options),
          body: JSON.stringify(body),
          signal: options?.signal ?? null,
        }),
      options?.signal,
    );
    await this.assertOk(res);
    const data = (await res.json()) as {
      data?: string;
      url?: string;
      b64_json?: string;
      mimeType?: string;
      model?: string;
      provider?: string;
      title?: string;
      lyrics?: string;
      durationSeconds?: number;
      cost?: WebCostBreakdown;
    };
    this._accumulateProxyCost(data, "music");
    let audio: Blob;
    const mime = data.mimeType ?? "audio/mpeg";
    if (data.url) {
      const audioResponse = await this.fetchWithResilience(
        () => fetch(data.url!, { signal: options?.signal ?? null }),
        options?.signal,
        "safe-read",
      );
      audio = await audioResponse.blob();
    } else {
      const encoded = data.b64_json ?? data.data;
      if (!encoded) throw new Error("generateMusic: no audio data in proxy response");
      const comma = encoded.indexOf(",");
      const base64 = comma >= 0 ? encoded.slice(comma + 1) : encoded;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      audio = new Blob([bytes], { type: mime });
    }
    return {
      audio,
      model: data.model ?? "",
      provider: data.provider ?? "",
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.lyrics !== undefined ? { lyrics: data.lyrics } : {}),
      ...(data.durationSeconds !== undefined ? { durationSeconds: data.durationSeconds } : {}),
      ...(data.cost !== undefined ? { cost: data.cost } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // generateStructured
  // -------------------------------------------------------------------------

  /** Generate structured JSON output matching the given schema description. */
  async generateStructured<T = unknown>(
    prompt: string,
    options?: WebCallOptions,
  ): Promise<WebStructuredResult<T>> {
    if (this.opts.mode === "proxy") {
      this._checkProjectedBudget(options?.model ?? "", prompt);
      const body: Record<string, unknown> = { prompt };
      this.addProxyRoutingFields(body, options);
      if (options?.temperature !== undefined) body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined) body["maxTokens"] = options.maxTokens;
      if (options?.systemPrompt !== undefined) body["systemPrompt"] = options.systemPrompt;
      if (this.opts.profile) body["profile"] = this.opts.profile;

      const res = await this.fetchWithResilience(
        () =>
          fetch(`${this.proxyBase}/structured`, {
            method: "POST",
            headers: this.proxyHeaders(options),
            body: JSON.stringify(body),
            signal: options?.signal ?? null,
          }),
        options?.signal,
      );
      await this.assertOk(res);
      const data = (await res.json()) as {
        data?: T;
        model?: string;
        provider?: string;
        cost?: { totalUsd: number; isEstimate: boolean };
      };
      this._accumulateProxyCost(data, "structured");
      return {
        data: data.data ?? (data as unknown as T),
        model: data.model ?? "",
        provider: data.provider ?? "",
        ...(data.cost !== undefined && { cost: data.cost }),
      };
    }

    // Direct mode — instruct the model to return JSON
    const jsonPrompt = `${prompt}\n\nRespond ONLY with valid JSON, no markdown or explanation.`;
    const result = await this._generateDirectText(
      jsonPrompt,
      {
        ...options,
        systemPrompt:
          options?.systemPrompt ??
          "You are a helpful assistant that responds only with valid JSON.",
      },
      prompt,
    );

    let parsed: T;
    try {
      parsed = JSON.parse(result.content) as T;
    } catch {
      throw new Error(
        `generateStructured: model returned non-JSON content: ${result.content.slice(0, 100)}`,
      );
    }
    // Cost was already accumulated by the underlying generateText call.
    return { data: parsed, model: result.model, provider: result.provider };
  }

  // -------------------------------------------------------------------------
  // listModels
  // -------------------------------------------------------------------------

  /** List models available from the configured provider or proxy. */
  async listModels(
    modality?: string,
    accepts?: string,
    options?: WebCallOptions,
  ): Promise<WebModelInfo[]>;
  async listModels(modality?: string, options?: WebCallOptions): Promise<WebModelInfo[]>;
  async listModels(
    modality?: string,
    acceptsOrOptions?: string | WebCallOptions,
    options?: WebCallOptions,
  ): Promise<WebModelInfo[]> {
    const accepts = typeof acceptsOrOptions === "string" ? acceptsOrOptions : undefined;
    const callOptions = typeof acceptsOrOptions === "string" ? options : acceptsOrOptions;
    if (this.opts.mode === "proxy") {
      const url = new URL(`${this.proxyBase}/models`);
      if (modality) url.searchParams.set("modality", modality);
      if (accepts) url.searchParams.set("accepts", accepts);
      if (callOptions?.provider) url.searchParams.set("provider", callOptions.provider);
      const res = await this.fetchWithResilience(
        () =>
          fetch(url.toString(), {
            headers: this.proxyHeaders(callOptions),
            signal: callOptions?.signal ?? null,
          }),
        callOptions?.signal,
        "safe-read",
      );
      await this.assertOk(res);
      return res.json() as Promise<WebModelInfo[]>;
    }

    const { provider, apiKey: _apiKey } = this.opts;
    const endpoint =
      provider === "anthropic"
        ? `${PROVIDER_BASE_URLS[provider]}/models`
        : `${PROVIDER_BASE_URLS[provider]}/models`;

    const res = await this.fetchWithResilience(
      () =>
        fetch(endpoint, {
          headers: this.directHeaders(),
          signal: callOptions?.signal ?? null,
        }),
      callOptions?.signal,
      "safe-read",
    );
    await this.assertOk(res);

    if (provider === "anthropic") {
      const data = (await res.json()) as { data: Array<Record<string, unknown>> };
      const models: WebModelInfo[] = data.data.map((m): WebModelInfo => {
        const id = typeof m["id"] === "string" ? (m["id"] as string) : "";
        const name = typeof m["display_name"] === "string" ? (m["display_name"] as string) : id;
        return {
          ...m,
          id,
          name,
          capabilities: ["text", "structured"],
          inputCapabilities: ["image"],
        };
      });
      return accepts
        ? models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false)
        : models;
    }

    if (provider === "venice") {
      const data = (await res.json()) as { data: Array<Record<string, unknown>> };
      const models: WebModelInfo[] = data.data.map((m): WebModelInfo => {
        const id = typeof m["id"] === "string" ? (m["id"] as string) : "";
        const isImage = typeof m["type"] === "string" ? (m["type"] as string) === "image" : false;
        const capabilities = isImage ? ["image"] : ["text", "structured"];
        const model: WebModelInfo = {
          ...m,
          id,
          name: id,
          capabilities,
        };
        if (isImage) {
          model.inputCapabilities = ["image"];
        }
        return model;
      });
      return accepts
        ? models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false)
        : models;
    }

    // OpenAI-compatible /models response
    const data = (await res.json()) as { data: Array<Record<string, unknown>> };
    const models: WebModelInfo[] = data.data.map((m): WebModelInfo => {
      const id = typeof m["id"] === "string" ? (m["id"] as string) : "";
      const model: WebModelInfo = {
        ...m,
        id,
        name: id,
        capabilities: [],
      };
      const inferred = inferDirectModeInputCapabilities(provider, id);
      if (inferred && model.inputCapabilities === undefined) {
        model.inputCapabilities = inferred;
      }
      return model;
    });
    return accepts ? models.filter((m) => m.inputCapabilities?.includes(accepts) ?? false) : models;
  }

  // -------------------------------------------------------------------------
  // session
  // -------------------------------------------------------------------------

  /**
   * Returns (or re-creates) a `BrowserConversationSession` by ID.
   * History is persisted in `sessionStorage` and survives page re-renders
   * within the same browser tab.
   */
  session(id: string): BrowserConversationSession {
    return new BrowserConversationSession(id, this);
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a `WebAiClient` from the given options.
 *
 * @example
 * // Proxy mode (recommended for production)
 * const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3000" });
 *
 * @example
 * // Direct mode (development / demo only)
 * const client = createWebClient({ mode: "direct", provider: "openai", apiKey: "sk-..." });
 */
export function createWebClient(opts: WebClientOptions): WebAiClient {
  return new WebAiClient(opts);
}
/** Stable error envelope for proxy transport and billing-contract failures. */
export class WebProxyError extends Error {
  readonly code: string;
  readonly statusCode?: number;

  constructor(message: string, code = "PROXY_ERROR", statusCode?: number) {
    super(message);
    this.name = "ProxyError";
    this.code = code;
    if (statusCode !== undefined) this.statusCode = statusCode;
  }
}
