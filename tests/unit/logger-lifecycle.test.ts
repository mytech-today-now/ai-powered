/**
 * Regression coverage for repeated module-level logger initialization.
 *
 * Proxy requests initialize the logger with a component name on every client
 * creation. That must reuse the Pino transport instead of adding one process
 * exit listener per request.
 */

import { describe, expect, it } from "vitest";
import { initLogger } from "../../src/ai-powered/utils.js";

describe("module logger lifecycle", () => {
  it("reuses the transport when only the component name changes", () => {
    const initialExitListeners = process.listenerCount("exit");

    for (let index = 0; index < 25; index += 1) {
      initLogger({ debug: false, name: `logger-regression-${index}` });
    }

    expect(process.listenerCount("exit")).toBeLessThanOrEqual(initialExitListeners + 1);
  });
});
