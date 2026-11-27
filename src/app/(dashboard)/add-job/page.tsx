// Adds a Job the Admin found on the web from its URL, and Prepares it.
import { PageHeader } from "@/components/ui";
import { AddJobForm } from "./add-job-form";

// Reading a Job page takes a Firecrawl scrape of up to 2 minutes, then an LLM request.
export const maxDuration = 300;

export default function AddJobPage() {
  return (
    <>
      <PageHeader title="Add Job" subtitle="Prepare a Job you found on the web, from its public URL" />
      <AddJobForm />
    </>
  );
}
