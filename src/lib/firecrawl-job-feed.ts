import { z } from "zod";
import type { CollectedJob, JobFeedReader } from "./gateways";

const SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const TIMEOUT_MS = 120_000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const PROMPT =
  "Extract every job listed on this page. Use the link to each job's own page as its url. " +
  "Skip any job whose hiring company's name is not shown, such as confidential or anonymous listings. " +
  // Only a written date: a relative age such as "3 days ago" would make the model guess today's date.
  "Give postedDate as YYYY-MM-DD only when the page shows the full date the job was posted. " +
  "Leave it empty for relative ages such as '3 days ago' or when no date is shown. " +
  "Give companyLogoUrl only when the page shows the company's logo image for the job.";

const JOBS_SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          location: { type: "string" },
          url: { type: "string" },
          postedDate: { type: "string" },
          companyLogoUrl: { type: "string" },
        },
        required: ["title", "company", "url"],
      },
    },
  },
  required: ["jobs"],
};

const itemSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullish(),
  url: z.string().min(1),
  postedDate: z.string().nullish(),
  companyLogoUrl: z.string().nullish(),
});

const responseSchema = z.object({ data: z.object({ json: z.object({ jobs: z.array(z.unknown()) }) }) });

export const FEED_SOURCE_PREFIX = "Feed: ";

/** Labels a Job from a Job Feed by the Job Feed's host, such as "Feed: weworkremotely.com". */
const feedSource = (feedUrl: string) => `${FEED_SOURCE_PREFIX}${new URL(feedUrl).hostname.replace(/^www\./, "")}`;

export function firecrawlJobFeedReader(apiKey: string): JobFeedReader {
  return {
    async read(feedUrl: string) {
      // One scrape of the page as given: no crawling, so only the first page is read.
      const response = await fetch(SCRAPE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url: feedUrl,
          formats: [{ type: "json", prompt: PROMPT, schema: JOBS_SCHEMA }],
          onlyMainContent: true,
          timeout: TIMEOUT_MS,
          maxAge: MAX_AGE_MS,
        }),
      });
      if (!response.ok) throw new Error(`Firecrawl request failed: ${response.status}`);

      const { jobs } = responseSchema.parse(await response.json()).data.json;
      const source = feedSource(feedUrl);

      return jobs.flatMap((item): CollectedJob[] => {
        const parsed = itemSchema.safeParse(item);
        if (!parsed.success || !URL.canParse(parsed.data.url, feedUrl)) {
          console.warn(`Skipped a malformed Job from Job Feed ${feedUrl}`);
          return [];
        }
        const { title, company, location, url, postedDate, companyLogoUrl } = parsed.data;
        return [
          {
            source,
            title,
            companyName: company,
            location: location ?? "",
            url: new URL(url, feedUrl).href,
            postDay: postedDate && ISO_DAY.test(postedDate) ? postedDate : null,
            description: null,
            companyLinkedinUrl: null,
            companyLogoUrl: companyLogoUrl && URL.canParse(companyLogoUrl, feedUrl) ? new URL(companyLogoUrl, feedUrl).href : null,
          },
        ];
      });
    },
  };
}
