/**
 * Stable public error and redacted diagnostic contracts for the proxy server.
 *
 * The native API keeps the historical `error` and `code` fields for callers,
 * while adding a machine-readable status and request correlation identifier.
 * Internal messages, causes, paths, URLs, credentials, and upstream bodies
 * never cross this boundary.
 */

import { randomUUID } from "node:crypto";
import type { Response } from "express";
import {
  AiPoweredError,
  AllProvidersExhaustedError,
  BudgetExceededError,
  CircuitOpenError,
  PluginError,
  ProviderCapabilityError,
  ProviderError,
  ValidationError,
} from "../types.js";
import { maskApiKey } from "../utils.js";
import { ResourcePolicyError } from "./resource-policy.js";

export interface PublicErrorEnvelope {
  /** Historical public message field retained for compatibility. */
  error: string;
  /** Explicit message alias for clients that use standard error envelopes. */
  message: string;
  code: string;
  status: number;
  requestId: string;
  retryable: boolean;
  limit?: string;
  issues?: string[];
}

export interface PublicErrorOptions {
  code?: string;
  message?: string;
  statusCode?: number;
  retryable?: boolean;
  limit?: string;
  issues?: string[];
}

export interface PublicErrorResult {
  statusCode: number;
  body: PublicErrorEnvelope;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_DIAGNOSTIC_TEXT = 512;

/** Return a bounded request identifier, preserving a valid caller-supplied ID. */
export function createRequestId(candidate?: string): string {
  const trimmed = candidate?.trim();
  return trimmed && REQUEST_ID_PATTERN.test(trimmed) ? trimmed : randomUUID();
}

/** Read the server-owned request ID attached by the first middleware. */
export function getRequestId(res: Response): string {
  const candidate = res.locals["requestId"];
  return typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : createRequestId();
}

function statusInRange(status: unknown): status is number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599;
}

function safeProviderStatus(error: ProviderError): number {
  if (statusInRange(error.statusCode)) {
    // Preserve the documented client and gateway statuses. Normalize an
    // arbitrary provider 5xx to the proxy's upstream-failure boundary.
    if (error.statusCode >= 500 && ![502, 503, 504].includes(error.statusCode)) return 502;
    return error.statusCode;
  }
  return 502;
}

function providerMessage(statusCode: number): string {
  if (statusCode === 401 || statusCode === 403) {
    return "The provider rejected the configured credentials. Check Settings / Configuration and try again.";
  }
  if (statusCode === 402) {
    return "The provider account cannot complete this request. Check provider billing or credits and try again.";
  }
  if (statusCode === 404) {
    return "The provider could not find the requested model or resource. Check the selected model and try again.";
  }
  if (statusCode === 409) {
    return "The provider rejected this request because it conflicts with an existing operation. Try again.";
  }
  if (statusCode === 413) {
    return "The provider rejected the request because its payload is too large. Reduce the input and try again.";
  }
  if (statusCode === 422) {
    return "The provider rejected the request. Check the selected model and request options, then try again.";
  }
  if (statusCode === 429) return "The provider is rate limiting requests. Wait and try again.";
  if (statusCode === 499) return "The provider request was cancelled.";
  if (statusCode === 504) return "The provider timed out. Wait and try again.";
  if (statusCode === 502 || statusCode === 503) {
    return "The provider is temporarily unavailable. Wait and try again.";
  }
  return "The provider could not complete the request. Check provider settings and try again.";
}

function classifyError(error: unknown): PublicErrorOptions {
  if (error instanceof ResourcePolicyError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      retryable: error.statusCode === 429 || error.statusCode === 504,
      limit: error.limit,
    };
  }
  if (error instanceof BudgetExceededError) {
    return { code: error.code, message: error.message, statusCode: 402, retryable: false };
  }
  if (error instanceof AllProvidersExhaustedError) {
    return {
      code: error.code,
      message:
        "All configured providers are unavailable. Check provider settings or try again later.",
      statusCode: 503,
      retryable: true,
    };
  }
  if (error instanceof ProviderCapabilityError) {
    return {
      code: error.code,
      message:
        "The selected provider does not support this request. Choose another provider or modality.",
      statusCode: 422,
      retryable: false,
    };
  }
  if (error instanceof ProviderError) {
    const statusCode = safeProviderStatus(error);
    return {
      code: error.code,
      message: providerMessage(statusCode),
      statusCode,
      retryable: error.retryable,
    };
  }
  if (error instanceof ValidationError) {
    return {
      code: error.code,
      message:
        "The provider response did not match the requested schema. Review the schema and try again.",
      statusCode: 422,
      retryable: false,
    };
  }
  if (error instanceof CircuitOpenError) {
    return {
      code: error.code,
      message: "The provider is temporarily unavailable. Wait and try again.",
      statusCode: 503,
      retryable: true,
    };
  }
  if (error instanceof PluginError) {
    return {
      code: error.code,
      message: "A server extension failed while handling the request. Try again later.",
      statusCode: 500,
      retryable: false,
    };
  }
  if (error instanceof Error && /ffmpeg not found in PATH/i.test(error.message)) {
    return {
      code: "INTERNAL_SERVER_ERROR",
      message: "ffmpeg not found in PATH. Install ffmpeg on the server host, then try again.",
      statusCode: 500,
      retryable: false,
    };
  }
  // Do not reflect arbitrary AiPoweredError codes. Only the known subclasses
  // above have a server contract; all other failures are internal faults.
  if (error instanceof AiPoweredError) {
    return {
      code: "INTERNAL_SERVER_ERROR",
      message: "The server could not complete the request. Try again later.",
      statusCode: 500,
      retryable: false,
    };
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: "The server could not complete the request. Try again later.",
    statusCode: 500,
    retryable: false,
  };
}

/** Serialize an error without exposing the original message or cause. */
export function serializePublicError(
  error: unknown,
  requestId: string,
  overrides: PublicErrorOptions = {},
): PublicErrorResult {
  const classified = classifyError(error);
  const statusCode = statusInRange(overrides.statusCode)
    ? overrides.statusCode
    : (classified.statusCode ?? 500);
  const message =
    overrides.message ?? classified.message ?? "The server could not complete the request.";
  const code =
    overrides.code && SAFE_CODE_PATTERN.test(overrides.code)
      ? overrides.code
      : classified.code && SAFE_CODE_PATTERN.test(classified.code)
        ? classified.code
        : "INTERNAL_SERVER_ERROR";
  const body: PublicErrorEnvelope = {
    error: message,
    message,
    code,
    status: statusCode,
    requestId: createRequestId(requestId),
    retryable: overrides.retryable ?? classified.retryable ?? false,
    ...((overrides.limit ?? (classified.limit !== undefined ? classified.limit : undefined))
      ? { limit: overrides.limit ?? classified.limit }
      : {}),
    ...(overrides.issues ? { issues: overrides.issues } : {}),
  };
  return { statusCode, body };
}

/** Serialize and send a public error while retaining the legacy error field. */
export function sendPublicError(
  res: Response,
  error: unknown,
  overrides: PublicErrorOptions = {},
): PublicErrorResult {
  const result = serializePublicError(error, getRequestId(res), overrides);
  res.status(result.statusCode).json(result.body);
  return result;
}

function safeString(value: unknown): string {
  try {
    return typeof value === "string" ? value : String(value);
  } catch {
    return "[unprintable]";
  }
}

function redactDiagnosticText(value: unknown): string {
  let text = safeString(value).replace(/\s+/g, " ").trim();
  if (!text) return "[empty]";

  // A JSON object/array in an error is overwhelmingly likely to be an
  // upstream body. Do not retain it, even after ordinary token redaction.
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") return "[REDACTED_UPSTREAM_BODY]";
  } catch {
    // Continue with bounded text redaction for ordinary Error messages.
  }

  text = text.replace(/(?:https?:\/\/|wss?:\/\/)[^\s"'<>]+/gi, "[URL_REDACTED]");
  text = text.replace(
    /\b(?:api[_-]?key|authorization|bearer|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passphrase|credential(?:s)?|private[_-]?key)\s*[:=]\s*(?:Bearer\s+)?[^\s,;)}\]]+/gi,
    (match) => `${match.slice(0, match.search(/[:=]/))}[REDACTED]`,
  );
  text = text.replace(
    /(?:VENICE_INFERENCE_KEY_|sk-ant-|sk-or-v1-|sk-|xai-|ven-)[A-Za-z0-9._-]+/g,
    (match) => maskApiKey(match),
  );
  text = text.replace(
    /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|tmp|var|private|workspace|app|mnt|opt|srv|etc)\/)[^\s"'<>]*/gi,
    "[PATH_REDACTED]",
  );
  text = text.replace(
    /(?:upstream|response|raw)?\s*body\s*[:=]\s*\{.*$/i,
    "upstream body: [REDACTED]",
  );
  return text.length > MAX_DIAGNOSTIC_TEXT ? `${text.slice(0, MAX_DIAGNOSTIC_TEXT - 3)}...` : text;
}

/** Structured diagnostics safe for Pino; deliberately omits stack and raw objects. */
export function serializeErrorForLog(error: unknown, depth = 0): Record<string, unknown> {
  if (depth > 2) return { name: "NestedError", message: "[depth limited]" };
  if (error instanceof Error) {
    const output: Record<string, unknown> = {
      name: error.name,
      message: redactDiagnosticText(error.message),
    };
    if (error instanceof AiPoweredError) output["code"] = error.code;
    if (error instanceof ProviderError) {
      output["provider"] = error.provider;
      output["statusCode"] = error.statusCode;
      output["retryable"] = error.retryable;
    }
    if (error instanceof ResourcePolicyError) {
      output["code"] = error.code;
      output["statusCode"] = error.statusCode;
      output["limit"] = error.limit;
    }
    if (error.cause !== undefined) {
      output["cause"] =
        error.cause instanceof Error
          ? serializeErrorForLog(error.cause, depth + 1)
          : redactDiagnosticText(error.cause);
    }
    return output;
  }
  return { name: typeof error, message: redactDiagnosticText(error) };
}
