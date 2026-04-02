/**
 * @file src/ai-powered/server/routes.ts
 *
 * Express Router with Zod-validated routes for all ai-powered modalities.
 *
 * Routes mounted by createServer() in index.ts:
 *   GET  /health               – liveness probe
 *   GET  /config               – resolved config with all API keys masked
 *   GET  /models               – list models (optional ?modality=)
 *   GET  /pricing              – full MODEL_PRICING table (optional ?modality= ?model=)
 *   POST /text                 – generate text (blocking or plain-text stream)
 *   POST /stream               – SSE streaming: data: {"delta":"…"} / data: [DONE]
 *   POST /image                – generate image
 *   POST /audio/transcribe     – transcribe audio from base64 payload
 *   POST /audio/speak          – synthesise speech → base64 audio
 *   POST /video                – generate video
 *   POST /structured           – generate structured JSON
 *   POST /batch                – sequential batch (NDJSON stream)
 *
 * /v1/ compatibility routes (industry-standard wire formats):
 *   POST /v1/chat/completions     – OpenAI Chat Completions (text + streaming + structured output)
 *   POST /v1/messages             – Anthropic Messages API (text + streaming)
 *   POST /v1/images/generations   – OpenAI Images API
 *   POST /v1/audio/transcriptions – OpenAI Whisper transcription (multipart/form-data)
 *   POST /v1/audio/speech         – OpenAI TTS (binary audio response)
 *   GET  /v1/models               – OpenAI model list envelope (static aggregate)
 *   POST /v1/video/generations    – ai-powered native video (no external standard adopted)
 *
 * All routes call getAiClient() per request so that per-request overrides
 * (provider, model, temperature, profile, mock) are fully honoured.
 * Template rendering runs before the provider call when `template` is present.
 * BudgetExceededError → 402, AllProvidersExhaustedError → 503,
 * Zod validation failure → 400; all other errors propagate to the central
 * error handler in index.ts.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getAiClient, loadConfig, maskApiKey, listPricing } from "../index.js";
import { getTemplate, renderTemplate } from "../templates/index.js";
import { BudgetExceededError, AllProvidersExhaustedError } from "../types.js";
import { getLogger } from "../utils.js";
import type { ServeOptions } from "./index.js";
import { mountCompatRoutes } from "./compat/index.js";
import { inferProviderFromModel } from "./compat/model-router.js";

// ---------------------------------------------------------------------------
// Provider metadata — used by GET /providers
// ---------------------------------------------------------------------------

/** Static metadata for every registered provider. */
const PROVIDER_META = [
  {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    modalities: ["text", "image", "audio", "structured"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    modalities: ["text", "structured"],
  },
  {
    id: "xai",
    name: "xAI / Grok",
    envKey: "XAI_API_KEY",
    modalities: ["text", "structured", "video"],
  },
  {
    id: "venice",
    name: "Venice",
    envKey: "VENICE_API_KEY",
    modalities: ["text", "image", "structured"],
  },
  {
    id: "lumaai",
    name: "Luma AI",
    envKey: "LUMAAI_API_KEY",
    modalities: ["video"],
  },
  {
    id: "runway",
    name: "Runway",
    envKey: "RUNWAYML_API_SECRET",
    modalities: ["video"],
  },
  {
    id: "mock",
    name: "Mock (testing)",
    envKey: "",
    modalities: ["text", "image", "audio", "video", "structured"],
  },
] as const;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Shared per-request overrides forwarded to getAiClient(). */
const ClientOverrideSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
  profile: z.string().optional(),
});

/** Template rendering inputs included on text/structured routes. */
const TemplateSchema = z.object({
  template: z.string().optional(),
  vars: z.record(z.string()).optional(),
});

const TextBodySchema = ClientOverrideSchema.merge(TemplateSchema).extend({
  prompt: z.string().min(1, "prompt must not be empty"),
  stream: z.boolean().optional(),
});

/** Image-generation size controls forwarded into ProviderCallOptions. */
const ImageSizeSchema = z.object({
  aspectRatio: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  resolution: z.string().optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
});

const ImageBodySchema = ClientOverrideSchema.merge(TemplateSchema)
  .merge(ImageSizeSchema)
  .extend({
    prompt: z.string().min(1, "prompt must not be empty"),
  });

const TranscribeBodySchema = ClientOverrideSchema.extend({
  audioBase64: z.string().min(1, "audioBase64 must not be empty"),
});

const SpeakBodySchema = ClientOverrideSchema.extend({
  text: z.string().min(1, "text must not be empty"),
});

/** Video-generation size/duration controls forwarded into ProviderCallOptions. */
const VideoSizeSchema = z.object({
  aspectRatio: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  resolution: z.string().optional(),
  duration: z.number().positive().optional(),
  fps: z.number().int().positive().optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
});

const VideoBodySchema = ClientOverrideSchema.merge(TemplateSchema)
  .merge(VideoSizeSchema)
  .extend({
    prompt: z.string().min(1, "prompt must not be empty"),
  });

const StructuredBodySchema = ClientOverrideSchema.merge(TemplateSchema).extend({
  prompt: z.string().min(1, "prompt must not be empty"),
});

/** A single item inside a batch request. */
const BatchItemSchema = ClientOverrideSchema.merge(TemplateSchema)
  .merge(VideoSizeSchema)
  .extend({
    modality: z.enum(["text", "image", "video", "structured"]).default("video"),
    prompt: z.string().min(1, "prompt must not be empty"),
    /** Optional human-readable name used as the output filename. */
    name: z.string().optional(),
  });

/** Body for POST /batch — base overrides plus an ordered item list. */
const BatchBodySchema = ClientOverrideSchema.extend({
  items: z.array(BatchItemSchema).min(1, "items must not be empty"),
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Validate request body with a Zod schema; send 400 on failure. */
function parseBody<T>(schema: z.ZodSchema<T>, req: Request, res: Response): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: "Validation error",
      issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return null;
  }
  return result.data;
}

/** Wrap async route handlers so uncaught errors flow to the error handler. */
function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Resolve the effective prompt: if `template` is present, look it up and
 * render it with `vars`, treating the original `prompt` as the `{{prompt}}`
 * variable.  Falls through to `prompt` unchanged when no template is given.
 */
function resolvePrompt(prompt: string, template?: string, vars?: Record<string, string>): string {
  if (!template) return prompt;
  try {
    const tpl = getTemplate(template);
    return renderTemplate(tpl, { prompt, ...vars });
  } catch {
    getLogger().warn({ template }, "Template resolution failed; using raw prompt");
    return prompt;
  }
}

/** Build config overrides from the validated body + serve-level options. */
function buildOverrides(body: z.infer<typeof ClientOverrideSchema>, opts: ServeOptions) {
  // Auto-infer the provider from the model string when no explicit provider
  // is given — mirrors the same logic used by the /v1/ compat routes so that
  // native endpoints (POST /video, POST /batch, …) route to the correct
  // provider without requiring the caller to set the provider field manually.
  const inferredProvider =
    !body.provider && body.model ? inferProviderFromModel(body.model) : undefined;
  const effectiveProvider = body.provider ?? inferredProvider;

  return {
    ...opts.configOverrides,
    // Always propagate the server-level mock flag explicitly (true or false) so
    // that a stale AI_MOCK=true env var in the process environment cannot
    // override a server that was started without --mock (live mode).
    mock: opts.mock === true,
    ...(effectiveProvider ? { provider: effectiveProvider as never } : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens } : {}),
    ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
    ...((body.profile ?? opts.profile) ? { profile: body.profile ?? opts.profile } : {}),
  };
}

/** Map domain errors to appropriate HTTP status codes. */
function mapError(err: unknown, res: Response): boolean {
  if (err instanceof BudgetExceededError) {
    res.status(402).json({ error: err.message, code: "BUDGET_EXCEEDED" });
    return true;
  }
  if (err instanceof AllProvidersExhaustedError) {
    res.status(503).json({ error: err.message, code: "ALL_PROVIDERS_EXHAUSTED" });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createRouter(opts: ServeOptions): Router {
  const router = Router();

  // --- GET /.well-known/appspecific/com.chrome.devtools.json ---
  // Chrome DevTools automatically probes this URL for any server it inspects.
  // Responding with an empty object silences the 404 and CSP-violation console
  // noise without exposing any application data.
  router.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) => {
    res.json({});
  });

  // --- GET /health ---
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // --- GET /config ---
  // Returns the resolved configuration with all API keys masked.  The raw key
  // is NEVER sent to the browser; maskApiKey() is called unconditionally.
  router.get("/config", (_req, res) => {
    try {
      const overrides = {
        ...opts.configOverrides,
        mock: opts.mock === true,
        ...(opts.profile ? { profile: opts.profile } : {}),
      };
      const cfg = loadConfig({ flags: overrides as never });
      const safe = { ...cfg, apiKey: maskApiKey(cfg.apiKey ?? "") };
      res.json(safe);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // --- GET /providers ---
  // Returns all known providers with an `active` flag (true when the
  // corresponding API key env-var is set, or when mock mode is enabled).
  router.get("/providers", (_req, res) => {
    const providerList = PROVIDER_META.map((p) => ({
      id: p.id,
      name: p.name,
      active: p.id === "mock" ? Boolean(opts.mock) : Boolean(process.env[p.envKey]),
      modalities: [...p.modalities],
    }));
    res.json(providerList);
  });

  // --- GET /pricing ---
  // Returns the full MODEL_PRICING table as a JSON array.
  // Supports optional ?modality= ("text"|"image"|"audio"|"video") and
  // ?model= (substring match) query parameters to narrow results.
  router.get("/pricing", (req, res) => {
    const modality = req.query["modality"] as string | undefined;
    const model = req.query["model"] as string | undefined;

    const validModalities = ["text", "image", "audio", "video"] as const;
    type ModalityFilter = (typeof validModalities)[number];

    if (modality && !validModalities.includes(modality as ModalityFilter)) {
      res.status(400).json({
        error: `Invalid modality "${modality}". Must be one of: ${validModalities.join(", ")}.`,
      });
      return;
    }

    const entries = listPricing({
      ...(modality ? { modality: modality as ModalityFilter } : {}),
      ...(model ? { model } : {}),
    });

    res.json(entries);
  });

  // --- GET /models ---
  // Accepts optional ?modality= and ?provider= query params.
  // When ?provider= is specified, that provider's model list is returned
  // regardless of whether the server is in mock mode — all real providers
  // use static lists so no live API calls are made.  Falls back to an
  // empty array if the provider cannot be instantiated (e.g. missing key).
  // When no provider is specified and mock mode is on, the mock list is used.
  router.get(
    "/models",
    wrap(async (req, res) => {
      const modality = req.query["modality"] as string | undefined;
      const providerOverride = req.query["provider"] as string | undefined;

      // Honour an explicit ?provider= override even in mock mode so that the
      // UI can display models from all configured real providers.  listModels
      // for every built-in provider is static (no network calls), so this is safe.
      // Honour an explicit ?provider= to always fetch real models.
      // Otherwise propagate the server-level mock flag explicitly so a stale
      // AI_MOCK=true env var cannot force mock models when the server is live.
      const overrides = providerOverride
        ? { ...opts.configOverrides, provider: providerOverride as never, mock: false as const }
        : { ...opts.configOverrides, mock: opts.mock === true };

      try {
        const client = await getAiClient("serve-models", overrides as never);
        const models = await client.listModels(modality as never);
        res.json(models);
      } catch {
        // Provider construction failed (e.g. missing API key) — return empty list
        res.json([]);
      }
    }),
  );

  // --- POST /text ---
  // Non-streaming returns JSON; streaming (`stream: true`) returns plain text chunks
  // compatible with the WebAiClient.streamText() proxy implementation.
  router.post(
    "/text",
    wrap(async (req, res, next) => {
      const body = parseBody(TextBodySchema, req, res);
      if (!body) return;
      const prompt = resolvePrompt(body.prompt, body.template, body.vars);
      const overrides = buildOverrides(body, opts);
      try {
        const client = await getAiClient("serve-text", overrides as never);
        if (body.stream) {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          for await (const chunk of client.streamText(prompt)) {
            res.write(chunk);
          }
          res.end();
        } else {
          const result = await client.generateText(prompt);
          res.json(result);
        }
      } catch (err) {
        if (!mapError(err, res)) next(err);
      }
    }),
  );

  // --- POST /stream ---
  // Proper Server-Sent Events endpoint.  Emits:
  //   data: {"delta":"<chunk>"}  for each text delta
  //   data: [DONE]               to signal completion
  router.post(
    "/stream",
    wrap(async (req, res, next) => {
      const body = parseBody(TextBodySchema, req, res);
      if (!body) return;
      const prompt = resolvePrompt(body.prompt, body.template, body.vars);
      const overrides = buildOverrides(body, opts);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      try {
        const client = await getAiClient("serve-stream", overrides as never);
        for await (const chunk of client.streamText(prompt)) {
          res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (err) {
        if (mapError(err, res)) return;
        // Send error as SSE event before closing the stream
        const msg = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
        next(err);
      }
    }),
  );

  // --- POST /image ---
  router.post(
    "/image",
    wrap(async (req, res, next) => {
      const body = parseBody(ImageBodySchema, req, res);
      if (!body) return;
      const prompt = resolvePrompt(body.prompt, body.template, body.vars);
      const overrides = buildOverrides(body, opts);
      const callOpts = {
        ...(body.aspectRatio !== undefined ? { aspectRatio: body.aspectRatio } : {}),
        ...(body.width !== undefined ? { width: body.width } : {}),
        ...(body.height !== undefined ? { height: body.height } : {}),
        ...(body.resolution !== undefined ? { resolution: body.resolution } : {}),
        ...(body.quality !== undefined ? { quality: body.quality } : {}),
      };
      try {
        const client = await getAiClient("serve-image", overrides as never);
        const result = await client.generateImage(
          prompt,
          Object.keys(callOpts).length ? callOpts : undefined,
        );
        res.json(result);
      } catch (err) {
        if (!mapError(err, res)) next(err);
      }
    }),
  );

  // --- POST /audio/transcribe ---
  router.post(
    "/audio/transcribe",
    wrap(async (req, res, next) => {
      const body = parseBody(TranscribeBodySchema, req, res);
      if (!body) return;
      const buffer = Buffer.from(body.audioBase64, "base64");
      const overrides = buildOverrides(body, opts);
      try {
        const client = await getAiClient("serve-transcribe", overrides as never);
        const result = await client.transcribeAudio(buffer);
        res.json(result);
      } catch (err) {
        if (!mapError(err, res)) next(err);
      }
    }),
  );

  // --- POST /audio/speak ---
  router.post(
    "/audio/speak",
    wrap(async (req, res, next) => {
      const body = parseBody(SpeakBodySchema, req, res);
      if (!body) return;
      const overrides = buildOverrides(body, opts);
      try {
        const client = await getAiClient("serve-speak", overrides as never);
        const result = await client.synthesizeSpeech(body.text);
        res.json({ ...result, audio: result.audio.toString("base64") });
      } catch (err) {
        if (!mapError(err, res)) next(err);
      }
    }),
  );

  // --- POST /video ---
  router.post(
    "/video",
    wrap(async (req, res, next) => {
      const body = parseBody(VideoBodySchema, req, res);
      if (!body) return;
      const prompt = resolvePrompt(body.prompt, body.template, body.vars);
      const overrides = buildOverrides(body, opts);
      const callOpts = {
        ...(body.aspectRatio !== undefined ? { aspectRatio: body.aspectRatio } : {}),
        ...(body.width !== undefined ? { width: body.width } : {}),
        ...(body.height !== undefined ? { height: body.height } : {}),
        ...(body.resolution !== undefined ? { resolution: body.resolution } : {}),
        ...(body.duration !== undefined ? { duration: body.duration } : {}),
        ...(body.fps !== undefined ? { fps: body.fps } : {}),
        ...(body.quality !== undefined ? { quality: body.quality } : {}),
      };
      try {
        const client = await getAiClient("serve-video", overrides as never);
        const result = await client.generateVideo(
          prompt,
          Object.keys(callOpts).length ? callOpts : undefined,
        );
        res.json(result);
      } catch (err) {
        if (!mapError(err, res)) next(err);
      }
    }),
  );

  // --- POST /structured ---
  router.post(
    "/structured",
    wrap(async (req, res, next) => {
      const body = parseBody(StructuredBodySchema, req, res);
      if (!body) return;
      const prompt = resolvePrompt(body.prompt, body.template, body.vars);
      const overrides = buildOverrides(body, opts);
      try {
        const { z: zod } = await import("zod");
        const schema = zod.record(zod.unknown());
        const client = await getAiClient("serve-structured", overrides as never);
        const result = await client.generateStructured(prompt, schema);
        res.json(result);
      } catch (err) {
        if (!mapError(err, res)) next(err);
      }
    }),
  );

  // --- POST /batch ---
  // Processes items sequentially and streams one NDJSON line per item.
  // Each line is: { index, name?, modality, prompt, status:"ok"|"error", result?, error? }
  // Item-level overrides are merged on top of the body-level base overrides.
  router.post(
    "/batch",
    wrap(async (req, res, next) => {
      const body = parseBody(BatchBodySchema, req, res);
      if (!body) return;

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering

      const baseOverrides = buildOverrides(body, opts);

      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i]!;
        // Item-level overrides win over body-level overrides.
        const itemOverrides = buildOverrides({ ...body, ...item }, opts);
        const prompt = resolvePrompt(item.prompt, item.template, item.vars);

        try {
          const client = await getAiClient("serve-batch", itemOverrides as never);
          let result: unknown;

          if (item.modality === "video") {
            const batchVideoOpts = {
              ...(item.aspectRatio !== undefined ? { aspectRatio: item.aspectRatio } : {}),
              ...(item.width !== undefined ? { width: item.width } : {}),
              ...(item.height !== undefined ? { height: item.height } : {}),
              ...(item.resolution !== undefined ? { resolution: item.resolution } : {}),
              ...(item.duration !== undefined ? { duration: item.duration } : {}),
              ...(item.fps !== undefined ? { fps: item.fps } : {}),
              ...(item.quality !== undefined ? { quality: item.quality } : {}),
            };
            result = await client.generateVideo(
              prompt,
              Object.keys(batchVideoOpts).length ? batchVideoOpts : undefined,
            );
          } else if (item.modality === "image") {
            result = await client.generateImage(prompt);
          } else if (item.modality === "structured") {
            const { z: zod } = await import("zod");
            const schema = zod.record(zod.unknown());
            result = await client.generateStructured(prompt, schema);
          } else {
            result = await client.generateText(prompt);
          }

          res.write(
            JSON.stringify({
              index: i,
              name: item.name,
              modality: item.modality,
              prompt,
              status: "ok",
              result,
            }) + "\n",
          );
        } catch (err) {
          // Per-item errors are written as NDJSON lines — they do NOT abort the stream.
          const msg = err instanceof Error ? err.message : String(err);
          res.write(
            JSON.stringify({
              index: i,
              name: item.name,
              modality: item.modality,
              prompt,
              status: "error",
              error: msg,
            }) + "\n",
          );
          // Still propagate budget/exhaustion errors so the caller can decide.
          if (err instanceof BudgetExceededError || err instanceof AllProvidersExhaustedError) {
            res.end();
            next(err);
            return;
          }
        }
      }

      res.end();
      void baseOverrides; // suppress unused-var lint
    }),
  );

  // --- /v1/ compatibility routes (industry-standard wire formats) ---
  // Mounted after all native routes so native routes always take precedence.
  mountCompatRoutes(router, opts);

  return router;
}
