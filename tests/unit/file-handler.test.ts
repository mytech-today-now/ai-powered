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
  FILE_REF_TTL_MS,
  _clearFileRefStore,
  _getFileRefStoreSize,
  validateMimeType,
  validateFileSize,
  storeFileRef,
  lookupFileRef,
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
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const B64 = "dGVzdA=="; // base64("test")
const FILE_ID = "file-abc123";

const pngFile = { filename: "photo.png", mimeType: PNG_MIME };
const pdfFile = { filename: "doc.pdf", mimeType: PDF_MIME };
const csvFile = { filename: "data.csv", mimeType: CSV_MIME };
const htmlFile = { filename: "page.html", mimeType: HTML_MIME };
const txtFile = { filename: "notes.txt", mimeType: TXT_MIME };
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
      provider: "openai",
    };
    const freshEntry = {
      filename: "fresh.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      base64Content: B64,
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
