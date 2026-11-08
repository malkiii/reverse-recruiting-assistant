import { revalidatePath } from "next/cache";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";
import { checkboxClass, inputClass, labelClass } from "@/components/ui";
import {
  drizzleExcludedKeywordStore,
  drizzleJobBoardSettingsStore,
  drizzleJobFeedStore,
  drizzleScheduleSettingsStore,
} from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import { glassdoorJobBoard } from "@/lib/glassdoor-job-board";
import { linkedInJobBoard } from "@/lib/linkedin-job-board";
import type { JobSearch } from "@/lib/schema";
import { LinkedInSearches } from "./linkedin-searches";

function databaseUrl() {
  return parseDashboardEnv(process.env).DATABASE_URL;
}

function parseSearches(formData: FormData): JobSearch[] {
  const locations = formData.getAll("location");
  return formData
    .getAll("keywords")
    .map((keywords, index) => ({ keywords: String(keywords).trim(), location: String(locations[index] ?? "").trim() }))
    .filter(({ keywords }) => keywords);
}

function feedUrl(formData: FormData) {
  const url = String(formData.get("url")).trim();
  if (!URL.canParse(url)) throw new Error(`Not a URL: ${url}`);
  return url;
}

async function saveSchedule(formData: FormData) {
  "use server";

  await drizzleScheduleSettingsStore(databaseUrl()).saveCollectionEnabled(formData.get("enabled") === "on");
  revalidatePath("/jobs");
}

async function saveLinkedIn(formData: FormData) {
  "use server";

  // The LinkedIn actor can't filter by remote work, so it has no Remote only setting.
  await drizzleJobBoardSettingsStore(databaseUrl()).save({
    source: linkedInJobBoard.source,
    enabled: formData.get("enabled") === "on",
    searches: parseSearches(formData),
    remoteOnly: false,
  });
  revalidatePath("/jobs");
}

async function saveGlassdoor(formData: FormData) {
  "use server";

  const keywords = String(formData.get("keywords")).trim();
  const location = String(formData.get("location")).trim();
  await drizzleJobBoardSettingsStore(databaseUrl()).save({
    source: glassdoorJobBoard.source,
    enabled: formData.get("enabled") === "on",
    searches: keywords ? [{ keywords, location }] : [],
    remoteOnly: formData.get("remoteOnly") === "on",
  });
  revalidatePath("/jobs");
}

async function saveExcludedKeywords(formData: FormData) {
  "use server";

  const keywords = String(formData.get("keywords"))
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const unique = [...new Map(keywords.map((keyword) => [keyword.toLowerCase(), keyword])).values()];
  await drizzleExcludedKeywordStore(databaseUrl()).replace(unique);
  revalidatePath("/jobs");
}

async function addJobFeed(formData: FormData) {
  "use server";

  await drizzleJobFeedStore(databaseUrl()).add(feedUrl(formData));
  revalidatePath("/jobs");
}

async function saveJobFeed(formData: FormData) {
  "use server";

  const id = Number(formData.get("id"));
  const store = drizzleJobFeedStore(databaseUrl());
  if (formData.get("remove")) await store.remove(id);
  else await store.update({ id, url: feedUrl(formData), enabled: formData.get("enabled") === "on" });
  revalidatePath("/jobs");
}

/** What Job Collection runs on: the Schedule, Job Boards, Job Feeds and Excluded Keywords. Shown in the Jobs side panel. */
export async function CollectionSettings() {
  const settingsStore = drizzleJobBoardSettingsStore(databaseUrl());
  const [linkedIn, glassdoor, feeds, excludedKeywords, scheduledCollection] = await Promise.all([
    settingsStore.get(linkedInJobBoard.source),
    settingsStore.get(glassdoorJobBoard.source),
    drizzleJobFeedStore(databaseUrl()).list(),
    drizzleExcludedKeywordStore(databaseUrl()).list(),
    drizzleScheduleSettingsStore(databaseUrl()).collectionEnabled(),
  ]);
  const glassdoorSearch = glassdoor?.searches[0];

  return (
    <div className="divide-y divide-line">
      <Section title="Schedule" description="Runs Job Collection every day at 10:00 in your timezone.">
        <form action={saveSchedule} className="flex items-center justify-between gap-3">
          <Enabled checked={scheduledCollection} />
          <Save />
        </form>
      </Section>

      <Section title="Glassdoor Job Board">
        <form action={saveGlassdoor} className="space-y-3">
          <div className="flex flex-wrap gap-x-5">
            <Enabled checked={glassdoor?.enabled} />
            <Checkbox name="remoteOnly" label="Remote only" checked={glassdoor?.remoteOnly} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelClass}>Keywords</span>
              <input
                name="keywords"
                placeholder="software engineer"
                defaultValue={glassdoorSearch?.keywords}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Location</span>
              <input name="location" placeholder="New York" defaultValue={glassdoorSearch?.location} className={inputClass} />
            </label>
          </div>
          <Save />
        </form>
      </Section>

      <Section title="LinkedIn Job Board">
        <form action={saveLinkedIn} className="space-y-3">
          <Enabled checked={linkedIn?.enabled} />
          <LinkedInSearches searches={linkedIn?.searches ?? []} />
          <Save />
        </form>
      </Section>

      <Section
        title="Job Feeds"
        description="Filtered job listing URLs from any website. Each enabled Job Feed costs one Firecrawl request a day."
      >
        {feeds.map((feed) => (
          <form key={feed.id} action={saveJobFeed} className="space-y-2 rounded-sm border border-line p-2.5">
            <input type="hidden" name="id" value={feed.id} />
            <input
              name="url"
              type="url"
              defaultValue={feed.url}
              required
              aria-label="Job Feed URL"
              className={inputClass}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Enabled checked={feed.enabled} />
              <div className="flex gap-2">
                <SubmitButton variant="danger" name="remove" value="1" pendingText="Removing…" confirm="Remove this Job Feed?">
                  Remove
                </SubmitButton>
                <SubmitButton variant="secondary" name="save" value="1" pendingText="Saving…">
                  Save
                </SubmitButton>
              </div>
            </div>
          </form>
        ))}
        <form action={addJobFeed} className="flex gap-2">
          <input
            name="url"
            type="url"
            placeholder="https://example.com/jobs?q=engineer"
            required
            aria-label="New Job Feed URL"
            className={inputClass}
          />
          <SubmitButton pendingText="Adding…" className="shrink-0">
            Add
          </SubmitButton>
        </form>
      </Section>

      <Section
        title="Excluded Keywords"
        description="A Job whose title contains any of these words or phrases, ignoring case, is skipped."
      >
        <form action={saveExcludedKeywords} className="space-y-3">
          <input
            name="keywords"
            placeholder="senior, lead, manager"
            defaultValue={excludedKeywords.join(", ")}
            aria-label="Excluded Keywords, comma separated"
            className={inputClass}
          />
          <Save />
        </form>
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 px-4 py-4">
      <div>
        <h3 className="text-xs font-medium tracking-wide text-fg uppercase">{title}</h3>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Enabled({ checked }: { checked?: boolean }) {
  return <Checkbox name="enabled" label="Enabled" checked={checked} />;
}

function Checkbox({ name, label, checked }: { name: string; label: string; checked?: boolean }) {
  return (
    <label className="flex min-h-9 items-center gap-2.5 text-[13px] text-fg-2">
      <input type="checkbox" name={name} defaultChecked={checked} className={checkboxClass} /> {label}
    </label>
  );
}

function Save() {
  return (
    <SubmitButton variant="secondary" pendingText="Saving…">
      Save
    </SubmitButton>
  );
}
