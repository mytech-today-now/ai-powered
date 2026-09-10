/**
 * @file src/ai-powered/server/compat/anthropic.ts
 *
 * Anthropic Messages API compatibility adapters for ai-powered.
 *
 * Exports:
 *   AnthropicMessagesBodySchema    – Zod schema for POST /v1/messages
 *   normaliseAnthropicContent()    – flatten text-only content blocks to a plain string
 *   toAnthropicResponse()          – serialise TextResult to Anthropic Messages envelope
 *   toAnthropicErrorEnvelope()     – serialise errors to Anthropic error envelope
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { getAiClient } from "../../index.js";
import type { TextResult } from "../../types.js";
import {
  BudgetExceededError,
  AllProvidersExhaustedError,
  ProviderCapabilityError,
} from "../../types.js";
import type { ProviderCallOptions } from "../../providers/base.js";
import type { ServeOptions } from "../index.js";
import { inferProviderFromModel } from "./model-router.js";

// ---------------------------------------------------------------------------
// bd-t8gb: AnthropicMessagesBodySchema
// ---------------------------------------------------------------------------

const AnthropicTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strict();

const AnthropicBase64SourceSchema = z
  .object({
    type: z.literal("base64"),
    media_type: z.string(),
    data: z.string(),
  })
  .strict();

const AnthropicFileSourceSchema = z
  .object({
    type: z.literal("file"),
    file_id: z.string(),
  })
  .strict();

const AnthropicImageBlockSchema = z
  .object({
    type: z.literal("image"),
    source: z.union([AnthropicBase64SourceSchema, AnthropicFileSourceSchema]),
  })
  .strict();

const AnthropicDocumentBlockSchema = z
  .object({
    type: z.literal("document"),
    source: z.union([AnthropicBase64SourceSchema, AnthropicFileSourceSchema]),
  })
  .strict();

/**
 * Content blocks accepted by Anthropic Messages requests.
 * Text-only arrays remain supported; image/document blocks are accepted so
 * uploads resolved by file-handler.ts survive validation unchanged.
 */
type AnthropicTextBlock = z.infer<typeof AnthropicTextBlockSchema>;
type AnthropicContentBlock =
  | AnthropicTextBlock
  | z.infer<typeof AnthropicImageBlockSchema>
  | z.infer<typeof AnthropicDocumentBlockSchema>;
type AnthropicMessageContent = string | AnthropicContentBlock[];

function isAnthropicContentBlock(value: unknown): value is AnthropicContentBlock {
  return (
    AnthropicTextBlockSchema.safeParse(value).success ||
    AnthropicImageBlockSchema.safeParse(value).success ||
    AnthropicDocumentBlockSchema.safeParse(value).success
  );
}

const AnthropicMessageContentSchema = z.custom<AnthropicMessageContent>(
  (value): value is AnthropicMessageContent => {
    if (typeof value === "string") return true;
    if (!Array.isArray(value)) return false;
    return value.every((block) => isAnthropicContentBlock(block));
  },
  {
    message:
      "Unsupported Anthropic content block type. Supported block types: text, image, document.",
  },
);

const AnthropicMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: AnthropicMessageContentSchema,
  })
  .strict();

/**
 * Zod schema for the POST /v1/messages request body.
 *
 * Strictly follows the Anthropic Messages API wire format with two
 * ai-powered extensions: `provider` and `mock`.
 *
 * https://docs.anthropic.com/en/api/messages
 */
export const AnthropicMessagesBodySchema = z.object({
  model: z.string(),
  messages: z.array(AnthropicMessageSchema).min(1),
  system: z.string().optional(),
  max_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional().default(false),
  // ai-powered extensions
  provider: z.string().optional(),
  mock: z.boolean().optional(),
});

export type AnthropicMessagesBody = z.infer<typeof AnthropicMessagesBodySchema>;

// ---------------------------------------------------------------------------
// bd-t8gb: normaliseAnthropicContent()
// ---------------------------------------------------------------------------

/**
 * Normalise an Anthropic message `content` field to a plain string.
 *
 * The Anthropic API accepts content as either:
 *   - A plain `string` — returned unchanged.
 *   - An array of `{ type: "text", text: "…" }` blocks — all `text` values
 *     are joined in order with no separator (callers may add whitespace in
 *     the `text` values themselves if needed).
 *
 * @example
 *   normaliseAnthropicContent("hello")                     // "hello"
 *   normaliseAnthropicContent([
 *     { type: "text", text: "hello" },
 *     { type: "text", text: " world" },
 *   ])                                                      // "hello world"
 */
export function normaliseAnthropicContent(content: string | Array<AnthropicTextBlock>): string {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("");
}

/**
 * Returns true when a content array contains non-text Anthropic blocks.
 *
 * This is used to decide whether we can preserve the existing text-only path
 * or need to pass the original messages array through to the provider.
 */
function hasAnthropicMultimodalContent(content: AnthropicMessageContent): boolean {
  return Array.isArray(content) && content.some((block) => block.type !== "text");
}

/**
 * Extract only the text fragments from a message content value.
 *
 * Multimodal blocks stay in the provider call options; this helper only
 * generates the plain-text fallback used for budgeting and the legacy
 * text-only prompt path.
 */
function extractAnthropicPromptText(content: AnthropicMessageContent): string {
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

// ---------------------------------------------------------------------------
// bd-2um7: toAnthropicResponse()
// ---------------------------------------------------------------------------

/**
 * Serialise an internal TextResult into a full Anthropic Messages API response envelope.
 *
 * Shape: https://docs.anthropic.com/en/api/messages
 *
 * Key differences from the OpenAI envelope:
 *   - Top-level `id` prefixed `msg_`
 *   - `content` is an array of typed blocks, not `choices[].message`
 *   - `stop_reason` instead of `finish_reason`
 *   - `usage` uses `input_tokens`/`output_tokens` (not `prompt_tokens`/`completion_tokens`)
 */
export function toAnthropicResponse(result: TextResult): object {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: result.model,
    content: [{ type: "text", text: result.content }],
    stop_reason: result.finishReason,
    stop_sequence: null,
    usage: {
      input_tokens: result.usage.promptTokens,
      output_tokens: result.usage.completionTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// bd-2um7: toAnthropicErrorEnvelope()
// ---------------------------------------------------------------------------

/**
 * Serialise any thrown value into an Anthropic error envelope.
 *
 * Shape: `{ "type": "error", "error": { "type": "<anthropic_type>", "message": "…" } }`
 *
 * Error-type mapping:
 *   BudgetExceededError           → "permission_error"
 *   AllProvidersExhaustedError    → "overloaded_error"
 *   ProviderCapabilityError       → "invalid_request_error"
 *   everything else               → "api_error"
 *
 * The `status` parameter is accepted for API symmetry (callers use it to set the HTTP
 * response status) but is not embedded in the response body — the Anthropic envelope
 * does not include an HTTP status field.
 */
export function toAnthropicErrorEnvelope(err: unknown, status: number): object {
  void status; // used by caller to set HTTP status; not part of Anthropic wire format

  let errorType: string;
  let message: string;

  if (err instanceof BudgetExceededError) {
    errorType = "permission_error";
    message = err.message;
  } else if (err instanceof AllProvidersExhaustedError) {
    errorType = "overloaded_error";
    message = err.message;
  } else if (err instanceof ProviderCapabilityError) {
    errorType = "invalid_request_error";
    message = err.message;
  } else if (err instanceof Error) {
    errorType = "api_error";
    message = err.message;
  } else {
    errorType = "api_error";
    message = String(err);
  }

  return {
    type: "error",
    error: { type: errorType, message },
  };
}

// ---------------------------------------------------------------------------
// bd-ff8g: handleAnthropicMessages() — POST /v1/messages
// ---------------------------------------------------------------------------

/**
 * Factory returning an Express handler for POST /v1/messages (Anthropic Messages API).
 *
 * Supports both streaming (SSE — 6-event Anthropic sequence) and non-streaming responses.
 * Applies inferProviderFromModel() for automatic provider selection.
 * Not restricted to the Anthropic provider — any text-capable provider may be used.
 */
export function handleAnthropicMessages(opts: ServeOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = AnthropicMessagesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const envelope = toAnthropicErrorEnvelope(
        new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")),
        400,
      );
      res.status(400).json(envelope);
      return;
    }
    const body = parsed.data;

    const hasMultimodalBlocks = body.messages.some((message) =>
      hasAnthropicMultimodalContent(message.content),
    );

    // Keep the text-only path unchanged. When multimodal blocks are present,
    // we still derive a text fallback for budget estimation, but the original
    // messages array is passed through to the provider unchanged.
    const prompt = body.messages
      .map((message) =>
        hasMultimodalBlocks
          ? extractAnthropicPromptText(message.content)
          : normaliseAnthropicContent(message.content as string | Array<AnthropicTextBlock>),
      )
      .join("\n\n");
    const callOptions: ProviderCallOptions | undefined = hasMultimodalBlocks
      ? { messages: body.messages as NonNullable<ProviderCallOptions["messages"]> }
      : undefined;

    // Provider inference — explicit body.provider takes precedence.
    const effectiveMock = opts.mock || body.mock;
    const inferredProvider = inferProviderFromModel(body.model);
    const effectiveProvider = body.provider ?? inferredProvider;

    const overrides = {
      ...opts.configOverrides,
      ...(effectiveMock ? { mock: true } : {}),
      ...(opts.profile ? { profile: opts.profile } : {}),
      ...(effectiveProvider ? { provider: effectiveProvider as never } : {}),
      model: body.model,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      maxTokens: body.max_tokens,
      ...(body.system ? { systemPrompt: body.system } : {}),
    };

    try {
      const client = await getAiClient("compat-anthropic", overrides as never);

      if (body.stream) {
        // Streaming path — Anthropic 6-event SSE sequence
        const msgId = `msg_${randomUUID()}`;
        const stream = client.streamText(prompt, callOptions);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Event 1: message_start
        res.write(
          `event: message_start\ndata: ${JSON.stringify({
            type: "message_start",
            message: {
              id: msgId,
              type: "message",
              role: "assistant",
              content: [],
              model: body.model,
              stop_reason: null,
            },
          })}\n\n`,
        );

        // Event 2: content_block_start
        res.write(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}\n\n`,
        );

        // Event 3: per-chunk content_block_delta
        for await (const chunk of stream) {
          res.write(
            `event: content_block_delta\ndata: ${JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: chunk },
            })}\n\n`,
          );
        }

        // Event 4: content_block_stop
        res.write(
          `event: content_block_stop\ndata: ${JSON.stringify({
            type: "content_block_stop",
            index: 0,
          })}\n\n`,
        );

        // Event 5: message_delta
        res.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: stream.finishReason ?? null, stop_sequence: null },
            ...(stream.usage?.completionTokens !== undefined
              ? { usage: { output_tokens: stream.usage.completionTokens } }
              : {}),
          })}\n\n`,
        );

        // Event 6: message_stop
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
      } else {
        // Non-streaming path
        const result = await client.generateText(prompt, callOptions);
        res.json(toAnthropicResponse(result));
      }
    } catch (err) {
      let status = 500;
      if (err instanceof BudgetExceededError) status = 402;
      else if (err instanceof AllProvidersExhaustedError) status = 503;
      else if (err instanceof ProviderCapabilityError) status = 422;

      if (status !== 500) {
        res.status(status).json(toAnthropicErrorEnvelope(err, status));
      } else {
        next(err);
      }
    }
  };
}
