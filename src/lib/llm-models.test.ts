import { expect, test } from "vitest";
import { listModels } from "./llm-models";

type Call = { url: string; headers: Record<string, string> };

/** Answers each request with the next queued body, recording the request. */
function fakeFetch(...bodies: unknown[]) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return Response.json(bodies.shift());
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

test("OpenAI lists only chat models with strict structured output", async () => {
  const ids = [
    "gpt-5",
    "gpt-5-mini",
    "gpt-4.1",
    "gpt-4o",
    "o3",
    "gpt-4",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-4o-mini-tts",
    "gpt-4o-transcribe",
    "gpt-4o-search-preview",
    "gpt-image-1",
    "text-embedding-3-small",
    "whisper-1",
    "dall-e-3",
    "omni-moderation-latest",
    "gpt-3.5-turbo-instruct",
    "o1-mini",
    "o1-preview",
    "o3-deep-research",
  ];
  const { calls, fetchFn } = fakeFetch({ data: ids.map((id) => ({ id })) });

  expect(await listModels("openai", "sk-key", fetchFn)).toEqual(["gpt-4.1", "gpt-4o", "gpt-5", "gpt-5-mini", "o3"]);
  expect(calls).toEqual([{ url: "https://api.openai.com/v1/models", headers: { authorization: "Bearer sk-key" } }]);
});

test("Groq lists only the gpt-oss models, the ones it holds to a strict JSON Schema", async () => {
  const ids = ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-120b", "openai/gpt-oss-safeguard-20b", "whisper-large-v3"];
  const { calls, fetchFn } = fakeFetch({ data: ids.map((id) => ({ id })) });

  expect(await listModels("groq", "gsk-key", fetchFn)).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  expect(calls).toEqual([{ url: "https://api.groq.com/openai/v1/models", headers: { authorization: "Bearer gsk-key" } }]);
});

test("Gemini lists its text models that generate content, across pages", async () => {
  const model = (id: string, methods = ["generateContent", "countTokens"]) => ({ name: `models/${id}`, supportedGenerationMethods: methods });
  const { calls, fetchFn } = fakeFetch(
    {
      models: [model("gemini-2.5-pro"), model("gemini-embedding-001", ["embedContent"]), model("gemini-2.5-flash-preview-tts")],
      nextPageToken: "page-2",
    },
    { models: [model("gemini-2.5-flash"), model("gemini-2.5-flash-image"), model("gemma-3-27b-it"), model("gemini-2.0-flash-live-001", ["bidiGenerateContent"])] },
  );

  expect(await listModels("gemini", "g-key", fetchFn)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  expect(calls).toEqual([
    { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", headers: { "x-goog-api-key": "g-key" } },
    { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=page-2", headers: { "x-goog-api-key": "g-key" } },
  ]);
});

test("Claude lists every model, newest first as Anthropic orders them, across pages", async () => {
  const headers = { "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" };
  const { calls, fetchFn } = fakeFetch(
    { data: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }], has_more: true, last_id: "claude-sonnet-5-5" },
    { data: [{ id: "claude-haiku-5-5" }], has_more: false, last_id: "claude-haiku-5-5" },
  );

  expect(await listModels("claude", "sk-ant", fetchFn)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  expect(calls).toEqual([
    { url: "https://api.anthropic.com/v1/models?limit=1000", headers },
    { url: "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-sonnet-5-5", headers },
  ]);
});

test("a key the provider refuses is rejected with the provider's reason", async () => {
  const fetchFn = (async () => Response.json({ error: { message: "Incorrect API key provided" } }, { status: 401 })) as typeof fetch;

  await expect(listModels("openai", "wrong", fetchFn)).rejects.toThrow("OpenAI refused the API key (401): Incorrect API key provided");
});
