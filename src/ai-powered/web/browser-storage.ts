/**
 * @file src/ai-powered/web/browser-storage.ts
 *
 * Browser-safe persistence helpers for the web demo and info page.
 */

/// <reference lib="dom" />

import type { WebMessage } from "./fetch-client.js";

export type BrowserModality = "text" | "image" | "audio" | "video" | "structured";
export type BrowserRecordKind = "session" | "artifact";
export type BrowserRecordStatus = "draft" | "complete" | "error";
export type BrowserReferenceCollection = "image" | "video";
export type BrowserReferenceKind = "image" | "video" | "invalid";
export type BrowserReferenceUploadState = "pending" | "ready" | "error";

export interface BrowserReferenceStorageItem {
  id: string;
  collection: BrowserReferenceCollection;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  lastModified: number;
  fingerprint: string;
  referenceKind: BrowserReferenceKind;
  uploadState: BrowserReferenceUploadState;
  fileRef: string | null;
  error: string | null;
  blob: Blob;
}

export interface BrowserReferenceStorage {
  schemaVersion: number;
  items: BrowserReferenceStorageItem[];
}

export interface BrowserRecordMetadata {
  prompt: string;
  provider: string;
  model: string;
  styleId: string;
  seed: number | null;
  aspectRatio: string;
  resolution: string;
  quality: string;
  duration: number | null;
  fps: number | null;
  title: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  kind: BrowserRecordKind;
  status: BrowserRecordStatus;
  transcript: string;
  messages: WebMessage[];
  outputText: string;
  outputSummary: string;
  fileName: string;
  mimeType: string | null;
  metadata: Record<string, unknown>;
}

export interface BrowserRecord extends BrowserRecordMetadata {
  id: string;
  modality: BrowserModality;
  createdAt: string;
  updatedAt: string;
  artifact: Blob | null;
  preview: Blob | null;
}

export interface BrowserRecordDraft extends Partial<BrowserRecordMetadata> {
  id?: string;
  modality: BrowserModality;
  artifact?: Blob | null;
  preview?: Blob | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrowserRecordPatch {
  title?: string;
  notes?: string;
  tags?: string[];
  favorite?: boolean;
}

export interface BrowserRecordSummary {
  backend: "indexeddb" | "memory";
  warning: string | null;
  totalRecords: number;
  countsByModality: Record<BrowserModality, number>;
  cacheKeys: string[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
}

export interface BrowserStorageOptions {
  dbName?: string;
  dbVersion?: number;
  backend?: "auto" | "indexeddb" | "memory";
  localStorage?: Storage | null;
  sessionStorage?: Storage | null;
  storagePrefixes?: string[];
  remoteCachePrefixes?: string[];
}

export interface BrowserRecordStore {
  readonly backend: "indexeddb" | "memory";
  readonly warning: string | null;
  readonly ready: Promise<void>;
  listRecords(modality?: BrowserModality | "all"): Promise<BrowserRecord[]>;
  getRecord(id: string): Promise<BrowserRecord | null>;
  saveRecord(draft: BrowserRecordDraft): Promise<BrowserRecord>;
  updateRecordMetadata(id: string, patch: BrowserRecordPatch): Promise<BrowserRecord | null>;
  replaceRecordArtifact(
    id: string,
    artifact: Blob | null,
    preview?: Blob | null,
    mimeType?: string | null,
    fileName?: string,
  ): Promise<BrowserRecord | null>;
  deleteRecord(id: string): Promise<boolean>;
  deleteRecords(ids: string[]): Promise<number>;
  clearRecords(): Promise<void>;
  getCache<T>(key: string): Promise<T | null>;
  setCache<T>(key: string, value: T): Promise<void>;
  deleteCache(key: string): Promise<void>;
  clearCache(): Promise<void>;
  getSummary(): Promise<BrowserRecordSummary>;
  resetAll(): Promise<void>;
  subscribe(listener: () => void): () => void;
  snapshot(modality?: BrowserModality | "all"): Promise<BrowserRecord[]>;
}

export interface ObjectUrlRegistry {
  create(blob: Blob): string;
  revoke(url: string | null | undefined): void;
  revokeAll(): void;
  size(): number;
}

export const DEFAULT_BROWSER_DB_NAME = "ai-powered-browser-workbench";
export const DEFAULT_BROWSER_DB_VERSION = 1;
export const BROWSER_RECORD_SCHEMA_VERSION = 2;
export const BROWSER_REFERENCE_SCHEMA_VERSION = 1;
export const DEFAULT_REFERENCE_CACHE_KEY = "ai-powered:references:v1";
export const DEFAULT_STORAGE_PREFIXES = ["ai-powered:", "ai-demo-"];
export const DEFAULT_REMOTE_CACHE_PREFIXES = ["ai-powered:remote:"];

export const DEFAULT_UI_KEYS = {
  activeTab: "ai-powered:ui:active-tab",
  historyExpanded: "ai-powered:ui:history-expanded",
  currentTextSessionId: "ai-powered:ui:text-session-id",
  infoTab: "ai-powered:info:active-tab",
} as const;

function storageToArray(storage: Storage | null | undefined, prefixes: string[]): string[] {
  if (!storage) return [];
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    if (prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key);
  }
  return keys;
}

function clearStoragePrefixes(storage: Storage | null | undefined, prefixes: string[]): void {
  if (!storage) return;
  const keys = storageToArray(storage, prefixes);
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore storage failures */
    }
  }
}

function readStorageJson<T>(storage: Storage | null | undefined, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorageJson(storage: Storage | null | undefined, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage failures */
  }
}

function safeRandomId(): string {
  const cryptoLike = globalThis.crypto as Crypto | undefined;
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  const random = Math.random().toString(36).slice(2, 10);
  return `rec-${Date.now().toString(36)}-${random}`;
}

function cloneMessage(message: WebMessage): WebMessage {
  return { role: message.role, content: message.content };
}

function cloneRecord(record: BrowserRecord): BrowserRecord {
  return {
    ...record,
    tags: [...record.tags],
    messages: record.messages.map(cloneMessage),
    metadata: { ...record.metadata },
  };
}

function inferArtifactKind(modality: BrowserModality): BrowserRecordKind {
  return modality === "text" ? "session" : "artifact";
}

function normalizeTitle(
  title: string | undefined,
  prompt: string,
  modality: BrowserModality,
): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  const fallback = prompt.trim().replace(/\s+/g, " ");
  if (fallback) return fallback.length > 72 ? `${fallback.slice(0, 72)}...` : fallback;
  return modality.charAt(0).toUpperCase() + modality.slice(1) + " record";
}

function summarizeText(value: string, limit = 160): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "";
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function messageTranscript(messages: WebMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n");
}

function textFromMessages(messages: WebMessage[]): string {
  return messages
    .map((message) => message.content)
    .join("\n\n")
    .trim();
}

function defaultMimeType(modality: BrowserModality): string {
  switch (modality) {
    case "image":
      return "image/png";
    case "audio":
      return "audio/mpeg";
    case "video":
      return "video/mp4";
    case "structured":
      return "application/json";
    default:
      return "text/plain";
  }
}

function extensionForMimeType(
  mimeType: string | null | undefined,
  modality: BrowserModality,
): string {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized === "text/plain") return "txt";
  if (normalized === "application/json") return "json";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("mp4")) return "mp4";
  if (modality === "structured") return "json";
  if (modality === "text") return "txt";
  if (modality === "image") return "png";
  if (modality === "audio") return "mp3";
  if (modality === "video") return "mp4";
  return "bin";
}

function createTextBlob(text: string, mimeType = "text/plain"): Blob {
  return new Blob([text], { type: mimeType });
}

function buildDefaultFileName(record: BrowserRecord): string {
  const stem =
    sanitizeFileStem(record.title || record.outputSummary || record.prompt || record.id) ||
    record.id;
  return `${stem}.${extensionForMimeType(record.mimeType, record.modality)}`;
}

function sanitizeFileStem(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRecordDraft(
  draft: BrowserRecordDraft,
  existing?: BrowserRecord | null,
): BrowserRecord {
  const now = new Date().toISOString();
  const messages = Array.isArray(draft.messages)
    ? draft.messages.map(cloneMessage)
    : existing?.messages
      ? existing.messages.map(cloneMessage)
      : [];
  const prompt = (draft.prompt ?? existing?.prompt ?? textFromMessages(messages) ?? "").trim();
  const outputText = (
    draft.outputText ??
    existing?.outputText ??
    textFromMessages(messages) ??
    prompt ??
    ""
  ).trim();
  const transcript = (
    draft.transcript ??
    existing?.transcript ??
    messageTranscript(messages) ??
    outputText
  ).trim();
  const title = normalizeTitle(draft.title ?? existing?.title, prompt, draft.modality);
  const kind = draft.kind ?? existing?.kind ?? inferArtifactKind(draft.modality);
  const mimeType = draft.mimeType ?? existing?.mimeType ?? defaultMimeType(draft.modality);
  const metadata = {
    ...(existing?.metadata ?? {}),
    ...(draft.metadata ?? {}),
  };
  const artifact =
    draft.artifact !== undefined
      ? draft.artifact
      : (existing?.artifact ?? (outputText ? createTextBlob(outputText, mimeType) : null));
  const preview =
    draft.preview !== undefined
      ? draft.preview
      : (existing?.preview ?? (draft.modality === "text" ? null : artifact));
  const summary =
    draft.outputSummary ??
    existing?.outputSummary ??
    (kind === "session"
      ? summarizeText(prompt || transcript || title)
      : summarizeText(outputText || prompt || title));

  return {
    id: draft.id ?? existing?.id ?? safeRandomId(),
    modality: draft.modality,
    kind,
    title,
    prompt,
    provider: (draft.provider ?? existing?.provider ?? "").trim(),
    model: (draft.model ?? existing?.model ?? "").trim(),
    styleId: (draft.styleId ?? existing?.styleId ?? "").trim(),
    seed: draft.seed ?? existing?.seed ?? null,
    aspectRatio: (draft.aspectRatio ?? existing?.aspectRatio ?? "").trim(),
    resolution: (draft.resolution ?? existing?.resolution ?? "").trim(),
    quality: (draft.quality ?? existing?.quality ?? "").trim(),
    duration: draft.duration ?? existing?.duration ?? null,
    fps: draft.fps ?? existing?.fps ?? null,
    notes: (draft.notes ?? existing?.notes ?? "").trim(),
    tags: Array.from(new Set([...(existing?.tags ?? []), ...(draft.tags ?? [])])).filter(Boolean),
    favorite: draft.favorite ?? existing?.favorite ?? false,
    status: draft.status ?? existing?.status ?? "complete",
    transcript,
    messages,
    outputText,
    outputSummary: summary,
    fileName: (draft.fileName ?? existing?.fileName ?? "").trim(),
    mimeType,
    metadata,
    createdAt: draft.createdAt ?? existing?.createdAt ?? now,
    updatedAt: draft.updatedAt ?? now,
    artifact,
    preview,
  };
}

function recordMatchesModality(record: BrowserRecord, modality: BrowserModality | "all"): boolean {
  return modality === "all" || record.modality === modality;
}

function sortRecords(records: BrowserRecord[]): BrowserRecord[] {
  return records.slice().sort((a, b) => {
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function createMemoryBackend(): BrowserStorageBackend {
  const records = new Map<string, BrowserRecord>();
  const cache = new Map<string, unknown>();

  async function listRecords(modality: BrowserModality | "all" = "all"): Promise<BrowserRecord[]> {
    return sortRecords(
      Array.from(records.values())
        .filter((record) => recordMatchesModality(record, modality))
        .map(cloneRecord),
    );
  }

  async function getRecord(id: string): Promise<BrowserRecord | null> {
    const record = records.get(id);
    return record ? cloneRecord(record) : null;
  }

  async function saveRecord(draft: BrowserRecordDraft): Promise<BrowserRecord> {
    const existing = draft.id ? (records.get(draft.id) ?? null) : null;
    const record = normalizeRecordDraft(draft, existing);
    records.set(record.id, record);
    return cloneRecord(record);
  }

  async function updateRecordMetadata(
    id: string,
    patch: BrowserRecordPatch,
  ): Promise<BrowserRecord | null> {
    const existing = records.get(id);
    if (!existing) return null;
    const updated = normalizeRecordDraft(
      {
        ...existing,
        title: patch.title ?? existing.title,
        notes: patch.notes ?? existing.notes,
        tags: patch.tags ?? existing.tags,
        favorite: patch.favorite ?? existing.favorite,
        updatedAt: new Date().toISOString(),
      },
      existing,
    );
    records.set(updated.id, updated);
    return cloneRecord(updated);
  }

  async function replaceRecordArtifact(
    id: string,
    artifact: Blob | null,
    preview?: Blob | null,
    mimeType?: string | null,
    fileName?: string,
  ): Promise<BrowserRecord | null> {
    const existing = records.get(id);
    if (!existing) return null;
    const draft: BrowserRecordDraft = {
      ...existing,
      artifact,
      mimeType: mimeType ?? existing.mimeType,
      fileName: fileName ?? existing.fileName,
      updatedAt: new Date().toISOString(),
    };
    if (preview !== undefined) {
      draft.preview = preview;
    }
    const updated = normalizeRecordDraft(draft, existing);
    records.set(updated.id, updated);
    return cloneRecord(updated);
  }

  async function deleteRecord(id: string): Promise<boolean> {
    return records.delete(id);
  }

  async function deleteRecords(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      if (records.delete(id)) count++;
    }
    return count;
  }

  async function clearRecords(): Promise<void> {
    records.clear();
  }

  async function getCache<T>(key: string): Promise<T | null> {
    return (cache.get(key) as T | undefined) ?? null;
  }

  async function setCache<T>(key: string, value: T): Promise<void> {
    cache.set(key, value);
  }

  async function deleteCache(key: string): Promise<void> {
    cache.delete(key);
  }

  async function clearCache(): Promise<void> {
    cache.clear();
  }

  async function getSummary(): Promise<BrowserRecordSummary> {
    const all = sortRecords(Array.from(records.values()));
    const countsByModality = {
      text: 0,
      image: 0,
      audio: 0,
      video: 0,
      structured: 0,
    } satisfies Record<BrowserModality, number>;
    for (const record of all) countsByModality[record.modality]++;
    return {
      backend: "memory",
      warning: null,
      totalRecords: all.length,
      countsByModality,
      cacheKeys: Array.from(cache.keys()).sort(),
      localStorageKeys: [],
      sessionStorageKeys: [],
    };
  }

  return {
    name: "memory",
    listRecords,
    getRecord,
    saveRecord,
    updateRecordMetadata,
    replaceRecordArtifact,
    deleteRecord,
    deleteRecords,
    clearRecords,
    getCache,
    setCache,
    deleteCache,
    clearCache,
    getSummary,
  };
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function openIndexedDb(dbName: string, dbVersion: number): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    throw new Error("IndexedDB is unavailable in this browser.");
  }
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: "id" });
        store.createIndex("by-modality", "modality", { unique: false });
        store.createIndex("by-updatedAt", "updatedAt", { unique: false });
        store.createIndex("by-createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("cache")) {
        const store = db.createObjectStore("cache", { keyPath: "key" });
        store.createIndex("by-updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
  });
}

function createIndexedDbBackend(dbName: string, dbVersion: number): Promise<BrowserStorageBackend> {
  return openIndexedDb(dbName, dbVersion).then((db) => {
    async function listRecords(
      modality: BrowserModality | "all" = "all",
    ): Promise<BrowserRecord[]> {
      const tx = db.transaction("records", "readonly");
      const store = tx.objectStore("records");
      const all = await idbRequest<BrowserRecord[]>(store.getAll());
      return sortRecords(
        all.filter((record) => recordMatchesModality(record, modality)).map(cloneRecord),
      );
    }

    async function getRecord(id: string): Promise<BrowserRecord | null> {
      const tx = db.transaction("records", "readonly");
      const store = tx.objectStore("records");
      const record = await idbRequest<BrowserRecord | undefined>(store.get(id));
      return record ? cloneRecord(record) : null;
    }

    async function saveRecord(draft: BrowserRecordDraft): Promise<BrowserRecord> {
      const existing = draft.id ? await getRecord(draft.id) : null;
      const record = normalizeRecordDraft(draft, existing);
      const tx = db.transaction("records", "readwrite");
      await idbRequest(tx.objectStore("records").put(record));
      return cloneRecord(record);
    }

    async function updateRecordMetadata(
      id: string,
      patch: BrowserRecordPatch,
    ): Promise<BrowserRecord | null> {
      const existing = await getRecord(id);
      if (!existing) return null;
      return saveRecord({
        ...existing,
        title: patch.title ?? existing.title,
        notes: patch.notes ?? existing.notes,
        tags: patch.tags ?? existing.tags,
        favorite: patch.favorite ?? existing.favorite,
      });
    }

    async function replaceRecordArtifact(
      id: string,
      artifact: Blob | null,
      preview?: Blob | null,
      mimeType?: string | null,
      fileName?: string,
    ): Promise<BrowserRecord | null> {
      const existing = await getRecord(id);
      if (!existing) return null;
      const draft: BrowserRecordDraft = {
        ...existing,
        artifact,
        mimeType: mimeType ?? existing.mimeType,
        fileName: fileName ?? existing.fileName,
      };
      if (preview !== undefined) {
        draft.preview = preview;
      }
      return saveRecord(draft);
    }

    async function deleteRecord(id: string): Promise<boolean> {
      const tx = db.transaction("records", "readwrite");
      await idbRequest(tx.objectStore("records").delete(id));
      return true;
    }

    async function deleteRecords(ids: string[]): Promise<number> {
      let count = 0;
      const tx = db.transaction("records", "readwrite");
      const store = tx.objectStore("records");
      for (const id of ids) {
        await idbRequest(store.delete(id));
        count++;
      }
      return count;
    }

    async function clearRecords(): Promise<void> {
      const tx = db.transaction("records", "readwrite");
      await idbRequest(tx.objectStore("records").clear());
    }

    async function getCache<T>(key: string): Promise<T | null> {
      const tx = db.transaction("cache", "readonly");
      const store = tx.objectStore("cache");
      const entry = await idbRequest<{ key: string; value: T } | undefined>(store.get(key));
      return entry?.value ?? null;
    }

    async function setCache<T>(key: string, value: T): Promise<void> {
      const tx = db.transaction("cache", "readwrite");
      await idbRequest(
        tx.objectStore("cache").put({
          key,
          value,
          updatedAt: new Date().toISOString(),
        }),
      );
    }

    async function deleteCache(key: string): Promise<void> {
      const tx = db.transaction("cache", "readwrite");
      await idbRequest(tx.objectStore("cache").delete(key));
    }

    async function clearCache(): Promise<void> {
      const tx = db.transaction("cache", "readwrite");
      await idbRequest(tx.objectStore("cache").clear());
    }

    async function getSummary(): Promise<BrowserRecordSummary> {
      const records = await listRecords("all");
      const countsByModality = {
        text: 0,
        image: 0,
        audio: 0,
        video: 0,
        structured: 0,
      } satisfies Record<BrowserModality, number>;
      for (const record of records) countsByModality[record.modality]++;
      const tx = db.transaction("cache", "readonly");
      const cacheStore = tx.objectStore("cache");
      const cacheEntries = await idbRequest<IDBValidKey[]>(cacheStore.getAllKeys());
      return {
        backend: "indexeddb",
        warning: null,
        totalRecords: records.length,
        countsByModality,
        cacheKeys: cacheEntries.map((entry) => String(entry)).sort(),
        localStorageKeys: [],
        sessionStorageKeys: [],
      };
    }

    return {
      name: "indexeddb",
      listRecords,
      getRecord,
      saveRecord,
      updateRecordMetadata,
      replaceRecordArtifact,
      deleteRecord,
      deleteRecords,
      clearRecords,
      getCache,
      setCache,
      deleteCache,
      clearCache,
      getSummary,
    };
  });
}

interface BrowserStorageBackend {
  name: "indexeddb" | "memory";
  listRecords(modality?: BrowserModality | "all"): Promise<BrowserRecord[]>;
  getRecord(id: string): Promise<BrowserRecord | null>;
  saveRecord(draft: BrowserRecordDraft): Promise<BrowserRecord>;
  updateRecordMetadata(id: string, patch: BrowserRecordPatch): Promise<BrowserRecord | null>;
  replaceRecordArtifact(
    id: string,
    artifact: Blob | null,
    preview?: Blob | null,
    mimeType?: string | null,
    fileName?: string,
  ): Promise<BrowserRecord | null>;
  deleteRecord(id: string): Promise<boolean>;
  deleteRecords(ids: string[]): Promise<number>;
  clearRecords(): Promise<void>;
  getCache<T>(key: string): Promise<T | null>;
  setCache<T>(key: string, value: T): Promise<void>;
  deleteCache(key: string): Promise<void>;
  clearCache(): Promise<void>;
  getSummary(): Promise<BrowserRecordSummary>;
}

export function createObjectUrlRegistry(): ObjectUrlRegistry {
  const urls = new Set<string>();
  return {
    create(blob: Blob): string {
      const url = URL.createObjectURL(blob);
      urls.add(url);
      return url;
    },
    revoke(url: string | null | undefined): void {
      if (!url || !urls.has(url)) return;
      urls.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore revocation failures */
      }
    },
    revokeAll(): void {
      for (const url of urls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore revocation failures */
        }
      }
      urls.clear();
    },
    size(): number {
      return urls.size;
    },
  };
}

export function createBrowserRecordStore(options: BrowserStorageOptions = {}): BrowserRecordStore {
  const dbName = options.dbName ?? DEFAULT_BROWSER_DB_NAME;
  const dbVersion = options.dbVersion ?? DEFAULT_BROWSER_DB_VERSION;
  const storagePrefixes = options.storagePrefixes ?? DEFAULT_STORAGE_PREFIXES;
  const remoteCachePrefixes = options.remoteCachePrefixes ?? DEFAULT_REMOTE_CACHE_PREFIXES;
  const localStorageRef =
    options.localStorage ??
    (typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null);
  const sessionStorageRef =
    options.sessionStorage ??
    (typeof globalThis.sessionStorage !== "undefined" ? globalThis.sessionStorage : null);
  const backendPreference = options.backend ?? "auto";

  let backend: BrowserStorageBackend = createMemoryBackend();
  let backendName: "indexeddb" | "memory" = "memory";
  let warning: string | null = null;
  const listeners = new Set<() => void>();

  async function hydrateBackend(): Promise<void> {
    if (backendPreference === "memory") {
      backend = createMemoryBackend();
      backendName = "memory";
      warning = null;
      return;
    }

    if (globalThis.indexedDB) {
      try {
        backend = await createIndexedDbBackend(dbName, dbVersion);
        backendName = "indexeddb";
        warning = null;
        return;
      } catch {
        /* fall through to memory backend */
      }
    }

    backend = createMemoryBackend();
    backendName = "memory";
    warning =
      backendPreference === "indexeddb"
        ? "IndexedDB storage is unavailable in this browser."
        : "IndexedDB storage could not be opened, so the app is using in-memory storage.";
  }

  const ready = hydrateBackend();

  function emitChange(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* ignore listener failures */
      }
    }
  }

  async function withBackend<T>(
    run: (activeBackend: BrowserStorageBackend) => Promise<T>,
  ): Promise<T> {
    await ready;
    return run(backend);
  }

  async function listRecords(modality: BrowserModality | "all" = "all"): Promise<BrowserRecord[]> {
    return withBackend((activeBackend) => activeBackend.listRecords(modality));
  }

  async function getRecord(id: string): Promise<BrowserRecord | null> {
    return withBackend((activeBackend) => activeBackend.getRecord(id));
  }

  async function saveRecord(draft: BrowserRecordDraft): Promise<BrowserRecord> {
    const record = await withBackend((activeBackend) => activeBackend.saveRecord(draft));
    emitChange();
    return record;
  }

  async function updateRecordMetadata(
    id: string,
    patch: BrowserRecordPatch,
  ): Promise<BrowserRecord | null> {
    const record = await withBackend((activeBackend) =>
      activeBackend.updateRecordMetadata(id, patch),
    );
    emitChange();
    return record;
  }

  async function replaceRecordArtifact(
    id: string,
    artifact: Blob | null,
    preview?: Blob | null,
    mimeType?: string | null,
    fileName?: string,
  ): Promise<BrowserRecord | null> {
    const record = await withBackend((activeBackend) =>
      activeBackend.replaceRecordArtifact(id, artifact, preview, mimeType, fileName),
    );
    emitChange();
    return record;
  }

  async function deleteRecord(id: string): Promise<boolean> {
    const result = await withBackend((activeBackend) => activeBackend.deleteRecord(id));
    emitChange();
    return result;
  }

  async function deleteRecords(ids: string[]): Promise<number> {
    const count = await withBackend((activeBackend) => activeBackend.deleteRecords(ids));
    emitChange();
    return count;
  }

  async function clearRecords(): Promise<void> {
    await withBackend((activeBackend) => activeBackend.clearRecords());
    emitChange();
  }

  async function getCache<T>(key: string): Promise<T | null> {
    return withBackend((activeBackend) => activeBackend.getCache<T>(key));
  }

  async function setCache<T>(key: string, value: T): Promise<void> {
    await withBackend((activeBackend) => activeBackend.setCache(key, value));
  }

  async function deleteCache(key: string): Promise<void> {
    await withBackend((activeBackend) => activeBackend.deleteCache(key));
  }

  async function clearCache(): Promise<void> {
    await withBackend((activeBackend) => activeBackend.clearCache());
  }

  async function getSummary(): Promise<BrowserRecordSummary> {
    await ready;
    const summary = await backend.getSummary();
    return {
      ...summary,
      backend: backendName,
      warning,
      localStorageKeys: storageToArray(localStorageRef, storagePrefixes),
      sessionStorageKeys: storageToArray(sessionStorageRef, storagePrefixes),
      cacheKeys: Array.from(
        new Set([
          ...summary.cacheKeys,
          ...storageToArray(localStorageRef, remoteCachePrefixes),
          ...storageToArray(sessionStorageRef, remoteCachePrefixes),
        ]),
      ).sort(),
    };
  }

  async function resetAll(): Promise<void> {
    try {
      await clearRecords();
      await clearCache();
    } catch {
      /* ignore reset failures */
    }
    try {
      clearStoragePrefixes(localStorageRef, storagePrefixes);
      clearStoragePrefixes(sessionStorageRef, storagePrefixes);
      clearStoragePrefixes(localStorageRef, remoteCachePrefixes);
      clearStoragePrefixes(sessionStorageRef, remoteCachePrefixes);
    } catch {
      /* ignore reset failures */
    }
    if (globalThis.indexedDB) {
      try {
        await new Promise<void>((resolve) => {
          const request = globalThis.indexedDB!.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });
      } catch {
        /* ignore deleteDatabase failures */
      }
    }
  }

  async function snapshot(modality: BrowserModality | "all" = "all"): Promise<BrowserRecord[]> {
    return listRecords(modality);
  }

  return {
    get backend() {
      return backendName;
    },
    get warning() {
      return warning;
    },
    ready,
    listRecords,
    getRecord,
    saveRecord,
    updateRecordMetadata,
    replaceRecordArtifact,
    deleteRecord,
    deleteRecords,
    clearRecords,
    getCache,
    setCache,
    deleteCache,
    clearCache,
    getSummary,
    resetAll,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot,
  };
}

export function recordToManifest(record: BrowserRecord): Record<string, unknown> {
  const metadata = { ...record.metadata };
  return {
    schemaVersion:
      typeof metadata["schemaVersion"] === "number"
        ? metadata["schemaVersion"]
        : BROWSER_RECORD_SCHEMA_VERSION,
    id: record.id,
    modality: record.modality,
    kind: record.kind,
    title: record.title,
    prompt: record.prompt,
    provider: record.provider,
    model: record.model,
    styleId: record.styleId,
    seed: record.seed,
    aspectRatio: record.aspectRatio,
    resolution: record.resolution,
    quality: record.quality,
    duration: record.duration,
    fps: record.fps,
    notes: record.notes,
    tags: record.tags.slice(),
    favorite: record.favorite,
    status: record.status,
    transcript: record.transcript,
    messages: record.messages.map(cloneMessage),
    outputText: record.outputText,
    outputSummary: record.outputSummary,
    fileName: record.fileName,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    hasArtifact: Boolean(record.artifact),
    artifactSize: record.artifact?.size ?? 0,
    previewSize: record.preview?.size ?? 0,
    artifact: {
      available: Boolean(record.artifact),
      fileName: record.fileName || null,
      mimeType: record.mimeType,
      sizeBytes: record.artifact?.size ?? 0,
      previewSizeBytes: record.preview?.size ?? 0,
      resultUrl:
        typeof (
          metadata["historyEvent"] as { result?: { artifact?: { url?: unknown } } } | undefined
        )?.result?.artifact?.url === "string"
          ? ((metadata["historyEvent"] as { result?: { artifact?: { url?: string } } }).result
              ?.artifact?.url ?? null)
          : null,
    },
    metadata,
  };
}

export function recordDownloadJsonPayload(record: BrowserRecord): { blob: Blob; filename: string } {
  const stem = sanitizeFileStem(record.title || record.modality || record.id) || "record";
  const id = sanitizeFileStem(record.id) || "record";
  const filename = `ai-powered-${record.modality}-${stem}-${id}.json`;
  return {
    blob: createTextBlob(JSON.stringify(recordToManifest(record), null, 2), "application/json"),
    filename,
  };
}

export function recordToPlainText(record: BrowserRecord): string {
  if (record.kind === "session") {
    const lines = [
      `Title: ${record.title}`,
      `Created: ${record.createdAt}`,
      `Updated: ${record.updatedAt}`,
      `Prompt: ${record.prompt}`,
    ];
    if (record.provider || record.model) {
      lines.push(`Provider: ${record.provider || "default"}`);
      lines.push(`Model: ${record.model || "default"}`);
    }
    if (record.styleId) lines.push(`Style: ${record.styleId}`);
    if (record.messages.length > 0) {
      lines.push("");
      lines.push(messageTranscript(record.messages));
    } else if (record.transcript) {
      lines.push("");
      lines.push(record.transcript);
    }
    return lines.join("\n").trim();
  }

  if (record.modality === "structured" || record.mimeType === "application/json") {
    return record.outputText || record.transcript || record.prompt || record.title;
  }

  return record.outputText || record.transcript || record.prompt || record.title;
}

export function recordDownloadName(record: BrowserRecord): string {
  if (record.fileName) return record.fileName;
  return buildDefaultFileName(record);
}

export function recordDownloadPayload(record: BrowserRecord): { blob: Blob; filename: string } {
  if (record.artifact) {
    return {
      blob: record.artifact,
      filename: recordDownloadName(record),
    };
  }

  const text = recordToPlainText(record);
  const mimeType = record.mimeType || defaultMimeType(record.modality);
  return {
    blob: createTextBlob(text, mimeType),
    filename: recordDownloadName(record),
  };
}

export function recordSummaryText(record: BrowserRecord): string {
  if (record.kind === "session") {
    return summarizeText(record.transcript || record.prompt || textFromMessages(record.messages));
  }
  return summarizeText(record.outputSummary || record.outputText || record.prompt || record.title);
}

export function buildSessionTitle(messages: WebMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const value = firstUser?.content?.trim() || "";
  if (!value) return "Untitled conversation";
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

export function readJsonPreference<T>(
  storage: Storage | null | undefined,
  key: string,
  fallback: T,
): T {
  return readStorageJson(storage, key, fallback);
}

export function writeJsonPreference(
  storage: Storage | null | undefined,
  key: string,
  value: unknown,
): void {
  writeStorageJson(storage, key, value);
}

export function clearPrefsByPrefix(storage: Storage | null | undefined, prefixes: string[]): void {
  clearStoragePrefixes(storage, prefixes);
}

export function listPrefsByPrefix(
  storage: Storage | null | undefined,
  prefixes: string[],
): string[] {
  return storageToArray(storage, prefixes);
}
