import { z } from "zod";
import type { JobPageReader } from "./gateways";

const SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const TIMEOUT_MS = 120_000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

const responseSchema = z.object({ data: z.object({ markdown: z.string() }) });

/** Reads a Job page to main-content markdown, in one Firecrawl scrape. */
export function firecrawlJobPageReader(apiKey: string): JobPageReader {
  return {
    async read(url: string) {
      const response = await fetch(SCRAPE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: TIMEOUT_MS, maxAge: MAX_AGE_MS }),
      });
      if (!response.ok) throw new Error(`Firecrawl scrape failed: ${response.status} ${await response.text()}`);
      return responseSchema.parse(await response.json()).data.markdown;
    },
  };
}
