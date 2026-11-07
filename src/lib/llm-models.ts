import { z } from "zod";
import type { LlmProvider } from "./schema";

export const LLM_PROVIDER_NAMES: Record<LlmProvider, string> = {
  claude: "Claude",
  gemini: "Gemini",
  openai: "OpenAI",
  groq: "Groq",
};

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

const idListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/** OpenAI's text models that take a strict JSON Schema; older GPT-4, GPT-3.5 and o1 previews don't. */
const isOpenAiChatModel = (id: string) =>
  /^(gpt-|o\d)/.test(id) &&
  !/^(gpt-(3\.5|4)(-|$)|o1-(mini|preview))/.test(id) &&
  !/(audio|realtime|tts|transcribe|search|research|image|instruct|embedding|moderation)/.test(id);

/** A provider's answer, or its error as a readable message. */
async function getJson(provider: LlmProvider, fetchFn: typeof fetch, url: string, headers: Record<string, string>) {
  const response = await fetchFn(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const reason = errorSchema.safeParse(body).data?.error.message ?? response.statusText;
  const problem = response.status === 401 || response.status === 403 ? "refused the API key" : "couldn't list its models";
  throw new Error(`${LLM_PROVIDER_NAMES[provider]} ${problem} (${response.status}): ${reason}`);
}

/** The models the API key may use for Prepare's requests. Throws when the provider refuses the key. */
export async function listModels(provider: LlmProvider, apiKey: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const bearer = { authorization: `Bearer ${apiKey}` };
  switch (provider) {
    case "openai":
      return ids(await getJson(provider, fetchFn, "https://api.openai.com/v1/models", bearer)).filter(isOpenAiChatModel).sort();
    case "groq":
      // Groq holds only these to a strict JSON Schema.
      return ids(await getJson(provider, fetchFn, "https://api.groq.com/openai/v1/models", bearer))
        .filter((id) => /^openai\/gpt-oss-\d+b$/.test(id))
        .sort();
    case "gemini":
      return (await geminiModels(fetchFn, apiKey)).sort();
    case "claude":
      return claudeModels(fetchFn, apiKey);
  }
}

const claudePageSchema = idListSchema.extend({ has_more: z.boolean(), last_id: z.string().nullable() });

async function claudeModels(fetchFn: typeof fetch, apiKey: string) {
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  const models: string[] = [];
  let afterId: string | null = null;
  do {
    const url = `https://api.anthropic.com/v1/models?limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ""}`;
    const page = claudePageSchema.parse(await getJson("claude", fetchFn, url, headers));
    models.push(...page.data.map(({ id }) => id));
    afterId = page.has_more ? page.last_id : null;
  } while (afterId);
  return models;
}

const geminiPageSchema = z.object({
  models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).default([]) })).default([]),
  nextPageToken: z.string().optional(),
});

async function geminiModels(fetchFn: typeof fetch, apiKey: string) {
  const models: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const page = geminiPageSchema.parse(await getJson("gemini", fetchFn, url, { "x-goog-api-key": apiKey }));
    for (const { name, supportedGenerationMethods } of page.models) {
      const id = name.replace(/^models\//, "");
      if (supportedGenerationMethods.includes("generateContent") && /^gemini-/.test(id) && !/(tts|image|embedding|live|audio)/.test(id)) {
        models.push(id);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return models;
}

const ids = (body: unknown) => idListSchema.parse(body).data.map(({ id }) => id);
