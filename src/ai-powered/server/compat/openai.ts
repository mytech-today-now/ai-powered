/**
 * @file src/ai-powered/server/compat/openai.ts
 *
 * OpenAI-compatible adapters for ai-powered responses.
 *
 * Exports:
 *   ChatCompletionsBodySchema     – Zod schema for POST /v1/chat/completions
 *   ImageGenerationsBodySchema    – Zod schema for POST /v1/images/generations
 *   AudioSpeechBodySchema         – Zod schema for POST /v1/audio/speech
 *   toOpenAiChatResponse()        – serialise TextResult to the OpenAI chat completion envelope
 *   toOpenAiImageResponse()       – serialise ImageResult to the OpenAI image generation envelope
 *   handleChatCompletions()       – Express handler factory for POST /v1/chat/completions
 *   handleImageGenerations()      – Express handler factory for POST /v1/images/generations
 *   handleAudioTranscriptions()   – Express handler factory for POST /v1/audio/transcriptions
 *   handleAudioSpeech()           – Express handler factory for POST /v1/audio/speech
 *   handleModels()                – Express handler for GET /v1/models
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import multer from "multer";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getAiClient } from "../../index.js";
import type { TextResult, ImageResult } from "../../types.js";
import {
  BudgetExceededError,
  AllProvidersExhaustedError,
  ProviderCapabilityError,
} from "../../types.js";
import type { ServeOptions } from "../index.js";
import { inferProviderFromModel } from "./model-router.js";

// ---------------------------------------------------------------------------
// OpenAI error envelope helper
// ---------------------------------------------------------------------------

function openAiError(res: Response, status: number, message: string, type: string): void {
  res.status(status).json({ error: { message, type, code: String(status) } });
}

// ---------------------------------------------------------------------------
// bd-hsd1: ChatCompletionsBodySchema
// ---------------------------------------------------------------------------

/**
 * Zod schema for POST /v1/chat/completions.
 *
 * Follows the OpenAI Chat Completions API shape with two ai-powered extensions:
 * `provider` and `mock`.
 */
export const ChatCompletionsBodySchema = z.object({
  model:           z.string().optional(),
  messages:        z
    .array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() }))
    .min(1),
  temperature:     z.number().min(0).max(2).optional(),
  max_tokens:      z.number().int().positive().optional(),
  stream:          z.boolean().optional().default(false),
  response_format: z
    .union([
      z.object({ type: z.literal("text") }),
      z.object({ type: z.literal("json_object") }),
      z.object({
        type:        z.literal("json_schema"),
        json_schema: z.object({ schema: z.record(z.unknown()) }),
      }),
    ])
    .optional(),
  // ai-powered extension fields (ignored by standard clients)
  provider: z.string().optional(),
  mock:     z.boolean().optional(),
  profile:  z.string().optional(),
});

export type ChatCompletionsBody = z.infer<typeof ChatCompletionsBodySchema>;

// ---------------------------------------------------------------------------
// bd-hsd1: ImageGenerationsBodySchema
// ---------------------------------------------------------------------------

/**
 * Zod schema for POST /v1/images/generations.
 *
 * Only n=1 is supported — ai-powered generates one image per request.
 */
export const ImageGenerationsBodySchema = z.object({
  prompt:          z.string().min(1),
  model:           z.string().optional(),
  n:               z.number().int().min(1).max(1).optional().default(1),
  size:            z
    .enum(["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"])
    .optional(),
  response_format: z.enum(["url", "b64_json"]).optional().default("url"),
  // ai-powered extension fields
  provider: z.string().optional(),
  mock:     z.boolean().optional(),
});

export type ImageGenerationsBody = z.infer<typeof ImageGenerationsBodySchema>;

// ---------------------------------------------------------------------------
// bd-up47: toOpenAiChatResponse()
// ---------------------------------------------------------------------------

/**
 * Serialise an internal TextResult into a full OpenAI chat completion envelope.
 *
 * Shape: https://platform.openai.com/docs/api-reference/chat/create
 */
export function toOpenAiChatResponse(result: TextResult): object {
  return {
    id:      `chatcmpl-${randomUUID()}`,
    object:  "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model:   result.model,
    choices: [
      {
        index:         0,
        message:       { role: "assistant", content: result.content },
        finish_reason: result.finishReason,
      },
    ],
    usage: {
      prompt_tokens:     result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens:      result.usage.totalTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// bd-38t1: toOpenAiImageResponse()
// ---------------------------------------------------------------------------

/**
 * Serialise an internal ImageResult into the OpenAI image generation envelope.
 *
 * Detects whether `result.data` is a URL or base64 and maps to the correct
 * field.  If the actual format does not match the requested `responseFormat`,
 * an `ai-powered-warning` response header is set describing the mismatch.
 *
 * Shape: https://platform.openai.com/docs/api-reference/images
 */
export function toOpenAiImageResponse(
  result: ImageResult,
  responseFormat: "url" | "b64_json",
  res: Response,
): object {
  const isUrl    = /^https?:\/\//.test(result.data);
  const actual   = isUrl ? "url" : "b64_json";

  if (actual !== responseFormat) {
    res.setHeader(
      "ai-powered-warning",
      `Requested response_format '${responseFormat}' but provider returned '${actual}'. ` +
        "Data is returned in the field matching the actual format.",
    );
  }

  const entry: Record<string, string> = {};
  if (isUrl) {
    entry["url"]      = result.data;
  } else {
    entry["b64_json"] = result.data;
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data:    [entry],
  };
}

// ---------------------------------------------------------------------------
// bd-gf2n: handleChatCompletions() — POST /v1/chat/completions
// ---------------------------------------------------------------------------

/**
 * Factory returning an Express handler for POST /v1/chat/completions.
 *
 * Handles both streaming (SSE) and non-streaming responses.
 * Routes to generateStructured() when response_format is json_object or json_schema.
 * Applies inferProviderFromModel() for automatic provider selection.
 */
export function handleChatCompletions(opts: ServeOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ChatCompletionsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      openAiError(
        res,
        400,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        "invalid_request_error",
      );
      return;
    }
    const body = parsed.data;

    // Extract system prompt and build user/assistant conversation prompt.
    const systemMsg  = body.messages.find((m) => m.role === "system");
    const otherMsgs  = body.messages.filter((m) => m.role !== "system");
    const prompt     = otherMsgs.map((m) => m.content).join("\n\n");

    // Infer provider from model name (explicit body.provider takes precedence).
    const effectiveMock     = opts.mock || body.mock;
    const inferredProvider  = body.model ? inferProviderFromModel(body.model) : undefined;
    const effectiveProvider = body.provider ?? inferredProvider;

    const overrides = {
      ...opts.configOverrides,
      ...(effectiveMock       ? { mock: true }                                  : {}),
      ...(opts.profile ?? body.profile ? { profile: body.profile ?? opts.profile } : {}),
      ...(effectiveProvider   ? { provider: effectiveProvider as never }        : {}),
      ...(body.model          ? { model: body.model }                           : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature }    : {}),
      ...(body.max_tokens !== undefined  ? { maxTokens: body.max_tokens }       : {}),
      ...(systemMsg           ? { systemPrompt: systemMsg.content }             : {}),
    };

    const rfType = body.response_format?.type;
    const isStructured = rfType === "json_object" || rfType === "json_schema";

    try {
      const client = await getAiClient("compat-chat", overrides as never);

      if (body.stream && !isStructured) {
        // Streaming path — SSE
        const streamId = `chatcmpl-${randomUUID()}`;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        let finishReason = "stop";
        for await (const chunk of client.streamText(prompt)) {
          const event = {
            id:      streamId,
            object:  "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          void chunk;
        }
        // Final chunk with finish_reason
        const finalEvent = {
          id:      streamId,
          object:  "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        };
        res.write(`data: ${JSON.stringify(finalEvent)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else if (isStructured) {
        // Structured output path
        const { z: zod } = await import("zod");
        let schema: import("zod").ZodType<unknown> = zod.record(zod.unknown());
        if (rfType === "json_schema" && body.response_format && "json_schema" in body.response_format) {
          schema = zod.record(zod.unknown()); // runtime validation — use open schema
        }
        const result = await client.generateStructured(prompt, schema);
        res.json(toOpenAiChatResponse({
          modality:     "text",
          provider:     result.provider,
          model:        result.model,
          content:      typeof result.data === "string" ? result.data : JSON.stringify(result.data),
          usage:        result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          cost:         result.cost,
          latencyMs:    result.latencyMs,
          finishReason: "stop",
        }));
      } else {
        // Non-streaming text path
        const result = await client.generateText(prompt);
        res.json(toOpenAiChatResponse(result));
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        openAiError(res, 402, err.message, "insufficient_quota");
      } else if (err instanceof AllProvidersExhaustedError) {
        openAiError(res, 503, err.message, "server_error");
      } else if (err instanceof ProviderCapabilityError) {
        openAiError(res, 422, err.message, "invalid_request_error");
      } else {
        next(err);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// bd-10cw: handleImageGenerations() — POST /v1/images/generations
// ---------------------------------------------------------------------------

/**
 * Factory returning an Express handler for POST /v1/images/generations.
 *
 * Enforces n=1 (single image per request).
 * Applies inferProviderFromModel() for automatic provider selection.
 */
export function handleImageGenerations(opts: ServeOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ImageGenerationsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      openAiError(
        res,
        400,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        "invalid_request_error",
      );
      return;
    }
    const body = parsed.data;

    const effectiveMock     = opts.mock || body.mock;
    const inferredProvider  = body.model ? inferProviderFromModel(body.model) : undefined;
    const effectiveProvider = body.provider ?? inferredProvider;

    const overrides = {
      ...opts.configOverrides,
      ...(effectiveMock       ? { mock: true }                           : {}),
      ...(opts.profile        ? { profile: opts.profile }                : {}),
      ...(effectiveProvider   ? { provider: effectiveProvider as never } : {}),
      ...(body.model          ? { model: body.model }                    : {}),
    };

    try {
      const client = await getAiClient("compat-image", overrides as never);
      const result = await client.generateImage(body.prompt);
      res.json(toOpenAiImageResponse(result, body.response_format, res));
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        openAiError(res, 402, err.message, "insufficient_quota");
      } else if (err instanceof AllProvidersExhaustedError) {
        openAiError(res, 503, err.message, "server_error");
      } else if (err instanceof ProviderCapabilityError) {
        openAiError(res, 422, err.message, "invalid_request_error");
      } else {
        next(err);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// bd-andh: AudioSpeechBodySchema
// ---------------------------------------------------------------------------

/** Content-Type header for each audio response_format value. */
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  mp3:  "audio/mpeg",
  opus: "audio/ogg",
  aac:  "audio/aac",
  flac: "audio/flac",
  wav:  "audio/wav",
  pcm:  "audio/pcm",
};

export const AudioSpeechBodySchema = z.object({
  model:           z.enum(["tts-1", "tts-1-hd"]).default("tts-1"),
  input:           z.string().min(1).max(4096),
  voice:           z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).default("alloy"),
  response_format: z.enum(["mp3", "opus", "aac", "flac", "wav", "pcm"]).optional().default("mp3"),
  speed:           z.number().min(0.25).max(4.0).optional().default(1.0),
  // ai-powered extensions
  provider: z.string().optional(),
  mock:     z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// bd-andh: handleAudioSpeech()
// ---------------------------------------------------------------------------

/**
 * Factory returning an Express handler for POST /v1/audio/speech.
 *
 * Parses AudioSpeechBodySchema, synthesises speech via the ai-powered client,
 * and responds with binary audio at the appropriate Content-Type.
 * Only openai and mock providers support TTS; provider defaults to "openai".
 */
export function handleAudioSpeech(opts: ServeOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = AudioSpeechBodySchema.safeParse(req.body);
    if (!parsed.success) {
      openAiError(
        res,
        400,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        "invalid_request_error",
      );
      return;
    }
    const body = parsed.data;

    // Determine effective provider — only openai/mock support TTS.
    const effectiveMock     = opts.mock || body.mock;
    const effectiveProvider = body.provider ?? (effectiveMock ? "mock" : "openai");

    const overrides = {
      ...opts.configOverrides,
      ...(effectiveMock  ? { mock: true }                           : {}),
      ...(opts.profile   ? { profile: opts.profile }                : {}),
      provider: effectiveProvider as never,
      model:    body.model,
    };

    try {
      const client = await getAiClient("compat-tts", overrides as never);
      const result = await client.synthesizeSpeech(body.input);
      const contentType = AUDIO_CONTENT_TYPES[body.response_format] ?? "audio/mpeg";
      res.setHeader("Content-Type", contentType);
      res.send(result.audio);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        openAiError(res, 402, err.message, "insufficient_quota");
      } else if (err instanceof AllProvidersExhaustedError) {
        openAiError(res, 503, err.message, "server_error");
      } else if (err instanceof ProviderCapabilityError) {
        openAiError(res, 422, err.message, "invalid_request_error");
      } else {
        next(err);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// bd-9zsg: handleAudioTranscriptions() — POST /v1/audio/transcriptions
// ---------------------------------------------------------------------------

/** multer instance configured for in-memory storage (no temp files on disk). */
const _upload = multer({ storage: multer.memoryStorage() });

/**
 * Factory returning an array of Express request handlers for
 * POST /v1/audio/transcriptions (OpenAI Whisper wire format).
 *
 * Returns two handlers:
 *   [0] multer.single("file") — parses multipart/form-data and populates req.file
 *   [1] async handler         — calls transcribeAudio(); responds per response_format
 *
 * Only openai and mock providers support audio transcription.
 * Provider defaults to "openai" unless overridden via the `provider` extension field.
 *
 * Response formats:
 *   json         (default) → { "text": "…" }
 *   text                   → plain text body, Content-Type: text/plain
 *   verbose_json           → { "text", "language", "duration", "segments": [] }
 *   srt / vtt              → HTTP 501 (per-segment timestamps not available)
 */
export function handleAudioTranscriptions(opts: ServeOptions): RequestHandler[] {
  const asyncHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // req.file is populated by multer.single("file") which runs before this handler.
    if (!req.file) {
      openAiError(
        res,
        400,
        "No audio file provided. Send the audio as a 'file' field in a multipart/form-data request.",
        "invalid_request_error",
      );
      return;
    }

    const responseFormat =
      typeof req.body?.response_format === "string"
        ? req.body.response_format
        : "json";

    // srt/vtt require per-segment timestamps not exposed by TranscriptionResult.
    if (responseFormat === "srt" || responseFormat === "vtt") {
      openAiError(
        res,
        501,
        `response_format '${responseFormat}' requires per-segment timestamps which are not ` +
          "available from ai-powered's TranscriptionResult. Use 'json', 'text', or 'verbose_json'.",
        "invalid_request_error",
      );
      return;
    }

    // Determine effective provider — only openai/mock support transcription.
    const effectiveMock =
      opts.mock || req.body?.mock === true || req.body?.mock === "true";
    const bodyProvider =
      typeof req.body?.provider === "string" ? req.body.provider : undefined;
    const effectiveProvider = bodyProvider ?? (effectiveMock ? "mock" : "openai");

    const overrides = {
      ...opts.configOverrides,
      ...(effectiveMock  ? { mock: true }                : {}),
      ...(opts.profile   ? { profile: opts.profile }     : {}),
      provider: effectiveProvider as never,
    };

    const buffer: Buffer = req.file.buffer;

    try {
      const client = await getAiClient("compat-transcribe", overrides as never);
      const result = await client.transcribeAudio(buffer);

      if (responseFormat === "text") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(result.text);
      } else if (responseFormat === "verbose_json") {
        res.json({
          text:     result.text,
          language: result.language  ?? null,
          duration: result.durationSeconds ?? null,
          segments: [],
        });
      } else {
        // Default: json
        res.json({ text: result.text });
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        openAiError(res, 402, err.message, "insufficient_quota");
      } else if (err instanceof AllProvidersExhaustedError) {
        openAiError(res, 503, err.message, "server_error");
      } else if (err instanceof ProviderCapabilityError) {
        openAiError(res, 422, err.message, "invalid_request_error");
      } else {
        next(err);
      }
    }
  };

  return [_upload.single("file") as RequestHandler, asyncHandler];
}

// ---------------------------------------------------------------------------
// bd-andh: handleModels() — static aggregate of all provider model IDs
// ---------------------------------------------------------------------------

/** Flat list of every model ID across all registered providers. */
const STATIC_MODELS: ReadonlyArray<{ id: string; owned_by: string }> = [
  // OpenAI — text
  { id: "gpt-4o",                         owned_by: "openai"    },
  { id: "gpt-4o-mini",                    owned_by: "openai"    },
  { id: "o1",                             owned_by: "openai"    },
  { id: "o1-mini",                        owned_by: "openai"    },
  { id: "gpt-4-turbo",                    owned_by: "openai"    },
  { id: "gpt-3.5-turbo",                  owned_by: "openai"    },
  // OpenAI — image
  { id: "dall-e-3",                       owned_by: "openai"    },
  { id: "dall-e-2",                       owned_by: "openai"    },
  // OpenAI — audio
  { id: "whisper-1",                      owned_by: "openai"    },
  { id: "tts-1",                          owned_by: "openai"    },
  { id: "tts-1-hd",                       owned_by: "openai"    },
  // Anthropic
  { id: "claude-3-5-sonnet-20241022",     owned_by: "anthropic" },
  { id: "claude-3-5-haiku-20241022",      owned_by: "anthropic" },
  { id: "claude-3-opus-20240229",         owned_by: "anthropic" },
  { id: "claude-3-sonnet-20240229",       owned_by: "anthropic" },
  { id: "claude-3-haiku-20240307",        owned_by: "anthropic" },
  // xAI / Grok
  { id: "grok-2",                         owned_by: "xai"       },
  { id: "grok-2-latest",                  owned_by: "xai"       },
  { id: "grok-2-mini",                    owned_by: "xai"       },
  { id: "grok-beta",                      owned_by: "xai"       },
  { id: "grok-vision-beta",               owned_by: "xai"       },
  // Venice
  { id: "llama-3.3-70b",                  owned_by: "venice"    },
  { id: "mistral-31-24b",                 owned_by: "venice"    },
  { id: "qwen-2.5-vl",                    owned_by: "venice"    },
  { id: "venice-sd-3.5",                  owned_by: "venice"    },
  { id: "fluently-xl",                    owned_by: "venice"    },
  // Luma AI
  { id: "ray-2",                          owned_by: "lumaai"    },
  { id: "ray-2-720p",                     owned_by: "lumaai"    },
  { id: "ray-flash-2",                    owned_by: "lumaai"    },
  { id: "ray-flash-2-720p",               owned_by: "lumaai"    },
];

/**
 * Express handler for GET /v1/models.
 *
 * Returns the static aggregate model list in the OpenAI list envelope.
 * Does not make any live provider calls.
 */
export function handleModels() {
  return (_req: Request, res: Response): void => {
    res.json({
      object: "list",
      data: STATIC_MODELS.map((m) => ({
        id:       m.id,
        object:   "model",
        owned_by: m.owned_by,
        created:  0,
      })),
    });
  };
}

