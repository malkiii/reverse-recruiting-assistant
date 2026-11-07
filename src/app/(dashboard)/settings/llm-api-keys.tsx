import { SubmitButton } from "@/components/submit-button";
import { inputClass, labelClass } from "@/components/ui";
import { LLM_PROVIDER_NAMES } from "@/lib/llm-models";
import { LLM_PROVIDERS, type LlmProvider } from "@/lib/schema";

type FormAction = (formData: FormData) => Promise<void>;

function KeyInput({ label }: { label: string }) {
  return (
    <input type="password" name="apiKey" placeholder={label} aria-label={label} autoComplete="off" required className={inputClass} />
  );
}

/** The added providers, each with its key's ending to replace or remove, and a form to add another provider's key. */
export function LlmApiKeyList({
  keyEndings,
  chosenProvider,
  saveKey,
  removeKey,
}: {
  /** Each added key's last characters, by provider. */
  keyEndings: Partial<Record<LlmProvider, string>>;
  chosenProvider?: LlmProvider;
  saveKey: FormAction;
  removeKey: FormAction;
}) {
  const added = LLM_PROVIDERS.filter((provider) => keyEndings[provider] !== undefined);
  const notAdded = LLM_PROVIDERS.filter((provider) => keyEndings[provider] === undefined);

  return (
    <div>
      <p className={labelClass}>Providers</p>
      {added.length > 0 && (
        <ul className="mb-3 divide-y divide-line rounded-sm border border-line">
          {added.map((provider) => (
            <li key={provider} className="px-3 py-2">
              <details className="group">
                <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{LLM_PROVIDER_NAMES[provider]}</span>{" "}
                    <span className="font-mono text-muted">••••{keyEndings[provider]}</span>
                  </span>
                  <span className="text-xs text-muted group-open:hidden">Edit</span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <form action={saveKey} className="flex min-w-0 flex-1 gap-2">
                    <input type="hidden" name="provider" value={provider} />
                    <KeyInput label={`New ${LLM_PROVIDER_NAMES[provider]} API key`} />
                    <SubmitButton variant="secondary" pendingText="Checking…">
                      Save
                    </SubmitButton>
                  </form>
                  <form action={removeKey}>
                    <input type="hidden" name="provider" value={provider} />
                    <SubmitButton
                      variant="danger"
                      pendingText="Removing…"
                      confirm={`Remove ${LLM_PROVIDER_NAMES[provider]}'s API key?${
                        chosenProvider === provider ? " It's the chosen LLM, so you'll need to choose another." : ""
                      }`}
                    >
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {notAdded.length > 0 && (
        <form action={saveKey} className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
          <select name="provider" aria-label="Provider" required className={inputClass}>
            {notAdded.map((provider) => (
              <option key={provider} value={provider}>
                {LLM_PROVIDER_NAMES[provider]}
              </option>
            ))}
          </select>
          <KeyInput label="API key" />
          <SubmitButton variant="secondary" pendingText="Checking…">
            Add provider
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
