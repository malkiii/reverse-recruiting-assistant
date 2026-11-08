import { expect, test } from "vitest";
import {
  addDecisionMaker,
  applicationAsOf,
  cancel,
  deleteApplication,
  edit,
  PREPARE_TIME_LIMIT_MS,
  prepare,
  removeDecisionMaker,
  retry,
  retrySend,
  runPreparation,
  runSending,
  send,
  SEND_TIME_LIMIT_MS,
} from "./application-lifecycle";
import {
  FakeActor,
  FakeActorRunStore,
  FakeApplicationStore,
  FakeCompanyPageSearch,
  FakeCompanyStore,
  FakeDecisionMakerStore,
  FakeDrive,
  FakeGmail,
  FakeJobPages,
  FakeJobStore,
  FakeLlm,
  FakePdfReader,
  FakeResumeFolderStore,
  FakeFunctionRunStore,
  FakeSkippedApifyTokenStore,
  FakeStepLogStore,
} from "./fake-gateways";
import type { EmployeeSearch, FoundEmail, Person } from "./gateways";
import { type JobFunction, PREPARE_APPLICATION, SEND_APPLICATION } from "./schema";

const now = new Date("2026-11-04T10:00:00Z");

const linkedInJob = {
  source: "LinkedIn",
  title: "Backend Engineer",
  companyName: "Acme",
  location: "Remote",
  url: "https://www.linkedin.com/jobs/view/1",
  postDay: "2026-11-04",
  description: "Collected description: build APIs in Go",
  companyLinkedinUrl: null,
  companyLogoUrl: null,
};

const feedJob = {
  ...linkedInJob,
  source: "Feed: weworkremotely.com",
  title: "Data Analyst",
  url: "https://weworkremotely.com/jobs/2",
  description: null,
};

const pdf = (name: string) => ({
  id: `file-${name}`,
  name,
  mimeType: "application/pdf",
  webViewLink: `https://drive.google.com/file/${name}`,
});

const acmeQuery = "Acme fintech in Berlin, Germany site:linkedin.com/company";
const acmePage = { url: "https://www.linkedin.com/company/acme-corp", title: "ACME, Inc. | LinkedIn" };

async function setup() {
  const jobs = new FakeJobStore();
  await jobs.save([linkedInJob, feedJob]);
  const drive = new FakeDrive();
  drive.sharedByLink.add("folder");
  drive.contents.set("file-Backend Engineer Resume.pdf", "# Jane Doe\nGo engineer, 5 years of payment APIs.");
  drive.files.set("folder", [pdf("Backend Engineer Resume.pdf"), pdf("Data Analyst CV.pdf"), pdf("Notes.pdf")]);
  const llm = new FakeLlm();
  const decisionMakers = new FakeDecisionMakerStore();
  const gmail = new FakeGmail();
  const companyPageSearch = new FakeCompanyPageSearch();
  companyPageSearch.results.set(acmeQuery, acmePage);
  return {
    jobs,
    applications: new FakeApplicationStore(decisionMakers),
    jobPages: new FakeJobPages(),
    companies: new FakeCompanyStore(),
    companyPageSearch,
    resumeFolder: new FakeResumeFolderStore({ id: "folder", name: "Resumes" }),
    employeesActor: new FakeActor<EmployeeSearch, Person>("employees"),
    emailsActor: new FakeActor<string[], FoundEmail>("emails"),
    actorRuns: new FakeActorRunStore(),
    stepLogs: new FakeStepLogStore(),
    runs: new FakeFunctionRunStore(),
    decisionMakers,
    apifyTokens: "token-a,token-b",
    skippedApifyTokens: new FakeSkippedApifyTokenStore(),
    sleep: async (_ms: number) => {},
    gmail: async () => gmail,
    sendingAllowed: async () => true,
    pdfs: new FakePdfReader(),
    drive: async () => drive,
    llm: async () => llm,
    coverLetterInstructions: async (): Promise<string | null> => null,
    now: () => now,
    // Handles for the tests.
    fakeDrive: drive,
    fakeLlm: llm,
    fakeGmail: gmail,
  };
}

test("a double click on Prepare claims only one Application for the Job", async () => {
  const deps = await setup();

  const claims = await Promise.all([prepare(deps, 1), prepare(deps, 1)]);

  expect(claims.filter((id) => id !== null)).toHaveLength(1);
  expect(await deps.applications.list()).toMatchObject([{ jobId: 1, status: "preparing", createdAt: now }]);
});

const answer = {
  industry: "fintech",
  jobLocation: "Berlin, Germany",
  resumeFilename: "Backend Engineer Resume.pdf",
  jobSummary: "Acme needs a backend engineer to build payment APIs in Go.",
};

const letter = {
  subject: "Backend Engineer at Acme",
  coverLetter: "Hi {{name}},\n\nI build payment APIs in Go.\n\nMy Resume: {{resume_link}}",
};

test("Prepare uses a Job Board Job's collected description and saves the Resume and Job Summary the LLM chose", async () => {
  const deps = await setup();
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    currentStep: "find-decision-makers",
    jobPage: "Collected description: build APIs in Go",
    industry: "fintech",
    jobLocation: "Berlin, Germany",
    jobSummary: "Acme needs a backend engineer to build payment APIs in Go.",
    resumeFileId: "file-Backend Engineer Resume.pdf",
    resumeName: "Backend Engineer Resume.pdf",
    resumeLink: "https://drive.google.com/file/Backend Engineer Resume.pdf",
  });
  expect(deps.jobPages.urlsRead).toEqual([]);
});

test("the LLM gets the Job page and only the Resume filenames, each wrapped in XML tags", async () => {
  const deps = await setup();
  deps.jobPages.pages.set(feedJob.url, "Build payment APIs in Go.");
  deps.fakeLlm.answers.push(answer);

  await runPreparation(deps, (await prepare(deps, 2))!);

  const [{ prompt }] = deps.fakeLlm.requests;
  expect(prompt).toContain("<job_page>\nBuild payment APIs in Go.\n</job_page>");
  expect(prompt).toContain("<resume_filename>Backend Engineer Resume.pdf</resume_filename>");
  expect(prompt).toContain("<resume_filename>Data Analyst CV.pdf</resume_filename>");
  expect(prompt).not.toContain("Notes.pdf");
});

test("Prepare reads a Feed Job's page and saves it as the Job page", async () => {
  const deps = await setup();
  deps.jobPages.pages.set(feedJob.url, "# Data Analyst\nBuild dashboards.");
  deps.fakeLlm.answers.push({ ...answer, resumeFilename: "Data Analyst CV.pdf" });
  const id = (await prepare(deps, 2))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    currentStep: "find-decision-makers",
    jobPage: "# Data Analyst\nBuild dashboards.",
    resumeName: "Data Analyst CV.pdf",
  });
  expect(deps.jobPages.urlsRead).toEqual([feedJob.url]);
});

test("a Job Board Job with no description ends as Direct Apply without reading its page or asking the LLM", async () => {
  const deps = await setup();
  await deps.jobs.save([{ ...linkedInJob, title: "Frontend Engineer", url: "https://www.linkedin.com/jobs/view/3", description: "  " }]);
  const id = (await prepare(deps, 3))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "direct-apply",
    error: "The Job has no description, so apply through the Job link",
    jobPage: null,
  });
  expect(deps.jobPages.urlsRead).toEqual([]);
  expect(deps.fakeLlm.requests).toEqual([]);
});

test("a Feed Job whose page can't be read ends as Direct Apply without asking the LLM", async () => {
  const deps = await setup();
  const id = (await prepare(deps, 2))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ status: "direct-apply", jobPage: null });
  expect(deps.fakeLlm.requests).toEqual([]);
});

test("the Application stops when the LLM returns a filename that isn't a listed Resume", async () => {
  const deps = await setup();
  deps.fakeLlm.answers.push({ ...answer, resumeFilename: "Notes.pdf" });
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    currentStep: "choose-resume",
    error: 'The LLM chose "Notes.pdf", which isn\'t one of your Resumes',
    resumeFileId: null,
  });
});

test("the Application stops before reading the Job page when the Resume Folder has no Resume", async () => {
  const deps = await setup();
  deps.fakeDrive.files.set("folder", [pdf("Notes.pdf")]);
  deps.jobPages.pages.set(feedJob.url, "Build dashboards.");
  const id = (await prepare(deps, 2))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    error: "Your Resume Folder has no Resume: add a PDF whose name ends in \"resume\" or \"CV\"",
  });
  expect(deps.jobPages.urlsRead).toEqual([]);
  expect(deps.fakeLlm.requests).toEqual([]);
});

test("the Application stops when no Resume Folder is chosen", async () => {
  const deps = await setup();
  deps.resumeFolder.folder = undefined;
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    error: "No Resume Folder is chosen: choose one on the dashboard's Resumes page",
  });
});

test("an LLM error marks the Application failed, keeps the Job page, and fails the Function", async () => {
  const deps = await setup();
  const id = (await prepare(deps, 1))!;

  await expect(runPreparation(deps, id)).rejects.toThrow("The LLM has no answer queued");

  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    currentStep: "choose-resume",
    jobPage: "Collected description: build APIs in Go",
    error: "The LLM has no answer queued",
  });
});

test("a failed step is tried again, logging each attempt with its result or error", async () => {
  const deps = await setup();
  deps.fakeLlm.answers.push(new Error("The LLM is overloaded"), answer);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ status: "no-contacts", currentStep: "find-decision-makers" });
  expect(await deps.stepLogs.listForApplication(id)).toMatchObject([
    { step: "read-job", attempt: 1, status: "succeeded", result: "Read the Job's collected description", startedAt: now, finishedAt: now },
    { step: "choose-resume", attempt: 1, status: "failed", error: "The LLM is overloaded" },
    { step: "choose-resume", attempt: 2, status: "succeeded", result: "Chose Backend Engineer Resume.pdf" },
    { step: "find-company-page", attempt: 1, status: "succeeded" },
    // No Decision Maker is found, which ends the Application without failing the step.
    { step: "find-decision-makers", attempt: 1, status: "stopped", error: "No Decision Maker with an email address was found" },
  ]);
});

test("a step is tried 3 times, then the Application is marked failed and the Function fails", async () => {
  const deps = await setup();
  const waits: number[] = [];
  deps.sleep = async (ms) => void waits.push(ms);
  deps.fakeLlm.answers.push(...[1, 2, 3].map((n) => new Error(`The LLM is overloaded ${n}`)), answer);
  const id = (await prepare(deps, 1))!;

  await expect(runPreparation(deps, id)).rejects.toThrow("The LLM is overloaded 3");

  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    currentStep: "choose-resume",
    error: "The LLM is overloaded 3",
  });
  expect(deps.fakeLlm.requests).toHaveLength(3);
  expect(waits).toEqual([10_000, 20_000]);
  const logs = await deps.stepLogs.listForApplication(id);
  expect(logs.filter(({ step }) => step === "choose-resume")).toMatchObject([
    { attempt: 1, status: "failed" },
    { attempt: 2, status: "failed" },
    { attempt: 3, status: "failed", error: "The LLM is overloaded 3" },
  ]);
});

test("a Job with a saved Company LinkedIn page uses it without searching", async () => {
  const deps = await setup();
  await deps.jobs.save([
    { ...linkedInJob, title: "Platform Engineer", url: "https://www.linkedin.com/jobs/view/3", companyLinkedinUrl: "https://www.linkedin.com/company/acme" },
  ]);
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 3))!;

  await runPreparation(deps, id);

  expect(deps.companyPageSearch.queries).toEqual([]);
  expect(deps.companies.companies).toEqual([{ id: 1, name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" }]);
  expect(await deps.applications.get(id)).toMatchObject({
    currentStep: "find-decision-makers",
    companyId: 1,
  });
});

test("Prepare searches for the Company's LinkedIn page and accepts a first result whose name matches", async () => {
  const deps = await setup();
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(deps.companyPageSearch.queries).toEqual([acmeQuery]);
  expect(deps.companies.companies).toEqual([{ id: 1, name: "Acme", linkedinUrl: acmePage.url }]);
  expect(await deps.applications.get(id)).toMatchObject({ currentStep: "find-decision-makers", companyId: 1 });
});

test("a first search result for another Company ends the Application as Direct Apply, keeping the chosen Resume", async () => {
  const deps = await setup();
  deps.companyPageSearch.results.set(acmeQuery, { url: "https://www.linkedin.com/company/globex", title: "Globex LLC | LinkedIn" });
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "direct-apply",
    currentStep: "find-company-page",
    error: "The Company's LinkedIn page couldn't be confirmed, so apply through the Job link",
    resumeName: "Backend Engineer Resume.pdf",
    companyId: null,
  });
  expect(deps.companies.companies).toEqual([]);
});

test("no search result ends the Application as Direct Apply", async () => {
  const deps = await setup();
  deps.companyPageSearch.results.clear();
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ status: "direct-apply", companyId: null });
});

test("a Retry from the Company page step searches again without reading the Job or asking the LLM", async () => {
  const deps = await setup();
  deps.companyPageSearch.results.clear();
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 1))!;
  await runPreparation(deps, id);
  await deps.applications.update(id, { status: "preparing", error: null });
  deps.companyPageSearch.results.set(acmeQuery, acmePage);

  await runPreparation(deps, id);

  expect(deps.fakeLlm.requests).toHaveLength(1);
  expect(await deps.applications.get(id)).toMatchObject({ currentStep: "find-decision-makers", companyId: 1 });
});

test("Retry resumes only a failed Application, once", async () => {
  const deps = await setup();
  const id = (await prepare(deps, 1))!;
  await deps.applications.update(id, { status: "failed", error: "Firecrawl was down" });

  const claims = await Promise.all([retry(deps, id), retry(deps, id)]);

  expect(claims).toEqual([id, null]);
  expect(await deps.applications.get(id)).toMatchObject({ status: "preparing", error: null });
});

const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

test("an Application whose Function passed its time limit shows as failed and can be retried from its step", async () => {
  const deps = await setup();
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 1))!;
  // Modal kills the Function while it chooses the Resume, so nothing records the end.
  await deps.runs.start(PREPARE_APPLICATION, now, PREPARE_TIME_LIMIT_MS, id);
  await deps.applications.update(id, { currentStep: "choose-resume", jobPage: "Build APIs in Go" });
  await deps.stepLogs.start({ applicationId: id, step: "choose-resume", attempt: 1, startedAt: now });

  deps.now = () => minutesAfter(now, 29);
  const working = (await deps.applications.get(id))!;
  expect(applicationAsOf(working, await deps.runs.listForApplication(id), deps.now())).toEqual(working);
  expect(await retry(deps, id)).toBeNull();

  deps.now = () => minutesAfter(now, 30);
  expect(applicationAsOf(working, await deps.runs.listForApplication(id), deps.now())).toMatchObject({
    status: "failed",
    error: "Its Function passed its time limit: Retry to resume it",
  });
  expect(await retry(deps, id)).toBe(id);
  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ currentStep: "find-decision-makers", resumeName: "Backend Engineer Resume.pdf" });
  expect((await deps.stepLogs.listForApplication(id)).slice(0, 2)).toMatchObject([
    { step: "choose-resume", attempt: 1, status: "failed", error: "Its Function passed its time limit: Retry to resume it" },
    { step: "choose-resume", attempt: 2, status: "succeeded" },
  ]);
});

test("a double click on Retry of a killed Function claims it once, and a later Function start doesn't hide the kill", async () => {
  const deps = await setup();
  const id = (await prepare(deps, 1))!;
  await deps.runs.start(PREPARE_APPLICATION, now, PREPARE_TIME_LIMIT_MS, id);
  await deps.stepLogs.start({ applicationId: id, step: "read-job", attempt: 1, startedAt: now });
  // Another Application's Prepare marks the killed run failed.
  deps.now = () => minutesAfter(now, 31);
  await deps.runs.start(PREPARE_APPLICATION, deps.now(), PREPARE_TIME_LIMIT_MS, 99);

  expect((await Promise.all([retry(deps, id), retry(deps, id)])).filter((claim) => claim !== null)).toEqual([id]);
  // Before the retried Function's run is recorded.
  expect(await retry(deps, id)).toBeNull();
  expect(await deps.applications.get(id)).toMatchObject({ status: "preparing", error: null });
});

test("an Application just claimed by Send or Retry isn't taken for a killed one before its Function's run starts", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  const runId = (await deps.runs.start(PREPARE_APPLICATION, now, PREPARE_TIME_LIMIT_MS, id))!;
  await deps.runs.finish(runId, { status: "succeeded", finishedAt: now, error: null });
  deps.now = () => minutesAfter(now, 60);

  await send(deps, id);
  const claimed = (await deps.applications.get(id))!;
  expect(applicationAsOf(claimed, await deps.runs.listForApplication(id), deps.now())).toEqual(claimed);
  expect(await retrySend(deps, id)).toEqual({ outcome: "not-failed" });

  const sendRun = (await deps.runs.start(SEND_APPLICATION, deps.now(), SEND_TIME_LIMIT_MS, id))!;
  await deps.runs.finish(sendRun, { status: "failed", finishedAt: deps.now(), error: "Gmail refused the email" });
  await deps.applications.update(id, { status: "failed", error: "Gmail refused the email" });
  expect(await retrySend(deps, id)).toEqual({ outcome: "claimed" });
  expect(await retrySend(deps, id)).toEqual({ outcome: "not-failed" });
  expect(await deps.applications.get(id)).toMatchObject({ status: "sending" });
});

test("a Send whose Function passed its time limit can be retried, emailing only those not emailed yet", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  await send(deps, id);
  const [ann] = await deps.decisionMakers.listForApplication(id);
  // Modal kills the Function after Ann's email.
  await deps.runs.start(SEND_APPLICATION, now, SEND_TIME_LIMIT_MS, id);
  await deps.decisionMakers.recordSent(id, ann.id, now);

  expect(await retrySend(deps, id)).toEqual({ outcome: "not-failed" });
  deps.now = () => minutesAfter(now, 10);
  expect(await retry(deps, id)).toBeNull();
  expect(await retrySend(deps, id)).toEqual({ outcome: "claimed" });
  await runSending(deps, id);

  expect(deps.fakeGmail.sent.map(({ to }) => to)).toEqual(["bob@acme.com"]);
  expect(await deps.applications.get(id)).toMatchObject({ status: "sent" });
});

test("company suffixes are removed only as whole words, so a name inside another Company's name doesn't match", async () => {
  const deps = await setup();
  await deps.jobs.save([{ ...linkedInJob, title: "ML Engineer", companyName: "Cohere", url: "https://www.linkedin.com/jobs/view/4" }]);
  deps.companyPageSearch.results.set("Cohere fintech in Berlin, Germany site:linkedin.com/company", {
    url: "https://www.linkedin.com/company/here",
    title: "HERE Technologies | LinkedIn",
  });
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 3))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ status: "direct-apply", companyId: null });
});

test("the match ignores company suffixes such as Inc and Ltd", async () => {
  const deps = await setup();
  await deps.jobs.save([{ ...linkedInJob, title: "SRE", companyName: "Initech Inc", url: "https://www.linkedin.com/jobs/view/4" }]);
  deps.companyPageSearch.results.set("Initech Inc fintech in Berlin, Germany site:linkedin.com/company", {
    url: "https://www.linkedin.com/company/initech",
    title: "Initech Ltd | LinkedIn",
  });
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 3))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ currentStep: "find-decision-makers", companyId: 1 });
});

const person = (name: string): Person => ({
  name,
  headline: `${name} at Acme`,
  profileUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(" ", "-")}`,
  photo: null,
});

const search = (jobFunction: JobFunction): EmployeeSearch => ({ companyUrl: acmePage.url, jobFunction, maxEmployees: 5 });

type Deps = Awaited<ReturnType<typeof setup>>;

/** The employees actor finds these people for the function. */
function employees(deps: Deps, jobFunction: JobFunction, names: string[]) {
  deps.employeesActor.returns(search(jobFunction), names.map(person));
}

/** The email actor answers a lookup of exactly these names, finding an email for those in `withEmail`. */
function emails(deps: Deps, names: string[], withEmail: string[]) {
  deps.emailsActor.returns(
    names.map((name) => person(name).profileUrl),
    names.map((name) => ({
      profileUrl: person(name).profileUrl,
      email: withEmail.includes(name) ? `${name.toLowerCase()}@acme.com` : null,
    })),
  );
}

/** Prepares the LinkedIn Job through to the Decision Maker search. */
async function prepareToDecisionMakers(deps: Deps) {
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;
  await runPreparation(deps, id);
  return id;
}

const names = (people: { name: string }[]) => people.map(({ name }) => name);

test("Decision Makers are searched function by function until 5 have emails, asking each run for 5", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann", "Bob", "Gus"]);
  emails(deps, ["Ann", "Bob", "Gus"], ["Ann", "Bob", "Gus"]);
  employees(deps, "9", ["Cy", "Dee"]);
  emails(deps, ["Cy", "Dee"], ["Cy"]);
  employees(deps, "18", ["Eve", "Fay"]);
  emails(deps, ["Eve"], ["Eve"]);

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.inputs).toEqual([search("12"), search("9"), search("18")]);
  // Emails are looked up only for as many people as are still needed, so Fay isn't looked up.
  expect(deps.emailsActor.inputs).toEqual([
    [person("Ann").profileUrl, person("Bob").profileUrl, person("Gus").profileUrl],
    [person("Cy").profileUrl, person("Dee").profileUrl],
    [person("Eve").profileUrl],
  ]);
  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Ann", "Bob", "Gus", "Cy", "Eve"]);
  expect(names(await deps.decisionMakers.listForCompany(1))).toEqual(["Ann", "Bob", "Gus", "Cy", "Dee", "Eve", "Fay"]);
  expect(await deps.applications.get(id)).toMatchObject({
    status: "in-review",
    error: null,
  });
});

test("everyone found is saved to the Company, with their function and any email", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann", "Bob", "Cy"]);
  emails(deps, ["Ann", "Bob", "Cy"], ["Ann"]);

  await prepareToDecisionMakers(deps);

  expect(await deps.decisionMakers.listForCompany(1)).toMatchObject([
    { name: "Ann", headline: "Ann at Acme", email: "ann@acme.com", jobFunction: "12", foundAt: now },
    { name: "Bob", email: null, jobFunction: "12" },
    { name: "Cy", email: null, jobFunction: "12" },
  ]);
  expect(await deps.decisionMakers.peopleFoundAt(1)).toEqual(now);
});

test("people are kept unique by name, so someone found again under another function isn't looked up twice", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann"]);
  emails(deps, ["Ann"], []);
  employees(deps, "9", ["ann ", "Bob"]);
  emails(deps, ["Bob"], ["Bob"]);

  const id = await prepareToDecisionMakers(deps);

  expect(deps.emailsActor.inputs).toEqual([[person("Ann").profileUrl], [person("Bob").profileUrl]]);
  expect(names(await deps.decisionMakers.listForCompany(1))).toEqual(["Ann", "Bob"]);
  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Bob"]);
});

test("the search stops with 1-3 Decision Makers once all 5 functions are done, without searching any", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann", "Bob"]);
  emails(deps, ["Ann", "Bob"], ["Ann"]);
  employees(deps, "20", ["Cy"]);
  emails(deps, ["Cy"], ["Cy"]);

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.inputs).toEqual([search("12"), search("9"), search("18"), search("19"), search("20")]);
  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Ann", "Cy"]);
  expect(await deps.applications.get(id)).toMatchObject({ status: "in-review" });
});

test("any is searched once, last, when nobody with an email was found in the 5 functions", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann"]);
  emails(deps, ["Ann"], []);
  employees(deps, "any", ["Ann", "Bob"]);
  emails(deps, ["Bob"], ["Bob"]);

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.inputs.map(({ jobFunction }) => jobFunction)).toEqual(["12", "9", "18", "19", "20", "any"]);
  expect(await deps.decisionMakers.listForApplication(id)).toMatchObject([{ name: "Bob", jobFunction: "any" }]);
});

test("nobody with an email ends the Application as No Contacts, still saving the people found", async () => {
  const deps = await setup();
  employees(deps, "18", ["Ann"]);
  emails(deps, ["Ann"], []);

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.inputs).toHaveLength(6);
  expect(await deps.applications.get(id)).toMatchObject({
    status: "no-contacts",
    currentStep: "find-decision-makers",
    error: "No Decision Maker with an email address was found",
  });
  expect(names(await deps.decisionMakers.listForCompany(1))).toEqual(["Ann"]);
  expect(await deps.decisionMakers.listForApplication(id)).toEqual([]);
});

test("each actor run is saved before it's polled, with the Application and what it's for", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann", "Bob", "Cy", "Dee", "Eve"]);
  emails(deps, ["Ann", "Bob", "Cy", "Dee", "Eve"], ["Ann", "Bob", "Cy", "Dee", "Eve"]);
  deps.employeesActor.statuses.set(JSON.stringify(search("12")), ["running", "running", "succeeded"]);

  const id = await prepareToDecisionMakers(deps);

  expect(await deps.actorRuns.listForApplication(id)).toMatchObject([
    { runId: "employees-run-1", actor: "employees", token: "token-a", applicationId: id, purpose: "employees:12" },
    { runId: "emails-run-1", actor: "emails", token: "token-b", applicationId: id, purpose: "emails:12" },
  ]);
  expect(await deps.actorRuns.listUnfinished()).toEqual([]);
  expect(names(await deps.decisionMakers.listForApplication(id))).toHaveLength(5);
});

test("a Retry resumes the actor run still going instead of starting another", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann", "Bob", "Cy", "Dee", "Eve"]);
  emails(deps, ["Ann", "Bob", "Cy", "Dee", "Eve"], ["Ann", "Bob", "Cy", "Dee", "Eve"]);
  // Still running after every poll the Function has, then done by the Retry.
  deps.employeesActor.statuses.set(JSON.stringify(search("12")), [...Array(121).fill("running"), "succeeded"]);

  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;
  await expect(runPreparation(deps, id)).rejects.toThrow("is still running");
  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    error: "Actor run employees-run-1 (employees:12) is still running: Retry to resume it",
  });

  await retry(deps, id);
  await runPreparation(deps, id);

  expect(deps.employeesActor.started).toHaveLength(1);
  // LLM request 1 isn't asked again: only the Cover Letter is written after the Retry.
  expect(deps.fakeLlm.requests).toHaveLength(2);
  expect(await deps.applications.get(id)).toMatchObject({ status: "in-review" });
});

test("a Retry rereads finished runs and starts again only the run that failed", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann"]);
  emails(deps, ["Ann"], ["Ann"]);
  employees(deps, "9", ["Bob"]);
  emails(deps, ["Bob"], ["Bob"]);
  deps.employeesActor.statuses.set(JSON.stringify(search("9")), ["failed"]);
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;
  await expect(runPreparation(deps, id)).rejects.toThrow("failed: Retry to start it again");
  expect(await deps.applications.get(id)).toMatchObject({ status: "failed" });

  deps.employeesActor.statuses.clear();
  await retry(deps, id);
  await runPreparation(deps, id);

  expect(deps.employeesActor.inputs.map(({ jobFunction }) => jobFunction)).toEqual(["12", "9", "9", "18", "19", "20"]);
  expect(deps.emailsActor.started).toHaveLength(2);
  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Ann", "Bob"]);
});

test("an attempt tried again after a long poll gets only the polls left, so it can't pass the time limit", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann"]);
  emails(deps, ["Ann"], ["Ann"]);
  deps.employeesActor.statuses.set(JSON.stringify(search("12")), [...Array(60).fill("running"), "succeeded"]);
  deps.emailsActor.startErrors.push(new Error("Apify is down"));
  deps.emailsActor.statuses.set(JSON.stringify([person("Ann").profileUrl]), [...Array(70).fill("running"), "succeeded"]);
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;

  await expect(runPreparation(deps, id)).rejects.toThrow("emails-run-1 (emails:12) is still running");

  const searches = (await deps.stepLogs.listForApplication(id)).filter(({ step }) => step === "find-decision-makers");
  expect(searches.map(({ error }) => error)).toEqual([
    "Apify is down",
    "Actor run emails-run-1 (emails:12) is still running: Retry to resume it",
  ]);
});

test("emails are matched to people by profile URL, ignoring how the email actor writes it, and anyone missing is skipped", async () => {
  const deps = await setup();
  employees(deps, "12", ["Ann", "Bob"]);
  deps.emailsActor.returns(
    [person("Ann").profileUrl, person("Bob").profileUrl],
    [{ profileUrl: "http://linkedin.com/in/Ann/", email: "ann@acme.com" }],
  );

  const id = await prepareToDecisionMakers(deps);

  expect(await deps.decisionMakers.listForApplication(id)).toMatchObject([{ name: "Ann", email: "ann@acme.com" }]);
  expect(await deps.decisionMakers.listForCompany(1)).toMatchObject([{ name: "Ann" }, { name: "Bob", email: null }]);
});

test("a run that fails again after a Retry fails the Application again", async () => {
  const deps = await setup();
  deps.employeesActor.statuses.set(JSON.stringify(search("12")), ["failed"]);
  deps.fakeLlm.answers.push(answer);
  const id = (await prepare(deps, 1))!;
  await expect(runPreparation(deps, id)).rejects.toThrow("employees-run-1 (employees:12) failed");

  await retry(deps, id);
  await expect(runPreparation(deps, id)).rejects.toThrow("employees-run-2 (employees:12) failed");

  expect(await deps.applications.get(id)).toMatchObject({ status: "failed", currentStep: "find-decision-makers" });
});

/** Acme saved with these people, found at the given time: name → email, null for none. */
async function savedPeople(deps: Deps, foundAt: Date, people: Record<string, string | null>) {
  const companyId = await deps.companies.findOrCreate({ name: "Acme", linkedinUrl: acmePage.url });
  await deps.decisionMakers.save(
    companyId,
    Object.entries(people).map(([name, email]) => ({ ...person(name), email, jobFunction: "12" as const })),
    foundAt,
  );
}

const justUnderSixMonthsAgo = new Date("2026-05-04T10:00:00.001Z");
const sixMonthsAgo = new Date("2026-05-04T10:00:00Z");

test("saved people under 6 months old are reused with no actor runs, skipping those with no email", async () => {
  const deps = await setup();
  await savedPeople(deps, justUnderSixMonthsAgo, { Ann: null, Bob: "bob@acme.com", Cy: "cy@acme.com" });

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.started).toEqual([]);
  expect(deps.emailsActor.started).toEqual([]);
  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Bob", "Cy"]);
  expect(await deps.applications.get(id)).toMatchObject({ status: "in-review" });
});

test("saved people 6 months old trigger a People Refresh, which chooses only from the people found again", async () => {
  const deps = await setup();
  await savedPeople(deps, sixMonthsAgo, { Ann: "ann@acme.com" });
  employees(deps, "12", ["Bob"]);
  emails(deps, ["Bob"], ["Bob"]);

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.inputs.map(({ jobFunction }) => jobFunction)).toEqual(["12", "9", "18", "19", "20"]);
  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Bob"]);
  expect(await deps.decisionMakers.peopleFoundAt(1)).toEqual(now);
});

test("saved people with no email aren't retried before the People Refresh, so the Application ends as No Contacts", async () => {
  const deps = await setup();
  await savedPeople(deps, justUnderSixMonthsAgo, { Ann: null, Bob: null });

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.started).toEqual([]);
  expect(deps.emailsActor.started).toEqual([]);
  expect(await deps.applications.get(id)).toMatchObject({ status: "no-contacts" });
});

const justUnderThirtyDaysAgo = new Date("2026-10-05T10:00:00.001Z");
const thirtyDaysAgo = new Date("2026-10-05T10:00:00Z");

test("a Decision Maker emailed under 30 days ago is in Cooldown and left out, but one emailed 30 days ago isn't", async () => {
  const deps = await setup();
  await savedPeople(deps, justUnderSixMonthsAgo, { Ann: "ann@acme.com", Bob: "bob@acme.com", Cy: "cy@acme.com" });
  deps.decisionMakers.emailed("Ann", justUnderThirtyDaysAgo);
  deps.decisionMakers.emailed("Bob", thirtyDaysAgo);

  const id = await prepareToDecisionMakers(deps);

  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Bob", "Cy"]);
});

test("when every saved person is in Cooldown, the Application stops at the start, before anything is paid for", async () => {
  const deps = await setup();
  await savedPeople(deps, justUnderSixMonthsAgo, { Ann: "ann@acme.com", Bob: "bob@acme.com", Cy: null });
  deps.decisionMakers.emailed("Ann", justUnderThirtyDaysAgo);
  deps.decisionMakers.emailed("Bob", new Date("2026-11-01T09:00:00Z"));
  await deps.jobs.save([
    { ...linkedInJob, title: "Platform Engineer", url: "https://www.linkedin.com/jobs/view/3", companyLinkedinUrl: acmePage.url },
  ]);
  const id = (await prepare(deps, 3))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "all-in-cooldown",
    currentStep: "read-job",
    error: "Every Decision Maker is in Cooldown, emailed: Ann 29 days ago, Bob 3 days ago",
  });
  expect(deps.fakeLlm.requests).toEqual([]);
  expect(deps.employeesActor.started).toEqual([]);
});

test("newly found people in Cooldown are left out after the search, stopping the Application when that's everyone", async () => {
  const deps = await setup();
  await savedPeople(deps, sixMonthsAgo, { Ann: "ann@acme.com" });
  deps.decisionMakers.emailed("Ann", new Date("2026-11-02T10:00:00Z"));
  employees(deps, "12", ["Ann"]);
  emails(deps, ["Ann"], ["Ann"]);

  const id = await prepareToDecisionMakers(deps);

  expect(deps.employeesActor.started).not.toEqual([]);
  expect(await deps.applications.get(id)).toMatchObject({
    status: "all-in-cooldown",
    currentStep: "find-decision-makers",
    error: "Every Decision Maker is in Cooldown, emailed: Ann 2 days ago",
  });
});


/** The Admin's saved Decision Makers at Acme, so the search runs no actors. */
async function saveAcmePeople(deps: Deps) {
  const companyId = await deps.companies.findOrCreate({ name: "Acme", linkedinUrl: acmePage.url });
  await deps.decisionMakers.save(
    companyId,
    [{ ...person("Ann"), email: "ann@acme.com", jobFunction: "12" }],
    new Date("2026-11-01T00:00:00Z"),
  );
}

test("once Decision Makers are found, LLM request 2 writes the subject and Cover Letter from the Job Summary and Resume, then the Application is in Review", async () => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(deps.fakeLlm.requests).toHaveLength(2);
  const { prompt } = deps.fakeLlm.requests[1];
  expect(prompt).toContain(`<job_summary>\n${answer.jobSummary}\n</job_summary>`);
  expect(prompt).toContain("<resume>\n# Jane Doe\nGo engineer, 5 years of payment APIs.\n</resume>");
  expect(deps.fakeDrive.downloads).toEqual(["file-Backend Engineer Resume.pdf"]);
  expect(await deps.applications.get(id)).toMatchObject({
    status: "in-review",
    error: null,
    subject: letter.subject,
    coverLetter: letter.coverLetter,
  });
});

test("with no saved Cover Letter instructions, LLM request 2 uses the default ones followed by the writing rules", async () => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  const { instructions } = deps.fakeLlm.requests[1];
  expect(instructions).toMatch(/^You help a job seeker apply to a job by emailing the people who can hire them\./);
  expect(instructions).toContain("Avoid em dashes entirely.");
});

test("{{company}} in the subject and Cover Letter is filled in with the Job's company name before Review", async () => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.fakeLlm.answers.push(answer, {
    subject: "Payment APIs for {{company}}",
    coverLetter: "Hi {{name}},\n\nI noticed {{company}} is looking for someone who can build payment APIs.\n\n{{resume_link}}",
  });
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "in-review",
    subject: "Payment APIs for Acme",
    coverLetter: "Hi {{name}},\n\nI noticed Acme is looking for someone who can build payment APIs.\n\n{{resume_link}}",
  });
});

test("saved Cover Letter instructions replace the default ones, and the writing rules still follow them", async () => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.coverLetterInstructions = async () => "Write a short letter greeting {{name}} and ending with {{resume_link}}.";
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  const { instructions } = deps.fakeLlm.requests[1];
  expect(instructions).toMatch(/^Write a short letter greeting \{\{name\}\} and ending with \{\{resume_link\}\}\.\n/);
  expect(instructions).not.toContain("You help a job seeker apply to a job by emailing");
  expect(instructions).toContain("Avoid em dashes entirely.");
});

test("the Cover Letter isn't written when no Decision Maker is found, so the Application doesn't pay for it", async () => {
  const deps = await setup();
  for (const jobFunction of ["12", "9", "18", "19", "20", "any"] as const) employees(deps, jobFunction, []);
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ status: "no-contacts", subject: null, coverLetter: null });
  expect(deps.fakeLlm.requests).toHaveLength(1);
  expect(deps.fakeDrive.downloads).toEqual([]);
});

test.each([
  ["no {{name}}", "Hi there,\n\nI build APIs.\n\n{{resume_link}}"],
  ["{{name}} after the first line", "Hi,\n{{name}}, I build APIs.\n\n{{resume_link}}"],
  ["no {{resume_link}}", "Hi {{name}},\n\nI build APIs."],
  ["{{resume_link}} before the end", "Hi {{name}},\n\n{{resume_link}}\n\nThanks!"],
])("a Cover Letter with %s fails the Application before Review", async (_, coverLetter) => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.fakeLlm.answers.push(answer, { ...letter, coverLetter });
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    currentStep: "write-cover-letter",
    coverLetter: null,
    error: "The LLM's Cover Letter is missing {{name}} in its first line or {{resume_link}} at its end",
  });
});

test("a Resume Folder not shared by link stops the Application before Review, and a Retry after sharing doesn't write the letter again", async () => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.fakeDrive.sharedByLink.clear();
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);
  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    currentStep: "check-sharing",
    coverLetter: letter.coverLetter,
    error: 'Your Resume Folder "Resumes" isn\'t shared as "Anyone with the link": share it, then Retry',
  });

  deps.fakeDrive.sharedByLink.add("folder");
  await retry(deps, id);
  await runPreparation(deps, id);

  expect(await deps.applications.get(id)).toMatchObject({ status: "in-review", error: null });
  expect(deps.fakeLlm.requests).toHaveLength(2);
});

test("Cancel is final: a cancelled Application can't be cancelled, retried or Prepared again", async () => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;
  await runPreparation(deps, id);

  expect(await cancel(deps, id)).toBe(true);
  expect(await cancel(deps, id)).toBe(false);
  expect(await retry(deps, id)).toBeNull();
  expect(await prepare(deps, 1)).toBeNull();
  await runPreparation(deps, id);

  expect(await deps.applications.list()).toMatchObject([{ id, status: "cancelled" }]);
});

test("only an Application in Review can be cancelled", async () => {
  const deps = await setup();
  const id = (await prepare(deps, 1))!;

  expect(await cancel(deps, id)).toBe(false);
  expect(await deps.applications.get(id)).toMatchObject({ status: "preparing" });
});

test("Delete removes an Application and its recipients, so the Job can be Prepared again", async () => {
  const deps = await setup();
  await saveAcmePeople(deps);
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;
  await runPreparation(deps, id);

  expect(await deleteApplication(deps, id)).toBe(true);

  expect(await deps.applications.get(id)).toBeUndefined();
  expect(await deps.decisionMakers.listForApplication(id)).toEqual([]);
  expect(await prepare(deps, 1)).not.toBeNull();
});

test("an Application a Function is working on can't be deleted", async () => {
  const deps = await setup();
  const id = (await prepare(deps, 1))!;

  expect(await deleteApplication(deps, id)).toBe(false);
  expect(await deps.applications.get(id)).toMatchObject({ status: "preparing" });
});

test("a remote Job's location is left out of the Company page search", async () => {
  const deps = await setup();
  deps.companyPageSearch.results.set("Acme fintech site:linkedin.com/company", acmePage);
  deps.fakeLlm.answers.push({ ...answer, jobLocation: "Remote (EU)" });
  const id = (await prepare(deps, 1))!;

  await runPreparation(deps, id);

  expect(deps.companyPageSearch.queries).toEqual(["Acme fintech site:linkedin.com/company"]);
});

/** Prepares the LinkedIn Job to Review, with Ann and Bob, already saved at Acme, as its Decision Makers. */
async function reachReview(deps: Deps) {
  const companyId = await deps.companies.findOrCreate({ name: "Acme", linkedinUrl: acmePage.url });
  await deps.decisionMakers.save(
    companyId,
    ["Ann", "Bob"].map((name) => ({ ...person(name), email: `${name.toLowerCase()}@acme.com`, jobFunction: "12" as const })),
    new Date("2026-11-01T00:00:00Z"),
  );
  deps.fakeLlm.answers.push(answer, letter);
  const id = (await prepare(deps, 1))!;
  await runPreparation(deps, id);
  return id;
}

const editedLetter = "Hello {{name}},\n\nI ship payment APIs in Go.\n\nResume: {{resume_link}}";

test("in Review, the Admin can edit the subject and Cover Letter", async () => {
  const deps = await setup();
  const id = await reachReview(deps);

  const result = await edit(deps, id, { subject: "Go engineer for Acme", coverLetter: editedLetter });

  expect(result).toEqual({ saved: true });
  expect(await deps.applications.get(id)).toMatchObject({
    status: "in-review",
    subject: "Go engineer for Acme",
    coverLetter: editedLetter,
  });
});

test.each([
  ["{{name}}", "Hello there,\n\nI ship payment APIs in Go.\n\nResume: {{resume_link}}"],
  ["{{resume_link}}", "Hello {{name}},\n\nI ship payment APIs in Go."],
])("saving is refused when an edit removes %s, and nothing is saved", async (_, coverLetter) => {
  const deps = await setup();
  const id = await reachReview(deps);

  const result = await edit(deps, id, { subject: "Go engineer for Acme", coverLetter });

  expect(result).toEqual({
    saved: false,
    error: "The Cover Letter needs {{name}} in its first line and {{resume_link}} at its end",
  });
  expect(await deps.applications.get(id)).toMatchObject({ subject: letter.subject, coverLetter: letter.coverLetter });
});

test("in Review, the Admin can switch to any listed Resume", async () => {
  const deps = await setup();
  const id = await reachReview(deps);

  const result = await edit(deps, id, { resumeFileId: "file-Data Analyst CV.pdf" });

  expect(result).toEqual({ saved: true });
  expect(await deps.applications.get(id)).toMatchObject({
    resumeFileId: "file-Data Analyst CV.pdf",
    resumeName: "Data Analyst CV.pdf",
    resumeLink: "https://drive.google.com/file/Data Analyst CV.pdf",
    coverLetter: letter.coverLetter,
  });
});

test("a file that isn't a listed Resume can't be switched to", async () => {
  const deps = await setup();
  const id = await reachReview(deps);

  const result = await edit(deps, id, { resumeFileId: "file-Notes.pdf" });

  expect(result).toEqual({ saved: false, error: "That file isn't one of the Resumes in your Resume Folder" });
  expect(await deps.applications.get(id)).toMatchObject({ resumeFileId: "file-Backend Engineer Resume.pdf" });
});

test("in Review, the Admin can remove a Decision Maker, but not the last one", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  const [ann, bob] = await deps.decisionMakers.listForApplication(id);

  expect(await removeDecisionMaker(deps, id, bob.id)).toEqual({ saved: true });
  expect(await removeDecisionMaker(deps, id, ann.id)).toEqual({
    saved: false,
    error: "An Application needs a Decision Maker: Cancel it instead",
  });

  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Ann"]);
  // Removed from this Application only, so they stay saved at the Company.
  expect(names(await deps.decisionMakers.listForCompany(1))).toEqual(["Ann", "Bob"]);
});

test("in Review, the Admin can add anyone at the Company with an email who isn't in Cooldown", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  const at = new Date("2026-11-01T00:00:00Z");
  const [cy, dee, eve] = await deps.decisionMakers.save(
    1,
    [
      { ...person("Cy"), email: "cy@acme.com", jobFunction: "9" },
      { ...person("Dee"), email: null, jobFunction: "9" },
      { ...person("Eve"), email: "eve@acme.com", jobFunction: "9" },
    ],
    at,
  );
  deps.decisionMakers.emailed("Eve", at);
  const [ann] = await deps.decisionMakers.listForApplication(id);

  expect(await addDecisionMaker(deps, id, cy.id)).toEqual({ saved: true });
  expect(await addDecisionMaker(deps, id, ann.id)).toEqual({
    saved: false,
    error: "That person is already one of this Application's Decision Makers",
  });
  expect(await addDecisionMaker(deps, id, dee.id)).toEqual({ saved: false, error: "That person has no email" });
  expect(await addDecisionMaker(deps, id, eve.id)).toEqual({ saved: false, error: "That person is in Cooldown" });
  expect(await addDecisionMaker(deps, id, 999)).toEqual({
    saved: false,
    error: "That person wasn't found at this Application's Company",
  });

  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Ann", "Bob", "Cy"]);
});

test("a removed Decision Maker can be added back", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  const [, bob] = await deps.decisionMakers.listForApplication(id);

  await removeDecisionMaker(deps, id, bob.id);
  expect(await addDecisionMaker(deps, id, bob.id)).toEqual({ saved: true });

  expect(names(await deps.decisionMakers.listForApplication(id))).toEqual(["Ann", "Bob"]);
});

test("edits are only accepted while the Application is in Review", async () => {
  const deps = await setup();
  const preparing = (await prepare(deps, 2))!;
  const cancelled = await reachReview(deps);
  const [, bob] = await deps.decisionMakers.listForApplication(cancelled);
  await cancel(deps, cancelled);

  for (const id of [preparing, cancelled]) {
    expect(await edit(deps, id, { subject: "Changed" })).toEqual({
      saved: false,
      error: "Only an Application in Review can be edited",
    });
  }
  expect(await removeDecisionMaker(deps, cancelled, bob.id)).toMatchObject({ saved: false });
  expect(await addDecisionMaker(deps, cancelled, bob.id)).toMatchObject({ saved: false });

  expect(await deps.applications.get(cancelled)).toMatchObject({ status: "cancelled", subject: letter.subject });
  expect(await deps.applications.get(preparing)).toMatchObject({ subject: null });
  expect(names(await deps.decisionMakers.listForApplication(cancelled))).toEqual(["Ann", "Bob"]);
});

test("an empty subject can't be saved", async () => {
  const deps = await setup();
  const id = await reachReview(deps);

  expect(await edit(deps, id, { subject: "  " })).toEqual({ saved: false, error: "The subject can't be empty" });
  expect(await deps.applications.get(id)).toMatchObject({ subject: letter.subject });
});

const sendTime = new Date("2026-11-05T09:00:00Z");

test("Send emails each Decision Maker from the Admin's Gmail, a few seconds apart, personalized with their name and the Resume link", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  const events: string[] = [];
  deps.fakeGmail.onSend = (email) => events.push(`email ${email.to}`);
  deps.sleep = async (ms) => void events.push(`sleep ${ms}`);
  deps.now = () => sendTime;

  expect(await send(deps, id)).toEqual({ outcome: "claimed" });
  expect(deps.fakeGmail.sent).toEqual([]);
  await runSending(deps, id);

  expect(events).toEqual(["email ann@acme.com", "sleep 5000", "email bob@acme.com"]);
  expect(deps.fakeGmail.sent[0]).toEqual({
    to: "ann@acme.com",
    subject: letter.subject,
    body: "Hi Ann,\n\nI build payment APIs in Go.\n\nMy Resume: https://drive.google.com/file/Backend Engineer Resume.pdf",
  });
  expect(deps.fakeGmail.sent[1].body).toMatch(/^Hi Bob,/);
  expect(await deps.applications.get(id)).toMatchObject({ status: "sent", error: null });
  expect(await deps.decisionMakers.listForApplication(id)).toMatchObject([
    { name: "Ann", sentAt: sendTime, lastEmailedAt: sendTime },
    { name: "Bob", sentAt: sendTime, lastEmailedAt: sendTime },
  ]);
});

test("nothing is emailed without Send, and a double click on Send claims the Application once", async () => {
  const deps = await setup();
  const id = await reachReview(deps);

  await runSending(deps, id);
  expect(deps.fakeGmail.sent).toEqual([]);

  const claims = await Promise.all([send(deps, id), send(deps, id)]);

  expect(claims).toEqual([{ outcome: "claimed" }, { outcome: "not-in-review" }]);
  expect(await deps.applications.get(id)).toMatchObject({ status: "sending" });
  await runSending(deps, id);
  await runSending(deps, id);
  expect(deps.fakeGmail.sent).toHaveLength(2);
});

test("Send is refused if a placeholder is missing", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  // Saved by older code or by hand, since an edit can't remove a placeholder.
  await deps.applications.update(id, { coverLetter: "Hi there,\n\nI build APIs.\n\n{{resume_link}}" });

  expect(await send(deps, id)).toEqual({
    outcome: "refused",
    error: "The Cover Letter needs {{name}} in its first line and {{resume_link}} at its end",
  });
  expect(await deps.applications.get(id)).toMatchObject({ status: "in-review" });
});

test("everything is locked once Send starts", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  const [, bob] = await deps.decisionMakers.listForApplication(id);
  await send(deps, id);

  expect(await edit(deps, id, { subject: "Changed", coverLetter: editedLetter })).toMatchObject({ saved: false });
  expect(await edit(deps, id, { resumeFileId: "file-Data Analyst CV.pdf" })).toMatchObject({ saved: false });
  expect(await removeDecisionMaker(deps, id, bob.id)).toMatchObject({ saved: false });
  expect(await cancel(deps, id)).toBe(false);
  expect(await retry(deps, id)).toBeNull();
  await runSending(deps, id);

  expect(deps.fakeGmail.sent.map(({ to }) => to)).toEqual(["ann@acme.com", "bob@acme.com"]);
  expect(deps.fakeGmail.sent[0]).toMatchObject({ subject: letter.subject });
  expect(await deps.applications.get(id)).toMatchObject({ status: "sent" });
});

test("Send is refused unless Sending is allowed, and the Function emails nobody without it", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  deps.sendingAllowed = async () => false;

  expect(await send(deps, id)).toEqual({
    outcome: "refused",
    error: "Sending is turned off: turn it on in Settings (DISABLE_SEND also keeps it off)",
  });
  expect(await deps.applications.get(id)).toMatchObject({ status: "in-review" });

  await deps.applications.claimSend(id);
  await expect(runSending(deps, id)).rejects.toThrow("Sending is turned off");
  expect(deps.fakeGmail.sent).toEqual([]);
});

test("a Send is tried 3 times, emailing nobody twice, then the Application is marked failed at the send step and stays locked", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  deps.now = () => sendTime;
  deps.fakeGmail.failFrom = 2;
  await send(deps, id);

  await expect(runSending(deps, id)).rejects.toThrow("Gmail refused the email");

  expect(deps.fakeGmail.sent.map(({ to }) => to)).toEqual(["ann@acme.com"]);
  expect(await deps.decisionMakers.listForApplication(id)).toMatchObject([
    { name: "Ann", sentAt: sendTime, lastEmailedAt: sendTime },
    { name: "Bob", sentAt: null, lastEmailedAt: null },
  ]);
  expect(await deps.applications.get(id)).toMatchObject({
    status: "failed",
    currentStep: "send",
    error: "Gmail refused the email",
  });
  const sendLogs = (await deps.stepLogs.listForApplication(id)).filter(({ step }) => step === "send");
  expect(sendLogs.map(({ attempt, status }) => [attempt, status])).toEqual([
    [1, "failed"],
    [2, "failed"],
    [3, "failed"],
  ]);
  expect(await edit(deps, id, { subject: "Changed" })).toMatchObject({ saved: false });
  expect(await cancel(deps, id)).toBe(false);
});

test("a Retry of a partly sent Application resumes the Send, emailing only those not emailed yet", async () => {
  const deps = await setup();
  const id = await reachReview(deps);
  deps.fakeGmail.failFrom = 2;
  await send(deps, id);
  await expect(runSending(deps, id)).rejects.toThrow("Gmail refused the email");
  deps.fakeGmail.failFrom = Infinity;

  // A failed Send isn't prepared again.
  expect(await retry(deps, id)).toBeNull();
  expect(await retrySend(deps, id)).toEqual({ outcome: "claimed" });
  expect(await retrySend(deps, id)).toEqual({ outcome: "not-failed" });
  expect(await deps.applications.get(id)).toMatchObject({ status: "sending", error: null });
  await runSending(deps, id);

  expect(deps.fakeGmail.sent.map(({ to }) => to)).toEqual(["ann@acme.com", "bob@acme.com"]);
  expect(await deps.applications.get(id)).toMatchObject({ status: "sent", error: null });
  expect((await deps.stepLogs.listForApplication(id)).at(-1)).toMatchObject({
    step: "send",
    attempt: 4,
    status: "succeeded",
    result: "Emailed Bob <bob@acme.com>",
  });
});

test("a failed Prepare can't be retried as a Send, and a Send can't be retried without Sending allowed", async () => {
  const deps = await setup();
  const preparing = (await prepare(deps, 2))!;
  await deps.applications.update(preparing, { status: "failed", error: "Firecrawl was down" });

  expect(await retrySend(deps, preparing)).toEqual({ outcome: "not-failed" });

  const sending = await reachReview(deps);
  deps.fakeGmail.failFrom = 1;
  await send(deps, sending);
  await expect(runSending(deps, sending)).rejects.toThrow("Gmail refused the email");
  deps.sendingAllowed = async () => false;
  expect(await retrySend(deps, sending)).toEqual({
    outcome: "refused",
    error: "Sending is turned off: turn it on in Settings (DISABLE_SEND also keeps it off)",
  });
  expect(await deps.applications.get(sending)).toMatchObject({ status: "failed" });
});
