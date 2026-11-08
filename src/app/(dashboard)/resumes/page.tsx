import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { buttonClass } from "@/components/button";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, CardBody, CardHeader, ExternalLink, inputClass, labelClass, PageHeader, Tag } from "@/components/ui";
import { loadApplications } from "@/lib/dashboard-data";
import { dashboardGoogle } from "@/lib/dashboard-google";
import { parseDashboardEnv } from "@/lib/env";
import type { DriveFile, DriveFolder, DriveGateway } from "@/lib/gateways";
import { GoogleConnectionError } from "@/lib/google-connection";
import { type ResumeUsage, resumesIn, resumeUsage } from "@/lib/resumes";

async function chooseFolder(formData: FormData) {
  "use server";

  const google = dashboardGoogle();
  const id = String(formData.get("folderId"));
  // Looked up again rather than trusted from the form, so only one of the Admin's folders can be saved.
  const drive = await google.drive();
  const folder = (await drive.listFolders()).find((folder) => folder.id === id);
  if (!folder) throw new Error(`Not one of your Drive folders: ${id}`);
  await google.resumeFolder.save(folder);
  redirect("/resumes");
}

function FolderChooser({ folders, current }: { folders: DriveFolder[]; current?: DriveFolder }) {
  if (folders.length === 0)
    return <Alert tone="warning">Your Google Drive has no folders. Create one for your Resumes first.</Alert>;
  return (
    <form action={chooseFolder} className="space-y-3">
      <label className="block">
        <span className={labelClass}>Resume Folder</span>
        <select name="folderId" defaultValue={current?.id} required className={inputClass}>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
        {current && (
          <Link href="/resumes" className={buttonClass("ghost")}>
            Keep {current.name}
          </Link>
        )}
      </div>
    </form>
  );
}

async function ResumeFolder({ drive, folder }: { drive: DriveGateway; folder: DriveFolder }) {
  const { DATABASE_URL } = parseDashboardEnv(process.env);
  const [files, shared, applications] = await Promise.all([
    drive.listFiles(folder.id),
    drive.isSharedByLink(folder.id),
    loadApplications(DATABASE_URL, new Date()),
  ]);
  const resumes = resumesIn(files);
  const others = files.filter((file) => !resumes.includes(file));
  const usage = resumeUsage(applications.map(({ application }) => application));

  return (
    <>
      <Card>
        <CardHeader
          title={<>Resume Folder: {folder.name}</>}
          action={
            <Link href="/resumes?change=1" className={buttonClass("ghost")}>
              Change
            </Link>
          }
        />
        <CardBody className="space-y-3">
          {!shared && (
            <Alert tone="warning">
              This folder isn&apos;t shared as &quot;Anyone with the link&quot;, so recipients can&apos;t open your
              Resume links. Share it in Google Drive.
            </Alert>
          )}
          <p className="text-sm text-muted">
            Resumes are PDFs whose names end in &quot;resume&quot; or &quot;CV&quot;, in any case.
          </p>
        </CardBody>
        <FileList files={resumes} usage={usage} empty="No Resumes in this folder." />
      </Card>
      {others.length > 0 && (
        <Card>
          <CardHeader title="Other files" />
          <CardBody>
            <p className="text-sm text-muted">These aren&apos;t Resumes, so they&apos;re never sent.</p>
          </CardBody>
          <FileList files={others} empty="" />
        </Card>
      )}
    </>
  );
}

function FileList({ files, usage, empty }: { files: DriveFile[]; usage?: Map<string, ResumeUsage>; empty: string }) {
  if (files.length === 0) return empty ? <p className="px-4 pb-4 text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="divide-y divide-line border-t border-line">
      {files.map((file) => {
        const used = usage?.get(file.id);
        return (
          <li key={file.id} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
            <ExternalLink href={file.webViewLink} className="min-w-0 flex-1 truncate text-sm font-medium">
              {file.name}
            </ExternalLink>
            {usage && (
              <span className="flex shrink-0 gap-1.5">
                <Tag>
                  {used?.applications ?? 0} Application{used?.applications === 1 ? "" : "s"}
                </Tag>
                {used && used.sent > 0 && <Tag tone="emerald">{used.sent} Sent</Tag>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default async function ResumesPage({ searchParams }: { searchParams: Promise<{ change?: string }> }) {
  await connection();
  const { change } = await searchParams;
  const google = dashboardGoogle();

  let drive: DriveGateway | undefined;
  let connectionProblem: string | undefined;
  try {
    drive = await google.drive();
  } catch (problem) {
    if (!(problem instanceof GoogleConnectionError)) throw problem;
    connectionProblem = problem.message;
  }
  const folder = await google.resumeFolder.get();

  return (
    <div className="space-y-4">
      <PageHeader title="Resumes" subtitle="The Resumes in your Resume Folder, and how many Applications used each" />
      {!drive ? (
        <Card>
          <CardBody className="space-y-3">
            {connectionProblem && <Alert tone="warning">{connectionProblem}</Alert>}
            <p className="text-sm">The agent reads your Resumes from one Google Drive folder. Connect Google first.</p>
            <a href="/google/connect" className={buttonClass("primary")}>
              Connect Google
            </a>
          </CardBody>
        </Card>
      ) : !folder || change ? (
        <Card>
          <CardHeader title="Choose your Resume Folder" />
          <CardBody>
            <p className="mb-3 text-sm text-muted">Choose the Google Drive folder that holds your Resumes.</p>
            <FolderChooser folders={await drive.listFolders()} current={folder} />
          </CardBody>
        </Card>
      ) : (
        <ResumeFolder drive={drive} folder={folder} />
      )}
    </div>
  );
}
