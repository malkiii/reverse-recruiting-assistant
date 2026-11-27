import { z } from "zod";
import type { JobPageReader, JobStore, LlmGateway } from "./gateways";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const INSTRUCTIONS =
  "You read one job posting page, given as markdown, and give the job's details. " +
  "Give postDay as YYYY-MM-DD only when the page shows the date the job was posted, working out a relative age " +
  "such as '3 days ago' from today's date; otherwise leave it empty. " +
  "Give companyLinkedinUrl only when the page links to the company's LinkedIn page. Leave anything not shown empty.";

const answerSchema = z.object({
  title: z.string(),
  companyName: z.string(),
  location: z.string(),
  postDay: z.string(),
  companyLinkedinUrl: z.string(),
});

/** A Job the Admin found, as read from its page, for them to check before it's saved. */
export type JobDraft = z.infer<typeof answerSchema> & { url: string; description: string };

export type ReadJobPageDeps = { jobPages: JobPageReader; llm: LlmGateway; jobs: JobStore };

/**
 * Reads a Job page into a draft of the Job, or gives the saved Job when the URL already is one.
 * Today, as YYYY-MM-DD, is the post day when the page shows none.
 */
export async function readJobPage({ jobPages, llm, jobs }: ReadJobPageDeps, url: string, today: string) {
  const saved = await jobs.findByUrl(url);
  if (saved) return { kind: "saved" as const, jobId: saved.id };
  const description = (await jobPages.read(url)).trim();
  const answer = await llm.generate({
    instructions: INSTRUCTIONS,
    prompt: `Today is ${today}.\n\n<job-page url="${url}">\n${description}\n</job-page>`,
    schema: answerSchema,
  });
  const draft: JobDraft = { ...answer, postDay: ISO_DAY.test(answer.postDay) ? answer.postDay : today, url, description };
  return { kind: "draft" as const, draft };
}

export const MANUAL_SOURCE = "manual";

/** Saves the draft the Admin checked as a manual Job, and returns its ID: a Duplicate Job's when it is one. */
export function addManualJob({ jobs }: { jobs: JobStore }, { title, companyName, location, url, postDay, description, companyLinkedinUrl }: JobDraft) {
  return jobs.add({
    source: MANUAL_SOURCE,
    title,
    companyName,
    location,
    url,
    postDay,
    description,
    companyLinkedinUrl: companyLinkedinUrl || null,
    companyLogoUrl: null,
  });
}
