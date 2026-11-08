import type { ApplicationStatus, DriveFile } from "./gateways";

const PDF = "application/pdf";
const RESUME_NAME = /(resume|cv)(\.pdf)?$/i;

/** The Resumes among the Resume Folder's files: PDFs whose names end in "resume" or "CV", in any case. */
export function resumesIn(files: DriveFile[]) {
  return files.filter(({ name, mimeType }) => mimeType === PDF && RESUME_NAME.test(name.trim()));
}

export type ResumeUsage = { applications: number; sent: number };

/** How many Applications use each Resume, by its file ID, and how many of them were Sent. */
export function resumeUsage(applications: { resumeFileId: string | null; status: ApplicationStatus }[]) {
  const usage = new Map<string, ResumeUsage>();
  for (const { resumeFileId, status } of applications) {
    if (!resumeFileId) continue;
    const counts = usage.get(resumeFileId) ?? { applications: 0, sent: 0 };
    usage.set(resumeFileId, { applications: counts.applications + 1, sent: counts.sent + (status === "sent" ? 1 : 0) });
  }
  return usage;
}
