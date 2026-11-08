import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { CALLBACK_PATH, OAUTH_STATE_COOKIE, dashboardGoogle } from "@/lib/dashboard-google";
import { connectGoogle } from "@/lib/google-connection";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const backToGooglePage = (error?: string) => {
    const url = new URL("/google", origin);
    if (error) url.searchParams.set("error", error);
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: CALLBACK_PATH });
    return response;
  };

  const state = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !safeEqual(state, searchParams.get("state") ?? "")) return backToGooglePage("The sign-in expired. Try again.");
  const code = searchParams.get("code");
  if (!code) return backToGooglePage(`Google sign-in was cancelled: ${searchParams.get("error") ?? "no code"}`);

  try {
    await connectGoogle(dashboardGoogle().connection, code, new URL(CALLBACK_PATH, origin).toString());
  } catch (error) {
    return backToGooglePage(error instanceof Error ? error.message : String(error));
  }
  // On first entry, the Resume Folder is chosen next.
  if (!(await dashboardGoogle().resumeFolder.get())) {
    const response = NextResponse.redirect(new URL("/resumes", origin));
    response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: CALLBACK_PATH });
    return response;
  }
  return backToGooglePage();
}
