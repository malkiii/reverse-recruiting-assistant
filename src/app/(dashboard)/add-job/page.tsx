// Adds a Job the Admin found on the web from its URL, and Prepares it.
import { connection } from "next/server";
import { Alert, PageHeader } from "@/components/ui";
import { parseDashboardEnv } from "@/lib/env";
import { AddJobForm } from "./add-job-form";

// Reading a Job page takes a Firecrawl scrape of up to 2 minutes, then an LLM request.
export const maxDuration = 300;

export default async function AddJobPage() {
  await connection();
  const { FIRECRAWL_API_KEY } = parseDashboardEnv(process.env);
  return (
    <>
      <PageHeader title="Add Job" subtitle="Prepare a Job you found on the web, from its public URL" />
      {!FIRECRAWL_API_KEY && (
        <div className="mb-4">
          <Alert tone="warning">Add FIRECRAWL_API_KEY to the dashboard&apos;s environment to read Job pages.</Alert>
        </div>
      )}
      <AddJobForm />
    </>
  );
}
