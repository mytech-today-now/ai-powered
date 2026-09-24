/**
 * Caller authentication for the HTTP proxy.
 *
 * This adapter deliberately reuses the credential hierarchy in ../auth.ts:
 *   Authorization: Bearer <RS256 agent JWT>
 *   X-AI-Agent-Key: <verified agent API key>
 *   X-AI-API-Key: <AIPOWERED_API_KEY service key>
 *
 * Provider credentials are intentionally not accepted as proxy credentials.
 * They identify an upstream provider, not the caller using this service.
 */

import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { resolveCredential } from "../auth.js";
import { AiPoweredError } from "../errors.js";
import type { ResolvedCredential } from "../auth.js";

export interface ProxyPrincipal {
  /** Stable non-secret identity used for request attribution and rate limits. */
  readonly id: string;
  readonly credentialType: ResolvedCredential["type"];
  readonly unrestricted: boolean;
  readonly scopes: readonly string[];
}

/** Identity used only by Vitest's explicit mock-server bypass. */
export const TEST_BYPASS_PRINCIPAL_ID = "test-bypass";

declare global {
  namespace Express {
    interface Request {
      aiPrincipal?: ProxyPrincipal;
    }
  }
}

export type ProxyAuthDecision = { public: true } | { public: false; scope?: string };

/**
 * Return the scope required by a protected proxy request.
 *
 * `generate` covers provider-consuming routes. File upload/download uses its
 * own scopes, while read-only operational routes use `read`. The service-level
 * credential is unrestricted, as it represents the existing global service
 * identity from auth.ts.
 */
export function proxyAuthDecision(req: Pick<Request, "method" | "path">): ProxyAuthDecision {
  if (req.method === "OPTIONS") return { public: true };
  if (req.method === "GET" && req.path === "/health") return { public: true };

  // The shell and its static assets are intentionally public so a browser can
  // load the UI before it has a caller credential. API and file paths do not
  // match these rules and remain protected.
  if (
    req.method === "GET" &&
    (req.path === "/" ||
      req.path === "/index.html" ||
      req.path === "/info.html" ||
      req.path === "/config.html" ||
      req.path.startsWith("/dist-web/") ||
      req.path.startsWith("/.well-known/") ||
      (!req.path.startsWith("/files/") && /\.[A-Za-z0-9]+$/.test(req.path)))
  ) {
    return { public: true };
  }

  if (req.path === "/upload" || req.path.startsWith("/upload/")) {
    return { public: false, scope: "files:write" };
  }
  // Provider capabilities are self-authenticating, short-lived URLs. The
  // route still verifies the signature and purpose before returning bytes.
  if (req.method === "GET" && req.path === "/files/provider") {
    return { public: true };
  }
  if (req.path.startsWith("/files/")) {
    return { public: false, scope: req.method === "DELETE" ? "files:write" : "files:read" };
  }
  if (
    req.path === "/text" ||
    req.path === "/stream" ||
    req.path === "/image" ||
    req.path.startsWith("/audio/") ||
    req.path === "/video" ||
    req.path === "/music" ||
    req.path === "/structured" ||
    req.path === "/batch" ||
    req.path === "/stitch" ||
    req.path.startsWith("/v1/")
  ) {
    return { public: false, scope: "generate" };
  }
  return { public: false, scope: "read" };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function authFailure(
  res: Response,
  status: 401 | 403,
  code: "AUTH_MISSING" | "AUTH_INVALID_TOKEN" | "AUTH_INVALID_KEY" | "AUTH_INSUFFICIENT_SCOPE",
): void {
  const message =
    status === 403 ? "Authenticated caller lacks the required scope." : "Authentication required.";
  res.status(status).json({ error: message, code });
}

function normalizePrincipalId(credential: ResolvedCredential): string {
  const raw = credential.agentId?.trim();
  if (raw && /^[A-Za-z0-9._:-]{1,128}$/.test(raw)) return raw;
  return `${credential.type}:unknown`;
}

function hasScope(principal: ProxyPrincipal, requiredScope: string | undefined): boolean {
  // Only the explicitly marked service identity is unrestricted. Agent
  // credentials with missing or invalid scopes fail closed.
  if (principal.unrestricted) return true;
  return requiredScope !== undefined && principal.scopes.includes(requiredScope);
}

/**
 * Authenticate a request using the existing agent credential hierarchy.
 * This middleware does not parse a body and should run before body parsing or
 * provider/file routes.
 */
export async function authenticateProxyRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  decision: ProxyAuthDecision,
): Promise<void> {
  if (decision.public) {
    next();
    return;
  }

  const authorization = req.get("Authorization");
  const agentKey = req.get("X-AI-Agent-Key");
  const serviceKey = req.get("X-AI-API-Key");
  const supplied = [authorization, agentKey, serviceKey].filter(
    (value): value is string => value !== undefined,
  );
  if (supplied.length > 1) {
    authFailure(res, 401, "AUTH_INVALID_TOKEN");
    return;
  }

  try {
    let credential: ResolvedCredential;
    if (authorization !== undefined) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      if (!match || !match[1]) {
        authFailure(res, 401, "AUTH_INVALID_TOKEN");
        return;
      }
      credential = await resolveCredential({ agentToken: match[1] } as never);
    } else if (agentKey !== undefined) {
      if (!agentKey.trim()) {
        authFailure(res, 401, "AUTH_INVALID_KEY");
        return;
      }
      credential = await resolveCredential({ agentApiKey: agentKey } as never);
    } else if (serviceKey !== undefined) {
      const expected = process.env["AIPOWERED_API_KEY"];
      if (!expected || !constantTimeEqual(serviceKey, expected)) {
        authFailure(res, 401, "AUTH_INVALID_KEY");
        return;
      }
      credential = { type: "global", unrestricted: true, agentId: "service", scopes: [] };
    } else {
      authFailure(res, 401, "AUTH_MISSING");
      return;
    }

    const principal: ProxyPrincipal = {
      id: normalizePrincipalId(credential),
      credentialType: credential.type,
      unrestricted: credential.unrestricted,
      scopes: [...credential.scopes],
    };
    if (!hasScope(principal, decision.scope)) {
      authFailure(res, 403, "AUTH_INSUFFICIENT_SCOPE");
      return;
    }
    req.aiPrincipal = principal;
    next();
  } catch (err) {
    // Auth libraries can throw structured errors or validation errors for
    // malformed server configuration. Never reflect their detail or a token.
    const code = err instanceof AiPoweredError ? err.code : "AUTH_INVALID_KEY";
    if (code === "AUTH_INVALID_TOKEN") {
      authFailure(res, 401, code);
    } else if (code === "AUTH_INSUFFICIENT_SCOPE") {
      authFailure(res, 403, code);
    } else if (code === "AUTH_MISSING") {
      authFailure(res, 401, code);
    } else {
      authFailure(res, 401, code === "AUTH_INVALID_KEY" ? code : "AUTH_INVALID_KEY");
    }
  }
}
