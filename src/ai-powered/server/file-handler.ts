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
 *   validateMimeType()        – Check if a MIME type is in the allowlist
 *   validateFileSize()        – Check if a file size is within the 50 MiB limit
 *   FileInput                 – Interface for the file descriptor passed to buildFileContentBlock()
 *   buildFileContentBlock()   – Build a provider-native content block for a given file
 */

import { randomUUID } from "node:crypto";
import { ProviderCapabilityError } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIME_ALLOWLIST = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/html",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

/** Remove expired entries so the in-memory store stays bounded. */
function pruneExpiredFileRefs(now = Date.now()): void {
  for (const [token, stored] of fileRefStore) {
    if (now >= stored.expiresAt) {
      fileRefStore.delete(token);
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
    entry,
    expiresAt: Date.now() + FILE_REF_TTL_MS,
  });
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
 * Clear the file ref store. For use in unit tests only.
 * @internal
 */
export function _clearFileRefStore(): void {
  fileRefStore.clear();
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
  return sizeBytes <= MAX_FILE_BYTES;
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
 * @throws {ProviderCapabilityError} when the provider does not support the given file type.
 */
export function buildFileContentBlock(
  provider: string,
  _model: string,
  file: FileInput,
  base64Content: string,
  fileId?: string,
): Record<string, unknown> {
  const dataUrl = `data:${file.mimeType};base64,${base64Content}`;
  const isImage = IMAGE_MIMES.has(file.mimeType);

  switch (provider) {
    case "openai":
      if (fileId) return { type: "file", file: { file_id: fileId } };
      if (isImage) return { type: "image_url", image_url: { url: dataUrl } };
      // OpenAI's file API (file_data) only accepts application/pdf.
      // For text-based types, decode to UTF-8 and send as a plain text content block instead.
      if (file.mimeType === "application/pdf") {
        return { type: "file", file: { filename: file.filename, file_data: dataUrl } };
      }
      if (file.mimeType.startsWith("text/")) {
        const decoded = Buffer.from(base64Content, "base64").toString("utf-8");
        return { type: "text", text: decoded };
      }
      // Office / other binary formats: best-effort via the file block.
      return { type: "file", file: { filename: file.filename, file_data: dataUrl } };

    case "anthropic": {
      if (isImage) {
        const src = fileId
          ? { type: "file", file_id: fileId }
          : { type: "base64", media_type: file.mimeType, data: base64Content };
        return { type: "image", source: src };
      }
      const docSrc = fileId
        ? { type: "file", file_id: fileId }
        : { type: "base64", media_type: file.mimeType, data: base64Content };
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

    default:
      throw new ProviderCapabilityError(provider as never, "text" as never);
  }
}
