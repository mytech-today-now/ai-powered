/**
 * Regression tests for browser-safe retry and circuit-breaker boundaries.
 */

import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, withRetryFetch } from "../../src/ai-powered/shared/resilience.js";

function response(status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ status }), { status, headers });
}

describe("shared fetch resilience", () => {
  it("keeps bounded retries for safe reads and stops after recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));

    const result = await withRetryFetch(fetchMock, {
      maxRetries: 1,
      backoffBase: 0,
      backoffCap: 0,
    });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient network failure for a safe read", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(response(200));

    const result = await withRetryFetch(fetchMock, {
      maxRetries: 1,
      backoffBase: 0,
      backoffCap: 0,
    });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a generation operation without an idempotency contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503));

    const result = await withRetryFetch(fetchMock, {
      maxRetries: 3,
      allowRetries: false,
      backoffBase: 0,
      backoffCap: 0,
    });

    expect(result.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels during backoff without issuing a hidden retry", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(response(503));
    const pending = withRetryFetch(
      fetchMock,
      { maxRetries: 1, backoffBase: 1_000, backoffCap: 1_000 },
      controller.signal,
    );

    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("shared circuit breaker", () => {
  it("counts a final retryable response as service failure", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1_000 });

    await expect(
      breaker.call(async () => {
        const result = await withRetryFetch(() => Promise.resolve(response(503)), {
          allowRetries: false,
        });
        if (result.status === 503) throw new Error("HTTP 503");
        return result;
      }),
    ).rejects.toThrow("HTTP 503");

    expect(breaker.state).toBe("OPEN");
    expect(breaker.failures).toBe(1);
  });

  it("does not count caller cancellation as a circuit failure", async () => {
    const controller = new AbortController();
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1_000 });
    controller.abort(new Error("cancelled"));

    await expect(
      breaker.call(() => Promise.reject(new Error("cancelled")), { signal: controller.signal }),
    ).rejects.toThrow("cancelled");

    expect(breaker.state).toBe("CLOSED");
    expect(breaker.failures).toBe(0);
  });
});
