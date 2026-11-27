import { expect, test } from "vitest";
import { FakeJobPages, FakeJobStore, FakeLlm } from "./fake-gateways";
import { addManualJob, readJobPage } from "./manual-job";

const url = "https://boards.greenhouse.io/acme/jobs/1";
const page = "# Senior Engineer\n\nAcme · Berlin, Germany\n\nPosted November 20, 2026\n\nBuild payments.";
const answer = {
  title: "Senior Engineer",
  companyName: "Acme",
  location: "Berlin, Germany",
  postDay: "2026-11-20",
  companyLinkedinUrl: "https://www.linkedin.com/company/acme",
};

function setup() {
  const jobPages = new FakeJobPages();
  jobPages.pages.set(url, page);
  return { jobPages, llm: new FakeLlm(), jobs: new FakeJobStore() };
}

test("a Job page is read into a draft of the Job, with the page as its description", async () => {
  const deps = setup();
  deps.llm.answers.push(answer);

  const result = await readJobPage(deps, url, "2026-11-27");

  expect(result).toEqual({ kind: "draft", draft: { ...answer, url, description: page } });
  expect(deps.llm.requests[0].prompt).toContain(page);
});

test("a Job page that shows no post date is drafted as posted today", async () => {
  const deps = setup();
  deps.llm.answers.push({ ...answer, postDay: "" });

  const result = await readJobPage(deps, url, "2026-11-27");

  expect(result).toMatchObject({ kind: "draft", draft: { postDay: "2026-11-27" } });
});

test("a URL that is already a saved Job isn't read again", async () => {
  const deps = setup();
  await deps.jobs.save([{ ...answer, source: "LinkedIn", url, description: "Saved", companyLogoUrl: null }]);

  const result = await readJobPage(deps, url, "2026-11-27");

  expect(result).toEqual({ kind: "saved", jobId: 1 });
  expect(deps.jobPages.urlsRead).toEqual([]);
});

const draft = { ...answer, url, description: page };

test("a saved draft is a manual Job with no Job Alert", async () => {
  const deps = setup();

  const jobId = await addManualJob(deps, draft);

  expect(await deps.jobs.get(jobId)).toEqual({
    id: jobId,
    source: "manual",
    title: "Senior Engineer",
    companyName: "Acme",
    location: "Berlin, Germany",
    url,
    postDay: "2026-11-20",
    description: page,
    companyLinkedinUrl: "https://www.linkedin.com/company/acme",
    companyLogoUrl: null,
  });
  expect(await deps.jobs.listPendingAlerts()).toEqual([]);
});

test("a draft that is a Duplicate Job gives the saved Job instead of a new one", async () => {
  const deps = setup();
  await deps.jobs.save([{ ...answer, source: "LinkedIn", url: "https://www.linkedin.com/jobs/view/1", description: "Saved", companyLogoUrl: null }]);

  const jobId = await addManualJob(deps, { ...draft, title: "senior engineer", companyName: "ACME" });

  expect(jobId).toBe(1);
  expect(await deps.jobs.list()).toHaveLength(1);
});
