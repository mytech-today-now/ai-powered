/**
 * tests/app-008.test.ts — App-008
 *
 * Unit tests for the shared resilience primitives that will live in
 * src/ai-powered/shared/resilience.ts after App-008 is implemented.
 *
 * Inline implementations are used here so the tests can run before the
 * source file exists, providing a living specification.
 *
 * Run:
 *   npx vitest run openspec/changes/app-008/tests/app-008.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Inline implementations (mirror src/ai-powered/shared/resilience.ts)
// ---------------------------------------------------------------------------

function jitterDelay(attempt: number, base = 500, cap = 8000): number {
  return Math.random() * Math.min(cap, base * Math.pow(2, attempt));
}

type RetryOptions = {
  maxRetries?: number;
  backoffBase?: number;
  backoffCap?: number;
  retryOn?: (status: number) => boolean;
};

async function withRetryFetch(
  fn: () => Promise<{ status: number }>,
  opts: RetryOptions = {},
  signal?: AbortSignal,
): Promise<{ status: number }> {
  const { maxRetries = 3, backoffBase = 1, backoffCap = 10,
          retryOn = (s) => s === 429 || s === 503 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw (signal.reason ?? new Error("Aborted"));
    try {
      const res = await fn();
      if (!retryOn(res.status) || attempt === maxRetries) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) throw err;
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, jitterDelay(attempt, backoffBase, backoffCap));
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("Aborted"));
      }, { once: true });
    });
  }
  throw lastErr;
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

class CircuitBreaker {
  private _state: CircuitState = "CLOSED";
  private _failures = 0;
  private _openedAt: number | null = null;
  private readonly _threshold: number;
  private readonly _resetMs: number;
  constructor(opts?: { failureThreshold?: number; resetTimeoutMs?: number }) {
    this._threshold = opts?.failureThreshold ?? 5;
    this._resetMs   = opts?.resetTimeoutMs  ?? 60_000;
  }
  get state(): CircuitState { return this._state; }
  get failures(): number { return this._failures; }
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this._state === "OPEN") {
      const elapsed = Date.now() - (this._openedAt ?? 0);
      if (elapsed >= this._resetMs) { this._state = "HALF_OPEN"; }
      else throw new Error(`CircuitBreaker OPEN`);
    }
    try {
      const result = await fn();
      if (this._state === "HALF_OPEN") { this._state = "CLOSED"; this._failures = 0; this._openedAt = null; }
      else { this._failures = 0; }
      return result;
    } catch (err) {
      this._failures++;
      if (this._state === "HALF_OPEN" || this._failures >= this._threshold) {
        this._state = "OPEN"; this._openedAt = Date.now();
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests — jitterDelay
// ---------------------------------------------------------------------------

describe("jitterDelay", () => {
  it("returns a value within [0, cap] for any attempt", () => {
    for (let i = 0; i < 50; i++) {
      const d = jitterDelay(i % 10, 500, 8000);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(8000);
    }
  });

  it("respects cap even when exponential exceeds it", () => {
    // attempt=10: 500 * 2^10 = 512000 > cap=1000
    const d = jitterDelay(10, 500, 1000);
    expect(d).toBeLessThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// Tests — withRetryFetch
// ---------------------------------------------------------------------------

describe("withRetryFetch", () => {
  it("returns immediately on 200 (no retry)", async () => {
    const fn = vi.fn().mockResolvedValue({ status: 200 });
    const res = await withRetryFetch(fn, { maxRetries: 3 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and returns 200 on second attempt", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ status: 429 })
      .mockResolvedValue({ status: 200 });
    const res = await withRetryFetch(fn, { maxRetries: 3, backoffBase: 1, backoffCap: 1 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 and returns 200 on third attempt", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValue({ status: 200 });
    const res = await withRetryFetch(fn, { maxRetries: 3, backoffBase: 1, backoffCap: 1 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns 503 response after exhausting maxRetries", async () => {
    const fn = vi.fn().mockResolvedValue({ status: 503 });
    const res = await withRetryFetch(fn, { maxRetries: 2, backoffBase: 1, backoffCap: 1 });
    expect(res.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("does NOT retry on 400 Bad Request", async () => {
    const fn = vi.fn().mockResolvedValue({ status: 400 });
    const res = await withRetryFetch(fn, { maxRetries: 3 });
    expect(res.status).toBe(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("aborts during retry delay when signal fires", async () => {
    const ac = new AbortController();
    const fn = vi.fn()
      .mockResolvedValueOnce({ status: 429 })
      .mockResolvedValue({ status: 200 });
    const p = withRetryFetch(fn, { maxRetries: 3, backoffBase: 500, backoffCap: 1000 }, ac.signal);
    setTimeout(() => ac.abort(new Error("cancelled")), 20);
    await expect(p).rejects.toThrow("cancelled");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — CircuitBreaker
// ---------------------------------------------------------------------------

describe("CircuitBreaker", () => {
  const failFn = () => Promise.reject(new Error("fail"));
  const okFn   = () => Promise.resolve("ok");

  it("starts in CLOSED state", () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe("CLOSED");
  });

  it("passes through successful calls in CLOSED state", async () => {
    const cb = new CircuitBreaker();
    const r = await cb.call(okFn);
    expect(r).toBe("ok");
    expect(cb.state).toBe("CLOSED");
    expect(cb.failures).toBe(0);
  });

  it("counts consecutive failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    await cb.call(failFn).catch(() => {});
    await cb.call(failFn).catch(() => {});
    expect(cb.failures).toBe(2);
    expect(cb.state).toBe("CLOSED");
  });

  it("opens after failureThreshold consecutive failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) await cb.call(failFn).catch(() => {});
    expect(cb.state).toBe("OPEN");
  });

  it("fast-fails when OPEN without calling fn", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    await cb.call(failFn).catch(() => {});
    await cb.call(failFn).catch(() => {});
    const fn = vi.fn().mockResolvedValue("should not be called");
    await expect(cb.call(fn)).rejects.toThrow("CircuitBreaker OPEN");
    expect(fn).not.toHaveBeenCalled();
  });

  it("transitions to HALF_OPEN after resetTimeoutMs", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 30 });
    await cb.call(failFn).catch(() => {});
    await cb.call(failFn).catch(() => {});
    expect(cb.state).toBe("OPEN");
    await new Promise(r => setTimeout(r, 40));
    await cb.call(okFn).catch(() => {});
    expect(cb.state).toBe("CLOSED");
  });

  it("closes after successful probe in HALF_OPEN state", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 20 });
    await cb.call(failFn).catch(() => {});
    await cb.call(failFn).catch(() => {});
    await new Promise(r => setTimeout(r, 30));
    await cb.call(okFn);
    expect(cb.state).toBe("CLOSED");
    expect(cb.failures).toBe(0);
  });

  it("re-opens if probe fails in HALF_OPEN state", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 20 });
    await cb.call(failFn).catch(() => {});
    await cb.call(failFn).catch(() => {});
    await new Promise(r => setTimeout(r, 30));
    await cb.call(failFn).catch(() => {});
    expect(cb.state).toBe("OPEN");
  });

  it("resets failure counter after success while CLOSED", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    await cb.call(failFn).catch(() => {});
    await cb.call(failFn).catch(() => {});
    await cb.call(okFn);
    expect(cb.failures).toBe(0);
    expect(cb.state).toBe("CLOSED");
  });
});

