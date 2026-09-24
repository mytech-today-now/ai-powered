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
import type { Request, Response } from "express";
import { getLogger } from "../../utils.js";
import { getRequestId, serializeErrorForLog, serializePublicError } from "../error-contract.js";

function sendVideoCompatibilityError(res: Response, error: unknown): void {
  const publicError = serializePublicError(error, getRequestId(res));
  getLogger().error(
    {
      requestId: publicError.body.requestId,
      publicCode: publicError.body.code,
      status: publicError.statusCode,
      error: serializeErrorForLog(error),
    },
    "Video compatibility request failed",
  );
  res.status(publicError.statusCode).json({
    error: publicError.body.error,
    code: publicError.body.code,
  });
}

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
  router.post("/v1/video/generations", async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const effectiveMock = opts.mock || body["mock"] === true;

    const overrides = {
      ...opts.configOverrides,
      ...(effectiveMock ? { mock: true } : {}),
      ...(opts.profile ? { profile: opts.profile } : {}),
      ...(body["provider"] ? { provider: body["provider"] as never } : {}),
      ...(body["model"] ? { model: String(body["model"]) } : {}),
    };
    const images = Array.isArray(body["images"])
      ? body["images"].filter((image): image is string => typeof image === "string")
      : [];
    const inputMedia = Array.isArray(body["inputMedia"])
      ? body["inputMedia"].filter(
          (media): media is { url: string; mimeType: string } =>
            typeof media === "object" &&
            media !== null &&
            typeof (media as Record<string, unknown>)["url"] === "string" &&
            typeof (media as Record<string, unknown>)["mimeType"] === "string",
        )
      : [];

    const prompt = typeof body["prompt"] === "string" ? body["prompt"] : "";
    if (!prompt) {
      res.status(400).json({ error: "prompt must not be empty" });
      return;
    }

    try {
      const client = await getAiClient("compat-video", overrides as never);
      const videoOptions = {
        ...(images.length > 0 ? { images } : {}),
        ...(inputMedia.length > 0 ? { inputMedia } : {}),
        ...(typeof body["resolution"] === "string" ? { resolution: body["resolution"] } : {}),
        ...(typeof body["duration"] === "number" ? { duration: body["duration"] } : {}),
        ...(typeof body["negativePrompt"] === "string"
          ? { negativePrompt: body["negativePrompt"] }
          : {}),
        ...(typeof body["seed"] === "number" ? { seed: body["seed"] } : {}),
        ...(typeof body["transitionDuration"] === "number"
          ? { transitionDuration: body["transitionDuration"] }
          : {}),
        ...(typeof body["pikaffect"] === "string" ? { pikaffect: body["pikaffect"] } : {}),
        ...(typeof body["modifyRegionRoi"] === "string"
          ? { modifyRegionRoi: body["modifyRegionRoi"] }
          : {}),
        ...(typeof body["modifyRegionMask"] === "string"
          ? { modifyRegionMask: body["modifyRegionMask"] }
          : {}),
      };
      const result = await client.generateVideo(
        prompt,
        Object.keys(videoOptions).length ? videoOptions : undefined,
      );
      res.json(result);
    } catch (err) {
      sendVideoCompatibilityError(res, err);
    }
  });
}
