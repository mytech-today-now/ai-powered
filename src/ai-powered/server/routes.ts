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
import multer from "multer";
import { z } from "zod";
import { getAiClient, loadConfig, maskApiKey, listPricing } from "../index.js";
import { getTemplate, renderTemplate } from "../templates/index.js";
import { BudgetExceededError, AllProvidersExhaustedError } from "../types.js";
import { getLogger } from "../utils.js";
import type { ProviderCallOptions } from "../providers/index.js";
import type { ServeOptions } from "./index.js";
import { selectI2VProvider } from "./smart-default.js";
import { mountCompatRoutes } from "./compat/index.js";
import { inferProviderFromModel } from "./compat/model-router.js";
import {
  lookupFileRef,
  buildFileContentBlock,
  storeFileRef,
  validateMimeType,
  validateFileSize,
} from "./file-handler.js";

// ---------------------------------------------------------------------------
// Node.js built-in imports — 'node:' prefix prevents npm package shadowing
// (REQ-SS-01). No additional npm packages required.
// ---------------------------------------------------------------------------
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Multer — multipart/form-data file upload middleware (50 MiB hard limit)
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 52_428_800 } });

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
    inputModalities: ["image", "audio"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    modalities: ["text", "structured"],
    inputModalities: ["image"],
  },
  {
    id: "xai",
    name: "xAI / Grok",
    envKey: "XAI_API_KEY",
    modalities: ["text", "structured", "video"],
    inputModalities: ["image"],
  },
  {
    id: "venice",
    name: "Venice",
    envKey: "VENICE_API_KEY",
    modalities: ["text", "image", "structured"],
    inputModalities: ["image"],
  },
  {
    id: "lumaai",
    name: "Luma AI",
    envKey: "LUMAAI_API_KEY",
    modalities: ["video"],
    inputModalities: ["image"],
  },
  {
    id: "runway",
    name: "Runway",
    envKey: "RUNWAYML_API_SECRET",
    modalities: ["video"],
    inputModalities: [],
  },
  {
    // VibeVoice is a local ASR/TTS server; active when VIBEVOICE_API_URL is set.
    // inputModalities: ["audio"] because transcribeAudio() consumes audio input.
    id: "vibevoice",
    name: "VibeVoice (local)",
    envKey: "VIBEVOICE_API_URL",
    modalities: ["audio"],
    inputModalities: ["audio"],
  },
  {
    id: "mock",
    name: "Mock (testing)",
    envKey: "",
    modalities: ["text", "image", "audio", "video", "structured"],
    inputModalities: ["image", "audio", "video"],
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
  /**
   * UUID token returned by POST /upload.  When present, the corresponding
   * file is resolved and injected into the generation request as a multimodal
   * content block.  Callers that omit this field behave identically to before.
   */
  fileRef: z.string().uuid().optional(),
  /**
   * Array of UUID tokens returned by POST /upload.  Supersedes `fileRef` when
   * present and non-empty; supports multi-image input for image-to-image and
   * image-to-video generation.
   */
  fileRefs: z.array(z.string().uuid()).optional(),
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

// audioBase64 is declared optional here so that the route handler can return
// the spec-required flat error shape { error: 'audioBase64 is required.' }
// instead of the generic Zod validation envelope. Presence is enforced explicitly
// inside the route (bd-ms87). The optional provider field is inherited from
// ClientOverrideSchema and forwarded via buildOverrides() to getAiClient().
const TranscribeBodySchema = ClientOverrideSchema.extend({
  audioBase64: z.string().optional(),
  mimeType: z.string().optional(),
});

const OPENAI_TTS_MAX_CHARS = 4096;
// text is declared optional here so that the route handler can return the
// spec-required flat error shape { error: 'text is required.' } instead of
// the generic Zod validation envelope. Length cap is still enforced by Zod.
// The optional provider field is inherited from ClientOverrideSchema (bd-p3qx).
const SpeakBodySchema = ClientOverrideSchema.extend({
  text: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || v.length <= OPENAI_TTS_MAX_CHARS,
      `text must not exceed ${OPENAI_TTS_MAX_CHARS} characters (OpenAI TTS limit)`,
    ),
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
    /** Optional array of image URLs passed to the provider alongside the prompt. */
    images: z.array(z.string().url()).optional(),
  });

/** Body for POST /batch — base overrides plus an ordered item list. */
const BatchBodySchema = ClientOverrideSchema.extend({
  items: z.array(BatchItemSchema).min(1, "items must not be empty"),
});

/** Body for POST /stitch — ordered base64 MP4 data URIs to concatenate. */
const StitchBodySchema = z.object({
  clips: z
    .array(z.string().min(1, "each clip must be a non-empty base64 data URI"))
    .min(2, "at least 2 clips are required to stitch a combined video")
    .max(20, "maximum of 20 clips per stitch request"),
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

/**
 * Resolve a `fileRef` UUID token into a provider-native content block.
 *
 * Returns `undefined` when:
 *   - `fileRef` is not provided (no file attached to the request)
 *   - the token is not found in the in-memory store (e.g. expired or invalid)
 *   - `buildFileContentBlock()` throws (unsupported MIME for the provider)
 *
 * Failures are logged at warn level and silently ignored so that the
 * generation request can still proceed without the attachment.
 */
function resolveFileBlock(
  fileRef: string | undefined,
  provider: string,
  model: string,
): Record<string, unknown> | undefined {
  if (!fileRef) return undefined;
  const entry = lookupFileRef(fileRef);
  if (!entry) {
    getLogger().warn({ fileRef }, "fileRef token not found; ignoring attachment");
    return undefined;
  }
  try {
    return buildFileContentBlock(
      provider,
      model,
      { filename: entry.filename, mimeType: entry.mimeType },
      entry.base64Content,
      entry.fileId,
    );
  } catch (err) {
    getLogger().warn(
      { fileRef, provider, mimeType: entry.mimeType, err },
      "buildFileContentBlock failed; ignoring attachment",
    );
    return undefined;
  }
}

/**
 * Resolve an array of `fileRef` UUID tokens into provider-native content blocks.
 *
 * Filters out any refs that are missing, expired, or produce an unsupported
 * MIME block.  Returns an empty array when `fileRefs` is empty or undefined.
 */
function resolveFileBlocks(
  fileRefs: string[] | undefined,
  provider: string,
  model: string,
): Array<Record<string, unknown>> {
  if (!fileRefs?.length) return [];
  return fileRefs.flatMap((ref) => {
    const block = resolveFileBlock(ref, provider, model);
    return block ? [block] : [];
  });
}

// ---------------------------------------------------------------------------
// spawnFfmpeg — native ffmpeg wrapper (REQ-SS-03)
// D1: native spawn over fluent-ffmpeg — minimal dep surface + full stderr capture.
// D4: tail-2KB preserves diagnostic while dropping verbose version banner.
// ---------------------------------------------------------------------------

/**
 * Spawn a native `ffmpeg` process and wait for completion.
 *
 * @param args - CLI arguments to pass after `ffmpeg`
 * @param cwd  - Working directory for the process (UUID-scoped temp dir)
 * @returns    Resolves with the full stderr string on exit code 0.
 * @throws     Error with tail-2KB stderr on non-zero exit, or an actionable
 *             install-hint error when ffmpeg is not found in PATH (ENOENT).
 */
function spawnFfmpeg(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    // Drain stdout silently — concat output goes to the file, not stdout.
    proc.stdout.resume();

    proc.on("close", (code) => {
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve(stderr);
      } else {
        // Tail the last 2 KB to avoid swamping logs with the version banner.
        const tail = stderr.slice(-2048);
        reject(
          new Error(
            `ffmpeg exited with code ${code}.\nCommand: ffmpeg ${args.join(" ")}\nStderr (tail 2 KB):\n${tail}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "ffmpeg not found in PATH. Install it on the server host:\n" +
              "  macOS:   brew install ffmpeg\n" +
              "  Ubuntu:  sudo apt-get install -y ffmpeg\n" +
              "  Windows: scoop install ffmpeg\n" +
              "Or use: npm install @ffmpeg-installer/ffmpeg",
          ),
        );
      } else {
        reject(err);
      }
    });
  });
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
  // lumaImageToVideoEnabled is true when PROXY_PUBLIC_BASE_URL is set, which is
  // required for Luma AI image-to-video (keyframes must be a publicly reachable URL).
  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      lumaImageToVideoEnabled: Boolean(process.env["PROXY_PUBLIC_BASE_URL"]),
    });
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
  // corresponding API key / URL env-var is set and non-empty after trimming,
  // or when mock mode is enabled).
  // Design D4: using (envVal.trim() ?? '').length > 0 instead of !!trim()
  // explicitly documents that VibeVoice uses a URL env-var (not a secret key)
  // and makes the intent clear for future URL-based provider authors.
  router.get("/providers", (_req, res) => {
    const providerList = PROVIDER_META.map((p) => ({
      id: p.id,
      name: p.name,
      active:
        p.id === "mock" ? Boolean(opts.mock) : (process.env[p.envKey]?.trim() ?? "").length > 0,
      modalities: [...p.modalities],
      inputModalities: [...p.inputModalities],
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
  // Accepts optional query parameters:
  //   ?modality=<modality>        – filter by output modality (e.g. "text", "image")
  //   ?provider=<provider>        – fetch models for a specific provider (bypasses mock)
  //   ?accepts=<inputModality>    – filter by input modality beyond plain text
  //                                 (e.g. "image", "audio", "video", "document");
  //                                 composable with ?modality= and ?provider=;
  //                                 unknown values return [] not a 4xx error
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
      const accepts = req.query["accepts"] as string | undefined;

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
        const models = await client.listModels(modality as never, accepts as never);
        res.json(models);
      } catch {
        // Provider construction failed (e.g. missing API key) — return empty list
        res.json([]);
      }
    }),
  );

  // --- POST /upload ---
  // Accepts multipart/form-data with a single "file" field.
  // Optional body fields: provider (string), model (string).
  // On success returns { fileRef: "<uuid>" } that callers pass as `fileRef`
  // in subsequent generation requests to attach the file as a content block.
  router.post("/upload", upload.single("file"), (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded. Include a 'file' field in the form data." });
      return;
    }

    const mimeType = file.mimetype;
    if (!validateMimeType(mimeType)) {
      res.status(415).json({
        error: `Unsupported file type "${mimeType}". Accepted types: image/jpeg, image/png, image/gif, image/webp, application/pdf, text/plain, text/html, text/csv, and Office document formats.`,
      });
      return;
    }

    if (!validateFileSize(file.size)) {
      res.status(413).json({ error: "File exceeds the 50 MiB size limit." });
      return;
    }

    const provider =
      ((req.body as Record<string, unknown>)["provider"] as string | undefined) ?? "openai";
    const model = ((req.body as Record<string, unknown>)["model"] as string | undefined) ?? "";
    const base64Content = file.buffer.toString("base64");

    // Validate that the provider supports this file type before storing.
    try {
      buildFileContentBlock(
        provider,
        model,
        { filename: file.originalname, mimeType },
        base64Content,
      );
    } catch {
      res.status(422).json({
        error: `Provider "${provider}" does not support file type "${mimeType}". Image providers only accept image/* MIME types.`,
      });
      return;
    }

    const fileRef = storeFileRef({
      filename: file.originalname,
      mimeType,
      sizeBytes: file.size,
      base64Content,
      provider,
      ...(model ? { model } : {}),
    });

    getLogger().info(
      { fileRef, filename: file.originalname, mimeType, sizeBytes: file.size, provider },
      "POST /upload: file stored",
    );

    res.status(201).json({ fileRef });
  });

  // --- GET /files/:uuid ---
  // Serves the raw binary of a stored uploaded file by its UUID token.
  // This endpoint is required by providers such as Luma AI that validate
  // keyframe URLs server-side and reject base64 data: URIs.
  // Expose this server publicly (e.g. via ngrok) and set the
  // PROXY_PUBLIC_BASE_URL environment variable so generated URLs are reachable.
  router.get("/files/:uuid", (req, res) => {
    const entry = lookupFileRef(req.params["uuid"] ?? "");
    if (!entry) {
      res.status(404).json({ error: "File not found or expired" });
      return;
    }
    const buffer = Buffer.from(entry.base64Content, "base64");
    res.setHeader("Content-Type", entry.mimeType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(buffer);
  });

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
      const effectiveProvider =
        (overrides as { provider?: string }).provider ?? opts.configOverrides?.provider ?? "openai";
      const fileBlock = resolveFileBlock(body.fileRef, effectiveProvider, body.model ?? "");
      const messages = fileBlock
        ? [{ role: "user" as const, content: [{ type: "text", text: prompt }, fileBlock] }]
        : undefined;
      try {
        const client = await getAiClient("serve-text", overrides as never);
        if (body.stream) {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          for await (const chunk of client.streamText(
            prompt,
            messages ? { messages } : undefined,
          )) {
            res.write(chunk);
          }
          res.end();
        } else {
          const result = await client.generateText(prompt, messages ? { messages } : undefined);
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
      const effectiveProvider =
        (overrides as { provider?: string }).provider ?? opts.configOverrides?.provider ?? "openai";
      // Prefer the fileRefs array (multi-image); fall back to the singular fileRef for
      // backward compatibility with clients that send only a single reference.
      const activeFileRefs = (body as { fileRefs?: string[] }).fileRefs?.length
        ? (body as { fileRefs: string[] }).fileRefs
        : body.fileRef
          ? [body.fileRef]
          : [];
      const fileBlocks = resolveFileBlocks(
        activeFileRefs.length ? activeFileRefs : undefined,
        effectiveProvider,
        body.model ?? "",
      );
      const messages = fileBlocks.length
        ? [{ role: "user" as const, content: [{ type: "text", text: prompt }, ...fileBlocks] }]
        : undefined;
      const callOpts = {
        ...(body.aspectRatio !== undefined ? { aspectRatio: body.aspectRatio } : {}),
        ...(body.width !== undefined ? { width: body.width } : {}),
        ...(body.height !== undefined ? { height: body.height } : {}),
        ...(body.resolution !== undefined ? { resolution: body.resolution } : {}),
        ...(body.quality !== undefined ? { quality: body.quality } : {}),
        ...(messages ? { messages } : {}),
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
  // Optional `provider` field is forwarded via buildOverrides() → getAiClient()
  // so callers may pin a specific provider per-request (bd-ms87).
  router.post(
    "/audio/transcribe",
    wrap(async (req, res, next) => {
      const body = parseBody(TranscribeBodySchema, req, res);
      if (!body) return;

      // Explicit guard: return the flat error shape the spec requires.
      if (!body.audioBase64) {
        res.status(400).json({ error: "audioBase64 is required." });
        return;
      }

      const buffer = Buffer.from(body.audioBase64, "base64");
      const overrides = buildOverrides(body, opts);
      try {
        const client = await getAiClient("serve-transcribe", overrides as never);
        const result = await client.transcribeAudio(buffer, {
          ...(body.mimeType ? { mimeType: body.mimeType } : {}),
        });
        res.json(result);
      } catch (err) {
        if (!mapError(err, res)) next(err);
      }
    }),
  );

  // --- POST /audio/speak ---
  // Optional `provider` field is forwarded via buildOverrides() → getAiClient()
  // so callers may pin a specific provider per-request (bd-p3qx).
  router.post(
    "/audio/speak",
    wrap(async (req, res, next) => {
      const body = parseBody(SpeakBodySchema, req, res);
      if (!body) return;

      // Explicit guard: return the flat error shape the spec requires.
      if (!body.text) {
        res.status(400).json({ error: "text is required." });
        return;
      }

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
      const effectiveProvider =
        (overrides as { provider?: string }).provider ?? opts.configOverrides?.provider ?? "openai";

      // Normalise to an array: prefer fileRefs (multi-image), fall back to singular fileRef.
      const activeFileRefs: string[] = (body as { fileRefs?: string[] }).fileRefs?.length
        ? (body as { fileRefs: string[] }).fileRefs
        : body.fileRef
          ? [body.fileRef]
          : [];

      // Luma AI rejects base64 data: URIs for keyframe images; it requires
      // publicly accessible HTTPS URLs.  Build one public URL per fileRef from
      // PROXY_PUBLIC_BASE_URL pointing to GET /files/:uuid.  Other providers
      // receive standard resolved content blocks (base64 data URIs).
      let lumaImageUrls: string[] = [];
      let fileBlock: Record<string, unknown> | undefined;

      if (activeFileRefs.length && effectiveProvider === "lumaai") {
        const baseUrl = (process.env["PROXY_PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
        if (!baseUrl) {
          res.status(422).json({
            error:
              "Luma AI requires a publicly accessible image URL for image-to-video. " +
              "Set the PROXY_PUBLIC_BASE_URL environment variable to this server's public-facing " +
              "address (e.g. https://abc123.ngrok.io) so Luma's servers can fetch the uploaded image.",
          });
          return;
        }
        lumaImageUrls = activeFileRefs
          .filter((ref) => lookupFileRef(ref) !== undefined)
          .map((ref) => `${baseUrl}/files/${ref}`);
        getLogger().info(
          { fileRefs: activeFileRefs, lumaImageUrls },
          "POST /video: using public URLs for Luma AI keyframes",
        );
      } else if (activeFileRefs.length) {
        // Non-Luma providers: resolve the first file ref to a content block.
        // Additional refs are included in the messages content array below.
        fileBlock = resolveFileBlock(activeFileRefs[0], effectiveProvider, body.model ?? "");
      }

      // Build messages content for non-Luma providers.
      const allFileBlocks =
        activeFileRefs.length && effectiveProvider !== "lumaai"
          ? resolveFileBlocks(activeFileRefs, effectiveProvider, body.model ?? "")
          : [];
      const messages = allFileBlocks.length
        ? [{ role: "user" as const, content: [{ type: "text", text: prompt }, ...allFileBlocks] }]
        : undefined;

      const callOpts = {
        ...(body.aspectRatio !== undefined ? { aspectRatio: body.aspectRatio } : {}),
        ...(body.width !== undefined ? { width: body.width } : {}),
        ...(body.height !== undefined ? { height: body.height } : {}),
        ...(body.resolution !== undefined ? { resolution: body.resolution } : {}),
        ...(body.duration !== undefined ? { duration: body.duration } : {}),
        ...(body.fps !== undefined ? { fps: body.fps } : {}),
        ...(body.quality !== undefined ? { quality: body.quality } : {}),
        // For Luma AI: pass public image URLs as the images array so the provider
        // maps frame0 / frame1 correctly (supports up to 2 keyframes).
        ...(lumaImageUrls.length ? { images: lumaImageUrls } : {}),
        // For non-Luma providers: pass fileContentBlock (single ref, legacy compat)
        // and the full messages array for multimodal input.
        ...(fileBlock && !lumaImageUrls.length ? { fileContentBlock: fileBlock } : {}),
        ...(messages ? { messages } : {}),
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

        // Resolve a per-item fileRef (falls back to the body-level fileRef when
        // the item does not supply its own).
        const itemFileRef = item.fileRef ?? body.fileRef;
        const itemProvider =
          (itemOverrides as { provider?: string }).provider ??
          opts.configOverrides?.provider ??
          "openai";
        const itemFileBlock = resolveFileBlock(itemFileRef, itemProvider, item.model ?? "");
        const itemMessages = itemFileBlock
          ? [{ role: "user" as const, content: [{ type: "text", text: prompt }, itemFileBlock] }]
          : undefined;

        // Smart I2V routing: resolve best provider for item.images before creating client.
        // item.images takes precedence over fileRef when both are present (design D4).
        let effectiveOverrides: ReturnType<typeof buildOverrides> = itemOverrides;
        let routingDecision: ReturnType<typeof selectI2VProvider> | undefined;
        const routingMeta: {
          providerUsed?: string;
          warning?: string;
          info?: string;
          alternativeProviders?: string[];
        } = {};

        if (item.modality === "video" && item.images && item.images.length > 0) {
          const liveVideoProviders = opts.mock
            ? PROVIDER_META.filter((p) =>
                (p.modalities as readonly string[]).includes("video"),
              ).map((p) => p.id)
            : PROVIDER_META.filter(
                (p) =>
                  (p.modalities as readonly string[]).includes("video") &&
                  Boolean(process.env[p.envKey]),
              ).map((p) => p.id);

          routingDecision = selectI2VProvider(itemProvider, item.images.length, liveVideoProviders);

          if (routingDecision.provider !== itemProvider) {
            effectiveOverrides = {
              ...itemOverrides,
              provider: routingDecision.provider,
            } as ReturnType<typeof buildOverrides>;
          }

          // Only populate routingMeta when routing actually changed (D6: absent ≠ null).
          if (
            routingDecision.provider !== itemProvider ||
            routingDecision.truncated ||
            routingDecision.warning
          ) {
            routingMeta.providerUsed = routingDecision.provider;
            if (routingDecision.warning) routingMeta.warning = routingDecision.warning;
            if (routingDecision.alternativeProviders?.length) {
              routingMeta.alternativeProviders = routingDecision.alternativeProviders;
            }
          }
        }

        try {
          const client = await getAiClient("serve-batch", effectiveOverrides as never);
          let result: unknown;

          if (item.modality === "video") {
            const hasImages = Boolean(item.images && item.images.length > 0);
            const batchVideoOpts: Record<string, unknown> = {
              ...(item.aspectRatio !== undefined ? { aspectRatio: item.aspectRatio } : {}),
              ...(item.width !== undefined ? { width: item.width } : {}),
              ...(item.height !== undefined ? { height: item.height } : {}),
              ...(item.resolution !== undefined ? { resolution: item.resolution } : {}),
              ...(item.duration !== undefined ? { duration: item.duration } : {}),
              ...(item.fps !== undefined ? { fps: item.fps } : {}),
              ...(item.quality !== undefined ? { quality: item.quality } : {}),
              // item.images takes precedence over fileRef when both are present.
              ...(itemFileBlock && !hasImages ? { fileContentBlock: itemFileBlock } : {}),
              ...(itemMessages && !hasImages ? { messages: itemMessages } : {}),
            };

            if (hasImages && routingDecision) {
              const effectiveImages = item.images!.slice(0, routingDecision.effectiveImageCount);
              // Build multimodal message: one image_url block per image, then a text block.
              const imageBlocks = effectiveImages.map((url: string) => ({
                type: "image_url",
                image_url: { url },
              }));
              batchVideoOpts["messages"] = [
                { role: "user", content: [...imageBlocks, { type: "text", text: prompt }] },
              ];
              batchVideoOpts["images"] = effectiveImages;
              // frame1Url carries the second keyframe URL for two-image providers (e.g. Luma).
              if (effectiveImages.length === 2) {
                batchVideoOpts["frame1Url"] = effectiveImages[1];
              }
            }

            result = await client.generateVideo(
              prompt,
              Object.keys(batchVideoOpts).length
                ? (batchVideoOpts as ProviderCallOptions)
                : undefined,
            );
          } else if (item.modality === "image") {
            result = await client.generateImage(
              prompt,
              itemMessages ? { messages: itemMessages } : undefined,
            );
          } else if (item.modality === "structured") {
            const { z: zod } = await import("zod");
            const schema = zod.record(zod.unknown());
            result = await client.generateStructured(prompt, schema);
          } else {
            result = await client.generateText(
              prompt,
              itemMessages ? { messages: itemMessages } : undefined,
            );
          }

          // Spread routingMeta last so its fields appear only when routing changed (D6).
          res.write(
            JSON.stringify({
              index: i,
              name: item.name,
              modality: item.modality,
              prompt,
              status: "ok",
              result,
              ...routingMeta,
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

  // --- POST /stitch ---
  // Accepts ordered base64 MP4 data URIs, writes clips to a UUID-scoped temp
  // dir, runs native ffmpeg -f concat -safe 0 -c copy (lossless stream-copy,
  // 2–8 s), and returns the combined MP4 as a base64 data URI.
  // D2: UUID per request ensures concurrent requests never collide.
  // D3: -c copy only — stream-copy, completely lossless, fastest path.
  // REQ-SS-04 / REQ-SS-07 / REQ-SS-08
  router.post(
    "/stitch",
    wrap(async (req, res, next) => {
      const body = parseBody(StitchBodySchema, req, res);
      if (!body) return;

      const logger = getLogger();
      const tmpDir = path.join(os.tmpdir(), "ai-powered-stitch-" + randomUUID());

      try {
        // Step 1: Create UUID-scoped temp directory.
        await fs.mkdir(tmpDir, { recursive: true });
        logger.info({ tmpDir, clipCount: body.clips.length }, "POST /stitch: temp dir created");

        // Step 2: Write each clip as clipN.mp4 and accumulate concat manifest lines.
        const concatLines: string[] = [];
        for (let i = 0; i < body.clips.length; i++) {
          const dataUri = body.clips[i]!;
          const base64 = dataUri.replace(/^data:[^,]+,/, "");
          const bytes = Buffer.from(base64, "base64");
          const clipName = `clip${i}.mp4`;
          await fs.writeFile(path.join(tmpDir, clipName), bytes);
          concatLines.push(`file '${clipName}'`);
          logger.info({ clipName, sizeBytes: bytes.length }, "POST /stitch: clip written");
        }

        // Step 3: Write the ffmpeg concat manifest.
        await fs.writeFile(path.join(tmpDir, "list.txt"), concatLines.join("\n") + "\n", "utf8");

        // Step 4: Spawn ffmpeg — stream-copy, lossless, no re-encode.
        logger.info({ clips: body.clips.length }, "POST /stitch: spawning ffmpeg concat…");
        await spawnFfmpeg(
          ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "combined.mp4"],
          tmpDir,
        );

        // Step 5: Read combined output and respond.
        const combinedBytes = await fs.readFile(path.join(tmpDir, "combined.mp4"));
        const sizeMB = parseFloat((combinedBytes.length / (1024 * 1024)).toFixed(1));
        logger.info({ sizeMB, clips: body.clips.length }, "POST /stitch: combined video ready");
        res.json({ data: "data:video/mp4;base64," + combinedBytes.toString("base64"), sizeMB });
      } catch (err) {
        if (!mapError(err, res)) next(err);
      } finally {
        // Step 6: Always clean up — even on error. Warn-only; never throws.
        fs.rm(tmpDir, { recursive: true, force: true }).catch((cleanupErr: unknown) => {
          getLogger().warn({ tmpDir, err: cleanupErr }, "POST /stitch: temp cleanup failed");
        });
      }
    }),
  );

  // --- /v1/ compatibility routes (industry-standard wire formats) ---
  // Mounted after all native routes so native routes always take precedence.
  mountCompatRoutes(router, opts);

  return router;
}
