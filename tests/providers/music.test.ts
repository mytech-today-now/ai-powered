import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConfigSchema } from "../../src/ai-powered/core.js";
import { MusicProvider } from "../../src/ai-powered/providers/music.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider(provider: string): MusicProvider {
  return new MusicProvider(
    AiConfigSchema.parse({ provider, apiKey: "music-test-key", mock: false }),
  );
}

const asyncFixtures = [
  {
    provider: "mubert",
    create: { id: "mubert-task" },
    result: { generations: [{ status: "done", url: "https://cdn.example/mubert.mp3" }] },
    pollUrl: "https://music-api.mubert.com/api/v3/public/tracks/mubert-task",
  },
  {
    provider: "mureka",
    create: { id: "mureka-task" },
    result: { status: "completed", clips: [{ audio_url: "https://cdn.example/mureka.mp3" }] },
    pollUrl: "https://api.mureka.ai/v1/song/query/mureka-task",
  },
  {
    provider: "apiframe",
    create: { jobId: "apiframe-task" },
    result: {
      status: "COMPLETED",
      result: { tracks: [{ audioUrl: "https://cdn.example/apiframe.mp3" }] },
    },
    pollUrl: "https://api.apiframe.ai/v2/jobs/apiframe-task",
  },
  {
    provider: "kie-suno",
    create: { data: { taskId: "kie-task" } },
    result: {
      data: {
        status: "SUCCESS",
        response: { sunoData: [{ audioUrl: "https://cdn.example/kie.mp3" }] },
      },
    },
    pollUrl: "https://api.kie.ai/api/v1/generate/record-info?taskId=kie-task",
  },
  {
    provider: "ace-suno",
    create: { data: { task_id: "ace-task" } },
    result: { response: { data: [{ audio_url: "https://cdn.example/ace.mp3" }] } },
    pollUrl: "https://api.acedata.cloud/suno/tasks",
    method: "POST",
    body: JSON.stringify({ id: "ace-task", action: "retrieve" }),
  },
  {
    provider: "musicapi",
    create: { task_id: "musicapi-task" },
    result: {
      data: { status: "success", clips: [{ audio_url: "https://cdn.example/musicapi.mp3" }] },
    },
    pollUrl: "https://api.musicapi.ai/api/v1/sonic/task/musicapi-task",
  },
  {
    provider: "udioapi",
    create: { workId: "udio-task" },
    result: {
      data: { type: "SUCCESS", response_data: [{ audio_url: "https://cdn.example/udio.mp3" }] },
    },
    pollUrl: "https://udioapi.pro/api/v2/feed?workId=udio-task",
  },
  {
    provider: "apipass-suno",
    create: { data: { taskId: "apipass-task" } },
    result: {
      data: {
        state: "success",
        resultJson: JSON.stringify({ data: [{ audio_url: "https://cdn.example/apipass.mp3" }] }),
      },
    },
    pollUrl: "https://api.apipass.dev/api/v1/jobs/recordInfo?taskId=apipass-task",
  },
  {
    provider: "sunor",
    create: { data: { task_id: "sunor-task" } },
    result: { data: { status: "success", output: { audio_url: "https://cdn.example/sunor.mp3" } } },
    pollUrl: "https://sunor.cc/api/v1/task/sunor-task",
  },
] as const;

describe("MusicProvider asynchronous contracts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(asyncFixtures)(
    "polls $provider using its own status contract without network access",
    async ({ provider, create, result, pollUrl, method, body }) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(create))
        .mockResolvedValueOnce(jsonResponse(result));
      vi.stubGlobal("fetch", fetchMock);

      const output = await createProvider(provider).generateMusic("test prompt");

      expect(output.data).toMatch(/^https:\/\/cdn\.example\/.*\.mp3$/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(pollUrl);
      const request = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
      expect(request?.method ?? "GET").toBe(method ?? "GET");
      if (body) expect(request?.body).toBe(body);
    },
  );

  it("fails closed when a synchronous provider returns a task without a contract", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: "unexpected-task" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProvider("google-lyria").generateMusic("test prompt")).rejects.toMatchObject(
      {
        provider: "google-lyria",
        statusCode: 502,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("udioapi.pro");
  });
});
