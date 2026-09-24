/**
 * @file src/ai-powered/server/file-handler.ts
 *
 * File upload utilities for the ai-powered proxy server.
 *
 * Exports:
 *   MIME_ALLOWLIST            – Set of accepted MIME types
 *   FILE_REF_TTL_MS           – In-memory retention window for uploaded refs
 *   FileRefEntry              – Interface for stored file reference data
 *   storeFileRef()            – Store a file ref in the bounded in-memory map; return UUID token
 *   lookupFileRef()           – Retrieve a file ref by UUID token
 *   readFileRefBuffer()       – Retrieve bounded cached decoded bytes for a UUID token
 *   validateMimeType()        – Check if a MIME type is in the allowlist
 *   validateFileSize()        – Check if a file size is within the 50 MiB limit
 *   FileInput                 – Interface for the file descriptor passed to buildFileContentBlock()
 *   buildFileContentBlock()   – Build a provider-native content block for a given file
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as path from "node:path";
import { ProviderCapabilityError } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIME_ALLOWLIST = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "application/pdf",
  "text/plain",
  "text/html",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]);

/** Hard limit: 50 MiB */
const MAX_FILE_BYTES = 52_428_800;

// ---------------------------------------------------------------------------
// File reference store (bounded in-memory; persistent storage is not implied)
// ---------------------------------------------------------------------------

/** File refs are retained for 1 hour unless explicitly deleted first. */
export const FILE_REF_TTL_MS = 60 * 60 * 1000;

const DEFAULT_FILE_REF_MAX_COUNT = 100;
const DEFAULT_FILE_REF_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_FILE_REF_MAX_COUNT_PER_OWNER = 20;
const DEFAULT_FILE_REF_MAX_BYTES_PER_OWNER = 64 * 1024 * 1024;
const DEFAULT_FILE_REF_BUFFER_CACHE_MAX_BYTES = 16 * 1024 * 1024;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Maximum live refs in the default process-local store. */
export const FILE_REF_MAX_COUNT = readPositiveIntegerEnv(
  "AIPOWERED_FILE_MAX_COUNT",
  DEFAULT_FILE_REF_MAX_COUNT,
);

/** Maximum declared attachment bytes in the default process-local store. */
export const FILE_REF_MAX_BYTES = readPositiveIntegerEnv(
  "AIPOWERED_FILE_MAX_BYTES",
  DEFAULT_FILE_REF_MAX_BYTES,
);

/** Maximum live refs owned by one principal in the default store. */
export const FILE_REF_MAX_COUNT_PER_OWNER = readPositiveIntegerEnv(
  "AIPOWERED_FILE_MAX_COUNT_PER_OWNER",
  DEFAULT_FILE_REF_MAX_COUNT_PER_OWNER,
);

/** Maximum declared attachment bytes owned by one principal in the default store. */
export const FILE_REF_MAX_BYTES_PER_OWNER = readPositiveIntegerEnv(
  "AIPOWERED_FILE_MAX_BYTES_PER_OWNER",
  DEFAULT_FILE_REF_MAX_BYTES_PER_OWNER,
);

/** Maximum decoded bytes retained by the default LRU buffer cache. */
export const FILE_REF_BUFFER_CACHE_MAX_BYTES = readPositiveIntegerEnv(
  "AIPOWERED_FILE_BUFFER_CACHE_MAX_BYTES",
  DEFAULT_FILE_REF_BUFFER_CACHE_MAX_BYTES,
);

/** Provider fetch capabilities are intentionally shorter-lived than file refs. */
export const FILE_PROVIDER_CAPABILITY_TTL_MS = 5 * 60 * 1000;

const FILE_PROVIDER_CAPABILITY_PURPOSE = "provider-media";
const generatedCapabilitySecret = randomBytes(32).toString("hex");

export interface FileRefEntry {
  /** Stable authenticated caller identity that owns this ref. */
  ownerId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  base64Content: string;
  provider: string;
  model?: string;
  /** Provider Files API file_id if the file was uploaded to the provider. */
  fileId?: string;
}

interface StoredFileRefEntry {
  entry: FileRefEntry;
  expiresAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

export type FileRefCapacityReason =
  "global-count" | "global-bytes" | "principal-count" | "principal-bytes";

/** Stable error raised when an upload would exceed a configured store quota. */
export class FileRefCapacityError extends Error {
  readonly code = "FILE_REF_CAPACITY_EXCEEDED" as const;

  constructor(
    readonly reason: FileRefCapacityReason,
    readonly limit: number,
    readonly current: number,
    readonly requested: number,
  ) {
    super(
      "Attachment storage capacity is full or the principal quota was exceeded. " +
        "Delete an existing attachment or wait for expiry, then retry.",
    );
    this.name = "FileRefCapacityError";
  }
}

export interface FileRefStoreOptions {
  maxCount?: number;
  maxBytes?: number;
  maxCountPerOwner?: number;
  maxBytesPerOwner?: number;
  bufferCacheMaxBytes?: number;
}

export interface FileRefCacheStats {
  hits: number;
  misses: number;
  fileRefs: number;
  bufferEntries: number;
  storedBytes: number;
  bufferBytes: number;
}

export interface FileRefStoreStats {
  fileRefs: number;
  storedBytes: number;
  maxCount: number;
  maxBytes: number;
  maxCountPerOwner: number;
  maxBytesPerOwner: number;
  bufferBytes: number;
  bufferCacheMaxBytes: number;
}

export interface FileRefStore {
  storeFileRef(entry: FileRefEntry): string;
  assertFileRefCapacity(ownerId: string, sizeBytes: number): void;
  lookupFileRef(token: string): FileRefEntry | undefined;
  lookupAuthorizedFileRef(token: string, ownerId: string | undefined): FileRefEntry | undefined;
  readFileRefBuffer(token: string): Buffer | undefined;
  deleteFileRef(token: string): boolean;
  deleteAuthorizedFileRef(token: string, ownerId: string | undefined): boolean;
  getFileRefCacheStats(): FileRefCacheStats;
  getFileRefStoreStats(): FileRefStoreStats;
  clearCache(): void;
  clear(): void;
  getSize(): number;
}

/** Normalize a filename so uploads stay path-safe across platforms. */
export function normalizeStoredFilename(filename: string): string {
  const sanitized = filename.replace(/\0/g, "").replace(/[\\/]+/g, "/");
  const baseName = path.posix.basename(sanitized);
  if (!baseName || baseName === "." || baseName === "..") {
    return "upload";
  }
  return baseName;
}

function normalizeStoreLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Create an isolated bounded store. The factory is used by tests to model
 * process resets and two instances; production routes use the default store
 * exported below.
 */
export function createFileRefStore(options: FileRefStoreOptions = {}): FileRefStore {
  const maxCount = normalizeStoreLimit(options.maxCount, FILE_REF_MAX_COUNT);
  const maxBytes = normalizeStoreLimit(options.maxBytes, FILE_REF_MAX_BYTES);
  const maxCountPerOwner = normalizeStoreLimit(
    options.maxCountPerOwner,
    FILE_REF_MAX_COUNT_PER_OWNER,
  );
  const maxBytesPerOwner = normalizeStoreLimit(
    options.maxBytesPerOwner,
    FILE_REF_MAX_BYTES_PER_OWNER,
  );
  const bufferCacheMaxBytes = normalizeStoreLimit(
    options.bufferCacheMaxBytes,
    FILE_REF_BUFFER_CACHE_MAX_BYTES,
  );

  const fileRefStore = new Map<string, StoredFileRefEntry>();
  const fileRefBufferCache = new Map<string, Buffer>();
  const ownerUsage = new Map<string, { count: number; bytes: number }>();
  let fileRefStoreBytes = 0;
  let fileRefBufferCacheBytes = 0;
  let fileRefBufferCacheHits = 0;
  let fileRefBufferCacheMisses = 0;

  function deleteCachedBuffer(token: string): void {
    const cached = fileRefBufferCache.get(token);
    if (!cached) return;
    fileRefBufferCache.delete(token);
    fileRefBufferCacheBytes -= cached.length;
  }

  function removeStoredFileRef(token: string, stored: StoredFileRefEntry): void {
    if (fileRefStore.get(token) !== stored) return;
    fileRefStore.delete(token);
    if (stored.cleanupTimer) clearTimeout(stored.cleanupTimer);
    fileRefStoreBytes -= stored.entry.sizeBytes;

    const usage = ownerUsage.get(stored.entry.ownerId);
    if (usage) {
      usage.count -= 1;
      usage.bytes -= stored.entry.sizeBytes;
      if (usage.count <= 0) ownerUsage.delete(stored.entry.ownerId);
    }
    deleteCachedBuffer(token);
  }

  /** Remove expired entries immediately, including their decoded buffers. */
  function pruneExpiredFileRefs(now = Date.now()): void {
    for (const [token, stored] of fileRefStore) {
      if (now >= stored.expiresAt) removeStoredFileRef(token, stored);
    }
  }

  function assertFileRefCapacity(ownerId: string, sizeBytes: number): void {
    pruneExpiredFileRefs();
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) throw new Error("File reference owner is required.");
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new Error("File reference size must be a non-negative integer.");
    }

    const usage = ownerUsage.get(normalizedOwnerId) ?? { count: 0, bytes: 0 };
    if (usage.count + 1 > maxCountPerOwner) {
      throw new FileRefCapacityError("principal-count", maxCountPerOwner, usage.count, 1);
    }
    if (usage.bytes + sizeBytes > maxBytesPerOwner) {
      throw new FileRefCapacityError("principal-bytes", maxBytesPerOwner, usage.bytes, sizeBytes);
    }
    if (fileRefStore.size + 1 > maxCount) {
      throw new FileRefCapacityError("global-count", maxCount, fileRefStore.size, 1);
    }
    if (fileRefStoreBytes + sizeBytes > maxBytes) {
      throw new FileRefCapacityError("global-bytes", maxBytes, fileRefStoreBytes, sizeBytes);
    }
  }

  function storeFileRef(entry: FileRefEntry): string {
    const ownerId = entry.ownerId.trim();
    assertFileRefCapacity(ownerId, entry.sizeBytes);
    const token = randomUUID();
    const stored: StoredFileRefEntry = {
      entry: {
        ...entry,
        ownerId,
        filename: normalizeStoredFilename(entry.filename),
      },
      expiresAt: Date.now() + FILE_REF_TTL_MS,
    };
    fileRefStore.set(token, stored);
    fileRefStoreBytes += entry.sizeBytes;
    const usage = ownerUsage.get(ownerId) ?? { count: 0, bytes: 0 };
    usage.count += 1;
    usage.bytes += entry.sizeBytes;
    ownerUsage.set(ownerId, usage);
    stored.cleanupTimer = setTimeout(() => {
      const current = fileRefStore.get(token);
      if (current === stored && Date.now() >= stored.expiresAt) {
        removeStoredFileRef(token, stored);
      }
    }, FILE_REF_TTL_MS);
    stored.cleanupTimer.unref?.();
    return token;
  }

  function lookupFileRef(token: string): FileRefEntry | undefined {
    pruneExpiredFileRefs();
    return fileRefStore.get(token)?.entry;
  }

  function lookupAuthorizedFileRef(
    token: string,
    ownerId: string | undefined,
  ): FileRefEntry | undefined {
    const entry = lookupFileRef(token);
    return entry && ownerId !== undefined && entry.ownerId === ownerId ? entry : undefined;
  }

  function cacheBuffer(token: string, buffer: Buffer): void {
    if (buffer.length > bufferCacheMaxBytes) return;
    deleteCachedBuffer(token);
    while (fileRefBufferCacheBytes + buffer.length > bufferCacheMaxBytes) {
      const oldestToken = fileRefBufferCache.keys().next().value as string | undefined;
      if (!oldestToken) break;
      deleteCachedBuffer(oldestToken);
    }
    fileRefBufferCache.set(token, buffer);
    fileRefBufferCacheBytes += buffer.length;
  }

  function readFileRefBuffer(token: string): Buffer | undefined {
    pruneExpiredFileRefs();
    const cached = fileRefBufferCache.get(token);
    if (cached) {
      fileRefBufferCacheHits += 1;
      fileRefBufferCache.delete(token);
      fileRefBufferCache.set(token, cached);
      return cached;
    }

    const entry = fileRefStore.get(token)?.entry;
    if (!entry) {
      fileRefBufferCacheMisses += 1;
      return undefined;
    }

    fileRefBufferCacheMisses += 1;
    const buffer = Buffer.from(entry.base64Content, "base64");
    cacheBuffer(token, buffer);
    return buffer;
  }

  function deleteFileRef(token: string): boolean {
    pruneExpiredFileRefs();
    const stored = fileRefStore.get(token);
    if (!stored) {
      deleteCachedBuffer(token);
      return false;
    }
    removeStoredFileRef(token, stored);
    return true;
  }

  function deleteAuthorizedFileRef(token: string, ownerId: string | undefined): boolean {
    const entry = lookupAuthorizedFileRef(token, ownerId);
    return entry ? deleteFileRef(token) : false;
  }

  function getFileRefCacheStats(): FileRefCacheStats {
    pruneExpiredFileRefs();
    return {
      hits: fileRefBufferCacheHits,
      misses: fileRefBufferCacheMisses,
      fileRefs: fileRefStore.size,
      bufferEntries: fileRefBufferCache.size,
      storedBytes: fileRefStoreBytes,
      bufferBytes: fileRefBufferCacheBytes,
    };
  }

  function getFileRefStoreStats(): FileRefStoreStats {
    pruneExpiredFileRefs();
    return {
      fileRefs: fileRefStore.size,
      storedBytes: fileRefStoreBytes,
      maxCount,
      maxBytes,
      maxCountPerOwner,
      maxBytesPerOwner,
      bufferBytes: fileRefBufferCacheBytes,
      bufferCacheMaxBytes,
    };
  }

  function clearCache(): void {
    fileRefBufferCache.clear();
    fileRefBufferCacheBytes = 0;
    fileRefBufferCacheHits = 0;
    fileRefBufferCacheMisses = 0;
  }

  function clear(): void {
    for (const stored of fileRefStore.values()) {
      if (stored.cleanupTimer) clearTimeout(stored.cleanupTimer);
    }
    fileRefStore.clear();
    ownerUsage.clear();
    fileRefStoreBytes = 0;
    clearCache();
  }

  return {
    storeFileRef,
    assertFileRefCapacity,
    lookupFileRef,
    lookupAuthorizedFileRef,
    readFileRefBuffer,
    deleteFileRef,
    deleteAuthorizedFileRef,
    getFileRefCacheStats,
    getFileRefStoreStats,
    clearCache,
    clear,
    getSize: () => {
      pruneExpiredFileRefs();
      return fileRefStore.size;
    },
  };
}

const defaultFileRefStore = createFileRefStore();

export function assertFileRefCapacity(ownerId: string, sizeBytes: number): void {
  defaultFileRefStore.assertFileRefCapacity(ownerId, sizeBytes);
}

/** Persist a file reference in the bounded process-local store. */
export function storeFileRef(entry: FileRefEntry): string {
  return defaultFileRefStore.storeFileRef(entry);
}

/** Retrieve a previously stored file reference by UUID token. */
export function lookupFileRef(token: string): FileRefEntry | undefined {
  return defaultFileRefStore.lookupFileRef(token);
}

/** Retrieve a ref only when it belongs to the authenticated caller. */
export function lookupAuthorizedFileRef(
  token: string,
  ownerId: string | undefined,
): FileRefEntry | undefined {
  return defaultFileRefStore.lookupAuthorizedFileRef(token, ownerId);
}

/** Retrieve decoded bytes from the bounded LRU cache or decode the stored payload. */
export function readFileRefBuffer(token: string): Buffer | undefined {
  return defaultFileRefStore.readFileRefBuffer(token);
}

/** Invalidate a single file ref and its cached bytes. */
export function deleteFileRef(token: string): boolean {
  return defaultFileRefStore.deleteFileRef(token);
}

/** Delete a ref only when the authenticated caller owns it. */
export function deleteAuthorizedFileRef(token: string, ownerId: string | undefined): boolean {
  return defaultFileRefStore.deleteAuthorizedFileRef(token, ownerId);
}

/** Clear only the decoded-byte cache. For use in unit tests only. */
export function _clearFileRefCache(): void {
  defaultFileRefStore.clearCache();
}

/** Return cache counters and bounded storage bytes for diagnostics and tests. */
export function getFileRefCacheStats(): FileRefCacheStats {
  return defaultFileRefStore.getFileRefCacheStats();
}

/** Return current storage usage and the configured capacity ceilings. */
export function getFileRefStoreStats(): FileRefStoreStats {
  return defaultFileRefStore.getFileRefStoreStats();
}

/** Clear the default file ref store. For use in unit tests only. */
export function _clearFileRefStore(): void {
  defaultFileRefStore.clear();
}

/** Return the number of live file refs in the default store. */
export function _getFileRefStoreSize(): number {
  return defaultFileRefStore.getSize();
}

function capabilitySecret(): string {
  return process.env["AIPOWERED_FILE_CAPABILITY_SECRET"]?.trim() || generatedCapabilitySecret;
}

function signCapabilityPayload(payload: string): string {
  return createHmac("sha256", capabilitySecret()).update(payload).digest("base64url");
}

/**
 * Create a short-lived capability for a provider to fetch one uploaded ref.
 * The token is purpose-bound and provider-bound; it is not accepted by the
 * ordinary owner download route.
 */
export function createProviderFileCapability(
  fileRef: string,
  provider: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      fileRef,
      purpose: FILE_PROVIDER_CAPABILITY_PURPOSE,
      provider,
      expiresAt: now + FILE_PROVIDER_CAPABILITY_TTL_MS,
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signCapabilityPayload(payload)}`;
}

/**
 * Resolve and authorize a provider capability. The returned file ref is kept
 * separate from the ordinary owner-authenticated download path.
 */
export function lookupProviderFileCapability(
  capability: string,
  provider: string,
  now = Date.now(),
): { fileRef: string; entry: FileRefEntry } | undefined {
  const [payload, signature] = capability.split(".");
  if (!payload || !signature) return undefined;

  const expectedSignature = signCapabilityPayload(payload);
  const signatureBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expectedSignature, "utf8");
  if (
    signatureBytes.length !== expectedBytes.length ||
    !timingSafeEqual(signatureBytes, expectedBytes)
  ) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      fileRef?: unknown;
      purpose?: unknown;
      provider?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof parsed.fileRef !== "string" ||
      typeof parsed.provider !== "string" ||
      parsed.purpose !== FILE_PROVIDER_CAPABILITY_PURPOSE ||
      parsed.provider !== provider ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      now >= parsed.expiresAt
    ) {
      return undefined;
    }
    const entry = lookupFileRef(parsed.fileRef);
    return entry ? { fileRef: parsed.fileRef, entry } : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** Returns `true` when the MIME type is in the approved allowlist. */
export function validateMimeType(mimeType: string): boolean {
  return MIME_ALLOWLIST.has(mimeType);
}

/** Returns `true` when `sizeBytes` does not exceed the 50 MiB limit. */
export function validateFileSize(sizeBytes: number): boolean {
  return Number.isInteger(sizeBytes) && sizeBytes >= 0 && sizeBytes <= MAX_FILE_BYTES;
}

// ---------------------------------------------------------------------------
// Provider-native content block builder
// ---------------------------------------------------------------------------

export interface FileInput {
  filename: string;
  mimeType: string;
}

/**
 * Build a provider-native content block ready for inclusion in a messages array.
 *
 * Rules per provider:
 *
 * **openai**
 *   - image MIME + no fileId  → `{ type:"image_url", image_url:{ url:"data:…;base64,…" } }`
 *   - image MIME + fileId     → `{ type:"file", file:{ file_id } }`
 *   - application/pdf + no fileId → `{ type:"file", file:{ filename, file_data:"data:…;base64,…" } }`
 *   - application/pdf + fileId  → `{ type:"file", file:{ file_id } }`
 *   - text/* (html, plain, csv) → `{ type:"text", text:"<decoded UTF-8>" }` (OpenAI file API only accepts PDF)
 *   - other document + fileId → `{ type:"file", file:{ file_id } }`
 *   - other document + no fileId → `{ type:"file", file:{ filename, file_data:"data:…;base64,…" } }` (best-effort)
 *
 * **anthropic**
 *   - image MIME + no fileId  → `{ type:"image", source:{ type:"base64", media_type, data } }`
 *   - image MIME + fileId     → `{ type:"image", source:{ type:"file", file_id } }`
 *   - document MIME + no fileId → `{ type:"document", source:{ type:"base64", media_type, data } }`
 *   - document MIME + fileId  → `{ type:"document", source:{ type:"file", file_id } }`
 *
 * **xai**  All MIMEs → `{ type:"image_url", image_url:{ url:"data:…;base64,…" } }`
 *
 * **venice** Image MIMEs only → `{ type:"image_url", … }`. Non-image → throws.
 *
 * **lumaai** Image MIMEs only → `{ image_ref:[{ url:"data:…;base64,…", weight:1.0 }] }`. Non-image → throws.
 *
 * **pika** Image MIMEs → `{ type:"image_url", … }`; video MIMEs →
 * `{ type:"video_url", … }`.
 *
 * @throws {ProviderCapabilityError} when the provider does not support the given file type.
 */
export function buildFileContentBlock(
  provider: string,
  _model: string,
  file: FileInput,
  base64Content: string,
  fileId?: string,
): Record<string, unknown> {
  const normalizedFile = {
    ...file,
    filename: normalizeStoredFilename(file.filename),
  };
  const dataUrl = `data:${normalizedFile.mimeType};base64,${base64Content}`;
  const isImage = IMAGE_MIMES.has(normalizedFile.mimeType);

  switch (provider) {
    case "openrouter":
    case "openai":
      if (fileId) return { type: "file", file: { file_id: fileId } };
      if (isImage) return { type: "image_url", image_url: { url: dataUrl } };
      // OpenAI's file API (file_data) only accepts application/pdf.
      // For text-based types, decode to UTF-8 and send as a plain text content block instead.
      if (normalizedFile.mimeType === "application/pdf") {
        return { type: "file", file: { filename: normalizedFile.filename, file_data: dataUrl } };
      }
      if (normalizedFile.mimeType.startsWith("text/")) {
        const decoded = Buffer.from(base64Content, "base64").toString("utf-8");
        return { type: "text", text: decoded };
      }
      // Office / other binary formats: best-effort via the file block.
      return { type: "file", file: { filename: normalizedFile.filename, file_data: dataUrl } };

    case "anthropic": {
      if (isImage) {
        const src = fileId
          ? { type: "file", file_id: fileId }
          : { type: "base64", media_type: normalizedFile.mimeType, data: base64Content };
        return { type: "image", source: src };
      }
      const docSrc = fileId
        ? { type: "file", file_id: fileId }
        : { type: "base64", media_type: normalizedFile.mimeType, data: base64Content };
      return { type: "document", source: docSrc };
    }

    case "xai":
      return { type: "image_url", image_url: { url: dataUrl } };

    case "venice":
      if (!isImage) throw new ProviderCapabilityError("venice" as never, "text" as never);
      return { type: "image_url", image_url: { url: dataUrl } };

    case "lumaai":
      if (!isImage) throw new ProviderCapabilityError("lumaai" as never, "text" as never);
      return { image_ref: [{ url: dataUrl, weight: 1.0 }] };

    case "pika":
      if (isImage) return { type: "image_url", image_url: { url: dataUrl } };
      if (VIDEO_MIMES.has(normalizedFile.mimeType)) {
        return { type: "video_url", video_url: { url: dataUrl } };
      }
      throw new ProviderCapabilityError("pika" as never, "video" as never);

    default:
      throw new ProviderCapabilityError(provider as never, "text" as never);
  }
}
