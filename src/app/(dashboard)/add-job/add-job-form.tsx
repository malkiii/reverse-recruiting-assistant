"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, CardBody, CardHeader, inputClass, labelClass } from "@/components/ui";
import { type ReadState, readJobPageAction, type SaveState, saveJobAction } from "./actions";
import type { JobDraft } from "@/lib/manual-job";

function Field({ name, label, draft, type = "text", required }: {
  name: Exclude<keyof JobDraft, "url" | "description">;
  label: string;
  draft: JobDraft;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
      </label>
      <input id={name} name={name} type={type} required={required} defaultValue={draft[name]} className={inputClass} />
    </div>
  );
}

function ReviewForm({ draft }: { draft: JobDraft }) {
  const [state, action] = useActionState<SaveState, FormData>(saveJobAction, {});
  return (
    <Card>
      <CardHeader title="Check the Job" />
      <CardBody>
        <form action={action} className="space-y-4">
          {state.error && <Alert>{state.error}</Alert>}
          <input type="hidden" name="url" value={draft.url} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="title" label="Title" draft={draft} required />
            <Field name="companyName" label="Company" draft={draft} required />
            <Field name="location" label="Location" draft={draft} />
            <Field name="postDay" label="Post day" draft={draft} type="date" required />
          </div>
          <Field name="companyLinkedinUrl" label="Company LinkedIn URL (optional)" draft={draft} type="url" />
          <div>
            <label htmlFor="description" className={labelClass}>
              Description
            </label>
            <textarea
              id="description"
              name="description"
              required
              rows={12}
              defaultValue={draft.description}
              className={`${inputClass} font-mono text-xs sm:text-xs`}
            />
          </div>
          <SubmitButton pendingText="Preparing…">Save and Prepare</SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}

/** Reads a Job page the Admin found, lets them check what was read, then saves and Prepares it. */
export function AddJobForm() {
  const [state, action] = useActionState<ReadState, FormData>(readJobPageAction, { url: "" });
  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="url" className={labelClass}>
                Job page URL
              </label>
              <input
                id="url"
                type="url"
                name="url"
                required
                defaultValue={state.url}
                placeholder="https://jobs.example.com/senior-engineer"
                className={inputClass}
              />
            </div>
            <SubmitButton pendingText="Reading…">Read the Job page</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-faint">
            A URL that&apos;s already a saved Job opens its Application, or Prepares it when it has none.
          </p>
        </CardBody>
      </Card>
      {state.error && <Alert>{state.error}</Alert>}
      {state.draft && <ReviewForm key={state.draft.url} draft={state.draft} />}
    </div>
  );
}
