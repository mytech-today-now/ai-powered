/**
 * @file src/ai-powered/templates/index.ts
 *
 * Named prompt template system (Node.js — full implementation).
 * Built-in templates: summarize, translate, qa.
 * User-defined templates loaded from templateDirs config or by file path.
 *
 * Resolution order (highest priority last — user overrides built-ins):
 *   1. Built-in registry (from ./builtins.js — no fs access)
 *   2. User-defined dirs from config.templateDirs
 *   3. Direct file path (contains a path separator)
 *
 * Browser-safe subset: import from ./builtins.js instead.
 */

import * as fs from "node:fs";
import { ValidationError } from "../types.js";
import { BUILT_IN_REGISTRY, TemplateSchema } from "./builtins.js";

// Re-export the browser-safe subset so that callers importing from templates/index.ts
// also receive renderTemplate, TemplateSchema, and the raw built-in data.
export {
  TemplateSchema,
  renderTemplate,
  BUILT_INS,
  BUILT_IN_REGISTRY,
  listBuiltInTemplates,
  getBuiltInTemplate,
} from "./builtins.js";
export type { Template } from "./builtins.js";

// ---------------------------------------------------------------------------
// Registry builder (Node.js only — uses fs)
// ---------------------------------------------------------------------------

/**
 * Builds a merged template registry.
 * Built-ins are seeded first; user-defined JSON files in `templateDirs`
 * are layered on top, allowing overrides by name.
 */
function buildRegistry(templateDirs: string[] = []): Map<string, import("./builtins.js").Template> {
  // Start from a mutable copy of the built-in registry.
  const registry = new Map(BUILT_IN_REGISTRY);

  for (const dir of templateDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const filepath = `${dir}/${entry}`;
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(filepath, "utf-8")) as unknown;
      } catch {
        throw new Error(`Failed to parse template file: ${filepath}`);
      }
      const parsed = TemplateSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => `[${filepath}] ${i.message}`),
          raw,
        );
      }
      registry.set(parsed.data.name, parsed.data);
    }
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all available templates (built-in + user-defined). */
export function listTemplates(templateDirs: string[] = []): import("./builtins.js").Template[] {
  return [...buildRegistry(templateDirs).values()];
}

/**
 * Retrieve a template by name or direct file path.
 * A value containing `/` or `\` is treated as a file path.
 */
export function getTemplate(
  nameOrPath: string,
  templateDirs: string[] = [],
): import("./builtins.js").Template {
  if (nameOrPath.includes("/") || nameOrPath.includes("\\")) {
    if (!fs.existsSync(nameOrPath)) {
      throw new Error(`Template file not found: ${nameOrPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(nameOrPath, "utf-8")) as unknown;
    const parsed = TemplateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message),
        raw,
      );
    }
    return parsed.data;
  }

  const registry = buildRegistry(templateDirs);
  const tpl = registry.get(nameOrPath);
  if (!tpl) {
    throw new Error(
      `Template not found: "${nameOrPath}". Run 'ai-powered list-templates' to see available templates.`,
    );
  }
  return tpl;
}

// renderTemplate is re-exported from ./builtins.js above — no local override needed.
