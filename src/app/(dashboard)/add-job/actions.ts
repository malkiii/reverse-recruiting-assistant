"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prepareJob } from "@/lib/dashboard-prepare";
import { drizzleJobStore, drizzleLlmSettingsStore } from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import { firecrawlJobPageReader } from "@/lib/firecrawl-job-page";
import { llmGateway } from "@/lib/llm";
import { addManualJob, type JobDraft, readJobPage } from "@/lib/manual-job";

export type ReadState = { url: string; draft?: JobDraft; error?: string };
export type SaveState = { error?: string };

/** What went wrong, as the Admin should read it: a form check's first message, or the error's. */
const errorMessage = (error: unknown) =>
  error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : String(error);

const webUrl = (error: string) => z.url({ protocol: /^https?$/, error });
const urlSchema = webUrl("Enter the Job page's full URL, starting with https://");

/** Reads the Job page into a draft for the Admin to check. A URL that's already a saved Job Prepares that one. */
export async function readJobPageAction(_state: ReadState, formData: FormData): Promise<ReadState> {
  const url = String(formData.get("url") ?? "").trim();
  let draft: JobDraft;
  let applicationId: number | undefined;
  try {
    const { DATABASE_URL, FIRECRAWL_API_KEY, TIMEZONE } = parseDashboardEnv(process.env);
    if (!FIRECRAWL_API_KEY) throw new Error("Add FIRECRAWL_API_KEY to the dashboard's environment to read Job pages");
    const settings = drizzleLlmSettingsStore(DATABASE_URL);
    const deps = {
      jobPages: firecrawlJobPageReader(FIRECRAWL_API_KEY),
      llm: llmGateway(await settings.get(), await settings.apiKeys()),
      jobs: drizzleJobStore(DATABASE_URL),
    };
    const today = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
    const result = await readJobPage(deps, urlSchema.parse(url), today);
    if (result.kind === "saved") applicationId = await prepareJob(result.jobId);
    else draft = result.draft;
  } catch (error) {
    return { url, error: errorMessage(error) };
  }
  if (applicationId !== undefined) redirect(`/applications/${applicationId}`);
  return { url, draft: draft! };
}

const draftSchema = z.object({
  title: z.string().trim().min(1, "Enter the Job title"),
  companyName: z.string().trim().min(1, "Enter the Company name"),
  location: z.string().trim(),
  postDay: z.iso.date("Enter the post day as a date"),
  companyLinkedinUrl: z.union([z.literal(""), webUrl("Enter the Company's LinkedIn URL in full, or leave it empty")]),
  url: urlSchema,
  description: z.string().trim().min(1, "The description is empty"),
});

/** Saves the checked draft as a manual Job, Prepares it and opens its Application. */
export async function saveJobAction(_state: SaveState, formData: FormData): Promise<SaveState> {
  let applicationId: number;
  try {
    const draft = draftSchema.parse(Object.fromEntries(Object.keys(draftSchema.shape).map((key) => [key, String(formData.get(key) ?? "")])));
    const { DATABASE_URL } = parseDashboardEnv(process.env);
    applicationId = await prepareJob(await addManualJob({ jobs: drizzleJobStore(DATABASE_URL) }, draft));
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(`/applications/${applicationId}`);
}
