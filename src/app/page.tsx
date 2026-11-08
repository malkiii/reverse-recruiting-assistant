import { redirect } from "next/navigation";
import { connection } from "next/server";
import { dashboardGoogle } from "@/lib/dashboard-google";

export default async function Home() {
  await connection();
  // On first entry, the Admin connects Google and chooses the Resume Folder before anything else.
  const folder = await dashboardGoogle().resumeFolder.get();
  redirect(folder ? "/jobs" : "/resumes");
}
