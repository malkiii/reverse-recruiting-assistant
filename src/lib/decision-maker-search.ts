import { apifyTokenRouter } from "./apify-tokens";
import type {
  ActorGateway,
  ActorRunStore,
  ApplicationActorRun,
  DecisionMaker,
  DecisionMakerStore,
  EmailsActor,
  EmployeesActor,
  FoundPerson,
  Recipient,
  SkippedApifyTokenStore,
} from "./gateways";
import type { JobFunction } from "./schema";

/** The most Decision Makers an Application chooses on its own, and how many people each employees run asks for. The Admin can add more. */
export const DECISION_MAKERS_PER_APPLICATION = 5;

/** Human Resources, Entrepreneurship, Operations, Product Management, then Program & Project Management. */
const FUNCTION_ORDER: JobFunction[] = ["12", "9", "18", "19", "20"];
const FUNCTION_NAMES: Record<JobFunction, string> = {
  "12": "Human Resources",
  "9": "Entrepreneurship",
  "18": "Operations",
  "19": "Product Management",
  "20": "Program & Project Management",
  any: "Any",
};
const POLL_DELAY_MS = 10_000;
// 20 minutes, well inside prepare-application's time limit with the earlier steps. A Retry resumes the run still going.
const MAX_POLLS = 120;

/** The polls one prepare-application run has left, shared by every attempt at the search so they can't pass its time limit. */
export type PollBudget = { left: number };

export const newPollBudget = (): PollBudget => ({ left: MAX_POLLS });

export type DecisionMakerSearchDeps = {
  employeesActor: EmployeesActor;
  emailsActor: EmailsActor;
  actorRuns: ActorRunStore;
  decisionMakers: DecisionMakerStore;
  apifyTokens: string;
  skippedApifyTokens: SkippedApifyTokenStore;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

/**
 * An error a step doesn't try again on its own, as that would pay for another actor run or pass the time limit.
 * It waits for the Admin's Retry.
 */
export class WaitForRetryError extends Error {}

type SearchedCompany = { id: number; linkedinUrl: string };

/** A person for the logs: name and email. */
export const describePerson = ({ name, email }: { name: string; email: string | null }) =>
  `${name} <${email ?? "no email"}>`;

const nameKey = (name: string) => name.trim().toLowerCase();

/** A LinkedIn profile URL for matching: without protocol, www, query or trailing slash, ignoring case. */
const profileKey = (url: string) =>
  url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

/**
 * Runs the Application's actors one at a time. Each run is saved before polling, so a Retry polls and rereads
 * the same run instead of paying for another, and starts again only a run that failed.
 */
async function actorRunner(deps: DecisionMakerSearchDeps, applicationId: number, polls: PollBudget) {
  const saved = await deps.actorRuns.listForApplication(applicationId);
  const router = apifyTokenRouter({
    apifyTokens: deps.apifyTokens,
    skippedTokens: deps.skippedApifyTokens,
    lastToken: () => deps.actorRuns.lastToken(),
    now: deps.now,
  });

  return async function run<Input, Result>(gateway: ActorGateway<Input, Result>, purpose: string, input: Input) {
    let run = saved.findLast((run) => run.purpose === purpose);
    if (run) {
      console.log(`Application ${applicationId}: resuming actor run ${run.runId} (${purpose})`);
    } else {
      const { token, result: runId } = await router.withToken((token) => gateway.start(input, token));
      const started: ApplicationActorRun = {
        runId,
        actor: gateway.actor,
        token,
        search: null,
        applicationId,
        purpose,
        startedAt: deps.now(),
      };
      await deps.actorRuns.save(started);
      run = started;
      console.log(`Application ${applicationId}: started actor run ${runId} (${purpose})`);
    }

    let status = await gateway.status(run);
    while (status === "running") {
      if (polls.left === 0) throw new WaitForRetryError(`Actor run ${run.runId} (${purpose}) is still running: Retry to resume it`);
      polls.left -= 1;
      await deps.sleep(POLL_DELAY_MS);
      status = await gateway.status(run);
    }
    if (status === "failed") {
      await deps.actorRuns.close(run.runId, deps.now());
      throw new WaitForRetryError(`Actor run ${run.runId} (${purpose}) failed: Retry to start it again`);
    }
    return gateway.results(run);
  };
}

/**
 * Searches the Company's employees function by function until 5 have emails, and saves everyone found to the
 * Company, including those with no email. Emails are looked up only for as many people as are still needed. "any" is
 * searched only when nobody with an email was found. Returns everyone found, as saved.
 */
async function searchPeople(
  deps: DecisionMakerSearchDeps,
  applicationId: number,
  company: SearchedCompany,
  polls: PollBudget,
) {
  const run = await actorRunner(deps, applicationId, polls);
  const found: FoundPerson[] = [];
  const withEmail = () => found.filter(({ email }) => email).length;

  async function search(jobFunction: JobFunction) {
    const employees = await run(deps.employeesActor, `employees:${jobFunction}`, {
      companyUrl: company.linkedinUrl,
      jobFunction,
      maxEmployees: DECISION_MAKERS_PER_APPLICATION,
    });
    const people: FoundPerson[] = [];
    for (const employee of employees) {
      const key = nameKey(employee.name);
      if (!key || [...found, ...people].some(({ name }) => nameKey(name) === key)) continue;
      people.push({ ...employee, name: employee.name.trim(), email: null, jobFunction });
    }
    found.push(...people);

    const lookUp = people.slice(0, DECISION_MAKERS_PER_APPLICATION - withEmail());
    if (lookUp.length > 0) {
      const urls = lookUp.map(({ profileUrl }) => profileUrl);
      const emails = await run(deps.emailsActor, `emails:${jobFunction}`, urls);
      for (const person of lookUp) {
        const key = profileKey(person.profileUrl);
        person.email = emails.find(({ profileUrl }) => profileKey(profileUrl) === key)?.email ?? null;
      }
    }
    console.log(
      `Application ${applicationId}: function ${jobFunction} (${FUNCTION_NAMES[jobFunction]}) found ${people.length} new people, ${withEmail()} with emails so far` +
        (people.length > 0 ? `: ${people.map(describePerson).join(", ")}` : ""),
    );
  }

  for (const jobFunction of FUNCTION_ORDER) {
    if (withEmail() >= DECISION_MAKERS_PER_APPLICATION) break;
    await search(jobFunction);
  }
  if (withEmail() === 0) await search("any");

  return deps.decisionMakers.save(company.id, found, deps.now());
}

const DAY_MS = 24 * 60 * 60_000;
export const COOLDOWN_DAYS = 30;
const COOLDOWN_MS = COOLDOWN_DAYS * DAY_MS;
const PEOPLE_REFRESH_MONTHS = 6;

/** Whether people found at this time are still current, or due a People Refresh. */
function isCurrent(foundAt: Date, now: Date) {
  const refreshAt = new Date(foundAt);
  refreshAt.setUTCDate(1);
  refreshAt.setUTCMonth(refreshAt.getUTCMonth() + PEOPLE_REFRESH_MONTHS);
  // A day past the month's end, such as 31 August to February, falls on its last day.
  const lastDay = new Date(Date.UTC(refreshAt.getUTCFullYear(), refreshAt.getUTCMonth() + 1, 0)).getUTCDate();
  refreshAt.setUTCDate(Math.min(foundAt.getUTCDate(), lastDay));
  return now < refreshAt;
}

export const inCooldown = ({ lastEmailedAt }: Pick<DecisionMaker, "lastEmailedAt">, now: Date) =>
  lastEmailedAt !== null && now.getTime() - lastEmailedAt.getTime() < COOLDOWN_MS;

function daysAgo(date: Date, now: Date) {
  const days = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The Company's saved people under 6 months old. Null when a People Refresh is due, or nobody was ever searched for. */
async function currentPeople(deps: DecisionMakerSearchDeps, companyId: number) {
  const now = deps.now();
  const foundAt = await deps.decisionMakers.peopleFoundAt(companyId);
  if (!foundAt || !isCurrent(foundAt, now)) return null;
  return (await deps.decisionMakers.listForCompany(companyId)).filter((person) => isCurrent(person.foundAt, now));
}

export type DecisionMakerChoice =
  | { outcome: "chosen"; decisionMakers: DecisionMaker[] }
  | { outcome: "no-contacts" }
  | { outcome: "all-in-cooldown"; reason: string };

/** Up to 5 people with emails who aren't in Cooldown. */
function chooseFrom(people: DecisionMaker[], now: Date): DecisionMakerChoice {
  const withEmail = people.filter(({ email }) => email);
  if (withEmail.length === 0) return { outcome: "no-contacts" };
  const decisionMakers = withEmail
    .filter((person) => !inCooldown(person, now))
    .slice(0, DECISION_MAKERS_PER_APPLICATION);
  if (decisionMakers.length > 0) return { outcome: "chosen", decisionMakers };
  const contacted = withEmail.map(({ name, lastEmailedAt }) => `${name} ${daysAgo(lastEmailedAt!, now)}`);
  return {
    outcome: "all-in-cooldown",
    reason: `Every Decision Maker is in Cooldown, emailed: ${contacted.join(", ")}`,
  };
}

/**
 * Checks the Cooldown of the Company's saved people before anything is paid for.
 * Returns why the Application stops when every one of them with an email is in Cooldown, otherwise null.
 */
export async function savedPeopleCooldownReason(deps: DecisionMakerSearchDeps, companyId: number) {
  const people = await currentPeople(deps, companyId);
  if (!people) return null;
  const choice = chooseFrom(people, deps.now());
  return choice.outcome === "all-in-cooldown" ? choice.reason : null;
}

/**
 * Chooses the Application's Decision Makers: the Company's saved people when under 6 months old, without any actor
 * run, otherwise a People Refresh searches for them again. People in Cooldown are left out either way.
 */
export async function chooseDecisionMakers(
  deps: DecisionMakerSearchDeps,
  applicationId: number,
  company: SearchedCompany,
  polls: PollBudget,
): Promise<DecisionMakerChoice> {
  const saved = await currentPeople(deps, company.id);
  if (saved) console.log(`Application ${applicationId}: reusing ${saved.length} saved people`);
  const people = saved ?? (await searchPeople(deps, applicationId, company, polls));
  const choice = chooseFrom(people, deps.now());
  if (choice.outcome === "chosen") {
    await deps.decisionMakers.addToApplication(
      applicationId,
      choice.decisionMakers.map(({ id }) => id),
    );
  }
  return choice;
}

/** Why a Person found at the Company isn't one of the Application's Decision Makers. */
export type NotChosenReason = "no-email" | "in-cooldown" | "not-chosen";

/** The Application's Decision Makers, and everyone else found at its Company with why they weren't chosen. */
export function groupPeople(people: DecisionMaker[], recipients: Recipient[], now: Date) {
  const recipientIds = new Set(recipients.map(({ id }) => id));
  const alsoFound = people
    .filter(({ id }) => !recipientIds.has(id))
    .map((person) => {
      const reason: NotChosenReason = !person.email ? "no-email" : inCooldown(person, now) ? "in-cooldown" : "not-chosen";
      return { ...person, reason };
    });
  return { decisionMakers: recipients, alsoFound };
}
