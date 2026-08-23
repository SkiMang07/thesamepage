"use client";

// Public invite-acceptance page (Team Mission Control, Session 22) — NOT
// under /app, so middleware.ts's auth gate (matcher: /app/:path*) doesn't
// apply. A report lands here before they have any account at all.
//
// Reuses the exact same passwordless magic-link flow /app/login already
// uses (supabase.auth.signInWithOtp) rather than inventing a password
// signup — the only addition is an emailRedirectTo `next` param that routes
// /auth/callback straight to /app/ic with the invite token attached, so
// that page can call POST /api/invites/{token}/accept once the session
// exists. /auth/callback/route.ts needed no changes for this — it already
// supports a `next` query param.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { InvitePreview, getInvitePreview } from "@/lib/api";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getInvitePreview(token)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load invite"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSignIn() {
    if (!preview || sending) return;
    setSending(true);
    setError(null);
    const supabase = createClient();
    const next = encodeURIComponent(`/app/ic?invite=${token}`);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: preview.invited_email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}`,
      },
    });
    if (authError) {
      setError(authError.message);
    } else {
      setSent(true);
    }
    setSending(false);
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">You&apos;ve been invited</h1>

      {loading ? (
        <p className="mt-8 text-ink-secondary">Loading...</p>
      ) : error ? (
        <p className="mt-8 text-sm text-red-700">{error}</p>
      ) : sent ? (
        <div className="mt-8">
          <p className="text-ink-body">
            Check <strong>{preview?.invited_email}</strong> for a login link. It expires in 1 hour.
          </p>
        </div>
      ) : (
        preview && (
          <div className="mt-8">
            <p className="text-ink-secondary">
              {preview.manager_name ? `${preview.manager_name} has` : "Your manager has"} invited{" "}
              <strong>{preview.report_name}</strong> to The Same Page.
            </p>
            <button
              onClick={handleSignIn}
              disabled={sending}
              className="mt-6 w-full rounded-md bg-brand px-4 py-2 text-white disabled:opacity-40"
            >
              {sending ? "Sending…" : `Send login link to ${preview.invited_email}`}
            </button>
          </div>
        )
      )}
    </main>
  );
}
