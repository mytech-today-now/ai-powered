/**
 * @file src/ai-powered/plugins/audit-log.ts
 *
 * Built-in audit-log plugin.
 *
 * Appends one JSON line per request and one per response to a JSONL audit file.
 * API keys are masked before writing; raw prompts are stored as SHA-256 hashes
 * so the log is safe to retain long-term without exposing user input.
 *
 * Activate via config:  plugins: ['audit-log']
 * Default output path:  ./ai-powered-audit.jsonl
 */

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";
import type { AiPlugin, RequestContext, ResponseContext, AiPoweredError } from "../types.js";
import { maskApiKey } from "../utils.js";
import { getLogger } from "../utils.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AuditLogOptions {
  /** Path to the output JSONL file. Default: ./ai-powered-audit.jsonl */
  outputPath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of the concatenated user-role message contents. */
function hashMessages(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string {
  const text = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function appendLine(filePath: string, record: unknown): void {
  try {
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    getLogger().warn({ filePath, err }, "audit-log: failed to write entry");
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an audit-log plugin instance.
 *
 * @param opts  Optional configuration overrides.
 */
export function createAuditLogPlugin(opts: AuditLogOptions = {}): AiPlugin {
  const outputPath = path.resolve(opts.outputPath ?? "./ai-powered-audit.jsonl");

  // Ensure the parent directory exists at plugin-creation time.
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    name: "audit-log",
    version: "1.0.0",
    description: "Appends every request and response to a JSONL audit file with masked keys.",

    async onRequest(ctx: RequestContext): Promise<RequestContext> {
      const record = {
        type: "request",
        timestamp: new Date().toISOString(),
        modality: ctx.modality,
        provider: ctx.config.provider,
        model: ctx.config.model ?? null,
        promptHash: hashMessages(ctx.messages),
        apiKeyMasked: maskApiKey(ctx.config.apiKey ?? ""),
        options: {
          temperature: ctx.config.temperature ?? null,
          maxTokens: ctx.config.maxTokens ?? null,
        },
      };
      appendLine(outputPath, record);
      // Return context unmodified — this plugin is observation-only on request.
      return ctx;
    },

    async onResponse(ctx: ResponseContext): Promise<ResponseContext> {
      const record = {
        type: "response",
        timestamp: new Date().toISOString(),
        modality: ctx.modality,
        provider: ctx.result.provider,
        model: ctx.result.model,
        latencyMs: ctx.result.latencyMs,
        costUsd: ctx.result.cost.totalUsd,
        isEstimate: ctx.result.cost.isEstimate,
        usage: ctx.result.usage ?? null,
        finishReason: "finishReason" in ctx.result
          ? (ctx.result as { finishReason: string }).finishReason
          : null,
      };
      appendLine(outputPath, record);
      // Return context unmodified — this plugin is observation-only on response.
      return ctx;
    },

    async onError(error: AiPoweredError): Promise<void> {
      const record = {
        type: "error",
        timestamp: new Date().toISOString(),
        code: error.code,
        message: error.message,
      };
      appendLine(outputPath, record);
    },
  };
}

