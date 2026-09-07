/**
 * @file tests/unit/webhook.test.ts
 *
 * Regression tests for webhook delivery retry behavior.
 *
 * Covers:
 *   - Successful callbacks exit after the first 2xx response.
 *   - A stalled attempt is aborted after the per-attempt timeout and retried.
 *   - Retryable network failures still allow a later retry to succeed.
 *   - Exhausted retries still log the final delivery_failed payload.
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverWebhook } from "../../src/ai-powered/webhook.js";
import type { WebhookCompletePayload } from "../../src/ai-powered/webhook.js";

const CALLBACK_URL = "https://callbacks.example.test/webhooks/ai-powered";
const SIGNING_KEY = "fb_sk_webhook_test_key";

const COMPLETE_PAYLOAD: WebhookCompletePayload = {
  event: "shot:complete",
  jobId: "job_123",
  shotId: "shot_1",
  status: "complete",
  clipPath: "/tmp/shot-1.mp4",
  durationSeconds: 4.2,
  resolution: "1920x1080",
  creditsCharged: 5,
  timestamp: "2026-04-15T10:03:22Z",
};

function expectedSignature(payload: WebhookCompletePayload, key: string): string {
  return "sha256=" + createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deliverWebhook", () => {
  it("posts the completion payload once and includes the signature header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook(CALLBACK_URL, COMPLETE_PAYLOAD, SIGNING_KEY);

    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CALLBACK_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(COMPLETE_PAYLOAD);

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-AiPowered-Signature"]).toBe(expectedSignature(COMPLETE_PAYLOAD, SIGNING_KEY));
  });

  it("aborts a stalled attempt after the timeout and retries successfully", async () => {
    let callCount = 0;
    const fetchSpy = vi.fn((_url: string, init: RequestInit) => {
      callCount += 1;
      if (callCount === 1) {
        const signal = init.signal as AbortSignal | null | undefined;
        if (signal === undefined || signal === null) {
          throw new Error("expected AbortSignal on timed webhook attempt");
        }

        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const abortError = new Error("Webhook delivery timed out");
              abortError.name = "AbortError";
              reject(abortError);
            },
            { once: true },
          );
        });
      }

      return Promise.resolve({ ok: true, status: 200 } as Response);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook(CALLBACK_URL, COMPLETE_PAYLOAD, SIGNING_KEY);

    const [firstCallUrl, firstCallInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(firstCallUrl).toBe(CALLBACK_URL);
    const firstSignal = firstCallInit.signal as AbortSignal | null;
    expect(firstSignal).not.toBeNull();
    expect(firstSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(firstSignal?.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("retries a rejected fetch and succeeds on the next attempt", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("ECONNRESET"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook(CALLBACK_URL, COMPLETE_PAYLOAD, SIGNING_KEY);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy).not.toHaveBeenCalled();

    for (const call of fetchSpy.mock.calls) {
      const [, init] = call as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-AiPowered-Signature"]).toBe(
        expectedSignature(COMPLETE_PAYLOAD, SIGNING_KEY),
      );
    }
  });

  it("logs delivery_failed after exhausting HTTP 500 retries", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", fetchSpy);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook(CALLBACK_URL, COMPLETE_PAYLOAD, SIGNING_KEY);

    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(4);

    for (const call of fetchSpy.mock.calls) {
      const [, init] = call as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-AiPowered-Signature"]).toBe(
        expectedSignature(COMPLETE_PAYLOAD, SIGNING_KEY),
      );
    }

    const stderrText = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(stderrText).toContain('"delivery_failed":true');

    const parsed = JSON.parse(stderrText);
    expect(parsed).toMatchObject({
      delivery_failed: true,
      ...COMPLETE_PAYLOAD,
      callbackUrl: CALLBACK_URL,
      attempts: 4,
    });
  });
});
