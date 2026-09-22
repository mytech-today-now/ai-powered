/**
 * @file src/ai-powered/limits-validator.ts
 *
 * LimitsValidator — loads provider config JSON at import time and exposes
 * validateImage / validateVideo helpers used by provider implementations.
 *
 * Config files are read from providers/configs/*.json synchronously at module
 * initialisation. Any missing or malformed file throws at startup.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import * as path from "path";
import { ProviderError } from "./types.js";
import { AspectRatioService } from "./aspect-ratio.js";
import { getLogger } from "./utils.js";

// ---------------------------------------------------------------------------
// Types — mirror of the JSON schema
// ---------------------------------------------------------------------------

export interface ResolutionEntry {
  label: string;
  width: number;
  height: number;
}

export interface ModelConfig {
  id: string;
  modalities: string[];
  aspectRatios?: string[];
  resolutions?: ResolutionEntry[];
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxDurationSecs?: number;
  fpsOptions?: number[];
  qualityOptions?: string[];
  options?: Array<{
    name: string;
    type: "string" | "integer" | "number" | "boolean" | "enum";
    values?: Array<string | number | boolean>;
    min?: number;
    max?: number;
    required?: boolean;
    description?: string;
  }>;
  inputRequirements?: Array<{
    modality: "image" | "audio" | "video" | "document";
    min?: number;
    max?: number;
    required?: boolean;
  }>;
}

export interface ProviderConfig {
  provider: string;
  updatedAt: string;
  models: ModelConfig[];
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type ConfigMap = Record<string, ProviderConfig>;

let _configs: ConfigMap = {};

// Allow tests to inject mock config maps (call with null to reset).
let _mockConfigs: ConfigMap | null = null;

function _configsDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, "providers", "configs");
}

function _loadConfigs(): void {
  if (_mockConfigs !== null) {
    _configs = _mockConfigs;
    return;
  }
  const providers = ["openai", "anthropic", "xai", "venice", "lumaai", "runway", "pika"];
  const dir = _configsDir();
  const loaded: ConfigMap = {};
  for (const name of providers) {
    const file = path.join(dir, `${name}.json`);
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      throw new Error(`LimitsValidator: failed to read config file ${name}.json`);
    }
    try {
      loaded[name] = JSON.parse(raw) as ProviderConfig;
    } catch {
      throw new Error(`LimitsValidator: failed to parse ${name}.json — invalid JSON`);
    }
  }
  _configs = loaded;
}

// Initialise at import time.
_loadConfigs();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function _getModel(provider: string, model: string): ModelConfig | undefined {
  return _configs[provider]?.models.find((m) => m.id === model);
}

export interface VideoValidateOpts {
  aspectRatio?: string;
  duration?: number;
  fps?: number;
  quality?: string;
  resolution?: string;
  options?: Record<string, unknown>;
  inputMedia?: Array<{ modality: "image" | "video"; url?: string; mimeType?: string }>;
}

export const LimitsValidator = {
  /**
   * Inject a mock config map for testing. Pass `null` to revert to real files.
   * @internal
   */
  _injectMockConfigs(mocks: ConfigMap | null): void {
    _mockConfigs = mocks;
    _loadConfigs();
  },

  /**
   * Validate image width/height against provider+model constraints.
   *
   * When the model config defines a `resolutions` list, the supplied dimensions
   * are first snapped to the nearest supported entry (via `snapImage`) before
   * any limit checks are applied.  This prevents providers like Venice from
   * receiving arbitrary dimension pairs that they reject with HTTP 404.
   *
   * @returns The validated (and possibly snapped) `{ width, height }` pair.
   * @throws {ProviderError} when dimensions exceed maxWidth, maxHeight, or maxPixels.
   */
  validateImage(
    provider: string,
    model: string,
    width: number,
    height: number,
  ): { width: number; height: number } {
    const cfg = _getModel(provider, model);
    if (!cfg) return { width, height }; // unknown model — pass through unchanged

    const maxW = cfg.maxWidth ?? Infinity;
    const maxH = cfg.maxHeight ?? Infinity;
    const maxPx = cfg.maxPixels ?? Infinity;

    // Check per-side limits on the ORIGINAL (user-supplied) dimensions before
    // snapping.  This ensures requests that exceed maxWidth/maxHeight are
    // rejected even if they would snap to an in-range resolution.
    if (width > maxW || height > maxH) {
      const nearest = _nearestResolution(cfg, width, height);
      const hint = nearest ? ` nearest valid: ${nearest.width}×${nearest.height}` : "";
      throw new ProviderError(
        provider as import("./core.js").ProviderName,
        `${model}: width/height exceeds max ${maxW}×${maxH}.${hint}`,
        422,
        false,
      );
    }

    // Snap to the nearest supported resolution (for providers with a fixed
    // resolution list such as Venice or DALL-E 3).
    const snapped = _nearestResolution(cfg, width, height);
    if (snapped) {
      width = snapped.width;
      height = snapped.height;
    }

    // Check total pixel count on the snapped dimensions.
    const pixels = width * height;
    if (pixels > maxPx) {
      const nearest = _nearestResolution(cfg, width, height);
      const hint = nearest ? ` nearest valid: ${nearest.width}×${nearest.height}` : "";
      throw new ProviderError(
        provider as import("./core.js").ProviderName,
        `${model}: pixel count ${pixels} exceeds maxPixels ${maxPx}.${hint}`,
        422,
        false,
      );
    }

    return { width, height };
  },

  /**
   * Validate video generation parameters against provider+model constraints.
   *
   * @throws {ProviderError} on unsupported aspectRatio, exceeded duration, or unsupported fps.
   */
  validateVideo(provider: string, model: string, opts: VideoValidateOpts): void {
    const cfg = _getModel(provider, model);
    if (!cfg) return;

    if (opts.aspectRatio !== undefined && opts.aspectRatio !== "auto") {
      const supported = cfg.aspectRatios ?? [];
      if (!supported.includes(opts.aspectRatio)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: aspectRatio "${opts.aspectRatio}" not supported. Supported: ${supported.join(", ")}`,
          422,
          false,
        );
      }
    }

    if (opts.resolution !== undefined) {
      const supported = (cfg.resolutions ?? []).map((entry) => entry.label);
      if (!supported.includes(opts.resolution)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: resolution "${opts.resolution}" not supported. Supported: ${supported.join(", ")}`,
          422,
          false,
        );
      }
    }

    if (opts.duration !== undefined && cfg.maxDurationSecs !== undefined) {
      if (opts.duration > cfg.maxDurationSecs) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: duration ${opts.duration}s exceeds max ${cfg.maxDurationSecs}s`,
          422,
          false,
        );
      }
    }

    const durationOption = cfg.options?.find((option) => option.name === "duration");
    if (opts.duration !== undefined && !durationOption && cfg.maxDurationSecs === undefined) {
      throw new ProviderError(
        provider as import("./core.js").ProviderName,
        model + ": duration is not supported",
        422,
        false,
      );
    }
    if (opts.duration !== undefined && durationOption) {
      if (
        durationOption.values &&
        !durationOption.values.some((value) => value === opts.duration)
      ) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: duration ${opts.duration}s is not supported. Supported: ${durationOption.values.join(", ")}`,
          422,
          false,
        );
      }
      if (durationOption.min !== undefined && opts.duration < durationOption.min) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: duration must be at least ${durationOption.min}s`,
          422,
          false,
        );
      }
      if (durationOption.max !== undefined && opts.duration > durationOption.max) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: duration must be at most ${durationOption.max}s`,
          422,
          false,
        );
      }
    }

    if (opts.fps !== undefined) {
      const supported = cfg.fpsOptions ?? [];
      if (!supported.includes(opts.fps)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: fps ${opts.fps} not supported. Supported: ${supported.join(", ")}`,
          422,
          false,
        );
      }
    }

    if (opts.quality !== undefined) {
      const supported = cfg.qualityOptions ?? [];
      if (!supported.includes(opts.quality)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: quality "${opts.quality}" not supported. Supported: ${supported.join(", ")}`,
          422,
          false,
        );
      }
    }

    if (opts.options || opts.inputMedia) {
      this.validateModelOptions(provider, model, opts.options ?? {}, opts.inputMedia ?? []);
    }
  },

  /** Validate model-specific options and media input counts from provider config. */
  validateModelOptions(
    provider: string,
    model: string,
    values: Record<string, unknown>,
    inputMedia: Array<{ modality: "image" | "video"; url?: string }> = [],
  ): void {
    const cfg = _getModel(provider, model);
    if (!cfg) return;

    const declared = cfg.options ?? [];
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined || value === null || value === "") continue;
      const option = declared.find((entry) => entry.name === name);
      if (!option) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" is not supported`,
          422,
          false,
        );
      }
      if (option.type === "string" && typeof value !== "string") {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" must be a string`,
          422,
          false,
        );
      }
      if (option.type === "boolean" && typeof value !== "boolean") {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" must be a boolean`,
          422,
          false,
        );
      }
      if (
        (option.type === "integer" || option.type === "number") &&
        (typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" must be a number`,
          422,
          false,
        );
      }
      if (option.type === "integer" && typeof value === "number" && !Number.isInteger(value)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" must be an integer`,
          422,
          false,
        );
      }
      if (option.values && !option.values.some((allowed) => allowed === value)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" value ${JSON.stringify(value)} is not supported. Supported: ${option.values.join(", ")}`,
          422,
          false,
        );
      }
      if (typeof value === "number" && option.min !== undefined && value < option.min) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" must be at least ${option.min}`,
          422,
          false,
        );
      }
      if (typeof value === "number" && option.max !== undefined && value > option.max) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${name}" must be at most ${option.max}`,
          422,
          false,
        );
      }
    }

    for (const option of declared) {
      if (option.required && (values[option.name] === undefined || values[option.name] === "")) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: option "${option.name}" is required`,
          422,
          false,
        );
      }
    }

    const requirements = cfg.inputRequirements ?? [];
    if (inputMedia.length > 0 && requirements.length === 0) {
      throw new ProviderError(
        provider as import("./core.js").ProviderName,
        `${model}: media input is not supported`,
        422,
        false,
      );
    }

    for (const media of inputMedia) {
      if (
        requirements.length > 0 &&
        !requirements.some((entry) => entry.modality === media.modality)
      ) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: ${media.modality} input is not supported`,
          422,
          false,
        );
      }
    }

    for (const requirement of requirements) {
      const count = inputMedia.filter((media) => media.modality === requirement.modality).length;
      const min = requirement.min ?? (requirement.required ? 1 : 0);
      if (count < min) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: requires at least ${min} ${requirement.modality} input${min === 1 ? "" : "s"}`,
          422,
          false,
        );
      }
      if (requirement.max !== undefined && count > requirement.max) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: accepts at most ${requirement.max} ${requirement.modality} input${requirement.max === 1 ? "" : "s"}`,
          422,
          false,
        );
      }
    }
  },

  /**
   * Snap width/height to the nearest supported resolution for the given model.
   *
   * Providers like Venice reject arbitrary dimensions with a 404; this helper
   * ensures callers always send a dimension pair that appears in the model's
   * `resolutions` list.  When no list is defined the original values are
   * returned unchanged.
   */
  snapImage(
    provider: string,
    model: string,
    width: number,
    height: number,
  ): { width: number; height: number } {
    const cfg = _getModel(provider, model);
    if (!cfg || !cfg.resolutions || cfg.resolutions.length === 0) {
      return { width, height };
    }
    const nearest = _nearestResolution(cfg, width, height);
    return nearest ? { width: nearest.width, height: nearest.height } : { width, height };
  },

  /**
   * Attempt to enrich the in-memory config with live provider capabilities.
   * On success, any model IDs returned by the live endpoint that are not
   * already present in the static config are added with fallback limits.
   * Logs a warning on any failure — never throws.
   */
  async fetchLiveCapabilities(provider: string): Promise<void> {
    try {
      const url = _liveUrl(provider);
      if (!url) return;
      const resp = await fetch(url);
      if (!resp.ok) {
        getLogger().warn({ provider, status: resp.status }, "LimitsValidator: live fetch failed");
        return;
      }
      const json = (await resp.json()) as unknown;
      _mergeModels(provider, json);
      getLogger().debug({ provider }, "LimitsValidator: live capabilities fetched");
    } catch (err) {
      getLogger().warn(
        { provider, err },
        "LimitsValidator: live fetch error — using static config",
      );
    }
  },
};

function _nearestResolution(
  cfg: ModelConfig,
  width: number,
  height: number,
): ResolutionEntry | undefined {
  const list = cfg.resolutions;
  if (!list || list.length === 0) return undefined;
  // Use AspectRatioService.nearest to find closest within the valid list.
  try {
    const nearest = AspectRatioService.nearest(width, height, list);
    return list.find((r) => r.width === nearest.width && r.height === nearest.height);
  } catch {
    return list[0];
  }
}

/**
 * Merge model IDs from a live API response into the in-memory config.
 * Supports both `{ data: [{id}...] }` (OpenAI-compatible) and
 * `{ models: [{id}...] }` response shapes.
 * Only adds models not already present; existing entries are never overwritten.
 */
function _mergeModels(provider: string, json: unknown): void {
  const cfg = _configs[provider];
  if (!cfg) return;

  let entries: unknown[] = [];
  if (typeof json === "object" && json !== null) {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj["data"])) entries = obj["data"] as unknown[];
    else if (Array.isArray(obj["models"])) entries = obj["models"] as unknown[];
  }

  const existingIds = new Set(cfg.models.map((m) => m.id));
  let added = 0;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const id = (entry as Record<string, unknown>)["id"];
    if (typeof id !== "string" || existingIds.has(id)) continue;
    cfg.models.push({ id, modalities: ["image"] });
    existingIds.add(id);
    added++;
  }

  if (added > 0) {
    getLogger().debug({ provider, added }, "LimitsValidator: merged live models into config");
  }
}

function _liveUrl(provider: string): string | undefined {
  const urls: Record<string, string> = {
    venice: "https://api.venice.ai/api/v1/models",
    xai: "https://api.x.ai/v1/models",
  };
  return urls[provider];
}
