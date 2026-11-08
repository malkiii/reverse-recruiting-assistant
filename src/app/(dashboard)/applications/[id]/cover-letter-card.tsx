"use client";

import { useState } from "react";
import { buttonClass } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { inputClass } from "@/components/ui";
import { splitPlaceholders } from "@/lib/cover-letter-placeholders";
import type { DriveFile } from "@/lib/gateways";

/** The Cover Letter, read-only until the Admin taps Edit while it's In Review, which swaps in the form in place. */
export function CoverLetterCard({
  applicationId,
  subject,
  coverLetter,
  resumeFileId,
  resumes,
  editable,
  save,
}: {
  applicationId: number;
  subject: string;
  coverLetter: string;
  resumeFileId: string | null;
  resumes: DriveFile[];
  editable: boolean;
  save: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="text-sm font-semibold">Cover Letter</h2>
        {!editing && (
          <div className="flex gap-1">
            <CopyButton text={coverLetter} label="Copy the Cover Letter">
              Copy
            </CopyButton>
            {editable && (
              <button type="button" onClick={() => setEditing(true)} className={buttonClass("ghost")}>
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <form action={save} className="space-y-4 px-4 py-4">
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="currentResumeFileId" value={resumeFileId ?? ""} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Resume</span>
            <select name="resumeFileId" defaultValue={resumeFileId ?? undefined} className={inputClass}>
              {resumes.map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Subject</span>
            <input name="subject" defaultValue={subject} required className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Cover Letter</span>
            <textarea
              name="coverLetter"
              defaultValue={coverLetter}
              required
              rows={14}
              className={`${inputClass} font-mono leading-relaxed`}
            />
          </label>
          <p className="text-xs text-muted">
            Keep <code className="rounded bg-subtle px-1">{"{{name}}"}</code> in the first line and
            end with <code className="rounded bg-subtle px-1">{"{{resume_link}}"}</code>.
          </p>
          <div className="flex gap-2">
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
            <button type="button" onClick={() => setEditing(false)} className={buttonClass("secondary")}>
              Discard
            </button>
          </div>
        </form>
      ) : (
        <div className="px-4 py-4">
          <p className="text-xs font-medium text-muted">Subject</p>
          <p className="mb-4 font-medium">{subject}</p>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {splitPlaceholders(coverLetter).map(({ text, placeholder }, index) =>
              placeholder ? (
                <mark key={index} className="rounded-xs bg-accent-soft px-0.5 font-mono text-[0.9em] text-accent">
                  {text}
                </mark>
              ) : (
                text
              ),
            )}
          </div>
        </div>
      )}
    </section>
  );
}
