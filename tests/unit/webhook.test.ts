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
import {
  _setWebhookDnsLookupForTests,
  deliverWebhook,
  validateWebhookDestination,
} from "../../src/ai-powered/webhook.js";
import type { WebhookCompletePayload } from "../../src/ai-powered/webhook.js";

const CALLBACK_URL = "https://93.184.216.34/webhooks/ai-powered";
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
  _setWebhookDnsLookupForTests();
  delete process.env["AIPOWERED_WEBHOOK_TEST_MODE"];
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
      event: COMPLETE_PAYLOAD.event,
      jobId: COMPLETE_PAYLOAD.jobId,
      shotId: COMPLETE_PAYLOAD.shotId,
      status: COMPLETE_PAYLOAD.status,
      attempts: 4,
    });
    expect(parsed.destinationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stderrText).not.toContain(CALLBACK_URL);
    expect(stderrText).not.toContain(COMPLETE_PAYLOAD.clipPath);
    expect(stderrText).not.toContain(SIGNING_KEY);
  });
  it("accepts public HTTPS and rejects malformed, HTTP, and loopback destinations", () => {
    expect(validateWebhookDestination(CALLBACK_URL)).toMatchObject({
      url: CALLBACK_URL,
      hostname: "93.184.216.34",
      addresses: ["93.184.216.34"],
    });
    expect(() => validateWebhookDestination("not-a-url")).toThrow();
    expect(() => validateWebhookDestination("http://93.184.216.34/webhook")).toThrow();
    expect(() => validateWebhookDestination("https://127.0.0.1/webhook")).toThrow();
    expect(() => validateWebhookDestination("https://10.0.0.4/webhook")).toThrow();
  });

  it("allows localhost only when explicit test mode is enabled", () => {
    expect(() => validateWebhookDestination("http://127.0.0.1:31337/webhook")).toThrow();
    expect(
      validateWebhookDestination("http://127.0.0.1:31337/webhook", { allowLocalhost: true }),
    ).toMatchObject({
      allowLocalhost: true,
      addresses: ["127.0.0.1"],
    });
  });

  it("rejects DNS names resolving to private addresses before fetch", async () => {
    _setWebhookDnsLookupForTests(async () => ["10.0.0.4"]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook("https://callbacks.example.test/webhook", COMPLETE_PAYLOAD, SIGNING_KEY);
    await vi.runAllTimersAsync();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('"delivery_rejected":true');
    expect(String(stderrSpy.mock.calls[0]?.[0])).not.toContain("callbacks.example.test");
    expect(String(stderrSpy.mock.calls[0]?.[0])).not.toContain(COMPLETE_PAYLOAD.clipPath);
  });

  it("stops before retry when DNS resolution changes to a private address", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["10.0.0.4"]);
    _setWebhookDnsLookupForTests(lookup);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchSpy);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook("https://callbacks.example.test/webhook", COMPLETE_PAYLOAD, SIGNING_KEY);
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls.at(-1)?.[0])).toContain('"reason":"private_address"');
  });

  it("does not follow a redirect to another destination", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://127.0.0.1/blocked" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook(CALLBACK_URL, COMPLETE_PAYLOAD, SIGNING_KEY);
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchSpy.mock.calls) {
      expect((init as RequestInit).redirect).toBe("manual");
    }
  });

  it("permits an HTTP localhost callback only in environment test mode", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    deliverWebhook("http://127.0.0.1:31337/webhook", COMPLETE_PAYLOAD, SIGNING_KEY);
    await vi.runAllTimersAsync();
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env["AIPOWERED_WEBHOOK_TEST_MODE"] = "true";
    deliverWebhook("http://127.0.0.1:31337/webhook", COMPLETE_PAYLOAD, SIGNING_KEY);
    await vi.runAllTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
