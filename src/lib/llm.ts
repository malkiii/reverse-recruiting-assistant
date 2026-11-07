import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { LlmApiKeys, LlmChoice, LlmGateway, LlmRequest } from "./gateways";
import { LLM_PROVIDER_NAMES } from "./llm-models";

const MAX_TOKENS = 16_000;

/** The schema as plain JSON Schema, which every provider's structured output takes. */
function jsonSchema(schema: z.ZodType) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<unknown>;
}

function claude(apiKey: string, model: string): LlmGateway {
  const client = new Anthropic({ apiKey });
  return {
    async generate<T>({ instructions, prompt, schema }: LlmRequest<T>) {
      const message = await client.messages.parse({
        model,
        max_tokens: MAX_TOKENS,
        system: instructions,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: zodOutputFormat(schema as z.ZodType<T>) },
      });
      if (message.stop_reason === "refusal") throw new Error(`Claude declined the request: ${message.stop_details?.category}`);
      if (message.parsed_output == null) throw new Error(`Claude returned no structured output (${message.stop_reason})`);
      return message.parsed_output as T;
    },
  };
}

const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable(), refusal: z.string().nullish() }) })).min(1),
});

/** OpenAI's Chat Completions, which Groq also serves, with a strict JSON Schema response format. */
function chatCompletions(url: string, apiKey: string, model: string): LlmGateway {
  return {
    async generate<T>({ instructions, prompt, schema }: LlmRequest<T>) {
      const body = await postJson(url, { authorization: `Bearer ${apiKey}` }, {
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "answer", strict: true, schema: jsonSchema(schema) },
        },
      });
      const { message } = chatCompletionSchema.parse(body).choices[0];
      if (message.refusal) throw new Error(`The LLM declined the request: ${message.refusal}`);
      if (!message.content) throw new Error("The LLM returned no content");
      return schema.parse(JSON.parse(message.content));
    },
  };
}

const geminiResponseSchema = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) }))
    .min(1),
});

function gemini(apiKey: string, model: string): LlmGateway {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    async generate<T>({ instructions, prompt, schema }: LlmRequest<T>) {
      const body = await postJson(url, { "x-goog-api-key": apiKey }, {
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: jsonSchema(schema) },
      });
      const answer = geminiResponseSchema.safeParse(body);
      // A blocked prompt or answer comes back with no candidate or no parts.
      if (!answer.success) throw new Error(`Gemini returned no answer: ${JSON.stringify(body).slice(0, 500)}`);
      const text = answer.data.candidates[0].content.parts.map((part) => part.text ?? "").join("");
      return schema.parse(JSON.parse(text));
    },
  };
}

/** The LLM the Admin chose, with the API key they added in settings. */
export function llmGateway(choice: LlmChoice | undefined, apiKeys: LlmApiKeys): LlmGateway {
  if (!choice) throw new Error("No LLM is chosen: choose a provider and model in the dashboard's settings");
  const { provider, model } = choice;
  const apiKey = apiKeys[provider];
  if (!apiKey) throw new Error(`${LLM_PROVIDER_NAMES[provider]} has no API key: add one in the dashboard's settings`);

  switch (provider) {
    case "claude":
      return claude(apiKey, model);
    case "openai":
      return chatCompletions("https://api.openai.com/v1/chat/completions", apiKey, model);
    case "groq":
      return chatCompletions("https://api.groq.com/openai/v1/chat/completions", apiKey, model);
    case "gemini":
      return gemini(apiKey, model);
  }
}
