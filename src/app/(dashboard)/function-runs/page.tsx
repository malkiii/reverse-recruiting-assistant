import { redirect } from "next/navigation";

/** Function runs moved to Activity. Kept for links in earlier Failure Alerts. */
export default function FunctionRunsPage() {
  redirect("/activity?kind=function");
}
