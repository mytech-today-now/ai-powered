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
  /** Model override for this call only. */
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

/** Result of a text-generation call. */
export interface WebTextResult {
  content: string;
  model: string;
  provider: string;
  finishReason?: string;
  usage?: WebTokenUsage;
}

/** Result of a structured-output call. */
export interface WebStructuredResult<T = unknown> {
  data: T;
  model: string;
  provider: string;
}

/** Minimal model descriptor returned from listModels(). */
export interface WebModelInfo {
  id: string;
  name: string;
  capabilities: string[];
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
}

/**
 * Direct mode: the browser calls the provider API directly.
 *
 * ⚠ WARNING: your API key is visible in DevTools and network traffic.
 * Use proxy mode in production. A non-suppressible DOM banner is rendered.
 */
export interface WebDirectOptions {
  mode: "direct";
  provider: "openai" | "anthropic" | "venice" | "xai";
  apiKey: string;
  model?: string;
}

export type WebClientOptions = WebProxyOptions | WebDirectOptions;

// ---------------------------------------------------------------------------
// Provider base URLs (direct mode)
// ---------------------------------------------------------------------------

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  venice: "https://api.venice.ai/api/v1",
  xai: "https://api.x.ai/v1",
};

// ---------------------------------------------------------------------------
// Default models per provider (used when opts.model is omitted in direct mode)
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<string, Partial<Record<string, string>>> = {
  openai: { text: "gpt-4o", image: "dall-e-3", audio: "whisper-1", structured: "gpt-4o" },
  anthropic: { text: "claude-opus-4-5", structured: "claude-3-5-sonnet-20241022" },
  venice: { text: "llama-3.3-70b", image: "fluently-xl", structured: "llama-3.3-70b" },
  xai: { text: "grok-2-1212", structured: "grok-2-1212" },
};

// ---------------------------------------------------------------------------
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
  const doc = (globalThis as Record<string, unknown>)["document"] as
    | MinimalDoc
    | undefined;
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

// ---------------------------------------------------------------------------
// BrowserConversationSession
// ---------------------------------------------------------------------------

/**
 * Lightweight multi-turn session backed by `sessionStorage`.
 *
 * History is keyed as `ai-session:<id>` and persisted for the tab lifetime.
 * Each call to `send()` prepends the accumulated history so the model has
 * full context, then appends both the user prompt and assistant reply.
 */
export class BrowserConversationSession {
  private readonly storageKey: string;

  constructor(
    private readonly sessionId: string,
    private readonly client: WebAiClient,
  ) {
    this.storageKey = `ai-session:${sessionId}`;
  }

  /** Retrieve the full conversation history from sessionStorage. */
  getHistory(): WebMessage[] {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      return raw ? (JSON.parse(raw) as WebMessage[]) : [];
    } catch {
      return [];
    }
  }

  /** Append a message to the persistent history. */
  private appendMessage(msg: WebMessage): void {
    const history = this.getHistory();
    history.push(msg);
    sessionStorage.setItem(this.storageKey, JSON.stringify(history));
  }

  /**
   * Send a user message, building on the accumulated history.
   * Returns the assistant reply text and persists both turns.
   */
  async send(userMessage: string, options?: WebCallOptions): Promise<string> {
    this.appendMessage({ role: "user", content: userMessage });
    const history = this.getHistory();

    // Build a combined prompt from the history for single-turn providers.
    const historyPrompt = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const result = await this.client.generateText(historyPrompt, options);
    const reply = result.content;
    this.appendMessage({ role: "assistant", content: reply });
    return reply;
  }

  /** Stream the assistant reply, persisting both turns on completion. */
  async *stream(
    userMessage: string,
    options?: WebCallOptions,
  ): AsyncIterable<string> {
    this.appendMessage({ role: "user", content: userMessage });
    const history = this.getHistory();
    const historyPrompt = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const chunks: string[] = [];
    for await (const chunk of this.client.streamText(historyPrompt, options)) {
      chunks.push(chunk);
      yield chunk;
    }
    this.appendMessage({ role: "assistant", content: chunks.join("") });
  }

  /** Clear session history from sessionStorage. */
  clear(): void {
    sessionStorage.removeItem(this.storageKey);
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

  constructor(opts: WebClientOptions) {
    this.opts = opts;
    if (opts.mode === "direct") {
      console.warn(
        "[ai-powered] Direct mode is active. Your API key is visible in browser " +
          "DevTools. Use proxy mode in production.",
      );
      renderSecurityBanner();
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
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  /** Resolve the model to use: call option → direct-mode default → provider default. */
  private resolveModel(modality: string, callModel?: string): string {
    if (callModel) return callModel;
    if (this.opts.mode === "direct") {
      return (
        this.opts.model ??
        DEFAULT_MODELS[this.opts.provider]?.[modality] ??
        ""
      );
    }
    return "";
  }

  /**
   * Parse a fetch Response that may be an error.
   * Throws a descriptive Error for non-2xx responses.
   */
  private async assertOk(res: Response): Promise<void> {
    if (res.ok) return;
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }

  // -------------------------------------------------------------------------
  // generateText
  // -------------------------------------------------------------------------

  /** Generate text from a prompt. */
  async generateText(
    prompt: string,
    options?: WebCallOptions,
  ): Promise<WebTextResult> {
    if (this.opts.mode === "proxy") {
      const body: Record<string, unknown> = { prompt };
      if (options?.temperature !== undefined) body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined) body["maxTokens"] = options.maxTokens;
      if (options?.systemPrompt !== undefined) body["systemPrompt"] = options.systemPrompt;
      if (this.opts.profile) body["profile"] = this.opts.profile;

      const res = await fetch(`${this.proxyBase}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ?? null,
      });
      await this.assertOk(res);
      const data = (await res.json()) as {
        content?: string;
        text?: string;
        model?: string;
        provider?: string;
        finishReason?: string;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      };
      return {
        content: data.content ?? data.text ?? "",
        model: data.model ?? "",
        provider: data.provider ?? "",
        ...(data.finishReason !== undefined && { finishReason: data.finishReason }),
        ...(data.usage !== undefined && { usage: data.usage }),
      };
    }

    // Direct mode — OpenAI-compatible chat completions (all four providers use this format)
    const { provider } = this.opts;
    const model = this.resolveModel("text", options?.model);
    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });

    const reqBody: Record<string, unknown> = { model, messages };
    if (options?.temperature !== undefined) reqBody["temperature"] = options.temperature;
    if (options?.maxTokens !== undefined) {
      // Anthropic uses max_tokens; others use max_tokens too (OpenAI-compat)
      reqBody["max_tokens"] = options.maxTokens;
    }

    const endpoint = `${PROVIDER_BASE_URLS[provider]}/messages`;
    const res = await fetch(
      provider === "anthropic" ? endpoint : `${PROVIDER_BASE_URLS[provider]}/chat/completions`,
      {
        method: "POST",
        headers: this.directHeaders(),
        body: JSON.stringify(reqBody),
        signal: options?.signal ?? null,
      },
    );
    await this.assertOk(res);

    if (provider === "anthropic") {
      const data = (await res.json()) as {
        content: Array<{ type: string; text?: string }>;
        model: string;
        stop_reason?: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
      const text = data.content.find((b) => b.type === "text")?.text ?? "";
      return {
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
    }

    // OpenAI-compatible response
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string }; finish_reason?: string }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const choice = data.choices[0];
    return {
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
  async *streamText(
    prompt: string,
    options?: WebCallOptions,
  ): AsyncIterable<string> {
    if (this.opts.mode === "proxy") {
      const body: Record<string, unknown> = { prompt, stream: true };
      if (options?.temperature !== undefined) body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined) body["maxTokens"] = options.maxTokens;
      if (options?.systemPrompt !== undefined) body["systemPrompt"] = options.systemPrompt;
      if (this.opts.profile) body["profile"] = this.opts.profile;

      const res = await fetch(`${this.proxyBase}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ?? null,
      });
      await this.assertOk(res);

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
      return;
    }

    // Direct mode — SSE stream from provider
    const { provider } = this.opts;
    const model = this.resolveModel("text", options?.model);
    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });

    const reqBody: Record<string, unknown> = { model, messages, stream: true };
    if (options?.temperature !== undefined) reqBody["temperature"] = options.temperature;
    if (options?.maxTokens !== undefined) reqBody["max_tokens"] = options.maxTokens;

    const res = await fetch(
      provider === "anthropic"
        ? `${PROVIDER_BASE_URLS[provider]}/messages`
        : `${PROVIDER_BASE_URLS[provider]}/chat/completions`,
      {
        method: "POST",
        headers: this.directHeaders(),
        body: JSON.stringify(reqBody),
        signal: options?.signal ?? null,
      },
    );
    await this.assertOk(res);

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
          // OpenAI-compatible (including Venice, xAI)
          const choices = evt["choices"] as
            | Array<{ delta?: { content?: string } }>
            | undefined;
          const delta = choices?.[0]?.delta?.content;
          if (delta) { yield delta; continue; }
          // Anthropic streaming
          const anthropicDelta = (
            evt["delta"] as { type?: string; text?: string } | undefined
          );
          if (anthropicDelta?.type === "text_delta" && anthropicDelta.text) {
            yield anthropicDelta.text;
          }
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
   * In proxy mode the server JSON response's `url` field is fetched to Blob.
   */
  async generateImage(prompt: string, options?: WebCallOptions): Promise<Blob> {
    if (this.opts.mode === "proxy") {
      const body: Record<string, unknown> = { prompt };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      const res = await fetch(`${this.proxyBase}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ?? null,
      });
      await this.assertOk(res);
      const data = (await res.json()) as { url?: string; b64_json?: string };
      if (data.url) {
        const imgRes = await fetch(data.url, { signal: options?.signal ?? null });
        return imgRes.blob();
      }
      if (data.b64_json) {
        const bytes = Uint8Array.from(atob(data.b64_json), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "image/png" });
      }
      throw new Error("generateImage: no url or b64_json in proxy response");
    }

    // Direct mode — OpenAI / Venice images endpoint
    const { provider, apiKey } = this.opts;
    const model = this.resolveModel("image", options?.model);
    const res = await fetch(`${PROVIDER_BASE_URLS[provider]}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt, response_format: "b64_json" }),
      signal: options?.signal ?? null,
    });
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
      const imgRes = await fetch(item.url, { signal: options?.signal ?? null });
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
      // Convert Blob to base64 for the JSON body the proxy server expects.
      const buffer = await audio.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const b64 = btoa(binary);

      const body: Record<string, unknown> = { audioBase64: b64 };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      const res = await fetch(`${this.proxyBase}/audio/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ?? null,
      });
      await this.assertOk(res);
      const data = (await res.json()) as { text?: string; transcript?: string };
      return data.text ?? data.transcript ?? "";
    }

    // Direct mode — multipart form upload to Whisper endpoint
    const { provider, apiKey } = this.opts;
    const model = this.resolveModel("audio", options?.model);
    const form = new FormData();
    form.append("file", audio, "audio.webm");
    form.append("model", model || "whisper-1");

    const res = await fetch(`${PROVIDER_BASE_URLS[provider]}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: options?.signal ?? null,
    });
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
      const body: Record<string, unknown> = { text };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      const res = await fetch(`${this.proxyBase}/audio/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ?? null,
      });
      await this.assertOk(res);
      // Proxy returns { audio: "<base64>" }
      const data = (await res.json()) as { audio?: string };
      if (data.audio) {
        const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "audio/mpeg" });
      }
      throw new Error("synthesizeSpeech: no audio in proxy response");
    }

    // Direct mode — OpenAI TTS endpoint
    const { provider, apiKey } = this.opts;
    const model = this.resolveModel("audio", options?.model) || "tts-1";
    const res = await fetch(`${PROVIDER_BASE_URLS[provider]}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: text, voice: "alloy" }),
      signal: options?.signal ?? null,
    });
    await this.assertOk(res);
    return res.blob();
  }

  // -------------------------------------------------------------------------
  // generateVideo
  // -------------------------------------------------------------------------

  /** Generate video and return it as a `Blob`. Only supported via proxy. */
  async generateVideo(prompt: string, options?: WebCallOptions): Promise<Blob> {
    if (this.opts.mode === "proxy") {
      const body: Record<string, unknown> = { prompt };
      if (this.opts.profile) body["profile"] = this.opts.profile;
      const res = await fetch(`${this.proxyBase}/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ?? null,
      });
      await this.assertOk(res);
      const data = (await res.json()) as { url?: string; b64_json?: string };
      if (data.url) {
        const vidRes = await fetch(data.url, { signal: options?.signal ?? null });
        return vidRes.blob();
      }
      if (data.b64_json) {
        const bytes = Uint8Array.from(atob(data.b64_json), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "video/mp4" });
      }
      throw new Error("generateVideo: no video data in proxy response");
    }
    throw new Error(
      "generateVideo is not supported in direct mode. Use proxy mode instead.",
    );
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
      const body: Record<string, unknown> = { prompt };
      if (options?.temperature !== undefined) body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined) body["maxTokens"] = options.maxTokens;
      if (options?.systemPrompt !== undefined) body["systemPrompt"] = options.systemPrompt;
      if (this.opts.profile) body["profile"] = this.opts.profile;

      const res = await fetch(`${this.proxyBase}/structured`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ?? null,
      });
      await this.assertOk(res);
      const data = (await res.json()) as {
        data?: T;
        model?: string;
        provider?: string;
      };
      return {
        data: data.data ?? (data as unknown as T),
        model: data.model ?? "",
        provider: data.provider ?? "",
      };
    }

    // Direct mode — instruct the model to return JSON
    const jsonPrompt = `${prompt}\n\nRespond ONLY with valid JSON, no markdown or explanation.`;
    const result = await this.generateText(jsonPrompt, {
      ...options,
      systemPrompt:
        options?.systemPrompt ??
        "You are a helpful assistant that responds only with valid JSON.",
    });

    let parsed: T;
    try {
      parsed = JSON.parse(result.content) as T;
    } catch {
      throw new Error(
        `generateStructured: model returned non-JSON content: ${result.content.slice(0, 100)}`,
      );
    }
    return { data: parsed, model: result.model, provider: result.provider };
  }

  // -------------------------------------------------------------------------
  // listModels
  // -------------------------------------------------------------------------

  /** List models available from the configured provider or proxy. */
  async listModels(modality?: string): Promise<WebModelInfo[]> {
    if (this.opts.mode === "proxy") {
      const url = new URL(`${this.proxyBase}/models`);
      if (modality) url.searchParams.set("modality", modality);
      const res = await fetch(url.toString());
      await this.assertOk(res);
      return res.json() as Promise<WebModelInfo[]>;
    }

    const { provider, apiKey } = this.opts;
    const endpoint =
      provider === "anthropic"
        ? `${PROVIDER_BASE_URLS[provider]}/models`
        : `${PROVIDER_BASE_URLS[provider]}/models`;

    const res = await fetch(endpoint, {
      headers: this.directHeaders(),
    });
    await this.assertOk(res);

    if (provider === "anthropic") {
      const data = (await res.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({
        id: m.id,
        name: m.display_name ?? m.id,
        capabilities: ["text", "structured"],
      }));
    }

    // OpenAI-compatible /models response
    const data = (await res.json()) as { data: Array<{ id: string }> };
    return data.data.map((m) => ({ id: m.id, name: m.id, capabilities: [] }));
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
