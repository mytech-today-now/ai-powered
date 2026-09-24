/** Regression coverage for the proxy public error and diagnostic contracts. */

import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AiClient } from "../../src/ai-powered/client.js";
import {
  AllProvidersExhaustedError,
  BudgetExceededError,
  ProviderCapabilityError,
  ProviderError,
  ValidationError,
} from "../../src/ai-powered/types.js";
import { getLogger } from "../../src/ai-powered/utils.js";
import {
  serializeErrorForLog,
  serializePublicError,
} from "../../src/ai-powered/server/error-contract.js";
import { createServer } from "../../src/ai-powered/server/index.js";
import { invalidStitchClipError } from "../../src/ai-powered/server/resource-policy.js";

describe("public proxy error contract", () => {
  const requestId = "contract-test-123";

  it("returns a stable envelope for unknown and non-Error throws", () => {
    for (const thrown of [
      new Error("C:\\private\\provider.json https://callback.example/hook?token=secret"),
      'upstream body: {"apiKey":"sk-secret"}',
    ]) {
      const result = serializePublicError(thrown, requestId);
      expect(result.statusCode).toBe(500);
      expect(result.body).toMatchObject({
        error: "The server could not complete the request. Try again later.",
        message: "The server could not complete the request. Try again later.",
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        requestId,
        retryable: false,
      });
      expect(JSON.stringify(result.body)).not.toContain("callback.example");
      expect(JSON.stringify(result.body)).not.toContain("sk-secret");
    }
  });

  it.each([
    [new BudgetExceededError(1.25, 1), 402, "BUDGET_EXCEEDED"],
    [
      new AllProvidersExhaustedError([{ provider: "openai", reason: "secret body" }]),
      503,
      "ALL_PROVIDERS_EXHAUSTED",
    ],
    [new ProviderCapabilityError("anthropic", "image"), 422, "PROVIDER_CAPABILITY_ERROR"],
    [new ProviderError("openai", "raw upstream body", 401, false), 401, "PROVIDER_ERROR"],
    [new ProviderError("openai", "gateway failed", 502, true), 502, "PROVIDER_ERROR"],
    [new ValidationError(["raw output"], { secret: "value" }), 422, "VALIDATION_ERROR"],
    [invalidStitchClipError(), 400, "INVALID_STITCH_CLIP"],
  ] as const)("preserves intentional status and code for %o", (error, status, code) => {
    const result = serializePublicError(error, requestId);
    expect(result.statusCode).toBe(status);
    expect(result.body).toMatchObject({ status, code, requestId });
    expect(JSON.stringify(result.body)).not.toContain("raw upstream body");
    expect(JSON.stringify(result.body)).not.toContain("secret body");
  });

  it("keeps only redacted, bounded cause diagnostics", () => {
    const error = new Error(
      'C:\\private\\provider.json https://callback.example/hook?token=secret sk-test-key Authorization=Bearer request-secret upstream body: {"raw":"secret"}',
      { cause: new Error("/tmp/nested xai-nested-key") },
    );
    const diagnostic = serializeErrorForLog(error);
    const text = JSON.stringify(diagnostic);
    expect(diagnostic).toHaveProperty("cause");
    expect(text).toContain("[URL_REDACTED]");
    expect(text).toContain("[PATH_REDACTED]");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("callback.example");
    expect(text).not.toContain("request-secret");
    expect(text).not.toContain("nested xai-nested-key");
    expect(text).not.toContain('raw\\":\\"secret');
  });
});

function readResponse(res: http.IncomingMessage): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => (body += chunk));
    res.on("end", () => {
      try {
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) });
      } catch (error) {
        reject(error);
      }
    });
    res.on("error", reject);
  });
}

describe("central proxy error responses", () => {
  let server: http.Server;
  let port: number;
  let logFile: string;
  let tempDir: string;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-powered-error-contract-"));
        logFile = path.join(tempDir, "proxy.jsonl");
        server = createServer({ mock: true, logFile }).listen(0, "127.0.0.1", () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          fs.rmSync(tempDir, { recursive: true, force: true });
          resolve();
        });
      }),
  );

  it("returns and logs a correlation id without exposing an internal cause", async () => {
    const secretPath = "C:\\private\\provider.json";
    const secretUrl = "https://callback.example/hook?token=secret";
    const secretKey = "sk-central-secret";
    const cause = new Error(`/tmp/nested ${secretKey}`);
    vi.spyOn(AiClient.prototype, "generateText").mockRejectedValueOnce(
      new Error(`${secretPath} ${secretUrl} ${secretKey} upstream body: {"raw":"secret"}`, {
        cause,
      }),
    );

    const response = await new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      body: unknown;
    }>((resolve, reject) => {
      const payload = JSON.stringify({ prompt: "trigger" });
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/text",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "X-Request-ID": "central-error-123",
          },
        },
        async (res) => {
          try {
            const parsed = await readResponse(res);
            resolve({ status: parsed.status, headers: res.headers, body: parsed.body });
          } catch (error) {
            reject(error);
          }
        },
      );
      request.on("error", reject);
      request.end(payload);
    });

    expect(response.status).toBe(500);
    expect(response.headers["x-request-id"]).toBe("central-error-123");
    expect(response.body).toMatchObject({
      error: "The server could not complete the request. Try again later.",
      message: "The server could not complete the request. Try again later.",
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
      requestId: "central-error-123",
      retryable: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(secretPath);
    expect(JSON.stringify(response.body)).not.toContain(secretUrl);
    expect(JSON.stringify(response.body)).not.toContain(secretKey);

    const logger = getLogger() as unknown as { flush?: () => void };
    logger.flush?.();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const logText = fs.readFileSync(logFile, "utf8");
    expect(logText).toContain("central-error-123");
    expect(logText).not.toContain(secretPath);
    expect(logText).not.toContain(secretUrl);
    expect(logText).not.toContain(secretKey);
    expect(logText).not.toContain('raw\\":\\"secret');
  });
});
