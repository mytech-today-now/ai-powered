/**
 * @file tests/unit/resilience.test.ts
 *
 * Unit tests for withRetry and CircuitBreaker.
 * Fake timers are used to advance Date.now() for circuit-breaker state transitions.
 */

import { withRetry, CircuitBreaker } from "../../src/ai-powered/resilience.js";
import { ProviderError, CircuitOpenError } from "../../src/ai-powered/types.js";

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe("withRetry", () => {
  it("returns the result immediately when fn succeeds on the first attempt", async () => {
    const result = await withRetry(async (_attempt) => "ok", { baseDelayMs: 0 });
    expect(result).toBe("ok");
  });

  it("does NOT retry a non-retryable ProviderError", async () => {
    let calls = 0;
    const fn = async (_attempt: number) => {
      calls++;
      throw new ProviderError("mock", "non-retryable", 400, false);
    };
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toThrow(ProviderError);
    expect(calls).toBe(1);
  });

  it("retries a retryable ProviderError and resolves when fn eventually succeeds", async () => {
    let calls = 0;
    const fn = async (_attempt: number): Promise<string> => {
      calls++;
      if (calls < 3) throw new ProviderError("mock", "rate-limited", 429, true);
      return "recovered";
    };
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("throws the last error after exhausting all maxAttempts", async () => {
    let calls = 0;
    const fn = async (_attempt: number) => {
      calls++;
      throw new ProviderError("mock", "server error", 503, true);
    };
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 0 })).rejects.toThrow("server error");
    expect(calls).toBe(2);
  });

  it("uses a custom isRetryable predicate for non-ProviderError errors", async () => {
    let calls = 0;
    const fn = async (_attempt: number): Promise<string> => {
      calls++;
      if (calls === 1) throw new TypeError("network glitch");
      return "ok";
    };
    const result = await withRetry(fn, {
      maxAttempts: 2,
      baseDelayMs: 0,
      isRetryable: (err) => err instanceof TypeError,
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

describe("CircuitBreaker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in CLOSED state with zero failures", () => {
    const cb = new CircuitBreaker("test", 3, 1000);
    expect(cb.state).toBe("CLOSED");
    expect(cb.failures).toBe(0);
  });

  it("remains CLOSED and resets failures on success", async () => {
    const cb = new CircuitBreaker("test", 3, 1000);
    await cb.call(() => Promise.resolve("ok"));
    expect(cb.state).toBe("CLOSED");
    expect(cb.failures).toBe(0);
  });

  it("opens after reaching the failure threshold", async () => {
    const cb = new CircuitBreaker("test", 2, 1000);
    const fail = () => cb.call(() => Promise.reject(new Error("fail")));
    await expect(fail()).rejects.toThrow();
    expect(cb.state).toBe("CLOSED");
    await expect(fail()).rejects.toThrow();
    expect(cb.state).toBe("OPEN");
  });

  it("throws CircuitOpenError immediately when the circuit is OPEN", async () => {
    const cb = new CircuitBreaker("test", 1, 60_000);
    await expect(cb.call(() => Promise.reject(new Error("boom")))).rejects.toThrow();
    expect(cb.state).toBe("OPEN");
    await expect(cb.call(() => Promise.resolve("ok"))).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("transitions to HALF_OPEN and closes on a successful probe", async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker("test", 1, 1000);
    await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    expect(cb.state).toBe("OPEN");

    vi.advanceTimersByTime(1001);

    const result = await cb.call(() => Promise.resolve("probe ok"));
    expect(result).toBe("probe ok");
    expect(cb.state).toBe("CLOSED");
    expect(cb.failures).toBe(0);
  });

  it("re-opens when a HALF_OPEN probe fails", async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker("test", 1, 1000);
    await expect(cb.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    expect(cb.state).toBe("OPEN");

    vi.advanceTimersByTime(1001);

    await expect(cb.call(() => Promise.reject(new Error("probe fail")))).rejects.toThrow("probe fail");
    expect(cb.state).toBe("OPEN");
  });
});

