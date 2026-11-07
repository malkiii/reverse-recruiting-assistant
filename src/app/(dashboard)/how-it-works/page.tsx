import Link from "next/link";
import type { ReactNode } from "react";
import { STEP_NAMES } from "@/components/status";
import { Card, CardHeader, linkClass, PageHeader } from "@/components/ui";
import type { ApplicationStep } from "@/lib/gateways";
import { APPLICATION_STEPS } from "@/lib/schema";

const STEP_DETAILS: Record<ApplicationStep, string> = {
  "read-job": "Reads the Job page and summarizes it.",
  "choose-resume": "The LLM picks the best-fitting Resume from your Resume Folder.",
  "find-company-page": "Confirms the Company's LinkedIn page. If it can't, the Application ends in Direct Apply.",
  "find-decision-makers":
    "Finds up to 5 Decision Makers with email addresses. If none has one, the Application ends in No Contacts.",
  "write-cover-letter": "Writes one Cover Letter for the Job, personalized for each Decision Maker.",
  "check-sharing": "Makes sure the Resume Folder is shared by link, so recipients can open the Resume.",
  send: "After you click Send, emails each Decision Maker from your Gmail. They then enter a 30-day Cooldown.",
};

/** The page's sections, in reading order. */
const SECTIONS = [
  { id: "setup", title: "1. Set up" },
  { id: "workflow", title: "2. The daily workflow" },
  { id: "steps", title: "3. Application steps" },
  { id: "collection-settings", title: "4. Collection settings" },
  { id: "settings", title: "5. Settings" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function HowItWorksPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="How it works" subtitle="A quick guide, from finding Jobs to sending Applications." />

      <Card>
        <CardHeader title="On this page" />
        <ol className="grid gap-1 px-2 py-2 text-sm sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="flex min-h-9 items-center rounded-sm px-2 text-fg-2 transition hover:bg-subtle hover:text-fg"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </Card>

      <Section id="setup" description="Do these once before your first Job Collection.">
        <Steps>
          <Step title="Choose an LLM" href="/settings" linkText="Settings">
            Add a provider with its API key, then pick one of the models it lets you use to choose a Resume and write the Cover Letter.
          </Step>
          <Step title="Connect Google" href="/google" linkText="Google">
            Connect Gmail, used to send, and choose the Resume Folder holding your Resume PDFs.
          </Step>
          <Step title="Set up Job Collection" href="/jobs" linkText="Jobs">
            Open the Collection settings side panel and add your Job Boards and Job Feeds. See{" "}
            <a href="#collection-settings" className={linkClass}>
              Collection settings
            </a>
            .
          </Step>
          <Step title="Allow sending" href="/settings" linkText="Settings">
            Turn on Sending when you&apos;re ready. While it&apos;s off, Send is refused.
          </Step>
        </Steps>
      </Section>

      <Section id="workflow">
        <Steps>
          <Step title="Job Collection" href="/jobs" linkText="Jobs">
            Gathers new Jobs daily from your enabled Job Boards and Job Feeds, and sends each new Job to you as a Job
            Alert.
          </Step>
          <Step title="Prepare" href="/jobs" linkText="Jobs">
            Prepare a Job you like. The agent builds an Application: Resume, Cover Letter and Decision Makers. Nothing
            is sent yet. See{" "}
            <a href="#steps" className={linkClass}>
              Application steps
            </a>
            .
          </Step>
          <Step title="Review" href="/applications?status=in-review" linkText="In Review">
            Edit the subject, Cover Letter or Resume, or remove a Decision Maker.
          </Step>
          <Step title="Send or Cancel" href="/applications" linkText="Applications">
            A Failed Application can be Retried from the step it failed at. Track results in{" "}
            <Link href="/stats" className={linkClass}>
              Stats
            </Link>
            .
          </Step>
        </Steps>
      </Section>

      <Section id="steps" description="What Prepare and Send do, in order. Each attempt shows as a Step Log.">
        <Steps>
          {APPLICATION_STEPS.map((step) => (
            <Step key={step} title={STEP_NAMES[step]}>
              {STEP_DETAILS[step]}
            </Step>
          ))}
        </Steps>
      </Section>

      <Section
        id="collection-settings"
        description={
          <>
            In the{" "}
            <Link href="/jobs" className={linkClass}>
              Jobs
            </Link>{" "}
            page&apos;s side panel.
          </>
        }
      >
        <Items>
          <Item name="Schedule">Runs Job Collection every day at 10:00 in your timezone. You can also start it by hand.</Item>
          <Item name="LinkedIn Job Board">One or more keyword and location searches.</Item>
          <Item name="Glassdoor Job Board">One keyword and location search, optionally remote only.</Item>
          <Item name="Job Feeds">Filtered job listing URLs from any website. Each costs one Firecrawl request a day.</Item>
          <Item name="Excluded Keywords">Jobs whose title contains any of these are skipped.</Item>
        </Items>
      </Section>

      <Section id="settings">
        <Items>
          <Item name="LLM" href="/settings">
            The providers you added with their API keys, and the provider and model used to choose a Resume and write the Cover Letter.
          </Item>
          <Item name="Sending" href="/settings">
            Must be on for Send to work. While it&apos;s off, Send is refused.
          </Item>
          <Item name="Google" href="/google">
            Connect Gmail, used to send, and choose the Resume Folder holding your Resume PDFs.
          </Item>
          <Item name="Function runs" href="/function-runs">
            Recent background runs and their errors.
          </Item>
          <Item name="Old Data" href="/settings">
            Deletes data 6 months old or more.
          </Item>
        </Items>
      </Section>
    </div>
  );
}

function Section({ id, description, children }: { id: SectionId; description?: ReactNode; children: ReactNode }) {
  const index = SECTIONS.findIndex((section) => section.id === id);
  const next = SECTIONS[index + 1];
  return (
    <section id={id} className="scroll-mt-20">
      <Card>
        <CardHeader title={SECTIONS[index].title} />
        <div className="space-y-3 px-4 py-4 text-sm text-fg-2">
          {description && <p className="text-muted">{description}</p>}
          {children}
        </div>
        <div className="flex justify-end border-t border-line px-4 py-2.5 text-sm">
          {next ? (
            <a href={`#${next.id}`} className={linkClass}>
              Next: {next.title.replace(/^\d+\.\s*/, "")} ↓
            </a>
          ) : (
            <a href="#top" className={linkClass}>
              Back to top ↑
            </a>
          )}
        </div>
      </Card>
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-3 [counter-reset:step]">{children}</ol>;
}

function Step({ title, href, linkText, children }: { title: string; href?: string; linkText?: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 [counter-increment:step]">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-medium text-accent before:content-[counter(step)]"
      />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="font-medium text-fg">
          {title}
          {href && (
            <>
              {" "}
              <Link href={href} className={`${linkClass} ml-1 text-xs font-normal`}>
                Open {linkText} ›
              </Link>
            </>
          )}
        </p>
        <p className="text-muted">{children}</p>
      </div>
    </li>
  );
}

function Items({ children }: { children: ReactNode }) {
  return <dl className="space-y-2">{children}</dl>;
}

function Item({ name, href, children }: { name: string; href?: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-fg">
        {href ? (
          <Link href={href} className="hover:text-accent hover:underline underline-offset-4">
            {name} ›
          </Link>
        ) : (
          name
        )}
      </dt>
      <dd className="text-muted">{children}</dd>
    </div>
  );
}
