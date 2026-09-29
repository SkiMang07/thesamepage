import type { SupabaseClient } from "@supabase/supabase-js";

// Where a manager lands after signing in, when the link didn't ask for a
// specific page. Zero direct reports means first run: /app/start asks who the
// next 1:1 is with instead of opening an empty Mission Control
// (docs/ONBOARDING_SCOPING.md). Counted through the manager's own session, so
// RLS applies and no service role is involved. Any failure falls back to the
// dashboard, which redirects to /app/start itself when its brief is empty.
export async function landingPath(supabase: SupabaseClient): Promise<string> {
  try {
    const { count, error } = await supabase
      .from("direct_reports")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null);
    if (error) return "/app/dashboard";
    return count === 0 ? "/app/start" : "/app/dashboard";
  } catch {
    return "/app/dashboard";
  }
}

// `next` comes from the link URL, so anyone can put anything in it. Only an
// in-app path under /app/ is honoured. A double slash or a backslash is
// refused too, since browsers read both as protocol-relative.
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/app/") || raw.includes("\\") || raw.includes("//")) {
    return null;
  }
  return raw;
}
