/**
 * @file src/ai-powered/server/file-handler.ts
 *
 * File upload utilities for the ai-powered proxy server.
 *
 * Exports:
 *   MIME_ALLOWLIST            – Set of accepted MIME types
 *   FILE_REF_TTL_MS           – In-memory retention window for uploaded refs
 *   FileRefEntry              – Interface for stored file reference data
 *   storeFileRef()            – Store a file ref in the in-memory map; return UUID token
 *   lookupFileRef()           – Retrieve a file ref by UUID token
 *   readFileRefBuffer()       – Retrieve cached decoded bytes for a UUID token
 *   validateMimeType()        – Check if a MIME type is in the allowlist
 *   validateFileSize()        – Check if a file size is within the 50 MiB limit
 *   FileInput                 – Interface for the file descriptor passed to buildFileContentBlock()
 *   buildFileContentBlock()   – Build a provider-native content block for a given file
 */

import { randomUUID } from "node:crypto";
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
// File reference store (in-memory; v2 will swap to persistent storage)
// ---------------------------------------------------------------------------

/** File refs are retained for 1 hour, then pruned on lookup or the next write. */
export const FILE_REF_TTL_MS = 60 * 60 * 1000;

export interface FileRefEntry {
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
}

const fileRefStore = new Map<string, StoredFileRefEntry>();
const fileRefBufferCache = new Map<string, Buffer>();
let fileRefBufferCacheHits = 0;
let fileRefBufferCacheMisses = 0;

export interface FileRefCacheStats {
  hits: number;
  misses: number;
  fileRefs: number;
  bufferEntries: number;
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

/** Remove expired entries so the in-memory store stays bounded. */
function pruneExpiredFileRefs(now = Date.now()): void {
  for (const [token, stored] of fileRefStore) {
    if (now >= stored.expiresAt) {
      fileRefStore.delete(token);
      fileRefBufferCache.delete(token);
    }
  }
}

/**
 * Persist a file reference in the in-memory store.
 * @returns A UUID token that can be passed back to callers as `fileRef`.
 */
export function storeFileRef(entry: FileRefEntry): string {
  pruneExpiredFileRefs();
  const token = randomUUID();
  fileRefStore.set(token, {
    entry: {
      ...entry,
      filename: normalizeStoredFilename(entry.filename),
    },
    expiresAt: Date.now() + FILE_REF_TTL_MS,
  });
  fileRefBufferCache.delete(token);
  return token;
}

/**
 * Retrieve a previously stored file reference by its UUID token.
 * Returns `undefined` if the token is not found.
 */
export function lookupFileRef(token: string): FileRefEntry | undefined {
  pruneExpiredFileRefs();
  return fileRefStore.get(token)?.entry;
}

/**
 * Retrieve the decoded bytes for a stored file reference.
 *
 * The first access decodes the base64 payload and caches the Buffer. Subsequent
 * reads hit the cache until the ref expires or is invalidated.
 */
export function readFileRefBuffer(token: string): Buffer | undefined {
  pruneExpiredFileRefs();
  const cached = fileRefBufferCache.get(token);
  if (cached) {
    fileRefBufferCacheHits += 1;
    return cached;
  }

  const entry = fileRefStore.get(token)?.entry;
  if (!entry) {
    fileRefBufferCacheMisses += 1;
    return undefined;
  }

  fileRefBufferCacheMisses += 1;
  const buffer = Buffer.from(entry.base64Content, "base64");
  fileRefBufferCache.set(token, buffer);
  return buffer;
}

/**
 * Invalidate a single file ref and its cached bytes.
 * Returns `true` when an entry was removed.
 */
export function deleteFileRef(token: string): boolean {
  pruneExpiredFileRefs();
  const removed = fileRefStore.delete(token);
  fileRefBufferCache.delete(token);
  return removed;
}

/** Clear only the decoded-byte cache. For use in unit tests only. */
export function _clearFileRefCache(): void {
  fileRefBufferCache.clear();
  fileRefBufferCacheHits = 0;
  fileRefBufferCacheMisses = 0;
}

/** Return cache counters for tests and diagnostics. */
export function getFileRefCacheStats(): FileRefCacheStats {
  pruneExpiredFileRefs();
  return {
    hits: fileRefBufferCacheHits,
    misses: fileRefBufferCacheMisses,
    fileRefs: fileRefStore.size,
    bufferEntries: fileRefBufferCache.size,
  };
}

/**
 * Clear the file ref store. For use in unit tests only.
 * @internal
 */
export function _clearFileRefStore(): void {
  fileRefStore.clear();
  _clearFileRefCache();
}

/**
 * Returns the current number of live file refs in the in-memory store.
 * For use in unit tests only.
 * @internal
 */
export function _getFileRefStoreSize(): number {
  pruneExpiredFileRefs();
  return fileRefStore.size;
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
