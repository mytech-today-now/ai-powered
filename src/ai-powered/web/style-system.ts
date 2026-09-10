/**
 * @file src/ai-powered/web/style-system.ts
 *
 * Data-driven browser theme system for the web demo and info page.
 */

/// <reference lib="dom" />

export interface StyleTokens {
  bg: string;
  bgAccent: string;
  surface: string;
  surfaceElevated: string;
  surfaceSoft: string;
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryStrong: string;
  secondary: string;
  secondaryStrong: string;
  accent: string;
  shadow: string;
  glow: string;
  selection: string;
  fontSans: string;
  fontDisplay: string;
  fontMono: string;
  radius: string;
}

export interface StyleDefinition {
  id: string;
  label: string;
  description: string;
  tokens: StyleTokens;
}

export interface StyleControllerOptions {
  storage?: Storage;
  document?: Document;
  previousStyleId?: string | null;
  preferredStyleId?: string | null;
  random?: () => number;
}

export interface StyleController {
  readonly style: StyleDefinition;
  readonly styleId: string;
  apply(target?: Document | HTMLElement | null): void;
  rotate(): StyleDefinition;
  persist(): void;
}

export const STYLE_STORAGE_KEY = "ai-powered:last-style-id";

export const STYLE_REGISTRY: StyleDefinition[] = [
  {
    id: "aurora",
    label: "Aurora",
    description: "Bright editorial palette with teal, blue, and soft paper surfaces.",
    tokens: {
      bg: "#f3f7fb",
      bgAccent:
        "radial-gradient(circle at top right, rgba(56, 189, 248, 0.26), transparent 34%), radial-gradient(circle at left top, rgba(14, 165, 233, 0.16), transparent 32%)",
      surface: "#ffffff",
      surfaceElevated: "#f8fbff",
      surfaceSoft: "#eef6fb",
      text: "#0f172a",
      textMuted: "#52607a",
      border: "#d7e2ee",
      borderStrong: "#9cc4df",
      primary: "#0f766e",
      primaryStrong: "#115e59",
      secondary: "#1d4ed8",
      secondaryStrong: "#1e40af",
      accent: "#f59e0b",
      shadow: "0 24px 60px rgba(15, 23, 42, 0.12)",
      glow: "0 0 0 1px rgba(15, 118, 110, 0.18), 0 18px 48px rgba(15, 118, 110, 0.12)",
      selection: "rgba(15, 118, 110, 0.22)",
      fontSans: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
      fontDisplay: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
      fontMono: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      radius: "18px",
    },
  },
  {
    id: "ember",
    label: "Ember",
    description: "Warm studio palette with sandstone, coral, and deep ink contrast.",
    tokens: {
      bg: "#fff7f0",
      bgAccent:
        "radial-gradient(circle at top left, rgba(251, 146, 60, 0.24), transparent 30%), radial-gradient(circle at bottom right, rgba(239, 68, 68, 0.12), transparent 34%)",
      surface: "#fffdfb",
      surfaceElevated: "#fff6ef",
      surfaceSoft: "#fff0e2",
      text: "#1f2937",
      textMuted: "#6b7280",
      border: "#f0d8c4",
      borderStrong: "#e7a17c",
      primary: "#c2410c",
      primaryStrong: "#9a3412",
      secondary: "#b91c1c",
      secondaryStrong: "#991b1b",
      accent: "#f97316",
      shadow: "0 24px 60px rgba(124, 45, 18, 0.12)",
      glow: "0 0 0 1px rgba(194, 65, 12, 0.18), 0 18px 48px rgba(194, 65, 12, 0.12)",
      selection: "rgba(249, 115, 22, 0.24)",
      fontSans: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
      fontDisplay: '"Book Antiqua", "Georgia", serif',
      fontMono: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      radius: "20px",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "High-contrast editorial palette with cobalt, silver, and deep slate.",
    tokens: {
      bg: "#eef2ff",
      bgAccent:
        "radial-gradient(circle at top right, rgba(99, 102, 241, 0.18), transparent 36%), radial-gradient(circle at left bottom, rgba(14, 165, 233, 0.16), transparent 32%)",
      surface: "#ffffff",
      surfaceElevated: "#f8fafc",
      surfaceSoft: "#e5eef8",
      text: "#111827",
      textMuted: "#4b5563",
      border: "#ccd8e7",
      borderStrong: "#8ba0bf",
      primary: "#1d4ed8",
      primaryStrong: "#1e40af",
      secondary: "#0f766e",
      secondaryStrong: "#115e59",
      accent: "#6366f1",
      shadow: "0 24px 60px rgba(15, 23, 42, 0.14)",
      glow: "0 0 0 1px rgba(29, 78, 216, 0.16), 0 18px 48px rgba(29, 78, 216, 0.12)",
      selection: "rgba(99, 102, 241, 0.22)",
      fontSans: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
      fontDisplay: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
      fontMono: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      radius: "16px",
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Calm paper-and-ink palette with moss, evergreen, and parchment surfaces.",
    tokens: {
      bg: "#f4f8f4",
      bgAccent:
        "radial-gradient(circle at top left, rgba(34, 197, 94, 0.18), transparent 34%), radial-gradient(circle at right center, rgba(16, 185, 129, 0.12), transparent 36%)",
      surface: "#fcfdfc",
      surfaceElevated: "#f5faf6",
      surfaceSoft: "#eaf5ec",
      text: "#10231a",
      textMuted: "#4d6659",
      border: "#d8e5db",
      borderStrong: "#98b39e",
      primary: "#166534",
      primaryStrong: "#14532d",
      secondary: "#0f766e",
      secondaryStrong: "#115e59",
      accent: "#84cc16",
      shadow: "0 24px 60px rgba(16, 35, 26, 0.11)",
      glow: "0 0 0 1px rgba(22, 101, 52, 0.16), 0 18px 48px rgba(22, 101, 52, 0.1)",
      selection: "rgba(22, 101, 52, 0.2)",
      fontSans: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
      fontDisplay: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
      fontMono: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      radius: "18px",
    },
  },
  {
    id: "studio",
    label: "Studio",
    description: "Neutral glassmorphism palette with violet accents and wide spacing.",
    tokens: {
      bg: "#f7f7fb",
      bgAccent:
        "radial-gradient(circle at 20% 0%, rgba(168, 85, 247, 0.18), transparent 35%), radial-gradient(circle at 90% 20%, rgba(14, 165, 233, 0.14), transparent 30%)",
      surface: "#ffffff",
      surfaceElevated: "#fbfbfe",
      surfaceSoft: "#f0f2f8",
      text: "#101828",
      textMuted: "#667085",
      border: "#d7dbe7",
      borderStrong: "#a5acc4",
      primary: "#7c3aed",
      primaryStrong: "#6d28d9",
      secondary: "#0284c7",
      secondaryStrong: "#0369a1",
      accent: "#f43f5e",
      shadow: "0 30px 70px rgba(15, 23, 42, 0.12)",
      glow: "0 0 0 1px rgba(124, 58, 237, 0.14), 0 18px 48px rgba(124, 58, 237, 0.12)",
      selection: "rgba(124, 58, 237, 0.2)",
      fontSans: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
      fontDisplay: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
      fontMono: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      radius: "22px",
    },
  },
];

export function getStyleById(styleId: string | null | undefined): StyleDefinition | null {
  if (!styleId) return null;
  return STYLE_REGISTRY.find((style) => style.id === styleId) ?? null;
}

export function readStoredStyleId(
  storage: Storage | undefined = globalThis.localStorage,
): string | null {
  try {
    return storage?.getItem(STYLE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredStyleId(
  styleId: string,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(STYLE_STORAGE_KEY, styleId);
  } catch {
    /* ignore storage failures */
  }
}

export function chooseStyleId(
  previousStyleId: string | null | undefined,
  random: () => number = Math.random,
  preferredStyleId: string | null | undefined = null,
): string {
  if (preferredStyleId && getStyleById(preferredStyleId)) return preferredStyleId;

  if (STYLE_REGISTRY.length === 0) return "";
  if (STYLE_REGISTRY.length === 1) return STYLE_REGISTRY[0]!.id;

  const eligible = previousStyleId
    ? STYLE_REGISTRY.filter((style) => style.id !== previousStyleId)
    : STYLE_REGISTRY.slice();
  const pool = eligible.length > 0 ? eligible : STYLE_REGISTRY;
  return pool[Math.floor(random() * pool.length)]!.id;
}

export function applyStyleDefinition(
  target: Document | HTMLElement | null | undefined,
  style: StyleDefinition,
): void {
  if (!target) return;
  const nodes = target instanceof Document ? target.documentElement : target;
  if (!nodes) return;

  const { tokens } = style;
  nodes.dataset["styleId"] = style.id;
  nodes.style.setProperty("--app-bg", tokens.bg);
  nodes.style.setProperty("--app-bg-accent", tokens.bgAccent);
  nodes.style.setProperty("--app-surface", tokens.surface);
  nodes.style.setProperty("--app-surface-elevated", tokens.surfaceElevated);
  nodes.style.setProperty("--app-surface-soft", tokens.surfaceSoft);
  nodes.style.setProperty("--app-text", tokens.text);
  nodes.style.setProperty("--app-text-muted", tokens.textMuted);
  nodes.style.setProperty("--app-border", tokens.border);
  nodes.style.setProperty("--app-border-strong", tokens.borderStrong);
  nodes.style.setProperty("--app-primary", tokens.primary);
  nodes.style.setProperty("--app-primary-strong", tokens.primaryStrong);
  nodes.style.setProperty("--app-secondary", tokens.secondary);
  nodes.style.setProperty("--app-secondary-strong", tokens.secondaryStrong);
  nodes.style.setProperty("--app-accent", tokens.accent);
  nodes.style.setProperty("--app-shadow", tokens.shadow);
  nodes.style.setProperty("--app-glow", tokens.glow);
  nodes.style.setProperty("--app-selection", tokens.selection);
  nodes.style.setProperty("--app-font-sans", tokens.fontSans);
  nodes.style.setProperty("--app-font-display", tokens.fontDisplay);
  nodes.style.setProperty("--app-font-mono", tokens.fontMono);
  nodes.style.setProperty("--app-radius", tokens.radius);
}

export function createStyleController(options: StyleControllerOptions = {}): StyleController {
  const storage = options.storage ?? globalThis.localStorage;
  const previousStyleId = options.previousStyleId ?? readStoredStyleId(storage);
  let currentStyle =
    getStyleById(chooseStyleId(previousStyleId, options.random, options.preferredStyleId)) ??
    STYLE_REGISTRY[0]!;

  if (options.document) {
    applyStyleDefinition(options.document, currentStyle);
  }

  const controller: StyleController = {
    get style() {
      return currentStyle;
    },
    get styleId() {
      return currentStyle.id;
    },
    apply(target = options.document ?? null) {
      applyStyleDefinition(target, currentStyle);
    },
    rotate() {
      const nextStyleId = chooseStyleId(currentStyle.id, options.random);
      const nextStyle = getStyleById(nextStyleId) ?? STYLE_REGISTRY[0]!;
      currentStyle = nextStyle;
      if (options.document) applyStyleDefinition(options.document, currentStyle);
      if (storage) writeStoredStyleId(currentStyle.id, storage);
      return nextStyle;
    },
    persist() {
      if (storage) writeStoredStyleId(currentStyle.id, storage);
    },
  };

  if (storage) writeStoredStyleId(currentStyle.id, storage);
  return controller;
}
