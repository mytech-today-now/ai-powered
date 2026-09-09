/**
 * Tests — web-example main demo streaming behavior
 *
 * Covers:
 *  - non-streaming generate path still renders the provider response
 *  - clean SSE streaming appends deltas in order and completes normally
 *  - malformed SSE frames stop the stream and surface a visible warning
 *  - the reader.done completion path still leaves the rendered text intact
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createWebClientMock, generateTextMock } = vi.hoisted(() => {
  const generateTextMock = vi.fn();
  const createWebClientMock = vi.fn(() => ({
    generateText: generateTextMock,
  }));
  return { createWebClientMock, generateTextMock };
});

vi.mock("ai-powered/web", () => ({
  createWebClient: createWebClientMock,
}));

function renderDemoDom(): void {
  document.body.innerHTML = `
    <input id="proxy-url" value="http://localhost:3001" />
    <textarea id="prompt">Explain SSE.</textarea>
    <button id="btn-generate" type="button">Generate</button>
    <button id="btn-stream" type="button">Stream</button>
    <div id="output"></div>
  `;
}

function makeStreamResponse(
  chunks: string[],
  options?: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    textBody?: string;
  },
): Response {
  let index = 0;
  let cancelled = false;
  const encoder = new TextEncoder();

  const reader = {
    async read() {
      if (cancelled || index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const value = encoder.encode(chunks[index] ?? "");
      index += 1;
      return { done: false, value };
    },
    async cancel() {
      cancelled = true;
    },
  };

  return {
    ok: options?.ok ?? true,
    status: options?.status ?? 200,
    statusText: options?.statusText ?? "OK",
    body: {
      getReader() {
        return reader;
      },
    },
    text: async () => options?.textBody ?? "",
  } as unknown as Response;
}

async function mountDemo(): Promise<void> {
  vi.resetModules();
  await import("../../integrations/web-example/main.js");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  renderDemoDom();
  createWebClientMock.mockClear();
  generateTextMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web-example main demo", () => {
  it("baseline: non-streaming generate path still renders the provider response", async () => {
    generateTextMock.mockResolvedValue({
      content: "Generated answer",
      model: "mock-model",
      provider: "mock",
    });

    await mountDemo();

    const prompt = document.getElementById("prompt") as HTMLTextAreaElement;
    prompt.value = "Hello from the generate path.";
    (document.getElementById("btn-generate") as HTMLButtonElement).click();

    await settle();

    expect(generateTextMock).toHaveBeenCalledWith("Hello from the generate path.");
    expect((document.getElementById("output") as HTMLDivElement).textContent).toBe(
      "Generated answer",
    );
    expect((document.getElementById("btn-generate") as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById("btn-stream") as HTMLButtonElement).disabled).toBe(false);
  });

  it("clean SSE stream: data frames append in order and [DONE] still completes normally", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse(['data: {"delta":"Hel"}\n', 'data: {"delta":"lo"}\n', "data: [DONE]\n"]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await mountDemo();

    (document.getElementById("btn-stream") as HTMLButtonElement).click();
    await settle();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Explain SSE." }),
    });
    expect((document.getElementById("output") as HTMLDivElement).textContent).toBe("Hello");
    expect((document.getElementById("btn-stream") as HTMLButtonElement).disabled).toBe(false);
  });

  it("malformed SSE frame: the stream stops, keeps partial text, and shows the truncation warning", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([
          'data: {"delta":"Hel"}\n',
          "data: {bad json}\n",
          'data: {"delta":"lo"}\n',
          "data: [DONE]\n",
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await mountDemo();

    (document.getElementById("btn-stream") as HTMLButtonElement).click();
    await settle();

    expect((document.getElementById("output") as HTMLDivElement).textContent).toBe(
      "Hel\n\nWarning: stream stopped after 1 malformed SSE frame; the answer may be incomplete.",
    );
    expect((document.getElementById("btn-stream") as HTMLButtonElement).disabled).toBe(false);
  });

  it("current completion path: a reader that ends without [DONE] still leaves rendered text intact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse(['data: {"delta":"Hi"}\n']));
    vi.stubGlobal("fetch", fetchMock);

    await mountDemo();

    (document.getElementById("btn-stream") as HTMLButtonElement).click();
    await settle();

    expect((document.getElementById("output") as HTMLDivElement).textContent).toBe("Hi");
    expect((document.getElementById("btn-stream") as HTMLButtonElement).disabled).toBe(false);
  });
});
