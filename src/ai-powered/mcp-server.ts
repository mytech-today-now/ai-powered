/**
 * @file src/ai-powered/mcp-server.ts
 *
 * MCP Tool Server entry point for the ai-powered filmbuff agent integration.
 *
 * Exposes all ai-powered functions as Model Context Protocol (MCP) tools via a
 * standalone server conforming to MCP specification 2025-11-25.  Supports both
 * `stdio` and HTTP (`StreamableHTTP`) transports (D5 — separate entry point).
 * HTTP binds to loopback by default; remote exposure is an explicit opt-in.
 *
 * Tool manifest (6 tools):
 *   generate_single_shot  submit_single_shot  poll_shot_job
 *   fund_agent_account    get_credit_balance  list_providers
 *
 * Spec: openspec/changes/filmbuff-ai-powered/specs/mcp-server/spec.md
 *       REQ-MCP-01 … REQ-MCP-09
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { generateSingleShot, submitSingleShot, pollShotJob } from "./single-shot.js";
import type { SingleShotOptions } from "./single-shot.js";
import { fundAgentAccount } from "./payments.js";
import { requireAuthEndpoint } from "./env.js";

// ---------------------------------------------------------------------------
// Canonical provider catalogue (list_providers — REQ-MCP-04)
// ---------------------------------------------------------------------------

/** Provider entry returned by the `list_providers` MCP tool. */
interface ProviderEntry {
  id: string;
  displayName: string;
  creditCostPerSecond: number;
  available: boolean;
}

/** Canonical list_providers response (spec §52-62). */
const PROVIDERS: readonly ProviderEntry[] = [
  { id: "runway-gen3", displayName: "Runway Gen-3", creditCostPerSecond: 1.25, available: true },
  { id: "pika-2", displayName: "Pika 2.0", creditCostPerSecond: 1.0, available: true },
  { id: "kling-1.6", displayName: "Kling 1.6", creditCostPerSecond: 0.75, available: true },
];

// ---------------------------------------------------------------------------
// Job subscription registry (bd-krxs / REQ-MCP-07)
// ---------------------------------------------------------------------------

/**
 * Tracks which `ai-powered://jobs/{jobId}` URIs have active MCP subscribers.
 *
 * Populated by the `resources/subscribe` protocol handler; cleared (one-shot)
 * when `sendResourceUpdated` is dispatched after job completion.
 *
 * This is a module-level singleton so both `registerTools` and
 * `registerResources` share the same state without coupling.
 *
 * Exported for test tear-down: `_clearJobSubscriptions()`.
 */
const jobSubscriptions = new Set<string>();

/** Test helper: clear all active job subscriptions. */
export function _clearJobSubscriptions(): void {
  jobSubscriptions.clear();
}

// ---------------------------------------------------------------------------
// Bearer auth middleware (bd-sqnu / REQ-MCP-06)
// Exported for unit testing (T-FB-14) without starting the full HTTP server.
// ---------------------------------------------------------------------------

/**
 * Express middleware that enforces `Authorization: Bearer <authToken>` on
 * every request.  Missing or incorrect tokens return HTTP 401 with a JSON
 * body matching the spec error format (REQ-MCP-06 / T-FB-14).
 *
 * @param authToken  Expected token value (raw; matched verbatim after "Bearer ").
 */
export function createBearerAuthMiddleware(
  authToken: string,
): (req: Request, res: Response, next: NextFunction) => void {
  const expected = `Bearer ${authToken}`;
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || header !== expected) {
      res.status(401).json({ error: "Missing or invalid Authorization: Bearer token" });
      return;
    }
    next();
  };
}

const HTTP_LOOPBACK_HOST = "127.0.0.1";
const HTTP_REMOTE_HOST = "0.0.0.0";

// ---------------------------------------------------------------------------
// Tool registration (bd-kv45 / REQ-MCP-01, REQ-MCP-02)
// Exported so tests can register tools on an in-memory server without
// starting the full stdio / HTTP transport (T-FB-11, T-FB-12, T-FB-13).
// ---------------------------------------------------------------------------

/**
 * Registers all 6 MCP tools on the provided `McpServer` instance.
 *
 * Each tool has:
 *  - A human-readable `description`
 *  - An `inputSchema` (Zod shape → auto-converted to JSON Schema with `required` array)
 *  - A `tools/call` handler (bd-x26x) returning `{ content: [{ type:"text", text: JSON }] }`
 *
 * REQ-MCP-01: exactly 6 tools are registered.
 * REQ-MCP-02: each tool has a complete inputSchema.
 */
export function registerTools(server: McpServer): void {
  // ── 1. generate_single_shot ─────────────────────────────────────────────
  server.registerTool(
    "generate_single_shot",
    {
      description:
        "Generate a single video shot synchronously. Returns a SingleShotResult with " +
        "status, clipPath, and creditsCharged.",
      inputSchema: {
        shot: z
          .object({
            id: z.string().describe("Client-assigned shot identifier for idempotency/logging"),
            prompt: z.string().describe("Text prompt describing the desired video content"),
            durationSeconds: z.number().describe("Desired video duration in seconds"),
          })
          .describe("Shot descriptor"),
        provider: z
          .string()
          .describe("Target provider: runway-gen3, runway-gen4, lumaai, venice, mock"),
        outputPath: z.string().describe("Filesystem path where the completed clip will be written"),
        agentToken: z.string().optional().describe("RS256 JWT Bearer token for agent identity"),
        agentApiKey: z.string().optional().describe("Raw API key prefixed fb_sk_ or ap_sk_"),
        agentId: z.string().optional().describe("Informational agent label for audit logs"),
        callbackUrl: z
          .string()
          .optional()
          .describe("Webhook URL for async job-completion notifications"),
        idempotencyKey: z.string().optional().describe("Client-supplied deduplication key"),
        agentPaymentMethodId: z
          .string()
          .optional()
          .describe("Stripe pm_* token for auto-top-up on INSUFFICIENT_CREDITS"),
      },
    },
    async (args) => {
      try {
        const result = await generateSingleShot(args as SingleShotOptions);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    },
  );

  // ── 2. submit_single_shot ───────────────────────────────────────────────
  server.registerTool(
    "submit_single_shot",
    {
      description:
        "Submit a single-shot video generation job asynchronously. Returns a jobId immediately. " +
        "Use poll_shot_job to retrieve the result.",
      inputSchema: {
        shot: z
          .object({
            id: z.string().describe("Client-assigned shot identifier"),
            prompt: z.string().describe("Text prompt describing the desired video content"),
            durationSeconds: z.number().describe("Desired video duration in seconds"),
          })
          .describe("Shot descriptor"),
        provider: z
          .string()
          .describe("Target provider: runway-gen3, runway-gen4, lumaai, venice, mock"),
        outputPath: z
          .string()
          .optional()
          .describe("Filesystem path for the output clip (written when job completes)"),
        agentToken: z.string().optional().describe("RS256 JWT Bearer token for agent identity"),
        agentApiKey: z.string().optional().describe("Raw API key prefixed fb_sk_ or ap_sk_"),
        idempotencyKey: z.string().optional().describe("Client-supplied deduplication key"),
      },
    },
    async (args) => {
      try {
        const opts: SingleShotOptions = {
          shot: args.shot,
          provider: args.provider,
          outputPath: args.outputPath ?? "",
          // Conditional spread avoids assigning explicit `undefined` to optional
          // fields under exactOptionalPropertyTypes (TypeScript strict mode).
          ...(args.agentToken !== undefined && { agentToken: args.agentToken }),
          ...(args.agentApiKey !== undefined && { agentApiKey: args.agentApiKey }),
          ...(args.idempotencyKey !== undefined && { idempotencyKey: args.idempotencyKey }),
        };
        const result = await submitSingleShot(opts);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    },
  );

  // ── 3. poll_shot_job ────────────────────────────────────────────────────
  server.registerTool(
    "poll_shot_job",
    {
      description:
        "Poll the status of a submitted shot job. Returns SingleShotResult. " +
        "If an MCP client has subscribed to ai-powered://jobs/{jobId} via resources/subscribe, " +
        "a notifications/resources/updated SSE event is sent when the job reaches a terminal state " +
        "(complete or failed). The client should then call resources/read to fetch the final status " +
        "(pull-after-push, MCP spec §8.3 / REQ-MCP-07).",
      inputSchema: {
        jobId: z.string().describe("Job identifier returned by submit_single_shot"),
        provider: z
          .string()
          .optional()
          .describe("Provider hint (future use; current impl uses jobId only)"),
        outputPath: z
          .string()
          .optional()
          .describe("Output path hint (future use; current impl uses jobId only)"),
        agentToken: z.string().optional().describe("RS256 JWT Bearer token for agent identity"),
        agentApiKey: z.string().optional().describe("Raw API key prefixed fb_sk_ or ap_sk_"),
      },
    },
    async (args) => {
      try {
        const result = await pollShotJob(args.jobId);

        // SSE push: notify subscribed clients when the job reaches a terminal state.
        // The MCP spec pull-after-push pattern (§8.3 / REQ-MCP-07 / AC-11):
        //   1. Client subscribed via resources/subscribe → URI is in jobSubscriptions.
        //   2. sendResourceUpdated fires notifications/resources/updated to the client.
        //   3. One-shot: subscription is removed so no duplicate notifications.
        //   4. Client receives the SSE event and calls resources/read for the result.
        //
        // `void … .catch()`: the notification is best-effort; a disconnected client
        // must not fail the tool call that triggered the notification.
        const uri = `ai-powered://jobs/${args.jobId}`;
        const isTerminal = result.status === "complete" || result.status === "failed";
        if (isTerminal && jobSubscriptions.has(uri)) {
          jobSubscriptions.delete(uri);
          void server.server.sendResourceUpdated({ uri }).catch(() => undefined); // silently ignore if client is no longer connected
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    },
  );

  // ── 4. fund_agent_account ───────────────────────────────────────────────
  server.registerTool(
    "fund_agent_account",
    {
      description:
        "Fund the agent account using a Stripe payment method token via stripe402. " +
        "Returns creditsGranted, newBalance, stripeChargeId, and optionally a paymentToken.",
      inputSchema: {
        stripePaymentMethodId: z.string().describe("Stripe pm_* payment method token"),
        creditAmount: z.number().describe("Credits to purchase (1 credit = $0.01)"),
        agentApiKey: z
          .string()
          .optional()
          .describe("Credits applied to this key's balance when supplied"),
        returnPaymentToken: z
          .boolean()
          .optional()
          .describe("If true, response includes a single-use X-Payment-Authorization token"),
      },
    },
    async (args) => {
      try {
        const result = await fundAgentAccount({
          stripePaymentMethodId: args.stripePaymentMethodId,
          creditAmount: args.creditAmount,
          ...(args.agentApiKey !== undefined && { agentApiKey: args.agentApiKey }),
          ...(args.returnPaymentToken !== undefined && {
            returnPaymentToken: args.returnPaymentToken,
          }),
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    },
  );

  // ── 5. get_credit_balance ───────────────────────────────────────────────
  server.registerTool(
    "get_credit_balance",
    {
      description:
        "Retrieve the current credit balance for the agent account from the FilmBuff platform.",
      inputSchema: {
        agentToken: z.string().optional().describe("RS256 JWT Bearer token for agent identity"),
        agentApiKey: z.string().optional().describe("Raw API key prefixed fb_sk_ or ap_sk_"),
      },
    },
    async (args) => {
      try {
        let endpoint: string;
        try {
          endpoint = requireAuthEndpoint();
        } catch {
          throw new Error("AIPOWERED_AUTH_ENDPOINT is not configured.");
        }
        const headers: Record<string, string> = {};
        if (args.agentToken) headers["Authorization"] = `Bearer ${args.agentToken}`;
        else if (args.agentApiKey) headers["X-Agent-Api-Key"] = args.agentApiKey;
        const res = await fetch(`${endpoint}/api/account/credits`, { headers });
        if (!res.ok) throw new Error(`Credit balance endpoint returned HTTP ${res.status}`);
        const data = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    },
  );

  // ── 6. list_providers ───────────────────────────────────────────────────
  server.registerTool(
    "list_providers",
    {
      description:
        "List supported video generation providers with credit cost per second. " +
        "Returns runway-gen3, pika-2, and kling-1.6.",
      inputSchema: {},
    },
    async () => {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ providers: PROVIDERS }) }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Resource registration (REQ-MCP-07)
// ---------------------------------------------------------------------------

/**
 * Registers the `ai-powered://jobs/{jobId}` MCP resource and enables SSE push
 * notifications for subscribers (bd-krxs / REQ-MCP-07 / AC-11).
 *
 * **Resource read**: Any MCP client can call `resources/read` with a
 * `ai-powered://jobs/<id>` URI to get the current job status as JSON.
 *
 * **SSE push** (subscribe → notify):
 * 1. Client sends `resources/subscribe { uri: "ai-powered://jobs/<id>" }`.
 * 2. Server records the subscription in `jobSubscriptions`.
 * 3. When the `poll_shot_job` tool handler receives a terminal result
 *    (`complete` or `failed`), it calls `server.server.sendResourceUpdated`
 *    which emits a `notifications/resources/updated` SSE frame to the client.
 * 4. Client receives the SSE event and calls `resources/read` to fetch
 *    the final status (pull-after-push pattern per MCP spec §8.3).
 * 5. Subscription is one-shot: it is removed after the notification fires.
 *
 * Subscription capability is declared via `server.server.registerCapabilities`
 * before any transport connects so the MCP handshake advertises it correctly.
 */
export function registerResources(server: McpServer): void {
  // ── 1. Declare subscription support in MCP capabilities (REQ-MCP-07) ─────
  // Must be called before server.connect() so the capability appears in the
  // server's initialization response.  registerCapabilities() merges with any
  // capabilities already declared by registerResource() calls.
  server.server.registerCapabilities({ resources: { subscribe: true } });

  // ── 2. Register the readable resource template ────────────────────────────
  const template = new ResourceTemplate("ai-powered://jobs/{jobId}", { list: undefined });

  server.registerResource(
    "job-status",
    template,
    {
      // `name` is the first positional argument; ResourceMetadata only has `description`.
      description:
        "Current status of a submitted shot job. Subscribe via resources/subscribe to receive " +
        "an SSE push notification when the job transitions to `complete` or `failed`.",
    },
    async (uri: URL) => {
      const jobId = uri.pathname.replace(/^\/+/, "");
      let text: string;
      try {
        const result = await pollShotJob(jobId);
        text = JSON.stringify(result);
      } catch (err) {
        text = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  // ── 3. Handle resources/subscribe (add to registry) ──────────────────────
  server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri.startsWith("ai-powered://jobs/")) {
      jobSubscriptions.add(uri);
    }
    // MCP protocol requires an empty-object result for subscribe (§8.3).
    return {};
  });

  // ── 4. Handle resources/unsubscribe (remove from registry) ───────────────
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    jobSubscriptions.delete(request.params.uri);
    return {};
  });
}

// ---------------------------------------------------------------------------
// startMcpServer (bd-sqnu / REQ-MCP-01, REQ-MCP-05)
// ---------------------------------------------------------------------------

/**
 * Starts the MCP server with the specified transport.
 *
 * **stdio**: Reads JSON-RPC from stdin, writes to stdout.
 * **http**: Starts an Express server on `port` (default 3743). By default the
 *   server binds to `127.0.0.1` so HTTP exposure stays local. When
 *   `unsafeExposeNetwork` is set, the server binds to `0.0.0.0` instead and
 *   requires `authToken`; every request must then carry
 *   `Authorization: Bearer <authToken>` or receive HTTP 401 (REQ-MCP-06).
 */
export async function startMcpServer(opts: {
  transport: "stdio" | "http";
  port?: number;
  authToken?: string;
  unsafeExposeNetwork?: boolean;
}): Promise<void> {
  const server = new McpServer({ name: "ai-powered", version: "1.0.0" });
  registerTools(server);
  registerResources(server);

  if (opts.transport === "stdio") {
    await server.connect(new StdioServerTransport());
    return;
  }

  // ── HTTP transport ───────────────────────────────────────────────────────
  const hasAuthToken = typeof opts.authToken === "string" && opts.authToken.trim().length > 0;
  if (opts.unsafeExposeNetwork && !hasAuthToken) {
    throw new Error(
      "HTTP MCP remote exposure requires an authToken when unsafeExposeNetwork is enabled.",
    );
  }

  const app = express();
  app.use(express.json());
  if (hasAuthToken && opts.authToken) app.use(createBearerAuthMiddleware(opts.authToken));

  // Stateless mode: omit sessionIdGenerator entirely (don't pass `undefined`
  // explicitly — exactOptionalPropertyTypes rejects that assignment).
  const transport = new StreamableHTTPServerTransport({});

  app.post("/mcp", async (req: Request, res: Response) => {
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", async (req: Request, res: Response) => {
    await transport.handleRequest(req, res);
  });
  app.delete("/mcp", async (req: Request, res: Response) => {
    await transport.handleRequest(req, res);
  });

  // SDK types declare `onclose` as optional on StreamableHTTPServerTransport
  // but Transport interface requires it non-optional under exactOptionalPropertyTypes.
  // This is a known SDK type gap; the cast is safe — connect() re-assigns onclose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await server.connect(transport as any);

  const port = opts.port ?? 3743;
  const listenHost = opts.unsafeExposeNetwork ? HTTP_REMOTE_HOST : HTTP_LOOPBACK_HOST;
  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, listenHost);
    httpServer.once("listening", () => resolve());
    httpServer.once("error", reject);
  });
}
