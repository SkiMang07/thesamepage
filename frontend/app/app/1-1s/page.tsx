"use client";

// /app/1-1s — the front door for the 1:1 loop (nav rework pass 2, Session 38,
// 2026-08-16). See docs/ONE_ON_ONES_PAGE_SPEC.md — this page answers one
// question: who do I owe a conversation, and what's already in flight?
//
// Owns the 1:1 loop end to end: due now, scheduled/prepared, and recently
// wrapped, all sourced from the single GET /api/one-on-ones/overview call
// (the canonical is_due/cadence computation — see backend/utils.py's
// resolve_cadence_days()). This page does no staleness math of its own,
// only ordering/filtering of fields the API already resolved.
//
// Session 56 white-space audit — entrance gap now uses the shared
// SECTION_GAP token (components/ZoneMap.tsx); the space-y-10 between the
// 3 sections (Due now / Prepped / Recently wrapped) is left as-is, same
// reasoning as team/page.tsx.
//
// Page actions remain triage + start/resume prep. Scheduling/repeat settings
// live inside prep; off-platform logging, bulk actions, search, and provider
// calendar sync do not belong on this overview.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CadenceSource, OneOnOneOverviewItem, getOneOnOnesOverview } from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Same honesty convention Capacity uses for logged-vs-assumed hours (spec
// section 3) — say which source resolved this person's cadence. Duplicated
// locally rather than shared, matching this app's established "minimal
// local copies" convention for small per-page helpers (see
// dashboard/page.tsx's period-helper comment).
function cadenceSourceLabel(days: number, source: CadenceSource) {
  if (source === "custom") return `every ${days} days (custom)`;
  if (source === "org") return `every ${days} days (org default)`;
  return `every ${days} days (default)`;
}

export default function OneOnOnesPage() {
  const [items, setItems] = useState<OneOnOneOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOneOnOnesOverview()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Due now — worst first (longest gap at top), never-met sorts as the
  // worst case. Ordering only; is_due/days_since_last are already resolved
  // server-side.
  const dueNow = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.is_due &&
            (i.planned_session === null || i.planned_session.status === "gathering")
        )
        .sort((a, b) => {
          const aGap = a.days_since_last ?? Number.POSITIVE_INFINITY;
          const bGap = b.days_since_last ?? Number.POSITIVE_INFINITY;
          return bGap - aGap;
        }),
    [items]
  );

  const inFlight = useMemo(
    () =>
      items.filter(
        (i) => i.planned_session !== null && i.planned_session.status !== "gathering"
      ),
    [items]
  );

  const recentlyWrapped = useMemo(
    () =>
      items
        .filter((i) => i.last_completed !== null)
        .sort((a, b) => (a.last_completed!.date < b.last_completed!.date ? 1 : -1))
        .slice(0, 5),
    [items]
  );

  if (loading) return <p className="p-8 text-ink-secondary">Loading...</p>;
  if (error) return <p className="p-8 text-red-700">{error}</p>;

  return (
    <PageShell maxWidth="3xl">
      <h1 className="text-2xl font-semibold">1:1s</h1>
      <p className="mt-1 text-sm text-ink-secondary">Who you owe a conversation, and what&apos;s already in flight.</p>

      {items.length === 0 ? (
        <p className={`${SECTION_GAP} text-ink-secondary`}>
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-ink-body">
            Add your first one from your dashboard
          </Link>
          .
        </p>
      ) : (
        <div className={`${SECTION_GAP} space-y-10`}>
          {/* Due now */}
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
              Due now{dueNow.length > 0 && ` (${dueNow.length})`}
            </h2>
            {dueNow.length === 0 ? (
              <p className="mt-3 text-sm text-ink-secondary">
                You&apos;re all caught up — nobody&apos;s due for a 1:1 right now. 🎯
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-divider rounded-xl border border-hairline bg-surface">
                {dueNow.map((r) => {
                  const badlyOverdue = r.days_since_last === null || r.days_since_last > r.cadence_days * 2;
                  return (
                    <li key={r.direct_report_id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                            badlyOverdue ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {initialsOf(r.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                          <p className={`mt-0.5 text-xs ${badlyOverdue ? "text-red-700" : "text-amber-700"}`}>
                            {r.days_since_last === null ? "Never met" : `${r.days_since_last} days since last 1:1`}
                            {" · "}
                            {cadenceSourceLabel(r.cadence_days, r.cadence_source)}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={
                          r.planned_session?.status === "planned"
                            ? `/app/reports/${r.direct_report_id}/prep?resume=${r.planned_session.id}`
                            : `/app/reports/${r.direct_report_id}/prep`
                        }
                        className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-hover"
                      >
                        Review →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Scheduled or prepped, not yet run */}
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
              Upcoming 1:1s{inFlight.length > 0 && ` (${inFlight.length})`}
            </h2>
            {inFlight.length === 0 ? (
              <p className="mt-3 text-sm text-ink-secondary">No meetings scheduled or prepped yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-divider rounded-xl border border-hairline bg-surface">
                {inFlight.map((r) => (
                  <li key={r.direct_report_id}>
                    <Link
                      href={
                        r.planned_session!.status === "planned"
                          ? `/app/reports/${r.direct_report_id}/prep?resume=${r.planned_session!.id}`
                          : `/app/reports/${r.direct_report_id}/prep`
                      }
                      className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-canvas"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {r.planned_session!.scheduled_at && `${formatDate(r.planned_session!.scheduled_at)} · `}
                          {r.planned_session!.status === "planned"
                            ? r.planned_session!.display_summary || "Prep sheet ready"
                            : r.planned_session!.recurrence_weeks
                              ? `Repeats every ${r.planned_session!.recurrence_weeks} week${r.planned_session!.recurrence_weeks === 1 ? "" : "s"}`
                              : "Scheduled — prep when you’re ready"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {r.planned_session!.status === "planned" ? "Start →" : "Review →"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recently wrapped */}
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
              Recently wrapped{recentlyWrapped.length > 0 && ` (${recentlyWrapped.length})`}
            </h2>
            {recentlyWrapped.length === 0 ? (
              <p className="mt-3 text-sm text-ink-secondary">Nothing logged yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-divider rounded-xl border border-hairline bg-surface">
                {recentlyWrapped.map((r) => (
                  <li key={r.direct_report_id}>
                    <Link
                      href={`/app/reports/${r.direct_report_id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-canvas"
                    >
                      <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                      <p className="shrink-0 text-xs text-ink-muted">
                        {formatDate(r.last_completed!.date)}
                        {r.last_completed!.commitment_count > 0 &&
                          ` · ${r.last_completed!.commitment_count} commitment${
                            r.last_completed!.commitment_count === 1 ? "" : "s"
                          }`}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
