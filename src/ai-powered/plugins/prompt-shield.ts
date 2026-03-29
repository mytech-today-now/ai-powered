/**
 * @file src/ai-powered/plugins/prompt-shield.ts
 *
 * Built-in prompt-shield plugin — heuristic prompt-injection detection.
 *
 * Scans every user-role message in `onRequest` against a list of known
 * injection patterns.  On a match it emits a WARNING log.  When configured
 * with `reject: true` the plugin throws a `PluginError`, preventing the
 * request from reaching the provider.
 *
 * Activate via config:  plugins: ['prompt-shield']
 * Default behaviour:    log-only (reject: false)
 */

import type { AiPlugin, RequestContext, ResponseContext } from "../types.js";
import { PluginError } from "../types.js";
import { getLogger } from "../utils.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PromptShieldOptions {
  /**
   * When `true`, a detected injection causes a `PluginError` to be thrown,
   * preventing the request from reaching the provider.
   * Default: false (log-only mode).
   */
  reject?: boolean;
}

// ---------------------------------------------------------------------------
// Injection-pattern registry
// ---------------------------------------------------------------------------

interface InjectionPattern {
  /** Human-readable label used in log/error messages. */
  label: string;
  /** Case-insensitive regular expression to test against prompt text. */
  re: RegExp;
}

/**
 * Heuristic patterns covering common prompt-injection techniques.
 * Patterns are tested against user-role message content only.
 */
const INJECTION_PATTERNS: InjectionPattern[] = [
  { label: "ignore-previous-instructions", re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i },
  { label: "override-system-prompt",       re: /override\s+(the\s+)?(system\s+prompt|instructions?)/i },
  { label: "disregard-instructions",       re: /disregard\s+(all\s+)?(previous|prior|your)\s+instructions?/i },
  { label: "act-as-jailbreak",            re: /act\s+as\s+(if\s+you('re|\s+are)\s+)?(a|an)\s+/i },
  { label: "dan-jailbreak",               re: /\bDAN\b|\bdo\s+anything\s+now\b/i },
  { label: "prompt-leak",                 re: /repeat\s+(the\s+)?(above|system|previous)\s+(instructions?|prompt|text)/i },
  { label: "end-of-system-context",       re: /\[?\s*(END|STOP)\s+SYSTEM\s*(PROMPT|MESSAGE|CONTEXT)?\s*\]?/i },
  { label: "role-play-developer-mode",    re: /developer\s+mode\s+(enabled|on|activated)/i },
  { label: "simulate-no-restrictions",    re: /simulate\s+(having\s+)?no\s+(content\s+)?(restrictions?|filters?|rules?)/i },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a prompt-shield plugin instance.
 *
 * @param opts  Optional configuration overrides.
 */
export function createPromptShieldPlugin(opts: PromptShieldOptions = {}): AiPlugin {
  const shouldReject = opts.reject ?? false;

  return {
    name: "prompt-shield",
    version: "1.0.0",
    description: `Heuristic prompt-injection detection (mode: ${shouldReject ? "reject" : "log-only"}).`,

    async onRequest(ctx: RequestContext): Promise<RequestContext> {
      const logger = getLogger();

      for (const msg of ctx.messages) {
        if (msg.role !== "user") continue;

        for (const { label, re } of INJECTION_PATTERNS) {
          if (!re.test(msg.content)) continue;

          logger.warn(
            {
              plugin: "prompt-shield",
              pattern: label,
              modality: ctx.modality,
              provider: ctx.config.provider,
            },
            `Potential prompt injection detected: pattern "${label}"`,
          );

          if (shouldReject) {
            throw new PluginError(
              "prompt-shield",
              new Error(
                `Prompt injection rejected: pattern "${label}" matched. ` +
                  "Request not dispatched to provider.",
              ),
            );
          }

          // Log-only mode: continue scanning remaining patterns/messages.
        }
      }

      return ctx;
    },

    async onResponse(ctx: ResponseContext): Promise<ResponseContext> {
      // No-op: injection scanning only applies to outbound requests.
      return ctx;
    },
  };
}

