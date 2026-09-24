"use client";

// Error boundary for every authenticated page (N-7). Renders inside
// app/app/layout.tsx, so the sidebar, top bar and Scribe stay usable and the
// manager always has a way back. Without this, a thrown render error showed
// Next's unbranded white "Application error" page with no navigation.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, EYEBROW } from "@/lib/tokens";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // This boundary catches the error before any global handler sees it, so
    // it has to report to Sentry itself.
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <PageShell maxWidth="3xl">
      <section className={`${CARD} p-6`} role="alert">
        <p className={EYEBROW}>Something went wrong</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">This page couldn’t be shown.</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Nothing you saved has been lost. Try again, or head back to Mission Control.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={reset} className={BTN_PRIMARY}>
            Try again
          </button>
          <Link href="/app/dashboard" className={BTN_SECONDARY}>
            Back to Mission Control
          </Link>
        </div>
        {error.digest && <p className="mt-4 text-xs text-ink-muted">Reference: {error.digest}</p>}
      </section>
    </PageShell>
  );
}
