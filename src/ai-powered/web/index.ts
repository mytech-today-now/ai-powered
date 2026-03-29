/**
 * @file src/ai-powered/web/index.ts
 *
 * Browser-safe web module entry point.
 *
 * This file is the Vite lib-mode entry for the browser bundle (dist-web/).
 * It must NOT import any Node.js built-ins (fs, path, os, crypto, …).
 * The Vite build configuration enforces this by externalising all Node built-ins
 * and the post-build secret-scan plugin will abort if any key prefix leaks in.
 *
 * Currently exported:
 *  - AiConfig schema types (for type-checking config in browser consumers)
 *  - Built-in template registry (browser-safe — no fs access)
 *
 * Full web-client implementation: bd-kms8 (createWebClient factory and WebAiClient).
 */

// ---------------------------------------------------------------------------
// Config types — no Node.js builtins; Zod schema is browser-safe.
// ---------------------------------------------------------------------------
export type { AiConfig, Modality, ProviderName } from "../core.js";

// ---------------------------------------------------------------------------
// Template system — browser-safe built-ins only (no fs, no path).
// ---------------------------------------------------------------------------

/**
 * Built-in template definitions (summarize, translate, qa) and rendering
 * utilities.  Safe to use in any browser environment.
 *
 * For Node.js / file-system-backed templates see the full `templates/index.js`.
 */
export {
  TemplateSchema,
  BUILT_INS,
  BUILT_IN_REGISTRY,
  listBuiltInTemplates,
  getBuiltInTemplate,
  renderTemplate,
} from "../templates/builtins.js";
export type { Template } from "../templates/builtins.js";

// ---------------------------------------------------------------------------
// Web client — bd-kms8 (createWebClient factory and WebAiClient)
// ---------------------------------------------------------------------------

/**
 * Browser-safe AI client.  Two modes are supported:
 *
 *  - **proxy** (recommended for production): all requests are forwarded
 *    through your own server; the API key never leaves the server.
 *  - **direct** (development / demo only): the browser calls the provider
 *    API directly.  A non-suppressible DOM banner is rendered to warn users
 *    that the API key is visible in DevTools.
 *
 * @example — proxy mode
 * ```ts
 * import { createWebClient } from "ai-powered/web";
 * const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3000" });
 * const result = await client.generateText("Hello!");
 * ```
 *
 * @example — direct mode (dev only)
 * ```ts
 * const client = createWebClient({ mode: "direct", provider: "openai", apiKey: "sk-..." });
 * ```
 */
export { createWebClient, WebAiClient, BrowserConversationSession } from "./fetch-client.js";

export type {
  WebCallOptions,
  WebTextResult,
  WebTokenUsage,
  WebStructuredResult,
  WebModelInfo,
  WebProxyOptions,
  WebDirectOptions,
  WebClientOptions,
  WebMessage,
} from "./fetch-client.js";

/** @internal Version sentinel consumed by the Vite build and dist-web bundle. */
export const __WEB_MODULE_VERSION__ = "0.1.0";

