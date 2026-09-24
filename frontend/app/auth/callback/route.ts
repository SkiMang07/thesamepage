import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

const DEFAULT_NEXT = "/app/dashboard";

// `next` comes from the magic-link URL, so anyone can put anything in it.
// Only an in-app path under /app/ is honoured; anything else falls back to the
// dashboard. A double slash or a backslash is refused too, since browsers read
// both as protocol-relative, so the check doesn't rely on the `origin` prefix
// the redirect below happens to add.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/app/") || raw.includes("\\") || raw.includes("//")) {
    return DEFAULT_NEXT;
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Code missing or exchange failed — back to login with an error flag
  return NextResponse.redirect(`${origin}/app/login?error=auth_failed`);
}
