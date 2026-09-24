/**
 * @file tests/unit/file-handler.test.ts
 *
 * Unit tests for the pure functions exported by src/ai-powered/server/file-handler.ts.
 *
 * Covers:
 *   - buildFileContentBlock() for all supported providers
 *   - validateMimeType() and validateFileSize()
 *   - storeFileRef() and lookupFileRef()
 */

import {
  buildFileContentBlock,
  createFileRefStore,
  FILE_REF_BUFFER_CACHE_MAX_BYTES,
  FILE_REF_TTL_MS,
  FileRefCapacityError,
  _clearFileRefStore,
  _getFileRefStoreSize,
  deleteFileRef,
  getFileRefCacheStats,
  getFileRefStoreStats,
  lookupFileRef,
  normalizeStoredFilename,
  readFileRefBuffer,
  storeFileRef,
  validateMimeType,
  validateFileSize,
} from "../../src/ai-powered/server/file-handler.js";
import { ProviderCapabilityError } from "../../src/ai-powered/types.js";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PNG_MIME = "image/png";
const PDF_MIME = "application/pdf";
const CSV_MIME = "text/csv";
const HTML_MIME = "text/html";
const TXT_MIME = "text/plain";
const VIDEO_MIME = "video/mp4";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const B64 = "dGVzdA=="; // base64("test")
const FILE_ID = "file-abc123";

const pngFile = { filename: "photo.png", mimeType: PNG_MIME };
const pdfFile = { filename: "doc.pdf", mimeType: PDF_MIME };
const csvFile = { filename: "data.csv", mimeType: CSV_MIME };
const htmlFile = { filename: "page.html", mimeType: HTML_MIME };
const txtFile = { filename: "notes.txt", mimeType: TXT_MIME };
const videoFile = { filename: "clip.mp4", mimeType: VIDEO_MIME };
const docxFile = { filename: "report.docx", mimeType: DOCX_MIME };

// ---------------------------------------------------------------------------
// buildFileContentBlock — OpenAI
// ---------------------------------------------------------------------------

describe("buildFileContentBlock — OpenAI", () => {
  it("U-OA-1: image MIME, no fileId → image_url block with data URI", () => {
    const block = buildFileContentBlock("openai", "", pngFile, B64);
    expect(block).toEqual({
      type: "image_url",
      image_url: { url: `data:${PNG_MIME};base64,${B64}` },
    });
  });

  it("U-OA-2: PDF MIME, no fileId → file block with filename and file_data", () => {
    const block = buildFileContentBlock("openai", "", pdfFile, B64);
    expect(block).toEqual({
      type: "file",
      file: { filename: "doc.pdf", file_data: `data:${PDF_MIME};base64,${B64}` },
    });
  });

  it("U-OA-3: PDF MIME, fileId set → file block with file_id only", () => {
    const block = buildFileContentBlock("openai", "", pdfFile, B64, FILE_ID);
    expect(block).toEqual({ type: "file", file: { file_id: FILE_ID } });
  });

  it("U-OA-4: DOCX MIME → document file block (best-effort for binary formats)", () => {
    const block = buildFileContentBlock("openai", "", docxFile, B64);
    expect(block["type"]).toBe("file");
    expect((block["file"] as Record<string, unknown>)["filename"]).toBe("report.docx");
  });

  it("U-OA-5: text/html MIME → text content block with decoded UTF-8 content", () => {
    // B64 = base64("test") → decoded = "test"
    const block = buildFileContentBlock("openai", "", htmlFile, B64);
    expect(block).toEqual({ type: "text", text: "test" });
  });

  it("U-OA-6: text/plain MIME → text content block with decoded UTF-8 content", () => {
    const block = buildFileContentBlock("openai", "", txtFile, B64);
    expect(block).toEqual({ type: "text", text: "test" });
  });

  it("U-OA-7: text/csv MIME → text content block with decoded UTF-8 content", () => {
    const block = buildFileContentBlock("openai", "", csvFile, B64);
    expect(block).toEqual({ type: "text", text: "test" });
  });

  it("U-OA-8: text/html MIME with fileId → file block with file_id (server-uploaded file)", () => {
    // When the file has already been uploaded to OpenAI, fileId takes precedence.
    const block = buildFileContentBlock("openai", "", htmlFile, B64, FILE_ID);
    expect(block).toEqual({ type: "file", file: { file_id: FILE_ID } });
  });
});

// ---------------------------------------------------------------------------
// buildFileContentBlock — Anthropic
// ---------------------------------------------------------------------------

describe("buildFileContentBlock — Anthropic", () => {
  it("U-AN-1: image MIME, no fileId → image block with base64 source", () => {
    const block = buildFileContentBlock("anthropic", "", pngFile, B64);
    expect(block).toEqual({
      type: "image",
      source: { type: "base64", media_type: PNG_MIME, data: B64 },
    });
  });

  it("U-AN-2: image MIME, fileId set → image block with file source", () => {
    const block = buildFileContentBlock("anthropic", "", pngFile, B64, FILE_ID);
    expect(block).toEqual({
      type: "image",
      source: { type: "file", file_id: FILE_ID },
    });
  });

  it("U-AN-3: PDF MIME, no fileId → document block with base64 source", () => {
    const block = buildFileContentBlock("anthropic", "", pdfFile, B64);
    expect(block).toEqual({
      type: "document",
      source: { type: "base64", media_type: PDF_MIME, data: B64 },
    });
  });

  it("U-AN-4: PDF MIME, fileId set → document block with file source", () => {
    const block = buildFileContentBlock("anthropic", "", pdfFile, B64, FILE_ID);
    expect(block).toEqual({
      type: "document",
      source: { type: "file", file_id: FILE_ID },
    });
  });
});

// ---------------------------------------------------------------------------
// buildFileContentBlock — xAI / Grok
// ---------------------------------------------------------------------------

describe("buildFileContentBlock — xAI", () => {
  it("U-XA-1: image MIME → image_url block with data URI", () => {
    const block = buildFileContentBlock("xai", "", pngFile, B64);
    expect(block).toEqual({
      type: "image_url",
      image_url: { url: `data:${PNG_MIME};base64,${B64}` },
    });
  });

  it("U-XA-2: PDF MIME → image_url block (Grok handles PDFs via vision mode)", () => {
    const block = buildFileContentBlock("xai", "", pdfFile, B64);
    expect(block).toEqual({
      type: "image_url",
      image_url: { url: `data:${PDF_MIME};base64,${B64}` },
    });
  });
});

// ---------------------------------------------------------------------------
// buildFileContentBlock — Venice
// ---------------------------------------------------------------------------

describe("buildFileContentBlock — Venice", () => {
  it("U-VE-1: image MIME → image_url block", () => {
    const block = buildFileContentBlock("venice", "", pngFile, B64);
    expect(block).toEqual({
      type: "image_url",
      image_url: { url: `data:${PNG_MIME};base64,${B64}` },
    });
  });

  it("U-VE-2: PDF MIME → throws ProviderCapabilityError", () => {
    expect(() => buildFileContentBlock("venice", "", pdfFile, B64)).toThrow(
      ProviderCapabilityError,
    );
  });

  it("U-VE-3: CSV MIME → throws ProviderCapabilityError", () => {
    expect(() => buildFileContentBlock("venice", "", csvFile, B64)).toThrow(
      ProviderCapabilityError,
    );
  });
});

// ---------------------------------------------------------------------------
// buildFileContentBlock — Luma AI
// ---------------------------------------------------------------------------

describe("buildFileContentBlock — Luma AI", () => {
  it("U-LU-1: image MIME → image_ref array block", () => {
    const block = buildFileContentBlock("lumaai", "", pngFile, B64);
    expect(block).toEqual({
      image_ref: [{ url: `data:${PNG_MIME};base64,${B64}`, weight: 1.0 }],
    });
  });

  it("U-LU-2: PDF MIME → throws ProviderCapabilityError", () => {
    expect(() => buildFileContentBlock("lumaai", "", pdfFile, B64)).toThrow(
      ProviderCapabilityError,
    );
  });
});

// ---------------------------------------------------------------------------
// buildFileContentBlock — Pika
// ---------------------------------------------------------------------------

describe("buildFileContentBlock — Pika", () => {
  it("U-PI-1: image MIME → image_url block", () => {
    const block = buildFileContentBlock("pika", "", pngFile, B64);
    expect(block).toEqual({
      type: "image_url",
      image_url: { url: `data:${PNG_MIME};base64,${B64}` },
    });
  });

  it("U-PI-2: video MIME → video_url block", () => {
    const block = buildFileContentBlock("pika", "", videoFile, B64);
    expect(block).toEqual({
      type: "video_url",
      video_url: { url: `data:${VIDEO_MIME};base64,${B64}` },
    });
  });

  it("U-PI-3: PDF MIME → throws ProviderCapabilityError", () => {
    expect(() => buildFileContentBlock("pika", "", pdfFile, B64)).toThrow(ProviderCapabilityError);
  });
});

// buildFileContentBlock — Unknown provider
// ---------------------------------------------------------------------------

describe("buildFileContentBlock — Unknown provider", () => {
  it("U-UK-1: unknown provider with any MIME → throws ProviderCapabilityError", () => {
    expect(() => buildFileContentBlock("runway", "", pngFile, B64)).toThrow(
      ProviderCapabilityError,
    );
  });
});

// ---------------------------------------------------------------------------
// validateMimeType
// ---------------------------------------------------------------------------

describe("validateMimeType", () => {
  it("U-VA-1: image/png → true", () => {
    expect(validateMimeType("image/png")).toBe(true);
  });

  it("U-VA-2: application/zip → false", () => {
    expect(validateMimeType("application/zip")).toBe(false);
  });

  it("allows all allowlisted MIMEs", () => {
    const allowed = [
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/html",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    for (const mime of allowed) {
      expect(validateMimeType(mime)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateFileSize
// ---------------------------------------------------------------------------

describe("validateFileSize", () => {
  it("U-VA-3: 50 MiB exactly (52_428_800 bytes) → true", () => {
    expect(validateFileSize(52_428_800)).toBe(true);
  });

  it("U-VA-4: 50 MiB + 1 byte (52_428_801 bytes) → false", () => {
    expect(validateFileSize(52_428_801)).toBe(false);
  });

  it("0 bytes → true", () => {
    expect(validateFileSize(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mobile-upload scenarios
// ---------------------------------------------------------------------------

/**
 * Mobile phones (iOS/Android) introduce two extra failure modes:
 *
 *   1. HEIC/HEIF format  — iOS cameras default to HEIC.  The server intentionally
 *      rejects it (no AI provider accepts HEIC natively).  The web demo handles
 *      this client-side: Safari decodes HEIC via createImageBitmap() and
 *      re-encodes it as JPEG before the upload reaches the server.
 *
 *   2. Large JPEG files  — Modern phones produce 8-15 MiB JPEGs.  The server
 *      multer limit is 50 MiB, so typical mobile photos always pass the size
 *      check.  The web demo additionally pre-compresses large images client-side
 *      to reduce upload time over slow tunnels (e.g. ngrok).
 */
describe("validateMimeType — mobile scenarios", () => {
  it("U-MOB-1: image/heic → false (HEIC not in allowlist; client-side converts before upload)", () => {
    expect(validateMimeType("image/heic")).toBe(false);
  });

  it("U-MOB-2: image/heif → false (same as HEIC — Apple variant name)", () => {
    expect(validateMimeType("image/heif")).toBe(false);
  });

  it("U-MOB-3: image/jpeg → true (iOS auto-converts HEIC, or client compresses)", () => {
    expect(validateMimeType("image/jpeg")).toBe(true);
  });

  it("U-MOB-3b: image/webp → true (common Android camera format)", () => {
    expect(validateMimeType("image/webp")).toBe(true);
  });
});

describe("validateFileSize — mobile scenarios", () => {
  it("U-MOB-4: 8 MiB (typical 12 MP JPEG from iPhone) → true", () => {
    expect(validateFileSize(8 * 1024 * 1024)).toBe(true);
  });

  it("U-MOB-5: 15 MiB (high-res JPEG or screenshot) → true (under 50 MiB server limit)", () => {
    expect(validateFileSize(15 * 1024 * 1024)).toBe(true);
  });

  it("U-MOB-6: 51 MiB (exceeds 50 MiB limit) → false", () => {
    expect(validateFileSize(51 * 1024 * 1024)).toBe(false);
  });

  it("U-MOB-7: 49.9 MiB → true (just under limit)", () => {
    expect(validateFileSize(Math.floor(49.9 * 1024 * 1024))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// storeFileRef / lookupFileRef
// ---------------------------------------------------------------------------

describe("storeFileRef / lookupFileRef", () => {
  it("U-FR-1: storeFileRef returns a UUID-format string", () => {
    const entry = {
      filename: "test.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "openai",
    };
    const token = storeFileRef(entry);
    expect(typeof token).toBe("string");
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("U-FR-2: lookupFileRef returns the stored FileRefEntry for a known token", () => {
    const entry = {
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "anthropic",
    };
    const token = storeFileRef(entry);
    const result = lookupFileRef(token);
    expect(result).toBeDefined();
    expect(result!.filename).toBe("invoice.pdf");
    expect(result!.mimeType).toBe("application/pdf");
    expect(result!.sizeBytes).toBe(2048);
    expect(result!.provider).toBe("anthropic");
  });

  it("U-FR-3: lookupFileRef returns undefined for an unknown token", () => {
    expect(lookupFileRef("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// storeFileRef / lookupFileRef TTL behaviour
// ---------------------------------------------------------------------------

describe("storeFileRef / lookupFileRef TTL behaviour", () => {
  beforeEach(() => {
    _clearFileRefStore();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _clearFileRefStore();
  });

  it("U-FR-4: lookupFileRef returns the stored entry before the TTL expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const entry = {
      filename: "preview.png",
      mimeType: "image/png",
      sizeBytes: 4096,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "openai",
    };
    const token = storeFileRef(entry);

    vi.advanceTimersByTime(FILE_REF_TTL_MS - 1);

    const firstLookup = lookupFileRef(token);
    const secondLookup = lookupFileRef(token);

    expect(firstLookup).toEqual(entry);
    expect(secondLookup).toEqual(entry);
    expect(_getFileRefStoreSize()).toBe(1);
  });

  it("U-FR-5: lookupFileRef removes expired entries and returns undefined after the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const entry = {
      filename: "expired.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8192,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "anthropic",
    };
    const token = storeFileRef(entry);

    expect(_getFileRefStoreSize()).toBe(1);

    vi.advanceTimersByTime(FILE_REF_TTL_MS + 1);

    expect(lookupFileRef(token)).toBeUndefined();
    expect(_getFileRefStoreSize()).toBe(0);
  });

  it("U-FR-6: storing a new ref prunes expired entries before the next upload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const expiredEntry = {
      filename: "stale.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "openai",
    };
    const freshEntry = {
      filename: "fresh.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "openai",
    };

    const staleToken = storeFileRef(expiredEntry);
    vi.advanceTimersByTime(FILE_REF_TTL_MS + 1);

    const freshToken = storeFileRef(freshEntry);

    expect(_getFileRefStoreSize()).toBe(1);
    expect(lookupFileRef(staleToken)).toBeUndefined();
    expect(lookupFileRef(freshToken)).toEqual(freshEntry);
  });
});

// ---------------------------------------------------------------------------
// file ref cache + path safety
// ---------------------------------------------------------------------------

describe("file ref cache + path safety", () => {
  beforeEach(() => {
    _clearFileRefStore();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _clearFileRefStore();
  });

  it("normalizes stored filenames to a basename without traversal segments", () => {
    const unsafeEntry = {
      filename: "..\\nested/../../safe-report.pdf",
      mimeType: PDF_MIME,
      sizeBytes: 1024,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "openai",
    };

    const token = storeFileRef(unsafeEntry);
    const result = lookupFileRef(token);
    const block = buildFileContentBlock("openai", "", unsafeEntry, B64);

    expect(result?.filename).toBe("safe-report.pdf");
    expect(normalizeStoredFilename(unsafeEntry.filename)).toBe("safe-report.pdf");
    expect(block).toEqual({
      type: "file",
      file: { filename: "safe-report.pdf", file_data: `data:${PDF_MIME};base64,${B64}` },
    });
  });

  it("caches decoded bytes, reports hits and misses, and invalidates on delete", () => {
    const entry = {
      filename: "cached.png",
      mimeType: PNG_MIME,
      sizeBytes: 1024,
      base64Content: B64,
      ownerId: "test-owner",
      provider: "openai",
    };

    const token = storeFileRef(entry);

    expect(getFileRefCacheStats()).toEqual({
      hits: 0,
      misses: 0,
      fileRefs: 1,
      bufferEntries: 0,
      storedBytes: 1024,
      bufferBytes: 0,
    });

    const first = readFileRefBuffer(token);
    const second = readFileRefBuffer(token);

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(first!.equals(Buffer.from(B64, "base64"))).toBe(true);
    expect(getFileRefCacheStats()).toEqual({
      hits: 1,
      misses: 1,
      fileRefs: 1,
      bufferEntries: 1,
      storedBytes: 1024,
      bufferBytes: 4,
    });

    expect(deleteFileRef(token)).toBe(true);
    expect(readFileRefBuffer(token)).toBeUndefined();
    expect(getFileRefCacheStats()).toEqual({
      hits: 1,
      misses: 2,
      fileRefs: 0,
      bufferEntries: 0,
      storedBytes: 0,
      bufferBytes: 0,
    });
  });
});

describe("bounded file ref stores", () => {
  const entry = (ownerId: string, sizeBytes: number, content = B64) => ({
    filename: "bounded.png",
    mimeType: PNG_MIME,
    sizeBytes,
    base64Content: content,
    ownerId,
    provider: "openai",
  });

  it("rejects aggregate count and byte quotas before storing a new ref", () => {
    const countStore = createFileRefStore({
      maxCount: 1,
      maxBytes: 100,
      maxCountPerOwner: 10,
      maxBytesPerOwner: 100,
      bufferCacheMaxBytes: 4,
    });
    countStore.storeFileRef(entry("owner-a", 1));
    expect(() => countStore.storeFileRef(entry("owner-b", 1))).toThrow(FileRefCapacityError);
    expect(() => countStore.storeFileRef(entry("owner-b", 1))).toThrow(
      expect.objectContaining({ reason: "global-count" }),
    );
    expect(countStore.getFileRefStoreStats().fileRefs).toBe(1);
    countStore.clear();

    const byteStore = createFileRefStore({
      maxCount: 10,
      maxBytes: 5,
      maxCountPerOwner: 10,
      maxBytesPerOwner: 5,
      bufferCacheMaxBytes: 4,
    });
    byteStore.storeFileRef(entry("owner-a", 5));
    expect(() => byteStore.storeFileRef(entry("owner-b", 1))).toThrow(
      expect.objectContaining({ reason: "global-bytes" }),
    );
    expect(getFileRefStoreStats().storedBytes).toBe(0);
    expect(byteStore.getFileRefStoreStats().storedBytes).toBe(5);
    byteStore.clear();
  });

  it("enforces per-principal count and byte quotas", () => {
    const byteStore = createFileRefStore({
      maxCount: 10,
      maxBytes: 100,
      maxCountPerOwner: 10,
      maxBytesPerOwner: 5,
      bufferCacheMaxBytes: 4,
    });
    byteStore.storeFileRef(entry("owner-a", 5));
    expect(() => byteStore.storeFileRef(entry("owner-a", 1))).toThrow(
      expect.objectContaining({ reason: "principal-bytes" }),
    );
    byteStore.clear();

    const countStore = createFileRefStore({
      maxCount: 10,
      maxBytes: 100,
      maxCountPerOwner: 1,
      maxBytesPerOwner: 100,
      bufferCacheMaxBytes: 4,
    });
    countStore.storeFileRef(entry("owner-a", 1));
    expect(() => countStore.storeFileRef(entry("owner-a", 1))).toThrow(
      expect.objectContaining({ reason: "principal-count" }),
    );
    countStore.clear();
  });

  it("keeps concurrent uploads within the principal quota", async () => {
    const store = createFileRefStore({
      maxCount: 25,
      maxBytes: 100,
      maxCountPerOwner: 20,
      maxBytesPerOwner: 100,
      bufferCacheMaxBytes: 4,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        Promise.resolve().then(() => store.storeFileRef(entry("owner-a", 1))),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
    expect(store.getFileRefStoreStats().fileRefs).toBe(20);
    store.clear();
  });

  it("eagerly expires refs and evicts decoded buffers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = createFileRefStore({
      maxCount: 10,
      maxBytes: 100,
      maxCountPerOwner: 10,
      maxBytesPerOwner: 100,
      bufferCacheMaxBytes: 4,
    });
    const token = store.storeFileRef(entry("owner-a", 4));
    expect(store.readFileRefBuffer(token)).toBeDefined();
    expect(store.getFileRefCacheStats().bufferEntries).toBe(1);

    vi.advanceTimersByTime(FILE_REF_TTL_MS + 1);

    expect(store.lookupFileRef(token)).toBeUndefined();
    expect(store.getFileRefCacheStats()).toEqual({
      hits: 0,
      misses: 1,
      fileRefs: 0,
      bufferEntries: 0,
      storedBytes: 0,
      bufferBytes: 0,
    });
    store.clear();
    vi.useRealTimers();
  });

  it("evicts the least recently used decoded buffer at its byte ceiling", () => {
    const store = createFileRefStore({
      maxCount: 10,
      maxBytes: 100,
      maxCountPerOwner: 10,
      maxBytesPerOwner: 100,
      bufferCacheMaxBytes: 4,
    });
    const first = store.storeFileRef(entry("owner-a", 4, B64));
    const second = store.storeFileRef(entry("owner-a", 4, "bW9yZQ=="));

    expect(store.readFileRefBuffer(first)).toBeDefined();
    expect(store.readFileRefBuffer(second)).toBeDefined();
    expect(store.getFileRefCacheStats().bufferEntries).toBe(1);
    expect(store.getFileRefCacheStats().bufferBytes).toBe(4);
    expect(store.readFileRefBuffer(first)).toBeDefined();
    expect(store.getFileRefCacheStats().bufferEntries).toBe(1);
    store.clear();
  });

  it("does not share refs between isolated instances and reset clears a store", () => {
    const first = createFileRefStore({
      maxCount: 2,
      maxBytes: 10,
      maxCountPerOwner: 2,
      maxBytesPerOwner: 10,
    });
    const second = createFileRefStore({
      maxCount: 2,
      maxBytes: 10,
      maxCountPerOwner: 2,
      maxBytesPerOwner: 10,
    });
    const token = first.storeFileRef(entry("owner-a", 1));

    expect(first.lookupFileRef(token)).toBeDefined();
    expect(second.lookupFileRef(token)).toBeUndefined();
    first.clear();
    expect(first.lookupFileRef(token)).toBeUndefined();
    second.clear();
  });

  it("exposes the configured storage and buffer ceilings", () => {
    const stats = getFileRefStoreStats();
    expect(stats.maxCount).toBeGreaterThan(0);
    expect(stats.maxBytes).toBeGreaterThan(0);
    expect(stats.maxCountPerOwner).toBeGreaterThan(0);
    expect(stats.maxBytesPerOwner).toBeGreaterThan(0);
    expect(stats.bufferCacheMaxBytes).toBe(FILE_REF_BUFFER_CACHE_MAX_BYTES);
  });
});
