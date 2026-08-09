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
// Protected by middleware.ts like every other /app/* route — an
// unauthenticated visitor never reaches here.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { acceptInvite } from "@/lib/api";

function ICLanding() {
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const [status, setStatus] = useState<"pending" | "done" | "error">(invite ? "pending" : "done");
  const [error, setError] = useState<string | null>(null);

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
      {status === "pending" && <p className="mt-4 text-gray-500">Setting up your account…</p>}
      {status === "error" && <p className="mt-4 text-sm text-red-500">{error}</p>}
      {status === "done" && (
        <p className="mt-4 text-gray-500">
          Your manager will be adding more here soon. There&apos;s nothing to do on your end yet.
        </p>
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
