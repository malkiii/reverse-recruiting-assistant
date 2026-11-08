import Link from "next/link";
import { connection } from "next/server";
import { buttonClass } from "@/components/button";
import { Alert, Card, CardBody, linkClass, PageHeader } from "@/components/ui";
import { dashboardGoogle } from "@/lib/dashboard-google";
import { GoogleConnectionError } from "@/lib/google-connection";

export default async function GooglePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const { error } = await searchParams;
  const google = dashboardGoogle();

  let connected = false;
  let connectionProblem: string | undefined;
  try {
    await google.drive();
    connected = true;
  } catch (problem) {
    if (!(problem instanceof GoogleConnectionError)) throw problem;
    connectionProblem = problem.message;
  }
  const folder = await google.resumeFolder.get();

  return (
    <div className="space-y-4">
      <Link href="/settings" className="inline-flex min-h-9 items-center text-sm text-muted hover:text-fg">
        ‹ Settings
      </Link>
      <PageHeader title="Google" />
      {error && <Alert>{error}</Alert>}

      {!connected ? (
        <Card>
          <CardBody className="space-y-3">
            {connectionProblem && <Alert tone="warning">{connectionProblem}</Alert>}
            <p className="text-sm">
              The agent sends Applications from your Gmail and reads your Resumes from one Google Drive folder.
            </p>
            <a href="/google/connect" className={buttonClass("primary")}>
              Connect Google
            </a>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardBody className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" /> Google is connected
              </p>
              <a href="/google/connect" className={buttonClass("ghost")}>
                Reconnect
              </a>
            </CardBody>
          </Card>
          {folder ? (
            <p className="text-sm text-muted">
              Your Resume Folder is {folder.name}. Manage it on{" "}
              <Link href="/resumes" className={linkClass}>
                Resumes
              </Link>
              .
            </p>
          ) : (
            <Alert tone="warning">
              No Resume Folder is chosen yet.{" "}
              <Link href="/resumes" className={linkClass}>
                Choose one on Resumes
              </Link>
              .
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
