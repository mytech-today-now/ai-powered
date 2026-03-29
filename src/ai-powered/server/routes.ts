/**
 * @file src/ai-powered/server/routes.ts
 *
 * Express Router with Zod-validated routes for all ai-powered modalities.
 *
 * Routes mounted by createServer() in index.ts:
 *   GET  /health               – liveness probe
 *   GET  /config               – resolved config with all API keys masked
 *   GET  /models               – list models (optional ?modality=)
 *   POST /text                 – generate text (blocking or plain-text stream)
 *   POST /stream               – SSE streaming: data: {"delta":"…"} / data: [DONE]
 *   POST /image                – generate image
 *   POST /audio/transcribe     – transcribe audio from base64 payload
 *   POST /audio/speak          – synthesise speech → base64 audio
 *   POST /video                – generate video
 *   POST /structured           – generate structured JSON
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
import { getAiClient, loadConfig, maskApiKey } from "../index.js";
import { getTemplate, renderTemplate } from "../templates/index.js";
import { BudgetExceededError, AllProvidersExhaustedError } from "../types.js";
import { getLogger } from "../utils.js";
import type { ServeOptions } from "./index.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Shared per-request overrides forwarded to getAiClient(). */
const ClientOverrideSchema = z.object({
  provider:    z.string().optional(),
  model:       z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens:   z.number().int().positive().optional(),
  systemPrompt:z.string().optional(),
  profile:     z.string().optional(),
});

/** Template rendering inputs included on text/structured routes. */
const TemplateSchema = z.object({
  template: z.string().optional(),
  vars:     z.record(z.string()).optional(),
});

const TextBodySchema = ClientOverrideSchema.merge(TemplateSchema).extend({
  prompt: z.string().min(1, "prompt must not be empty"),
  stream: z.boolean().optional(),
});

const ImageBodySchema = ClientOverrideSchema.merge(TemplateSchema).extend({
  prompt: z.string().min(1, "prompt must not be empty"),
});

const TranscribeBodySchema = ClientOverrideSchema.extend({
  audioBase64: z.string().min(1, "audioBase64 must not be empty"),
});

const SpeakBodySchema = ClientOverrideSchema.extend({
  text: z.string().min(1, "text must not be empty"),
});

const VideoBodySchema = ClientOverrideSchema.merge(TemplateSchema).extend({
  prompt: z.string().min(1, "prompt must not be empty"),
});

const StructuredBodySchema = ClientOverrideSchema.merge(TemplateSchema).extend({
  prompt: z.string().min(1, "prompt must not be empty"),
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Validate request body with a Zod schema; send 400 on failure. */
function parseBody<T>(
  schema: z.ZodSchema<T>,
  req: Request,
  res: Response,
): T | null {
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
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Resolve the effective prompt: if `template` is present, look it up and
 * render it with `vars`, treating the original `prompt` as the `{{prompt}}`
 * variable.  Falls through to `prompt` unchanged when no template is given.
 */
function resolvePrompt(
  prompt: string,
  template?: string,
  vars?: Record<string, string>,
): string {
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
function buildOverrides(
  body: z.infer<typeof ClientOverrideSchema>,
  opts: ServeOptions,
) {
  return {
    ...opts.configOverrides,
    ...(opts.mock                 ? { mock: true }             : {}),
    ...(body.provider             ? { provider: body.provider as never } : {}),
    ...(body.model                ? { model: body.model }      : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.maxTokens !== undefined   ? { maxTokens: body.maxTokens }    : {}),
    ...(body.systemPrompt         ? { systemPrompt: body.systemPrompt } : {}),
    ...(body.profile ?? opts.profile  ? { profile: body.profile ?? opts.profile } : {}),
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
        ...(opts.mock    ? { mock: true }          : {}),
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

  // --- GET /models ---
  router.get(
    "/models",
    wrap(async (req, res) => {
      const modality = req.query["modality"] as string | undefined;
      const client = await getAiClient("serve-models", opts.configOverrides);
      const models = await client.listModels(modality as never);
      res.json(models);
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
      try {
        const client = await getAiClient("serve-image", overrides as never);
        const result = await client.generateImage(prompt);
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
      try {
        const client = await getAiClient("serve-video", overrides as never);
        const result = await client.generateVideo(prompt);
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

  return router;
}

