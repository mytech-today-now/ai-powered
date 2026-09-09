/**
 * BrowserConversationSession regression tests.
 *
 * Covers:
 *  - normal persistence through sessionStorage
 *  - malformed stored history falling back without crashing
 *  - blocked writes still allowing send() and stream() to complete
 *  - removeItem failures still allowing clear() to complete
 *  - accessible warning text for storage failures
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserConversationSession,
  type WebAiClient,
} from "../../src/ai-powered/web/fetch-client.js";

type Message = { role: "user" | "assistant"; content: string };

const SESSION_KEY_PREFIX = "ai-session:";
const STORAGE_WARNING_ID = "__ai_powered_session_storage_status__";

function makeStorageError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

function createSessionStorageShim(options?: {
  initialValue?: string;
  setItemThrows?: boolean;
  removeItemThrows?: boolean;
}) {
  const store = new Map<string, string>();

  const shim = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      if (options?.removeItemThrows) {
        throw makeStorageError("SecurityError", "sessionStorage.removeItem blocked");
      }
      store.delete(key);
    },
    setItem(key: string, value: string) {
      if (options?.setItemThrows) {
        throw makeStorageError("QuotaExceededError", "sessionStorage.setItem blocked");
      }
      store.set(key, value);
    },
  } as Storage;

  return { shim, store };
}

function createMockClient(options?: { reply?: string; chunks?: string[] }) {
  const reply = options?.reply ?? "assistant reply";
  const chunks = options?.chunks ?? [reply];

  const generateText = vi.fn(async (prompt: string) => ({
    content: reply,
    model: "mock-model",
    provider: "mock-provider",
    prompt,
  }));

  const streamText = vi.fn(async function* (prompt: string) {
    void prompt;
    for (const chunk of chunks) {
      yield chunk;
    }
  });

  return {
    client: { generateText, streamText } as unknown as WebAiClient,
    generateText,
    streamText,
  };
}

function getStorageWarning(): HTMLElement | null {
  return document.getElementById(STORAGE_WARNING_ID);
}

function transcriptFromHistory(history: Message[]): string {
  return history
    .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
});

describe("BrowserConversationSession persistence", () => {
  it("round-trips history through sessionStorage and preserves the prompt order", async () => {
    const sessionId = "normal-send";
    const transcript: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const storage = createSessionStorageShim();
    storage.store.set(`${SESSION_KEY_PREFIX}${sessionId}`, JSON.stringify(transcript));
    vi.stubGlobal("sessionStorage", storage.shim);

    const { client, generateText } = createMockClient({ reply: "Follow-up answer" });
    const session = new BrowserConversationSession(sessionId, client);

    expect(session.getHistory()).toEqual(transcript);
    expect(getStorageWarning()).toBeNull();

    await expect(session.send("How are you?")).resolves.toBe("Follow-up answer");

    const expectedTranscript: Message[] = [
      ...transcript,
      { role: "user", content: "How are you?" },
      { role: "assistant", content: "Follow-up answer" },
    ];

    expect(generateText).toHaveBeenCalledWith(
      transcriptFromHistory([...transcript, { role: "user", content: "How are you?" }]),
      undefined,
    );
    expect(session.getHistory()).toEqual(expectedTranscript);
    expect(storage.store.get(`${SESSION_KEY_PREFIX}${sessionId}`)).toBe(
      JSON.stringify(expectedTranscript),
    );
  });

  it("appends streamed assistant text after completion and keeps normal persistence intact", async () => {
    const sessionId = "normal-stream";
    const storage = createSessionStorageShim();
    vi.stubGlobal("sessionStorage", storage.shim);

    const { client, streamText } = createMockClient({ chunks: ["Hel", "lo", "!"] });
    const session = new BrowserConversationSession(sessionId, client);

    const chunks: string[] = [];
    for await (const chunk of session.stream("Tell me a story")) {
      chunks.push(chunk);
    }

    const expectedTranscript: Message[] = [
      { role: "user", content: "Tell me a story" },
      { role: "assistant", content: "Hello!" },
    ];

    expect(chunks).toEqual(["Hel", "lo", "!"]);
    expect(streamText).toHaveBeenCalledWith("User: Tell me a story", undefined);
    expect(session.getHistory()).toEqual(expectedTranscript);
    expect(storage.store.get(`${SESSION_KEY_PREFIX}${sessionId}`)).toBe(
      JSON.stringify(expectedTranscript),
    );
    expect(getStorageWarning()).toBeNull();
  });
});

describe("BrowserConversationSession storage failures", () => {
  it("treats malformed stored history as a soft failure and recovers on the next send", async () => {
    const sessionId = "malformed-load";
    const storage = createSessionStorageShim();
    storage.store.set(`${SESSION_KEY_PREFIX}${sessionId}`, "not-json");
    vi.stubGlobal("sessionStorage", storage.shim);

    const { client, generateText } = createMockClient({ reply: "Recovered answer" });
    const session = new BrowserConversationSession(sessionId, client);

    expect(session.getHistory()).toEqual([]);

    const warning = getStorageWarning();
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain("temporary in this browser");
    expect(warning?.getAttribute("role")).toBe("status");
    expect(warning?.getAttribute("aria-live")).toBe("polite");
    expect(warning?.getAttribute("aria-atomic")).toBe("true");
    expect(warning?.tabIndex).toBe(0);

    await expect(session.send("Hello?")).resolves.toBe("Recovered answer");

    expect(generateText).toHaveBeenCalledWith("User: Hello?", undefined);
    expect(session.getHistory()).toEqual([
      { role: "user", content: "Hello?" },
      { role: "assistant", content: "Recovered answer" },
    ]);
    expect(storage.store.get(`${SESSION_KEY_PREFIX}${sessionId}`)).toBe(
      JSON.stringify([
        { role: "user", content: "Hello?" },
        { role: "assistant", content: "Recovered answer" },
      ]),
    );

    const recoveredWarning = getStorageWarning();
    expect(recoveredWarning?.hidden).toBe(true);
    expect(recoveredWarning?.textContent).toBe("");
  });

  it("keeps send() and stream() working when writes are blocked", async () => {
    const sessionId = "blocked-write";
    const storage = createSessionStorageShim({ setItemThrows: true });
    vi.stubGlobal("sessionStorage", storage.shim);

    const { client, generateText, streamText } = createMockClient({
      reply: "Still here",
      chunks: ["st", "reamed"],
    });
    const session = new BrowserConversationSession(sessionId, client);

    await expect(session.send("Hello")).resolves.toBe("Still here");

    expect(generateText).toHaveBeenCalledWith("User: Hello", undefined);
    expect(session.getHistory()).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Still here" },
    ]);
    expect(storage.store.get(`${SESSION_KEY_PREFIX}${sessionId}`)).toBeUndefined();

    const warning = getStorageWarning();
    expect(warning).not.toBeNull();
    expect(warning?.hidden).toBe(false);
    expect(warning?.textContent).toContain("temporary in this browser");
    expect(warning?.getAttribute("role")).toBe("status");

    const streamSessionId = "blocked-stream";
    const streamSession = new BrowserConversationSession(streamSessionId, client);
    const streamedChunks: string[] = [];
    for await (const chunk of streamSession.stream("Tell me more")) {
      streamedChunks.push(chunk);
    }

    expect(streamText).toHaveBeenCalledWith("User: Tell me more", undefined);
    expect(streamedChunks).toEqual(["st", "reamed"]);
    expect(streamSession.getHistory()).toEqual([
      { role: "user", content: "Tell me more" },
      { role: "assistant", content: "streamed" },
    ]);
    expect(getStorageWarning()?.hidden).toBe(false);
  });

  it("still clears the in-memory transcript when removeItem is blocked", async () => {
    const sessionId = "blocked-remove";
    const storage = createSessionStorageShim({ removeItemThrows: true });
    vi.stubGlobal("sessionStorage", storage.shim);

    const { client } = createMockClient({ reply: "Stored once" });
    const session = new BrowserConversationSession(sessionId, client);

    await expect(session.send("Archive me")).resolves.toBe("Stored once");
    expect(session.getHistory()).toEqual([
      { role: "user", content: "Archive me" },
      { role: "assistant", content: "Stored once" },
    ]);

    expect(() => session.clear()).not.toThrow();
    expect(session.getHistory()).toEqual([]);
    expect(storage.store.get(`${SESSION_KEY_PREFIX}${sessionId}`)).toBe(
      JSON.stringify([
        { role: "user", content: "Archive me" },
        { role: "assistant", content: "Stored once" },
      ]),
    );

    const warning = getStorageWarning();
    expect(warning).not.toBeNull();
    expect(warning?.hidden).toBe(false);
    expect(warning?.textContent).toContain("temporary in this browser");
  });
});
