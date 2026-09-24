/**
 * @file src/ai-powered/server/index.ts
 *
 * Express-based proxy server for all ai-powered modalities.
 *
 * Middleware stack (in order):
 *   1. Pino HTTP request/response logger — structured JSON with masked keys
 *   2. Helmet — X-Content-Type-Options: nosniff, X-Frame-Options: DENY,
 *               Strict-Transport-Security on every response
 *   3. CORS — configurable origin (default http://localhost:5173)
 *   4. Caller authentication — before rate limiting, body parsing, or routes
 *   5. express-rate-limit — default 60 req/min, principal-aware when authed
 *   6. express.json body parser — configurable resource-policy limit
 *   7. API routes from server/routes.ts (Zod-validated per route)
 *   8. Centralised error handler:
 *        BudgetExceededError          → 402
 *        AllProvidersExhaustedError   → 503
 *        everything else              → 500
 *
 * Health, preflight, and static browser assets remain public by decision in
 * server/auth.ts. Provider, upload, file, and operational routes require an
 * authenticated caller in normal (including mock) server runs.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Server } from "node:http";
import { BudgetExceededError } from "../types.js";
import { getLogger, initLogger } from "../utils.js";
import { createRouter, shouldServeAppShell } from "./routes.js";
import { authenticateProxyRequest, proxyAuthDecision, TEST_BYPASS_PRINCIPAL_ID } from "./auth.js";
import {
  createResourcePolicy,
  isRequestBodyTooLargeError,
  requestBodyLimitError,
  ResourcePolicyError,
  type ResourceLimitOptions,
  type ResourcePolicy,
} from "./resource-policy.js";
import type { AiConfig } from "../index.js";
import {
  createRequestId,
  getRequestId,
  sendPublicError,
  serializeErrorForLog,
} from "./error-contract.js";

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface ServeOptions {
  /** TCP port to listen on. Default: 3001 locally, or the deployment PORT when hosted. */
  port?: number;
  /** Network interface to bind. Default: 127.0.0.1 locally. */
  host?: string;
  /**
   * Allowed CORS origin(s). Default: http://localhost:5173
   * Pass an array to allow multiple origins.
   * Pass "*" to allow any origin (development only).
   */
  corsOrigin?: string | string[];
  /** Max requests per minute before 429. Default: 60 */
  rateLimit?: number;
  /** Force MockProvider for all requests (no API calls). Default: false */
  mock?: boolean;
  /** Named config profile to activate. */
  profile?: string;
  /** If set, append structured logs to this JSONL file path. */
  logFile?: string;
  /** Enable debug-level logging. Default: false */
  debug?: boolean;
  /** Deep-merged on top of the resolved config for every request. */
  configOverrides?: Partial<AiConfig>;
  /** Authentication controls. Authentication is required by default. */
  auth?: { required?: boolean };
  /** Resource budgets for buffered JSON and native stitch processing. */
  resourceLimits?: ResourceLimitOptions;
}

export interface ResolvedServeBinding {
  port: number;
  host: string;
}

const activeServers = new Set<Server>();

function parsePortValue(value: string | undefined, source: string): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${source} value "${value}". Expected a non-negative integer.`);
  }
  return parsed;
}

export function resolveServeBinding(
  opts: Pick<ServeOptions, "host" | "port"> = {},
  env: Partial<Pick<NodeJS.ProcessEnv, "HOST" | "PORT">> = process.env,
): ResolvedServeBinding {
  const explicitPort = opts.port;
  if (explicitPort !== undefined && (!Number.isInteger(explicitPort) || explicitPort < 0)) {
    throw new Error(
      `Invalid port value "${String(explicitPort)}". Expected a non-negative integer.`,
    );
  }

  const envPort = parsePortValue(env.PORT, "PORT");
  const envHost = env.HOST?.trim();
  const port = explicitPort ?? envPort ?? 3001;
  const host = opts.host?.trim() || envHost || (envPort !== undefined ? "0.0.0.0" : "127.0.0.1");
  return { port, host };
}

function isExplicitTestBypass(opts: ServeOptions): boolean {
  return (
    opts.auth?.required !== true &&
    (process.env["VITEST"] === "true" ||
      (opts.mock === true &&
        process.env["NODE_ENV"] === "test" &&
        process.env["AIPOWERED_PROXY_TEST_BYPASS"] === "true"))
  );
}

/** Keep file UUIDs and provider capabilities out of ordinary request logs. */
function safeRequestLogPath(req: Request): string {
  return req.path === "/files/provider" || req.path.startsWith("/files/")
    ? "/files/[redacted]"
    : req.path;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build and return the Express application without starting to listen.
 * Useful for integration tests that call `app.listen()` themselves.
 */
export function createServer(opts: ServeOptions = {}): express.Express {
  // Re-initialise the logger only when the server has its own log-file path or
  // is explicitly enabling debug mode. If the CLI preAction hook already
  // configured the logger, this is a no-op for the common case.
  if (opts.logFile !== undefined || opts.debug === true) {
    initLogger({
      debug: opts.debug ?? false,
      ...(opts.logFile !== undefined ? { logFile: opts.logFile } : {}),
    });
  }
  const logger = getLogger();

  const app = express();
  const configuredOrigin = opts.corsOrigin ?? "http://localhost:5173";
  const rpm = opts.rateLimit ?? 60;
  const resourcePolicy: ResourcePolicy = createResourcePolicy(opts.resourceLimits);

  // Establish one bounded correlation identifier before any middleware can
  // reject the request. It is returned as a header for every response and is
  // included in serialized JSON errors.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = createRequestId(req.get("X-Request-ID") ?? req.get("X-Correlation-ID"));
    res.locals["requestId"] = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  });

  /** Test whether a request origin matches a configured pattern. */
  function originMatchesPattern(origin: string, pattern: string): boolean {
    if (pattern === origin) return true;
    if (!pattern.includes("*")) return false;
    // Escape all regex special chars except `*`, then convert `*` → `[^.]+`
    // so one wildcard covers exactly one hostname label (not dots).
    const regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+");
    return new RegExp(`^${regexStr}$`).test(origin);
  }

  // Build a CORS origin handler for configured trusted origins. `false` is
  // deliberate for missing, null, malformed, and untrusted origins: the
  // request may still be handled by the server, but the browser receives no
  // readable cross-origin response. CORS never replaces caller auth.
  const corsOriginOption: cors.CorsOptions["origin"] = (requestOrigin, callback) => {
    // An absent Origin is normal for non-browser clients and must not be
    // treated as proof of same-origin access. A file:// page or sandboxed
    // document sends the literal string "null" and is never allowlisted.
    if (!requestOrigin || requestOrigin === "null") {
      return callback(null, false);
    }

    // Browser origins are serialized HTTP(S) origins. Reject malformed
    // values before consulting an explicit wildcard configuration.
    try {
      const origin = new URL(requestOrigin);
      if (
        (origin.protocol !== "http:" && origin.protocol !== "https:") ||
        origin.origin !== requestOrigin
      ) {
        return callback(null, false);
      }
    } catch {
      return callback(null, false);
    }

    if (configuredOrigin === "*") {
      return callback(null, true);
    }
    const allowed = Array.isArray(configuredOrigin) ? configuredOrigin : [configuredOrigin];
    if (allowed.some((pattern) => originMatchesPattern(requestOrigin, pattern))) {
      return callback(null, true);
    }
    // Do not reflect the rejected origin in an error response. Passing false
    // leaves the route and its independent authentication policy in control,
    // while the browser cannot read the response without ACAO.
    callback(null, false);
  };

  function isSameOriginRequest(req: Request): boolean {
    const requestOrigin = req.get("Origin");
    const requestHost = req.get("Host");
    if (!requestOrigin || !requestHost) return false;

    try {
      const origin = new URL(requestOrigin);
      const forwardedProtocol = req.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
      const requestProtocol = forwardedProtocol || req.protocol;
      return origin.host === requestHost && origin.protocol === `${requestProtocol}:`;
    } catch {
      return false;
    }
  }

  // 1. Helmet — security headers on every response.
  // The app shell sets its own page-scoped CSP in server/routes.ts.
  const strictHelmetMiddleware = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // noSniff, frameguard (DENY), and hsts are enabled by default in helmet.
  });
  const relaxedHelmetMiddleware = helmet({
    contentSecurityPolicy: false,
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const middleware = shouldServeAppShell(req.path)
      ? relaxedHelmetMiddleware
      : strictHelmetMiddleware;
    middleware(req, res, next);
  });

  // COOP / COEP — required for SharedArrayBuffer and ffmpeg.wasm.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  });

  // CORS is transport policy only. It never satisfies caller authentication.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isSameOriginRequest(req)) {
      next();
      return;
    }
    cors({ origin: corsOriginOption })(req, res, next);
  });

  // Authenticate before rate limiting, body parsing, provider work, uploads,
  // or file reads. OPTIONS remains public for browser preflight requests.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const decision = proxyAuthDecision(req);
    if (decision.public) {
      next();
      return;
    }
    if (isExplicitTestBypass(opts)) {
      req.aiPrincipal = {
        id: TEST_BYPASS_PRINCIPAL_ID,
        credentialType: "global",
        unrestricted: true,
        scopes: [],
      };
      next();
      return;
    }
    void authenticateProxyRequest(req, res, next, decision);
  });

  // Rate limits are keyed by authenticated principal when available.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: rpm,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.aiPrincipal?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
      message: { error: "Too many requests — rate limit exceeded.", code: "RATE_LIMITED" },
    }),
  );

  // The parser ceiling is deliberately below the old 200 MB limit. Route
  // handlers apply decoded and output budgets after parsing without copying the
  // already-buffered request body.
  app.use(express.json({ limit: resourcePolicy.limits.maxJsonBodyBytes }));

  // Pino HTTP request/response logger. Raw credentials are never logged.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          url: safeRequestLogPath(req),
          status: res.statusCode,
          ms: Date.now() - start,
          requestId: getRequestId(res),
          ...(req.aiPrincipal
            ? {
                principalId: req.aiPrincipal.id,
                credentialType: req.aiPrincipal.credentialType,
              }
            : {}),
        },
        "request",
      );
    });
    next();
  });

  // API routes (Zod-validated, all errors propagate to handler below).
  app.use("/", createRouter(opts, resourcePolicy));

  // Centralised error handler — Express requires exactly 4 parameters.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isRequestBodyTooLargeError(err)) {
      const limitError = requestBodyLimitError();
      logger.warn(
        { requestId: getRequestId(res), error: serializeErrorForLog(limitError) },
        "Proxy request rejected by body limit",
      );
      sendPublicError(res, limitError);
      return;
    }
    if (err instanceof ResourcePolicyError && err.code === "REQUEST_ABORTED") {
      return;
    }
    if (res.headersSent) {
      logger.error(
        { requestId: getRequestId(res), error: serializeErrorForLog(err) },
        "Proxy request failed after response started",
      );
      return;
    }
    const publicError = sendPublicError(res, err);
    const logLevel =
      err instanceof ResourcePolicyError || err instanceof BudgetExceededError ? "warn" : "error";
    logger[logLevel](
      {
        requestId: publicError.body.requestId,
        publicCode: publicError.body.code,
        status: publicError.statusCode,
        error: serializeErrorForLog(err),
      },
      "Proxy request failed",
    );
  });

  return app;
}

/** Start the server, bind to the configured host/port, and log the address. */
export function startServer(opts: ServeOptions = {}): Promise<void> {
  const { port, host } = resolveServeBinding(opts);
  const app = createServer(opts);
  return new Promise<void>((resolve, reject) => {
    let server: Server | undefined;
    let settled = false;

    const cleanup = (): void => {
      server?.off("listening", onListening);
      server?.off("error", onError);
    };

    const onListening = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      getLogger().info(`ai-powered proxy server listening on :${port}`);
      resolve();
    };

    const onError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (server) activeServers.delete(server);
      reject(error);
    };

    try {
      server = app.listen(port, host);
      activeServers.add(server);
      server.once("listening", onListening);
      server.once("error", onError);
    } catch (error) {
      settled = true;
      cleanup();
      if (server) activeServers.delete(server);
      reject(error);
    }
  });
}

/** Close a started server, or all servers started through startServer in tests. */
export function closeServer(server?: Server): Promise<void> {
  const servers = server ? [server] : [...activeServers];
  for (const activeServer of servers) activeServers.delete(activeServer);

  return Promise.all(
    servers.map(
      (activeServer) =>
        new Promise<void>((resolve, reject) => {
          if (!activeServer.listening) {
            resolve();
            return;
          }
          activeServer.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  ).then(() => undefined);
}
