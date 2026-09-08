/**
 * Tests — session storage fallback for the web example chat shell.
 *
 * Covers:
 *  - normal sessionStorage read/write path still restores the live transcript
 *  - malformed stored JSON no longer wipes an already-rendered transcript
 *  - blocked writes keep the in-memory transcript intact and surface a warning
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Message = { role: "user" | "assistant"; content: string };

const SESSION_KEY = "ai-demo-session";
const TEMP_WARNING =
  "Conversation history is temporary in this browser. Session storage is unavailable, so " +
  "the current chat stays visible but may not persist.";

function makeStorageError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

function readTranscript(root: HTMLElement): Message[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".bubble")).map((bubble) => ({
    role: bubble.classList.contains("bubble-user") ? "user" : "assistant",
    content: bubble.querySelector("p")?.textContent ?? "",
  }));
}

function createSessionStorageShim(options?: {
  initialValue?: string;
  setItemThrows?: boolean;
  removeItemThrows?: boolean;
}) {
  const store = new Map<string, string>();
  if (options?.initialValue !== undefined) {
    store.set(SESSION_KEY, options.initialValue);
  }

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

function createRuntime(options?: {
  initialStoredValue?: string;
  setItemThrows?: boolean;
  removeItemThrows?: boolean;
}) {
  document.body.innerHTML = `
    <div id="session-history" class="session-history" aria-live="polite"></div>
    <div id="text-output" class="output-box"></div>
    <div id="text-usage" class="usage-bar"></div>
    <p id="history-panel-warning" class="hidden" aria-live="polite"></p>
  `;

  const storage = createSessionStorageShim({
    initialValue: options?.initialStoredValue,
    setItemThrows: options?.setItemThrows,
    removeItemThrows: options?.removeItemThrows,
  });
  vi.stubGlobal("sessionStorage", storage.shim);

  const sessionHistory = document.getElementById("session-history") as HTMLDivElement;
  const warningEl = document.getElementById("history-panel-warning") as HTMLParagraphElement;

  let historyPanelWarningMessage = "";
  let sessionStorageWarningActive = false;
  let sessionMessages: Message[] = [];

  function syncHistoryPanelWarning() {
    const msg = sessionStorageWarningActive ? TEMP_WARNING : historyPanelWarningMessage;
    warningEl.setAttribute("role", "status");
    warningEl.setAttribute("aria-live", "polite");
    if (!msg) {
      warningEl.textContent = "";
      warningEl.classList.add("hidden");
      return;
    }
    warningEl.textContent = msg;
    warningEl.classList.remove("hidden");
  }

  function showSessionStorageWarning() {
    sessionStorageWarningActive = true;
    syncHistoryPanelWarning();
  }

  function loadSessionMessages(): Message[] {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]");
      if (Array.isArray(parsed)) return parsed as Message[];
    } catch {
      // Fall through to the warning below.
    }
    showSessionStorageWarning();
    return [];
  }

  function getSessionMessages(): Message[] {
    return sessionMessages.slice();
  }

  function saveSessionMessages(msgs: Message[]): boolean {
    sessionMessages = Array.isArray(msgs) ? msgs.slice() : [];
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionMessages));
      sessionStorageWarningActive = false;
      syncHistoryPanelWarning();
      return true;
    } catch {
      showSessionStorageWarning();
      return false;
    }
  }

  function appendSession(role: Message["role"], content: string) {
    const msgs = getSessionMessages();
    msgs.push({ role, content });
    saveSessionMessages(msgs);
  }

  function renderSessionHistory() {
    sessionHistory.innerHTML = "";
    for (const message of getSessionMessages()) {
      const wrap = document.createElement("div");
      wrap.className = "bubble bubble-" + message.role;

      const label = document.createElement("span");
      label.className = "bubble-label";
      label.textContent = message.role === "user" ? "You" : "Assistant";

      const p = document.createElement("p");
      p.textContent = message.content;

      wrap.append(label, p);
      sessionHistory.appendChild(wrap);
    }
    syncHistoryPanelWarning();
  }

  function buildHistoryPrompt() {
    return getSessionMessages()
      .map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.content)
      .join("\n");
  }

  function clearSessionMessages() {
    sessionMessages = [];
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorageWarningActive = false;
      syncHistoryPanelWarning();
      return true;
    } catch {
      showSessionStorageWarning();
      return false;
    }
  }

  sessionMessages = loadSessionMessages();
  renderSessionHistory();

  return {
    appendSession,
    buildHistoryPrompt,
    clearSessionMessages,
    getSessionMessages,
    renderSessionHistory,
    saveSessionMessages,
    sessionHistory,
    sessionStorage: storage.shim,
    store: storage.store,
    warningEl,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("session-storage normal path", () => {
  it("round-trips the transcript without changing order or content", () => {
    const runtime = createRuntime();
    const transcript: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    expect(runtime.saveSessionMessages(transcript)).toBe(true);
    runtime.renderSessionHistory();

    expect(runtime.sessionStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(transcript));
    expect(runtime.getSessionMessages()).toEqual(transcript);
    expect(readTranscript(runtime.sessionHistory)).toEqual(transcript);
    expect(runtime.buildHistoryPrompt()).toBe("User: Hello\nAssistant: Hi there");
    expect(runtime.warningEl.textContent).toBe("");
    expect(runtime.warningEl.classList.contains("hidden")).toBe(true);
  });
});

describe("session-storage malformed JSON", () => {
  it("keeps an already-rendered live transcript visible after storage becomes unreadable", () => {
    const transcript: Message[] = [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ];
    const runtime = createRuntime({ initialStoredValue: JSON.stringify(transcript) });

    expect(readTranscript(runtime.sessionHistory)).toEqual(transcript);

    runtime.store.set(SESSION_KEY, "not-json");
    runtime.renderSessionHistory();

    expect(runtime.getSessionMessages()).toEqual(transcript);
    expect(readTranscript(runtime.sessionHistory)).toEqual(transcript);
    expect(runtime.buildHistoryPrompt()).toBe("User: First question\nAssistant: First answer");
  });

  it("shows an aria-live warning when the stored payload is malformed on load", () => {
    const runtime = createRuntime({ initialStoredValue: "not-json" });

    expect(runtime.getSessionMessages()).toEqual([]);
    expect(readTranscript(runtime.sessionHistory)).toEqual([]);
    expect(runtime.warningEl.textContent).toBe(TEMP_WARNING);
    expect(runtime.warningEl.classList.contains("hidden")).toBe(false);
    expect(runtime.warningEl.getAttribute("role")).toBe("status");
    expect(runtime.warningEl.getAttribute("aria-live")).toBe("polite");
  });
});

describe("session-storage blocked write", () => {
  it("keeps the in-memory transcript intact and warns when writes fail", () => {
    const runtime = createRuntime({ setItemThrows: true });

    expect(() => runtime.appendSession("user", "Hello")).not.toThrow();
    expect(() => runtime.appendSession("assistant", "Hi there")).not.toThrow();
    runtime.renderSessionHistory();

    const transcript: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    expect(runtime.getSessionMessages()).toEqual(transcript);
    expect(readTranscript(runtime.sessionHistory)).toEqual(transcript);
    expect(runtime.buildHistoryPrompt()).toBe("User: Hello\nAssistant: Hi there");
    expect(runtime.warningEl.textContent).toBe(TEMP_WARNING);
    expect(runtime.warningEl.classList.contains("hidden")).toBe(false);
  });

  it("still clears the live transcript when the user requests a reset even if removeItem fails", () => {
    const runtime = createRuntime({ removeItemThrows: true });
    runtime.appendSession("user", "Hello");
    runtime.appendSession("assistant", "Hi there");

    expect(runtime.clearSessionMessages()).toBe(false);
    runtime.renderSessionHistory();

    expect(runtime.getSessionMessages()).toEqual([]);
    expect(readTranscript(runtime.sessionHistory)).toEqual([]);
    expect(runtime.warningEl.textContent).toBe(TEMP_WARNING);
  });
});
