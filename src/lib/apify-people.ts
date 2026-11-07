import { z } from "zod";
import { actorRunItems, actorRunStatus, startActorRun } from "./apify-actor";
import type { EmailsActor, EmployeesActor } from "./gateways";

const EMPLOYEES_ACTOR = "apt_marble/linkedin-company-employees-scraper";
const EMAILS_ACTOR = "vulnv/linkedin-email-finder";

const employeeSchema = z.object({
  name: z.string(),
  headline: z.string().nullish(),
  profileUrl: z.string(),
  image: z.string().nullish(),
});

const emailSchema = z.object({
  linkedin_url: z.string(),
  found: z.boolean(),
  email: z.string().nullish(),
});

export const apifyEmployeesActor: EmployeesActor = {
  actor: EMPLOYEES_ACTOR,

  start({ companyUrl, jobFunction, maxEmployees }, token) {
    return startActorRun(
      EMPLOYEES_ACTOR,
      { companyUrls: [companyUrl], maxEmployees, currentFunction: jobFunction },
      token,
    );
  },

  status: actorRunStatus,

  results(run) {
    return actorRunItems(run, employeeSchema, ({ name, headline, profileUrl, image }) => ({
      name,
      headline: headline ?? "",
      profileUrl,
      photo: image?.trim() || null,
    }));
  },
};

export const apifyEmailsActor: EmailsActor = {
  actor: EMAILS_ACTOR,

  start(profileUrls, token) {
    return startActorRun(EMAILS_ACTOR, { urls: profileUrls }, token);
  },

  status: actorRunStatus,

  results(run) {
    return actorRunItems(run, emailSchema, ({ linkedin_url, found, email }) => ({
      profileUrl: linkedin_url,
      email: (found && email?.trim()) || null,
    }));
  },
};
