import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, Card, CardHeader, checkboxClass, inputClass, PageHeader } from "@/components/ui";
import { DEFAULT_COVER_LETTER_INSTRUCTIONS } from "@/lib/cover-letter-instructions";
import {
  cleanUpOldData,
  drizzleCoverLetterSettingsStore,
  drizzleLlmSettingsStore,
  drizzleSendSettingsStore,
} from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import type { LlmApiKeys } from "@/lib/gateways";
import { LLM_PROVIDER_NAMES, listModels } from "@/lib/llm-models";
import { LLM_PROVIDERS, type LlmProvider } from "@/lib/schema";
import { isDarkTheme } from "@/lib/theme";
import { CleanUpButton } from "./clean-up-button";
import { LlmApiKeyList } from "./llm-api-keys";
import { LlmFields } from "./llm-fields";

function databaseUrl() {
  return parseDashboardEnv(process.env).DATABASE_URL;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function backToSettings(error?: string): never {
  revalidatePath("/settings");
  redirect(error ? `/settings?error=${encodeURIComponent(error)}` : "/settings");
}

function providerIn(formData: FormData) {
  const provider = String(formData.get("provider")) as LlmProvider;
  if (!LLM_PROVIDERS.includes(provider)) throw new Error(`Unknown LLM provider: ${provider}`);
  return provider;
}

async function saveLlm(formData: FormData) {
  "use server";

  const provider = providerIn(formData);
  const model = String(formData.get("model")).trim();
  if (!model) backToSettings("Choose a model");
  const store = drizzleLlmSettingsStore(databaseUrl());
  if (!(await store.apiKeys())[provider]) backToSettings(`Add ${LLM_PROVIDER_NAMES[provider]}'s API key first`);
  await store.save({ provider, model });
  backToSettings();
}

/** Adds or replaces a provider's API key, once the provider lists its models with it. */
async function saveLlmKey(formData: FormData) {
  "use server";

  const provider = providerIn(formData);
  const apiKey = String(formData.get("apiKey")).trim();
  if (!apiKey) backToSettings("Enter the API key");
  let error: string | undefined;
  try {
    await listModels(provider, apiKey);
  } catch (problem) {
    error = messageOf(problem);
  }
  // Outside the try, as redirect works by throwing.
  if (error) backToSettings(error);
  await drizzleLlmSettingsStore(databaseUrl()).saveApiKey(provider, apiKey);
  backToSettings();
}

async function removeLlmKey(formData: FormData) {
  "use server";

  await drizzleLlmSettingsStore(databaseUrl()).removeApiKey(providerIn(formData));
  backToSettings();
}

/** The models each added key may use, and why any key's models couldn't be listed. */
async function modelsByProvider(apiKeys: LlmApiKeys) {
  const models: Partial<Record<LlmProvider, string[]>> = {};
  const errors: string[] = [];
  await Promise.all(
    LLM_PROVIDERS.map(async (provider) => {
      const apiKey = apiKeys[provider];
      if (!apiKey) return;
      try {
        models[provider] = await listModels(provider, apiKey);
      } catch (error) {
        errors.push(messageOf(error));
      }
    }),
  );
  return { models, errors };
}

async function saveSending(formData: FormData) {
  "use server";

  await drizzleSendSettingsStore(databaseUrl()).saveSendingAllowed(formData.get("allowed") === "on");
  // Also drops an earlier LLM error from the address, so it doesn't look like this save failed.
  backToSettings();
}

/** Saves the Admin's Cover Letter instructions. Reset, an empty text or the default itself goes back to the default. */
async function saveCoverLetterInstructions(formData: FormData) {
  "use server";

  const text = String(formData.get("instructions") ?? "").trim();
  const isDefault = formData.get("intent") === "reset" || !text || text === DEFAULT_COVER_LETTER_INSTRUCTIONS;
  await drizzleCoverLetterSettingsStore(databaseUrl()).saveInstructions(isDefault ? null : text);
  backToSettings();
}

async function cleanUp() {
  "use server";

  return cleanUpOldData(databaseUrl());
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const llmSettings = drizzleLlmSettingsStore(databaseUrl());
  const [{ error }, llm, apiKeys, sendingAllowed, savedInstructions, dark] = await Promise.all([
    searchParams,
    llmSettings.get(),
    llmSettings.apiKeys(),
    drizzleSendSettingsStore(databaseUrl()).sendingAllowed(),
    drizzleCoverLetterSettingsStore(databaseUrl()).instructions(),
    isDarkTheme(),
  ]);
  const { models, errors: modelErrors } = await modelsByProvider(apiKeys);
  // Only each key's last characters reach the browser.
  const keyEndings = Object.fromEntries(
    LLM_PROVIDERS.flatMap((provider) => (apiKeys[provider] ? [[provider, apiKeys[provider].slice(-4)]] : [])),
  ) as Partial<Record<LlmProvider, string>>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        action={<ThemeToggle initialDark={dark} className="md:hidden" />}
      />

      <Card>
        <ul className="divide-y divide-line">
          <LinkRow href="/google" title="Google" description="Gmail connection and Resume Folder" />
          <LinkRow href="/function-runs" title="Function runs" description="Recent runs and their errors" />
          <LinkRow
            href="/how-it-works"
            title="How it works"
            description="The steps, settings and Collection settings explained"
            className="md:hidden"
          />
        </ul>
      </Card>

      <Section title="LLM" description="Used to choose a Resume and write the Cover Letter, with the API key you add here.">
        {error && <Alert>{error}</Alert>}
        {modelErrors.map((problem) => (
          <Alert key={problem} tone="warning">
            {problem}
          </Alert>
        ))}
        {!llm && <Alert tone="warning">No LLM is chosen yet, so Prepare can&apos;t choose a Resume.</Alert>}
        <LlmApiKeyList
          keyEndings={keyEndings}
          chosenProvider={llm?.provider}
          saveKey={saveLlmKey}
          removeKey={removeLlmKey}
        />
        {Object.keys(keyEndings).length > 0 ? (
          <form action={saveLlm} className="space-y-3">
            <LlmFields
              providerNames={LLM_PROVIDER_NAMES}
              models={models}
              withKeys={Object.keys(keyEndings) as LlmProvider[]}
              provider={llm?.provider}
              model={llm?.model}
            />
            <SubmitButton variant="secondary" pendingText="Saving…">
              Save
            </SubmitButton>
          </form>
        ) : (
          <p className="text-sm text-muted">Add a provider&apos;s API key to choose its model.</p>
        )}
      </Section>

      <Section
        title="Cover Letter"
        description="The instructions the LLM follows to write each Application's subject and Cover Letter. Keep {{name}} in the first line and {{resume_link}} at the end, or Prepare fails. {{company}} is replaced with the company name."
      >
        <form action={saveCoverLetterInstructions} className="space-y-3">
          <textarea
            // Remounts after a save or Reset, so it shows what was saved.
            key={savedInstructions ?? ""}
            name="instructions"
            aria-label="Cover Letter instructions"
            defaultValue={savedInstructions ?? DEFAULT_COVER_LETTER_INSTRUCTIONS}
            rows={8}
            className={`${inputClass} font-mono leading-relaxed`}
          />
          <div className="flex gap-2">
            <SubmitButton variant="secondary" name="intent" value="save" pendingText="Saving…">
              Save
            </SubmitButton>
            {savedInstructions !== null && (
              <SubmitButton
                variant="ghost"
                name="intent"
                value="reset"
                pendingText="Resetting…"
                confirm="Replace your instructions with the default ones?"
              >
                Reset to default
              </SubmitButton>
            )}
          </div>
        </form>
      </Section>

      <Section
        title="Sending"
        description="Lets Send email Decision Makers from your Gmail. While it's off, Send is refused. Compose's DISABLE_SEND keeps it off whatever this says."
      >
        <form action={saveSending} className="flex items-center justify-between gap-3">
          <label className="flex min-h-9 items-center gap-2.5 text-sm text-fg-2">
            <input type="checkbox" name="allowed" defaultChecked={sendingAllowed} className={checkboxClass} /> Allow
            sending
          </label>
          <SubmitButton variant="secondary" pendingText="Saving…">
            Save
          </SubmitButton>
        </form>
      </Section>

      <Section
        title="Old Data"
        description="Deletes Jobs, Applications with their recipients, Function runs, actor runs and Decision Makers 6 months old or more. Keeps a Job whose Application is newer or still in progress, and Decision Makers in Cooldown."
      >
        <CleanUpButton cleanUp={cleanUp} />
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="space-y-4 px-4 py-4">
        {description && <p className="text-sm text-muted">{description}</p>}
        {children}
      </div>
    </Card>
  );
}

function LinkRow({
  href,
  title,
  description,
  className,
}: {
  href: string;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <li className={className}>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-subtle active:bg-subtle"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="truncate text-sm text-muted">{description}</p>
        </div>
        <span aria-hidden="true" className="text-faint">
          ›
        </span>
      </Link>
    </li>
  );
}
