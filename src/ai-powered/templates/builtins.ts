/**
 * @file src/ai-powered/templates/builtins.ts
 *
 * Browser-safe built-in template definitions and rendering utilities.
 *
 * This file is intentionally free of Node.js built-ins (no fs, path, os,
 * crypto, …) so that it can be safely imported by both the Node.js library
 * AND the Vite browser bundle (dist-web/).
 *
 * Consumers that need filesystem-backed templates should import from
 * `./index.js` (Node.js only).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema & types
// ---------------------------------------------------------------------------

export const TemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  modality: z
    .enum(["text", "image", "audio", "video", "structured"])
    .default("text"),
  provider: z.string().optional(),
  model: z.string().optional(),
  system: z.string().optional(),
  userPrompt: z.string().min(1),
  defaults: z.record(z.string()).default({}),
});

export type Template = z.infer<typeof TemplateSchema>;

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

/**
 * Canonical built-in template definitions.
 *
 * Design notes:
 *  - Every template that includes an optional-but-useful variable (e.g.
 *    `{{language}}`) ships a sensible default so callers that omit the var
 *    never receive a "missing variables" error.
 *  - `qa` intentionally has no defaults for `{{question}}` and `{{context}}`
 *    because both are required caller inputs that have no meaningful fallback.
 */
export const BUILT_INS: Template[] = [
  {
    name: "summarize",
    description: "Summarize the provided text in a concise paragraph",
    modality: "text",
    userPrompt:
      "Please summarize the following text concisely in {{language}}:\n\n{{text}}",
    defaults: { language: "English" },
  },
  {
    name: "translate",
    description: "Translate text into a target language",
    modality: "text",
    userPrompt:
      "Translate the following text to {{targetLanguage}}:\n\n{{text}}",
    defaults: { targetLanguage: "English" },
  },
  {
    name: "qa",
    description: "Answer a question using the provided context",
    modality: "text",
    userPrompt:
      "Using the following context, answer the question.\n\nContext:\n{{context}}\n\nQuestion: {{question}}",
    defaults: {},
  },
];

// ---------------------------------------------------------------------------
// Built-in registry (Map for O(1) lookup)
// ---------------------------------------------------------------------------

/** Immutable registry of all built-in templates, keyed by name. */
export const BUILT_IN_REGISTRY: ReadonlyMap<string, Template> = new Map(
  BUILT_INS.map((t) => [t.name, t]),
);

// ---------------------------------------------------------------------------
// Public API (browser-safe)
// ---------------------------------------------------------------------------

/**
 * List all built-in templates.
 * Returns a new array on every call so callers cannot mutate the registry.
 */
export function listBuiltInTemplates(): Template[] {
  return [...BUILT_IN_REGISTRY.values()];
}

/**
 * Retrieve a built-in template by name.
 * Returns `undefined` when the name is not found (no throws — callers decide).
 */
export function getBuiltInTemplate(name: string): Template | undefined {
  return BUILT_IN_REGISTRY.get(name);
}

/**
 * Render a template by substituting `{{variable}}` placeholders.
 *
 * Resolution order (highest priority last):
 *   template.defaults → vars
 *
 * Throws an `Error` if any placeholder in `userPrompt` remains unresolved
 * after merging defaults and caller-supplied vars.
 *
 * This function is pure (no I/O) and safe to use in browser contexts.
 */
export function renderTemplate(
  template: Template,
  vars: Record<string, string> = {},
): string {
  const merged: Record<string, string> = { ...template.defaults, ...vars };
  const placeholders = [
    ...template.userPrompt.matchAll(/\{\{([^}]+)\}\}/g),
  ].map((m) => m[1]!);
  const missing = placeholders.filter((p) => !(p in merged));
  if (missing.length > 0) {
    throw new Error(
      `Template "${template.name}" missing required variables: ${missing.join(", ")}`,
    );
  }
  return template.userPrompt.replace(
    /\{\{([^}]+)\}\}/g,
    (_, key: string) => merged[key] ?? "",
  );
}

