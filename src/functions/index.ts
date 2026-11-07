import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { prepare, retry, retrySend, runPreparation, runSending, send } from "../lib/application-lifecycle";
import {
  drizzleActorRunStore,
  drizzleApplicationStore,
  drizzleCompanyStore,
  drizzleDecisionMakerStore,
  drizzleLlmSettingsStore,
  drizzleResumeFolderStore,
  drizzleScheduleSettingsStore,
  drizzleSendSettingsStore,
  drizzleExcludedKeywordStore,
  drizzleFunctionRunStore,
  drizzleGoogleConnectionStore,
  drizzleJobBoardSettingsStore,
  drizzleJobFeedStore,
  drizzleJobStore,
  drizzleSkippedApifyTokenStore,
  drizzleStepLogStore,
} from "../lib/drizzle";
import { apifyEmailsActor, apifyEmployeesActor } from "../lib/apify-people";
import { parseFunctionsEnv } from "../lib/env";
import { firecrawlCompanyPageSearch } from "../lib/firecrawl-company-page";
import { firecrawlJobFeedReader } from "../lib/firecrawl-job-feed";
import { firecrawlJobPageReader } from "../lib/firecrawl-job-page";
import { googleDrive, googleGmail, googleOAuth } from "../lib/google";
import { googleAccessToken } from "../lib/google-connection";
import { glassdoorJobBoard } from "../lib/glassdoor-job-board";
import { webImageGateway } from "../lib/images";
import { FUNCTION_TIME_LIMITS_MS } from "../lib/function-runs";
import { runCollection } from "../lib/job-collection";
import { linkedInJobBoard } from "../lib/linkedin-job-board";
import { llmGateway } from "../lib/llm";
import { pdfReader } from "../lib/pdf";
import { COLLECT_JOBS, PREPARE_APPLICATION, SEND_APPLICATION } from "../lib/schema";
import { telegramGateway } from "../lib/telegram";
import { InvalidFunctionRequestError } from "./accept-function-request";

type Services = ReturnType<typeof functionServices>;

type FunctionDefinition = {
  timeLimitMs: number;
  /** Claims the Application named in the request body. Null when it isn't in a startable state. */
  claim?: (services: Services, body: unknown) => Promise<number | null>;
  work: (services: Services, applicationId?: number) => Promise<void>;
};

/** A Prepare names the Job; a Retry names the failed Application. */
const prepareRequestSchema = z.union([
  z.object({ jobId: z.number().int().positive() }),
  z.object({ applicationId: z.number().int().positive() }),
]);

/** A Send names the Application in Review; a Retry of a failed Send also says it's a retry. */
const sendRequestSchema = z.object({ applicationId: z.number().int().positive(), retry: z.boolean().optional() });

function requireApplication(applicationId: number | undefined) {
  if (applicationId === undefined) throw new Error("No Application was given");
  return applicationId;
}

export const functions = new Map<string, FunctionDefinition>([
  ["noop", { timeLimitMs: FUNCTION_TIME_LIMITS_MS.noop, work: async () => {} }],
  [COLLECT_JOBS, { timeLimitMs: FUNCTION_TIME_LIMITS_MS[COLLECT_JOBS], work: runCollection }],
  [
    PREPARE_APPLICATION,
    {
      timeLimitMs: FUNCTION_TIME_LIMITS_MS[PREPARE_APPLICATION],
      async claim(services, body) {
        const request = prepareRequestSchema.safeParse(body);
        if (!request.success) {
          throw new InvalidFunctionRequestError("The request body needs a numeric jobId or applicationId");
        }
        return "jobId" in request.data
          ? prepare(services, request.data.jobId)
          : retry(services, request.data.applicationId);
      },
      work: (services, applicationId) => runPreparation(services, requireApplication(applicationId)),
    },
  ],
  [
    SEND_APPLICATION,
    {
      timeLimitMs: FUNCTION_TIME_LIMITS_MS[SEND_APPLICATION],
      async claim(services, body) {
        const request = sendRequestSchema.safeParse(body);
        if (!request.success) throw new InvalidFunctionRequestError("The request body needs a numeric applicationId");
        const { applicationId, retry } = request.data;
        const claim = retry ? await retrySend(services, applicationId) : await send(services, applicationId);
        if (claim.outcome === "refused") throw new InvalidFunctionRequestError(claim.error);
        return claim.outcome === "claimed" ? applicationId : null;
      },
      work: (services, applicationId) => runSending(services, requireApplication(applicationId)),
    },
  ],
]);

export function functionServices() {
  const {
    DATABASE_URL,
    FUNCTIONS_SECRET,
    APIFY_TOKENS,
    FIRECRAWL_API_KEY,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    DASHBOARD_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    DISABLE_SEND,
  } = parseFunctionsEnv(process.env);
  const now = () => new Date();
  const googleConnection = {
    store: drizzleGoogleConnectionStore(DATABASE_URL),
    oauth: googleOAuth(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET),
    now,
  };
  const accessToken = () => googleAccessToken(googleConnection);
  const llmSettings = drizzleLlmSettingsStore(DATABASE_URL);
  return {
    runs: drizzleFunctionRunStore(DATABASE_URL),
    scheduleSettings: drizzleScheduleSettingsStore(DATABASE_URL),
    secret: FUNCTIONS_SECRET,
    now,
    sleep: async (ms: number) => void (await setTimeout(ms)),
    jobBoards: [linkedInJobBoard, glassdoorJobBoard],
    jobBoardSettings: drizzleJobBoardSettingsStore(DATABASE_URL),
    excludedKeywords: drizzleExcludedKeywordStore(DATABASE_URL),
    actorRuns: drizzleActorRunStore(DATABASE_URL),
    stepLogs: drizzleStepLogStore(DATABASE_URL),
    jobs: drizzleJobStore(DATABASE_URL),
    jobFeeds: drizzleJobFeedStore(DATABASE_URL),
    feedReader: firecrawlJobFeedReader(FIRECRAWL_API_KEY),
    apifyTokens: APIFY_TOKENS,
    skippedApifyTokens: drizzleSkippedApifyTokenStore(DATABASE_URL),
    telegram: telegramGateway(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID),
    images: webImageGateway(),
    dashboardUrl: DASHBOARD_URL,
    /** The Admin's Google access token, from the connection the dashboard stored. */
    googleAccessToken: accessToken,
    applications: drizzleApplicationStore(DATABASE_URL),
    jobPages: firecrawlJobPageReader(FIRECRAWL_API_KEY),
    companies: drizzleCompanyStore(DATABASE_URL),
    companyPageSearch: firecrawlCompanyPageSearch(FIRECRAWL_API_KEY),
    employeesActor: apifyEmployeesActor,
    emailsActor: apifyEmailsActor,
    decisionMakers: drizzleDecisionMakerStore(DATABASE_URL),
    resumeFolder: drizzleResumeFolderStore(DATABASE_URL),
    drive: async () => googleDrive(await accessToken()),
    llm: async () => llmGateway(await llmSettings.get(), await llmSettings.apiKeys()),
    pdfs: pdfReader,
    gmail: async () => googleGmail(await accessToken()),
    sendingAllowed: async () => !DISABLE_SEND && (await drizzleSendSettingsStore(DATABASE_URL).sendingAllowed()),
  };
}
