import { z } from "zod";
import { actorRunItems, actorRunStatus, startActorRun } from "./apify-actor";
import type { ActorRun, JobBoardGateway } from "./gateways";
import type { JobSearch } from "./schema";

const ACTOR = "worldunboxer/rapid-linkedin-scraper";
const SOURCE = "LinkedIn";
const PAST_24_HOURS = "Past 24 hours";
// The actor rejects smaller runs. Job Collection still saves at most its cap.
const MIN_JOBS_PER_RUN = 10;

const itemSchema = z.object({
  job_url: z.string(),
  job_title: z.string(),
  company_name: z.string(),
  location: z.string().nullish(),
  posted_date: z.string(),
  job_description: z.string().nullish(),
  company_url: z.string().nullish(),
  company_logo_url: z.string().nullish(),
  // Only given with include_job_details, and only when the employer publishes it.
  salary_range: z.string().nullish(),
});

export const linkedInJobBoard: JobBoardGateway = {
  source: SOURCE,
  actor: ACTOR,

  start({ keywords, location }: JobSearch, limit: number, token: string) {
    return startActorRun(
      ACTOR,
      {
        jobs_titles: [keywords],
        location,
        posted_within: PAST_24_HOURS,
        jobs_entries: Math.max(limit, MIN_JOBS_PER_RUN),
        include_job_details: true,
      },
      token,
    );
  },

  status: actorRunStatus,

  results(run: ActorRun) {
    return actorRunItems(
      run,
      itemSchema,
      ({ job_url, job_title, company_name, location, posted_date, job_description, company_url, company_logo_url, salary_range }) => ({
        source: SOURCE,
        title: job_title,
        companyName: company_name,
        location: location ?? "",
        url: job_url.split("?")[0],
        postDay: posted_date.slice(0, 10),
        description: job_description ?? null,
        companyLinkedinUrl: company_url ?? null,
        companyLogoUrl: company_logo_url || null,
        salary: salary_range || null,
      }),
    );
  },
};
