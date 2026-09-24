/**
 * @file tests/server/startup-lifecycle.test.ts
 *
 * Regression coverage for server bind settlement and test cleanup.
 */

import { createServer as createNetServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLogger } from "../../src/ai-powered/utils.js";
import { closeServer, startServer } from "../../src/ai-powered/server/index.js";

async function reservePort(): Promise<{ server: Server; port: number }> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Port reservation did not produce a numeric address.");
  }
  return { server, port: address.port };
}

async function expectStartupRejectsPromptly(startup: Promise<void>): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      startup.then(
        () => {
          throw new Error("Expected server startup to reject.");
        },
        (error: unknown) => error,
      ),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Server startup did not settle promptly.")),
          1000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

afterEach(async () => {
  await closeServer();
});

describe("server startup lifecycle", () => {
  it("rejects promptly with the original occupied-port error", async () => {
    const reservation = await reservePort();
    const infoSpy = vi.spyOn(getLogger(), "info");

    try {
      const error = await expectStartupRejectsPromptly(
        startServer({ host: "127.0.0.1", port: reservation.port, mock: true }),
      );
      expect(error).toMatchObject({ code: "EADDRINUSE" });
      expect(infoSpy).not.toHaveBeenCalledWith(
        `ai-powered proxy server listening on :${reservation.port}`,
      );
    } finally {
      infoSpy.mockRestore();
      await closeServer(reservation.server);
    }
  });

  it("rejects promptly for an invalid host", async () => {
    const error = await expectStartupRejectsPromptly(
      startServer({ host: "256.256.256.256", port: 0, mock: true }),
    );
    expect(error).toMatchObject({ code: expect.any(String) });
  });

  it("logs only after listening and closes successfully", async () => {
    const infoSpy = vi.spyOn(getLogger(), "info");

    try {
      const startup = startServer({ host: "127.0.0.1", port: 0, mock: true });
      expect(infoSpy).not.toHaveBeenCalledWith("ai-powered proxy server listening on :0");
      await startup;
      expect(infoSpy).toHaveBeenCalledWith("ai-powered proxy server listening on :0");
      await expect(closeServer()).resolves.toBeUndefined();
      await expect(closeServer()).resolves.toBeUndefined();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("supports repeated startup and cleanup without retaining a prior listener", async () => {
    await startServer({ host: "127.0.0.1", port: 0, mock: true });
    await closeServer();

    await expect(startServer({ host: "127.0.0.1", port: 0, mock: true })).resolves.toBeUndefined();
    await expect(closeServer()).resolves.toBeUndefined();
  });
});
