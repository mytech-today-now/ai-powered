/**
 * CORS transport-policy matrix.
 *
 * These are raw Node `http` requests, not a real browser. They verify the
 * protocol-level condition that determines whether a browser can read the
 * response: the presence or absence of Access-Control-Allow-Origin. Caller
 * authentication is tested separately where noted.
 */

import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../src/ai-powered/server/index.js";

interface ResponseRecord {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function listen(
  app: ReturnType<typeof createServer>,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<ResponseRecord> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }),
          ...headers,
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: responseBody,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("CORS origin policy", () => {
  let exactServer: http.Server;
  let exactPort: number;
  let wildcardServer: http.Server;
  let wildcardPort: number;
  let forwardedServer: http.Server;
  let forwardedPort: number;
  let authServer: http.Server;
  let authPort: number;

  beforeAll(async () => {
    ({ server: exactServer, port: exactPort } = await listen(
      createServer({ mock: true, corsOrigin: "https://app.example.test" }),
    ));
    ({ server: wildcardServer, port: wildcardPort } = await listen(
      createServer({ mock: true, corsOrigin: "https://*.example.test" }),
    ));
    ({ server: forwardedServer, port: forwardedPort } = await listen(
      createServer({ mock: true, corsOrigin: "https://127.0.0.1:*" }),
    ));
    ({ server: authServer, port: authPort } = await listen(
      createServer({
        mock: true,
        auth: { required: true },
        corsOrigin: "https://trusted.example.test",
      }),
    ));
  });

  afterAll(async () => {
    await Promise.all(
      [exactServer, wildcardServer, forwardedServer, authServer].map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it("allows an exact configured origin", async () => {
    const response = await request(exactPort, "GET", "/health", {
      Origin: "https://app.example.test",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.test");
  });

  it("allows one hostname label for a configured wildcard pattern", async () => {
    const response = await request(wildcardPort, "GET", "/health", {
      Origin: "https://preview.example.test",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://preview.example.test");
  });

  it("does not allow a wildcard pattern to span multiple hostname labels", async () => {
    const response = await request(wildcardPort, "GET", "/health", {
      Origin: "https://preview.eu.example.test",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each([
    ["wrong host", "https://other.example.test"],
    ["wrong scheme", "http://app.example.test"],
    ["null", "null"],
    ["malformed", "not-an-origin"],
  ])("does not grant readable CORS access for %s", async (_label, origin) => {
    const response = await request(exactPort, "GET", "/health", { Origin: origin });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not treat a missing Origin as same-origin or CORS-allowed", async () => {
    const response = await request(exactPort, "GET", "/health");

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("uses X-Forwarded-Proto for same-origin requests behind TLS", async () => {
    const sameOrigin = `https://127.0.0.1:${forwardedPort}`;
    const sameOriginResponse = await request(forwardedPort, "GET", "/health", {
      Origin: sameOrigin,
      "X-Forwarded-Proto": "https",
    });
    const directHttpResponse = await request(forwardedPort, "GET", "/health", {
      Origin: sameOrigin,
    });

    expect(sameOriginResponse.statusCode).toBe(200);
    expect(sameOriginResponse.headers["access-control-allow-origin"]).toBeUndefined();
    expect(directHttpResponse.headers["access-control-allow-origin"]).toBe(sameOrigin);
  });

  it("does not expose a protected response to a null-origin caller", async () => {
    const response = await request(authPort, "GET", "/config", { Origin: "null" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.body).toContain("Authentication required.");
  });

  it("keeps missing-origin authorization independent from CORS", async () => {
    const response = await request(authPort, "GET", "/config");

    expect(response.statusCode).toBe(401);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.body).toContain("Authentication required.");
  });
});
