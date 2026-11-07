import { z } from "zod";

type Variables = Record<string, string | undefined>;

const sharedSchema = z.object({
  DATABASE_URL: z.url(),
  FUNCTIONS_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

const functionsSchema = sharedSchema.extend({
  APIFY_TOKENS: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  DASHBOARD_URL: z.url(),
  // Compose sets it to "true", so testing can't email real Decision Makers whatever the Sending setting says.
  DISABLE_SEND: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

const dashboardSchema = sharedSchema.extend({
  DASHBOARD_PASSWORD: z.string().min(1),
  FUNCTIONS_BASE_URL: z.url(),
  // Where "today" starts on the dashboard, as for the scheduled Job Collection.
  TIMEZONE: z
    .string()
    .optional()
    .transform((value) => value || "UTC"),
});

export const parseFunctionsEnv = (variables: Variables) => functionsSchema.parse(variables);

export const parseDashboardEnv = (variables: Variables) => dashboardSchema.parse(variables);
