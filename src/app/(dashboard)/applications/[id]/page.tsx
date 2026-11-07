import { AutoRefresh } from "@/components/auto-refresh";
import { Avatar } from "@/components/avatar";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { STEP_NAMES } from "@/components/status";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, CardHeader, DetailList, dateTime, ExternalLink, linkClass, SourceBadge, StatusBadge, Tag } from "@/components/ui";
import {
  addDecisionMaker,
  applicationAsOf,
  cancel,
  edit,
  type EditResult,
  removeDecisionMaker,
} from "@/lib/application-lifecycle";
import { startFunction } from "@/lib/dashboard-functions";
import { dashboardGoogle } from "@/lib/dashboard-google";
import { groupPeople, type NotChosenReason } from "@/lib/decision-maker-search";
import {
  drizzleApplicationStore,
  drizzleCompanyStore,
  drizzleDecisionMakerStore,
  drizzleFunctionRunStore,
  drizzleJobStore,
  drizzleSendSettingsStore,
  drizzleStepLogStore,
} from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import { runAsOf } from "@/lib/function-runs";
import type { Application, DriveFile, StepLog } from "@/lib/gateways";
import { GoogleConnectionError } from "@/lib/google-connection";
import { resumesIn } from "@/lib/resumes";
import { PREPARE_APPLICATION, SEND_APPLICATION } from "@/lib/schema";
import { CoverLetterCard } from "./cover-letter-card";

const applicationPath = (applicationId: number) => `/applications/${applicationId}`;

/** Back to the Application page, showing why the action was refused when it was. */
function backToApplication(applicationId: number, error?: string): never {
  revalidatePath(applicationPath(applicationId));
  redirect(error ? `${applicationPath(applicationId)}?error=${encodeURIComponent(error)}` : applicationPath(applicationId));
}

const applicationStore = () => drizzleApplicationStore(parseDashboardEnv(process.env).DATABASE_URL);

async function retryApplication(formData: FormData) {
  "use server";

  const applicationId = Number(formData.get("applicationId"));
  // A failed Send is resumed by send-application, anything else by prepare-application.
  // A 409 means it's no longer failed, such as after a double click, which the refreshed page shows.
  const response =
    formData.get("currentStep") === "send"
      ? await startFunction(SEND_APPLICATION, { applicationId, retry: true })
      : await startFunction(PREPARE_APPLICATION, { applicationId });
  backToApplication(applicationId, response.status === 400 ? response.error : undefined);
}

async function cancelApplication(formData: FormData) {
  "use server";

  const applicationId = Number(formData.get("applicationId"));
  // False when it's no longer in Review, such as after a double click, which the refreshed page shows.
  await cancel({ applications: applicationStore() }, applicationId);
  backToApplication(applicationId);
}

async function saveReview(formData: FormData) {
  "use server";

  const applicationId = Number(formData.get("applicationId"));
  const resumeFileId = String(formData.get("resumeFileId") ?? "");
  // Drive is only asked when the Resume was switched.
  const switched = resumeFileId !== "" && resumeFileId !== formData.get("currentResumeFileId");
  let result: EditResult;
  try {
    result = await edit({ applications: applicationStore(), ...dashboardGoogle() }, applicationId, {
      subject: String(formData.get("subject") ?? ""),
      coverLetter: String(formData.get("coverLetter") ?? ""),
      ...(switched && { resumeFileId }),
    });
  } catch (problem) {
    if (!(problem instanceof GoogleConnectionError)) throw problem;
    result = { saved: false, error: problem.message };
  }
  backToApplication(applicationId, result.saved ? undefined : result.error);
}

async function removeDecisionMakerAction(formData: FormData) {
  "use server";

  const applicationId = Number(formData.get("applicationId"));
  const result = await removeDecisionMaker(
    {
      applications: applicationStore(),
      decisionMakers: drizzleDecisionMakerStore(parseDashboardEnv(process.env).DATABASE_URL),
      now: () => new Date(),
    },
    applicationId,
    Number(formData.get("decisionMakerId")),
  );
  backToApplication(applicationId, result.saved ? undefined : result.error);
}

async function addDecisionMakerAction(formData: FormData) {
  "use server";

  const applicationId = Number(formData.get("applicationId"));
  const result = await addDecisionMaker(
    {
      applications: applicationStore(),
      decisionMakers: drizzleDecisionMakerStore(parseDashboardEnv(process.env).DATABASE_URL),
      now: () => new Date(),
    },
    applicationId,
    Number(formData.get("decisionMakerId")),
  );
  backToApplication(applicationId, result.saved ? undefined : result.error);
}

async function sendApplication(formData: FormData) {
  "use server";

  const applicationId = Number(formData.get("applicationId"));
  // A 409 means it's no longer in Review, such as after a double click, which the refreshed page shows.
  const response = await startFunction(SEND_APPLICATION, { applicationId });
  backToApplication(applicationId, response.status === 400 ? response.error : undefined);
}

/** The Resumes the Admin can switch to. Only the current one when Google can't be reached. */
async function listResumes(application: Application): Promise<DriveFile[]> {
  const current: DriveFile[] = application.resumeFileId
    ? [
        {
          id: application.resumeFileId,
          name: application.resumeName ?? application.resumeFileId,
          mimeType: "application/pdf",
          webViewLink: application.resumeLink ?? "",
        },
      ]
    : [];
  try {
    const google = dashboardGoogle();
    const folder = await google.resumeFolder.get();
    if (!folder) return current;
    const resumes = resumesIn(await (await google.drive()).listFiles(folder.id));
    return resumes.some(({ id }) => id === application.resumeFileId) ? resumes : [...current, ...resumes];
  } catch (problem) {
    console.warn("The Resumes couldn't be listed:", problem);
    return current;
  }
}

const REASON_TAGS: Record<NotChosenReason, ReactNode> = {
  "no-email": <Tag>No email</Tag>,
  "in-cooldown": <Tag tone="amber">In Cooldown</Tag>,
  "not-chosen": <Tag>Not chosen</Tag>,
};

const LOG_STATUS_CLASSES = {
  running: "text-blue-600 dark:text-blue-400",
  succeeded: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
  stopped: "text-muted",
};

/** Each attempt at each step, oldest first, collapsed. A running attempt whose Function was killed shows as failed. */
function StepLogs({ logs, stalled, timeZone }: { logs: StepLog[]; stalled: boolean; timeZone: string }) {
  return (
    <details className="group overflow-hidden rounded-md border border-line bg-surface">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        Step Logs <span className="text-xs font-normal text-muted">{logs.length}</span>
      </summary>
      <ol className="divide-y divide-line border-t border-line">
        {logs.map((log) => {
          const status = log.status === "running" && stalled ? "failed" : log.status;
          return (
            <li key={log.id} className="px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {STEP_NAMES[log.step]}
                  {log.attempt > 1 && <span className="text-muted"> · attempt {log.attempt}</span>}
                </span>
                <span className={`text-xs font-medium ${LOG_STATUS_CLASSES[status]}`}>{status}</span>
              </div>
              <p className="text-xs text-muted">
                {dateTime(log.startedAt, timeZone)}
                {log.finishedAt && <> → {dateTime(log.finishedAt, timeZone)}</>}
              </p>
              {(log.error ?? log.result) && (
                <p className="mt-1 text-xs break-words whitespace-pre-wrap text-fg-2">
                  {log.error ?? log.result}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function HiddenId({ application }: { application: Application }) {
  return <input type="hidden" name="applicationId" value={application.id} />;
}

/** Send and Cancel, fixed above the tab bar on phones so they're always within reach. */
function ReviewActions({ application, sendingAllowed }: { application: Application; sendingAllowed: boolean }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:rounded-md md:border md:bg-surface md:p-4 md:backdrop-blur-none">
      <div className="flex gap-2">
        <form action={cancelApplication} className="flex-1 md:flex-none">
          <HiddenId application={application} />
          <SubmitButton
            variant="danger"
            block
            pendingText="Cancelling…"
            confirm="Cancel this Application? This is final: the Job can't be Prepared again."
          >
            Cancel
          </SubmitButton>
        </form>
        <form action={sendApplication} className="flex-[2] md:flex-none">
          <HiddenId application={application} />
          <SubmitButton block pendingText="Sending…" disabled={!sendingAllowed}>
            Send
          </SubmitButton>
        </form>
      </div>
      {!sendingAllowed && (
        <p className="mt-2 text-xs text-muted">
          Sending is turned off.{" "}
          <Link href="/settings" className={linkClass}>
            Turn it on in Settings
          </Link>
          .
        </p>
      )}
      <p className="mt-2 hidden text-xs text-muted md:block">
        Send emails each Decision Maker from your Gmail and locks the Application. Cancel is final: this Job can&apos;t
        be Prepared again.
      </p>
    </div>
  );
}

function Person({
  name,
  profileUrl,
  headline,
  photo,
  children,
}: {
  name: string;
  profileUrl: string;
  headline: string;
  photo: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <Avatar name={name} photo={photo} />
      <div className="min-w-0 flex-1">
        <ExternalLink href={profileUrl} className="font-medium hover:underline">
          {name}
        </ExternalLink>
        <p className="truncate text-sm text-muted">{headline}</p>
        {children}
      </div>
    </div>
  );
}

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const id = Number((await params).id);
  const { error } = await searchParams;
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const saved = Number.isInteger(id) ? await drizzleApplicationStore(DATABASE_URL).get(id) : undefined;
  if (!saved) notFound();

  const inReview = saved.status === "in-review";
  const decisionMakerStore = drizzleDecisionMakerStore(DATABASE_URL);
  const [job, runs, recipients, company, people, resumes, logs, sendingAllowed] = await Promise.all([
    drizzleJobStore(DATABASE_URL).get(saved.jobId),
    drizzleFunctionRunStore(DATABASE_URL).listForApplication(id),
    decisionMakerStore.listForApplication(id),
    saved.companyId === null ? undefined : drizzleCompanyStore(DATABASE_URL).get(saved.companyId),
    saved.companyId === null ? [] : decisionMakerStore.listForCompany(saved.companyId),
    inReview ? listResumes(saved) : [],
    drizzleStepLogStore(DATABASE_URL).listForApplication(id),
    inReview && drizzleSendSettingsStore(DATABASE_URL).sendingAllowed(),
  ]);
  const now = new Date();
  // Shown as failed when its Function passed its time limit, so it can be retried.
  const application = applicationAsOf(saved, runs, now);
  const stalled = application !== saved;
  // Refreshes only while a Function is working on it, so a killed Function doesn't refresh forever.
  const working = runs.some((run) => runAsOf(run, now).status === "running");
  const sending = application.status === "sending" || application.status === "sent" || application.currentStep === "send";
  const { decisionMakers, alsoFound } = groupPeople(people, recipients, now);
  const companyName = company?.name ?? job?.companyName;

  const companyDetails: [string, ReactNode][] = [];
  if (company)
    companyDetails.push([
      "LinkedIn",
      <ExternalLink key="linkedin" href={company.linkedinUrl} className={linkClass}>
        {company.name}
      </ExternalLink>,
    ]);
  if (application.jobLocation) companyDetails.push(["Job location", application.jobLocation]);
  if (application.industryKeywords && application.industryKeywords.length > 0)
    companyDetails.push(["Industry", application.industryKeywords.join(", ")]);
  if (application.resumeLink)
    companyDetails.push([
      "Resume",
      <ExternalLink key="resume" href={application.resumeLink} className={linkClass}>
        {application.resumeName}
      </ExternalLink>,
    ]);

  return (
    <div className="space-y-4">
      {working && <AutoRefresh seconds={5} />}

      <Link href="/applications" className="inline-flex min-h-9 items-center text-sm text-muted hover:text-fg">
        ‹ Applications
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={application.status} />
          {(application.status === "preparing" || application.status === "sending") && (
            <span className="text-sm text-muted">{STEP_NAMES[application.currentStep]}…</span>
          )}
          {application.status === "failed" && (
            <span className="text-sm text-muted">at {STEP_NAMES[application.currentStep]}</span>
          )}
        </div>
        {job && (
          <>
            <h1 className="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">
              <ExternalLink href={job.url} className="hover:underline">
                {job.title}
              </ExternalLink>
            </h1>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-2">
              {companyName} · {job.location} <SourceBadge source={job.source} />
            </p>
          </>
        )}
        {application.status === "failed" && (
          <form action={retryApplication} className="pt-1">
            <HiddenId application={application} />
            <input type="hidden" name="currentStep" value={application.currentStep} />
            <SubmitButton pendingText="Retrying…">Retry</SubmitButton>
          </form>
        )}
      </header>

      {error && <Alert>{error}</Alert>}
      {application.error && <Alert>{application.error}</Alert>}
      {application.status === "direct-apply" && job && (
        <Alert tone="warning">
          Apply directly through{" "}
          <ExternalLink href={job.url} className="font-semibold underline">
            the Job link
          </ExternalLink>
          {application.resumeLink && (
            <>
              {" "}
              with{" "}
              <ExternalLink href={application.resumeLink} className="font-semibold underline">
                {application.resumeName}
              </ExternalLink>
            </>
          )}
          .
        </Alert>
      )}

      {inReview && <ReviewActions application={application} sendingAllowed={sendingAllowed} />}

      {(companyDetails.length > 0 || application.jobSummary) && (
        <Card>
          <CardHeader title={companyName ?? "Company"} />
          {companyDetails.length > 0 && <DetailList items={companyDetails} />}
          {application.jobSummary && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-1 text-xs font-medium text-muted">Job Summary</p>
              <p className="text-sm leading-relaxed">{application.jobSummary}</p>
            </div>
          )}
        </Card>
      )}

      {decisionMakers.length > 0 && (
        <Card>
          <CardHeader title="Decision Makers" action={<span className="text-xs text-muted">{decisionMakers.length}</span>} />
          <ul className="divide-y divide-line">
            {decisionMakers.map((decisionMaker) => (
              <li key={decisionMaker.id} className="flex items-start gap-3 px-4 py-3">
                <Person {...decisionMaker}>
                  <p className="truncate text-sm">{decisionMaker.email}</p>
                  {sending && (
                    <div className="mt-1">
                      {decisionMaker.sentAt ? (
                        <Tag tone="emerald">Sent {dateTime(decisionMaker.sentAt, TIMEZONE)}</Tag>
                      ) : (
                        <Tag>Not sent</Tag>
                      )}
                    </div>
                  )}
                </Person>
                {inReview && decisionMakers.length > 1 && (
                  <form action={removeDecisionMakerAction}>
                    <HiddenId application={application} />
                    <input type="hidden" name="decisionMakerId" value={decisionMaker.id} />
                    <SubmitButton variant="ghost" pendingText="Removing…" confirm={`Remove ${decisionMaker.name}?`}>
                      Remove
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {alsoFound.length > 0 && (
        <Card>
          <CardHeader
            title={`Also found at ${companyName ?? "the Company"}`}
            action={<span className="text-xs text-muted">{alsoFound.length}</span>}
          />
          <ul className="divide-y divide-line">
            {alsoFound.map((person) => (
              <li key={person.id} className="flex items-start gap-3 px-4 py-3">
                <Person {...person}>
                  {person.email && <p className="truncate text-sm text-fg-2">{person.email}</p>}
                </Person>
                {inReview && person.reason === "not-chosen" ? (
                  <form action={addDecisionMakerAction}>
                    <HiddenId application={application} />
                    <input type="hidden" name="decisionMakerId" value={person.id} />
                    <SubmitButton variant="ghost" pendingText="Adding…">
                      Add
                    </SubmitButton>
                  </form>
                ) : (
                  <div className="shrink-0 pt-0.5">{REASON_TAGS[person.reason]}</div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {application.coverLetter && (
        <CoverLetterCard
          // A saved edit remounts it, back to read-only.
          key={`${application.subject}\n${application.coverLetter}\n${application.resumeFileId}`}
          applicationId={application.id}
          subject={application.subject ?? ""}
          coverLetter={application.coverLetter}
          resumeFileId={application.resumeFileId}
          resumes={resumes}
          editable={inReview}
          save={saveReview}
        />
      )}

      {logs.length > 0 && <StepLogs logs={logs} stalled={stalled} timeZone={TIMEZONE} />}

      {runs.length > 0 && (
        <p className="text-sm">
          <Link href="/function-runs" className={linkClass}>
            Function runs
          </Link>
        </p>
      )}

      {/* Room for the fixed Send and Cancel bar on phones. */}
      {inReview && <div className="h-20 md:hidden" aria-hidden="true" />}
    </div>
  );
}
