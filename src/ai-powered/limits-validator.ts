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
  const providers = ["openai", "anthropic", "xai", "venice", "lumaai", "runway"];
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
  resolution?: string;
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
   * @throws {ProviderError} when dimensions exceed maxWidth, maxHeight, or maxPixels.
   */
  validateImage(provider: string, model: string, width: number, height: number): void {
    const cfg = _getModel(provider, model);
    if (!cfg) return; // unknown model — skip validation

    const maxW = cfg.maxWidth ?? Infinity;
    const maxH = cfg.maxHeight ?? Infinity;
    const maxPx = cfg.maxPixels ?? Infinity;

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
      if (supported.length > 0 && !supported.includes(opts.aspectRatio)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: aspectRatio "${opts.aspectRatio}" not supported. Supported: ${supported.join(", ")}`,
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

    if (opts.fps !== undefined && cfg.fpsOptions && cfg.fpsOptions.length > 0) {
      if (!cfg.fpsOptions.includes(opts.fps)) {
        throw new ProviderError(
          provider as import("./core.js").ProviderName,
          `${model}: fps ${opts.fps} not supported. Supported: ${cfg.fpsOptions.join(", ")}`,
          422,
          false,
        );
      }
    }
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
