/**
 * @file src/ai-powered/server/index.ts
 *
 * Express-based local proxy server for all ai-powered modalities.
 *
 * Middleware stack (in order):
 *   1. Pino HTTP request/response logger — structured JSON with masked keys
 *   2. Helmet — CSP, X-Content-Type-Options: nosniff, X-Frame-Options: DENY,
 *               Strict-Transport-Security on every response
 *   3. CORS — configurable origin (default http://localhost:5173)
 *   4. express-rate-limit — default 60 req/min, returns 429 on exceed
 *   5. express.json body parser — 10 MB limit
 *   6. API routes from server/routes.ts (Zod-validated per route)
 *   7. Centralised error handler:
 *        BudgetExceededError          → 402
 *        AllProvidersExhaustedError   → 503
 *        everything else              → 500
 *
 * Start-up log: "ai-powered proxy server listening on :<PORT>"
 */

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { BudgetExceededError, AllProvidersExhaustedError } from "../types.js";
import { getLogger, initLogger } from "../utils.js";
import { createRouter } from "./routes.js";
import type { AiConfig } from "../index.js";

// ---------------------------------------------------------------------------
// Server options
// ---------------------------------------------------------------------------

export interface ServeOptions {
  /** TCP port to listen on. Default: 3001 */
  port?: number;
  /** Network interface to bind. Default: 127.0.0.1 */
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
  // is explicitly enabling debug mode.  If the CLI preAction hook already
  // configured the logger, this is a no-op for the common case (no logFile,
  // debug === false/undefined).
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

  /**
   * Test whether a request origin matches a configured pattern.
   * Supports exact matches and glob-style wildcards where `*` matches any
   * single hostname segment (e.g. `https://*.ngrok-free.dev` matches
   * `https://contorted-jarrod-supersecure.ngrok-free.dev`).
   */
  function originMatchesPattern(origin: string, pattern: string): boolean {
    if (pattern === origin) return true;
    if (!pattern.includes("*")) return false;
    // Escape all regex special chars except `*`, then convert `*` → `[^.]+`
    // so one wildcard covers exactly one hostname label (not dots).
    const regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+");
    return new RegExp(`^${regexStr}$`).test(origin);
  }

  // Build a cors origin handler that also accepts `null` (file:// URLs) and
  // normalised arrays of allowed origins.  Each entry in the list may be an
  // exact origin string or a glob pattern containing `*`.
  const corsOriginOption: cors.CorsOptions["origin"] = (requestOrigin, callback) => {
    // requestOrigin is undefined for same-origin or non-browser requests;
    // it is the string "null" when the page is opened as a file:// URL.
    if (!requestOrigin || requestOrigin === "null") {
      return callback(null, true);
    }
    if (configuredOrigin === "*") {
      return callback(null, true);
    }
    const allowed = Array.isArray(configuredOrigin) ? configuredOrigin : [configuredOrigin];
    if (allowed.some((pattern) => originMatchesPattern(requestOrigin, pattern))) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin '${requestOrigin}' is not allowed`));
  };

  // 1. Helmet — security headers on every response
  app.use(
    helmet({
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
    }),
  );

  // 1a. COOP / COEP — required for SharedArrayBuffer to be available in the
  //     browser.  These must be set on every response from this server so that
  //     the web demo page runs in a cross-origin isolated context, which is a
  //     prerequisite for ffmpeg.wasm's multi-threaded mode (batch combined video).
  //
  //     Cross-Origin-Opener-Policy: same-origin
  //       Prevents the page from sharing a browsing context group with
  //       cross-origin popups, isolating it from side-channel attacks.
  //
  //     Cross-Origin-Embedder-Policy: require-corp
  //       Ensures every cross-origin sub-resource the page embeds declares
  //       CORP / CORS permission, which completes the isolation requirement.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  });

  // 2. CORS
  app.use(cors({ origin: corsOriginOption }));

  // 3. Rate limiter — 429 on exceed
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: rpm,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests — rate limit exceeded.", code: "RATE_LIMITED" },
    }),
  );

  // 4. Body parser
  app.use(express.json({ limit: "10mb" }));

  // 5. Pino HTTP request/response logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          ms: Date.now() - start,
        },
        "request",
      );
    });
    next();
  });

  // 6. API routes (Zod-validated, all errors propagate to handler below)
  app.use("/", createRouter(opts));

  // 7. Centralised error handler — maps domain errors to HTTP status codes.
  //    Express requires exactly 4 parameters for error-handling middleware.

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BudgetExceededError) {
      logger.warn({ code: "BUDGET_EXCEEDED" }, err.message);
      res.status(402).json({ error: err.message, code: "BUDGET_EXCEEDED" });
      return;
    }
    if (err instanceof AllProvidersExhaustedError) {
      logger.error({ code: "ALL_PROVIDERS_EXHAUSTED" }, err.message);
      res.status(503).json({ error: err.message, code: "ALL_PROVIDERS_EXHAUSTED" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, message);
    res.status(500).json({ error: message });
  });

  return app;
}

/**
 * Start the server, bind to the configured host/port, and log the listening
 * address.  The returned Promise resolves once the server is listening.
 */
export function startServer(opts: ServeOptions = {}): Promise<void> {
  const port = opts.port ?? 3001;
  const host = opts.host ?? "127.0.0.1";
  const app = createServer(opts);
  return new Promise((resolve) => {
    app.listen(port, host, () => {
      getLogger().info(`ai-powered proxy server listening on :${port}`);
      resolve();
    });
  });
}
