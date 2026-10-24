"use client";

// Minimal IC landing page (Team Mission Control, Session 22) — the "auth
// primitives now, IC view later" scoping call: this session builds the
// account/claim mechanism (invite -> magic link -> direct_reports.user_id
// set, see frontend/app/invite/[token]/page.tsx and
// accept_direct_report_invite() in schema.sql), not the IC-facing Mission
// Control view itself. This page exists only so a freshly-claimed account
// has somewhere to land instead of hitting the manager dashboard (which
// would just render confusingly empty for someone who isn't a manager).
// Replace with a real IC view in a follow-up session.
//
// It does list the report's own 1:1 transcripts (call transcription session
// 4): read-only, and only once each call has ended (RLS, through
// call_transcript_ids_for_report()). No notification goes with them.
//
// Protected by middleware.ts like every other /app/* route — an
// unauthenticated visitor never reaches here.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { acceptInvite, listCallTranscripts, type CallTranscript } from "@/lib/api";

function ICLanding() {
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const [status, setStatus] = useState<"pending" | "done" | "error">(invite ? "pending" : "done");
  const [error, setError] = useState<string | null>(null);

  const [transcripts, setTranscripts] = useState<CallTranscript[] | null>(null);
  useEffect(() => {
    if (status !== "done") return;
    listCallTranscripts()
      .then(({ transcripts }) => setTranscripts(transcripts.filter((t) => t.viewer === "report" && t.meeting_type === "one_on_one")))
      .catch(() => setTranscripts([]));
  }, [status]);

  useEffect(() => {
    if (!invite) return;
    acceptInvite(invite)
      .then(() => setStatus("done"))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to accept invite");
        setStatus("error");
      });
  }, [invite]);

  return (
    <main className="mx-auto max-w-sm px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re logged in</h1>
      {status === "pending" && <p className="mt-4 text-ink-secondary">Setting up your account…</p>}
      {status === "error" && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {status === "done" && (
        <p className="mt-4 text-ink-secondary">
          Your manager will be adding more here soon. There&apos;s nothing to do on your end yet.
        </p>
      )}
      {transcripts && transcripts.length > 0 && (
        <section aria-labelledby="ic-transcripts" className="mt-12 text-left">
          <h2 id="ic-transcripts" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Your 1:1 transcripts
          </h2>
          <ul className="mt-3 divide-y divide-divider rounded-xl border border-hairline">
            {transcripts.map((t) => (
              <li key={t.id}>
                <Link href={`/app/ic/transcripts/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-sunken">
                  <span className="text-ink">
                    1:1 with {t.manager_first_name || "your manager"}
                  </span>
                  <span className="text-ink-muted">
                    {new Date(t.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">Machine transcripts, read only. They appear once a call has ended.</p>
        </section>
      )}
    </main>
  );
}

export default function ICLandingPage() {
  return (
    <Suspense>
      <ICLanding />
    </Suspense>
  );
}
