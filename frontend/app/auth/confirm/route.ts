import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createRouteClient } from "@/lib/supabase-route";
import { landingPath, safeNext } from "@/lib/auth-landing";

// Sign-in and sign-up links (docs/auth-emails). verifyOtp with the token hash
// needs no code verifier, so the link works in any browser: asked for on a
// laptop, opened on a phone. The email templates link here as
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
const TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && rawType && TYPES.has(rawType)) {
    const supabase = await createRouteClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: rawType });
    if (!error) {
      return NextResponse.redirect(`${origin}${next ?? (await landingPath(supabase))}`);
    }
  }

  return NextResponse.redirect(`${origin}/app/login?error=link`);
}
