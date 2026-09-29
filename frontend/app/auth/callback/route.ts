import { NextResponse, type NextRequest } from "next/server";
import { createRouteClient } from "@/lib/supabase-route";
import { landingPath, safeNext } from "@/lib/auth-landing";

// The PKCE code flow. The code only exchanges in the browser that asked for
// it, so a sign-in link opened on another device fails here. Sign-in and
// sign-up emails now link to /auth/confirm instead (any device); this route
// stays for invites and anything else still on the code flow.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createRouteClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next ?? (await landingPath(supabase))}`);
    }
  }

  return NextResponse.redirect(`${origin}/app/login?error=auth_failed`);
}
