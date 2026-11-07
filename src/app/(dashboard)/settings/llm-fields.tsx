"use client";

import { useState } from "react";
import { inputClass, labelClass } from "@/components/ui";
import type { LlmProvider } from "@/lib/schema";

/** The provider select, offering only providers whose models were listed with their API key, and their model select. */
export function LlmFields({
  providerNames,
  models,
  withKeys,
  provider: savedProvider,
  model: savedModel,
}: {
  providerNames: Record<LlmProvider, string>;
  /** The models each usable provider's API key may use. A provider missing here can't be chosen. */
  models: Partial<Record<LlmProvider, string[]>>;
  /** The providers the Admin added an API key for. */
  withKeys: LlmProvider[];
  provider?: LlmProvider;
  model?: string;
}) {
  const providers = Object.keys(providerNames) as LlmProvider[];
  // The saved provider stays choosable while its models can't be listed, so saving doesn't silently switch it.
  const selectable = (option: LlmProvider) => Boolean(models[option]) || (option === savedProvider && withKeys.includes(option));
  const startModel = (option: LlmProvider | undefined) =>
    option === undefined ? "" : option === savedProvider && savedModel ? savedModel : (models[option]?.[0] ?? "");
  const initialProvider = savedProvider && selectable(savedProvider) ? savedProvider : providers.find(selectable);
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(startModel(initialProvider));

  function chooseProvider(next: LlmProvider) {
    setProvider(next);
    // Another provider's model would fail, so switch to the new provider's saved or first model.
    if (!models[next]?.includes(model)) setModel(startModel(next));
  }

  const listed = (provider && models[provider]) || [];
  // A saved model the key no longer lists stays choosable, so saving doesn't silently change it.
  const modelOptions = !model || listed.includes(model) ? listed : [model, ...listed];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className={labelClass}>Provider</span>
        <select
          name="provider"
          value={provider ?? ""}
          onChange={(event) => chooseProvider(event.target.value as LlmProvider)}
          required
          className={inputClass}
        >
          {!provider && (
            <option value="" disabled>
              No usable provider
            </option>
          )}
          {providers.map((option) => (
            <option key={option} value={option} disabled={!selectable(option)}>
              {providerNames[option] + (!withKeys.includes(option) ? " (no API key)" : models[option] ? "" : " (models unavailable)")}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>Model</span>
        <select name="model" value={model} onChange={(event) => setModel(event.target.value)} required className={inputClass}>
          {modelOptions.length === 0 && <option value="">No usable model</option>}
          {modelOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
