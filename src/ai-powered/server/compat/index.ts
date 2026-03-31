/**
 * @file src/ai-powered/server/compat/index.ts
 *
 * Mounts all /v1/ compatibility routes on the provided Express router.
 *
 * Routes registered (in order):
 *   POST /v1/chat/completions       – OpenAI Chat Completions (text + streaming + structured)
 *   POST /v1/messages               – Anthropic Messages API (text + streaming)
 *   POST /v1/images/generations     – OpenAI Images API
 *   POST /v1/audio/transcriptions   – OpenAI Whisper transcription (multipart/form-data)
 *   POST /v1/audio/speech           – OpenAI TTS (binary audio response)
 *   GET  /v1/models                 – OpenAI model list (static aggregate)
 *   POST /v1/video/generations      – ai-powered native video (no external standard)
 *
 * Usage:
 *   import { mountCompatRoutes } from "./compat/index.js";
 *   mountCompatRoutes(router, opts);  // call at end of createRouter()
 */

import type { Router } from "express";
import type { ServeOptions } from "../index.js";
import {
  handleChatCompletions,
  handleImageGenerations,
  handleAudioTranscriptions,
  handleAudioSpeech,
  handleModels,
} from "./openai.js";
import { handleAnthropicMessages } from "./anthropic.js";
import { getAiClient } from "../../index.js";
import {
  BudgetExceededError,
  AllProvidersExhaustedError,
  ProviderCapabilityError,
} from "../../types.js";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// bd-h22m: mountCompatRoutes()
// ---------------------------------------------------------------------------

/**
 * Register all /v1/ compatibility routes on the given Express router.
 *
 * Call this function at the end of createRouter() so that native routes
 * take precedence over any future /v1/ conflicts.
 */
export function mountCompatRoutes(router: Router, opts: ServeOptions): void {
  // --- POST /v1/chat/completions — OpenAI Chat Completions ---
  router.post("/v1/chat/completions", handleChatCompletions(opts));

  // --- POST /v1/messages — Anthropic Messages API ---
  router.post("/v1/messages", handleAnthropicMessages(opts));

  // --- POST /v1/images/generations — OpenAI Images API ---
  router.post("/v1/images/generations", handleImageGenerations(opts));

  // --- POST /v1/audio/transcriptions — OpenAI Whisper (multipart/form-data) ---
  router.post("/v1/audio/transcriptions", ...handleAudioTranscriptions(opts));

  // --- POST /v1/audio/speech — OpenAI TTS ---
  router.post("/v1/audio/speech", handleAudioSpeech(opts));

  // --- GET /v1/models — Static aggregate model list ---
  router.get("/v1/models", handleModels());

  // --- POST /v1/video/generations — ai-powered native format ---
  // No external standard exists for video generation. This alias places video
  // in the /v1/ namespace for consistency while using the same VideoResult shape
  // as the native POST /video route.
  router.post(
    "/v1/video/generations",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const body = req.body as Record<string, unknown>;
      const effectiveMock = opts.mock || body["mock"] === true;

      const overrides = {
        ...opts.configOverrides,
        ...(effectiveMock  ? { mock: true }          : {}),
        ...(opts.profile   ? { profile: opts.profile } : {}),
        ...(body["provider"] ? { provider: body["provider"] as never } : {}),
        ...(body["model"]    ? { model: String(body["model"]) }        : {}),
      };

      const prompt = typeof body["prompt"] === "string" ? body["prompt"] : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt must not be empty" });
        return;
      }

      try {
        const client = await getAiClient("compat-video", overrides as never);
        const result = await client.generateVideo(prompt);
        res.json(result);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          res.status(402).json({ error: err.message, code: "BUDGET_EXCEEDED" });
        } else if (err instanceof AllProvidersExhaustedError) {
          res.status(503).json({ error: err.message, code: "ALL_PROVIDERS_EXHAUSTED" });
        } else if (err instanceof ProviderCapabilityError) {
          res.status(422).json({ error: err.message, code: "PROVIDER_CAPABILITY_ERROR" });
        } else {
          next(err);
        }
      }
    },
  );
}

