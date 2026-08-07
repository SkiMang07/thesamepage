"use client";

// Mission Control v2 — grid layout (Session 19; scoped after reviewing a
// static HTML mockup with Andrew — see docs/SESSION_HISTORY.md and the
// mission_control_grid project memory note). Restructures Session 18's
// single-column stack into 3 columns across the top (Individual
// Performance / Goals / Key Initiatives) + a full-width Capacity strip
// below, adds a stat ribbon, a real AI insight banner, worst-first sorting
// on Individual Performance, and a "quick add" modal.
//
// Scope locked with Andrew before building:
//   - AI insight is real AI-generated (new GET /api/dashboard/insight,
//     backend/routes/dashboard.py) — not a rule-based string. The model is
//     told to return null when nothing crosses a real threshold, and the
//     banner simply doesn't render on days with nothing noteworthy.
//   - Quick add is a single modal (type picker + minimal form), not a
//     global ⌘K command palette. No new dependency.
//   - Individual Performance's status is still only the binary the data
//     actually supports (due for a 1:1, or not) plus a raw commitment
//     count — NOT a synthesized 3-tier on-track/needs-check-in/at-risk
//     status. The reviewed mockup used 3 tiers for visual variety, but
//     building that for real would mean inventing a status the data
//     doesn't back — this app has consistently avoided that (see
//     Assessments' "leave unscored rather than force coverage", Session 16).
//
// Still four client-side merges of existing endpoints, same as Session 18
// — the only new backend route is the insight endpoint. No new dependency;
// no schema changes.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QuickAddModal from "@/components/QuickAddModal";
import {
  CapacityOverviewItem,
  DashboardInsight,
  Goal,
  GoalLevel,
  GoalStatus,
  Project,
  TeamAssessmentItem,
  TeamOverviewItem,
  getCapacityOverview,
  getDashboardInsight,
  getGoals,
  getProjects,
  getTeamAssessments,
  getTeamOverview,
} from "@/lib/api";

// Matches the prep prompt's cadence logic in one_on_ones.py — past 21 days
// we stop assuming last meeting's context still holds.
const CADENCE_DAYS = 21;

function daysSince(iso: string) {
  const then = new Date(iso).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

function lastOneOnOneLabel(iso: string | null) {
  if (!iso) return "No 1:1s yet";
  const d = daysSince(iso);
  if (d === 0) return "Last 1:1 today";
  if (d === 1) return "Last 1:1 yesterday";
  return `Last 1:1 ${d} days ago`;
}

function needsOneOnOne(lastOneOnOneAt: string | null) {
  if (!lastOneOnOneAt) return true;
  return daysSince(lastOneOnOneAt) > CADENCE_DAYS;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Goals and Projects share the same status enum/styles — same pattern
// already used on reports/[id]/page.tsx.
const STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<GoalStatus, string> = {
  active: "bg-gray-100 text-gray-600",
  on_track: "bg-green-50 text-green-600",
  at_risk: "bg-amber-50 text-amber-600",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-gray-100 text-gray-400",
};

// Organization / Department / Team Goals — the board's three top-of-
// hierarchy goal cards, collapsed into one Goals section here. Individual
// goals stay off Mission Control; they live on the report's own page.
const GOAL_CARD_LEVELS: { id: GoalLevel; label: string }[] = [
  { id: "company", label: "Organization" },
  { id: "department", label: "Department" },
  { id: "team", label: "Team" },
];

// Key Initiatives = projects still in flight. Completed/cancelled stay off
// this card — it's a status board, not an archive (full history is on
// /app/projects).
const ACTIVE_PROJECT_STATUSES = new Set<GoalStatus>(["active", "on_track", "at_risk"]);

// Minimal local copies of capacity/page.tsx's period helpers — Mission
// Control only ever needs "this week", so it doesn't need that page's full
// week/month/quarter picker.
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // Monday as the start
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Individual Performance row — getTeamOverview (1:1 cadence, open
// commitments) merged client-side with getTeamAssessments (latest rating)
// by direct_report_id. No new backend route for this.
type PerformanceRow = TeamOverviewItem & {
  latest_level_label: string | null;
  assessed_at: string | null;
};

const NAV_LINKS = [
  { href: "/app/assessments", label: "Assessments" },
  { href: "/app/goals", label: "Goals" },
  { href: "/app/projects", label: "Projects" },
  { href: "/app/capacity", label: "Capacity" },
  { href: "/app/org", label: "Org" },
  { href: "/app/settings", label: "Settings" },
];

export default function DashboardPage() {
  const [team, setTeam] = useState<PerformanceRow[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [capacity, setCapacity] = useState<CapacityOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [insight, setInsight] = useState<DashboardInsight | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const weekRange = useMemo(() => {
    const start = startOfWeek(new Date());
    return { start, end: addDays(start, 6) };
  }, []);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    return Promise.all([
      getTeamOverview(),
      getTeamAssessments(),
      getGoals(),
      getProjects(),
      getCapacityOverview(toISODate(weekRange.start), toISODate(weekRange.end)),
    ])
      .then(([overview, assessments, allGoals, allProjects, capacityRows]) => {
        const ratingByReport = new Map<string, TeamAssessmentItem>(assessments.map((a) => [a.id, a]));
        const merged: PerformanceRow[] = overview.map((r) => ({
          ...r,
          latest_level_label: ratingByReport.get(r.id)?.latest_level_label ?? null,
          assessed_at: ratingByReport.get(r.id)?.assessed_at ?? null,
        }));
        // Worst-first: due for a 1:1 sorts before everyone who isn't, then
        // by open commitment count within each group. This is the single
        // highest-leverage change in the grid redesign — a manager scanning
        // three columns should see problems before people who are fine.
        merged.sort((a, b) => {
          const aDue = needsOneOnOne(a.last_one_on_one_at) ? 0 : 1;
          const bDue = needsOneOnOne(b.last_one_on_one_at) ? 0 : 1;
          if (aDue !== bDue) return aDue - bDue;
          return b.open_commitment_count - a.open_commitment_count;
        });
        setTeam(merged);
        setGoals(allGoals.filter((g) => g.level !== "individual"));
        setProjects(allProjects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)));
        setCapacity(capacityRows);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [weekRange]);

  useEffect(() => {
    loadDashboard();
    // The insight call is separate and allowed to fail quietly — it's a
    // nice-to-have banner, not core dashboard data, and a bad AI call
    // shouldn't block or error out the rest of the page.
    getDashboardInsight()
      .then(setInsight)
      .catch(() => setInsight(null));
  }, [loadDashboard]);

  const dueCount = team.filter((r) => needsOneOnOne(r.last_one_on_one_at)).length;
  const atRiskGoalCount = goals.filter((g) => g.status === "at_risk").length;
  const totalAvailableHours = capacity.reduce((sum, c) => sum + c.available_hours, 0);
  const maxCapacityHours = Math.max(1, ...capacity.map((c) => c.available_hours));

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 sm:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mission Control</h1>
          <p className="mt-1 text-sm text-gray-500">Your team, at a glance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-gray-900">
              {l.label}
            </Link>
          ))}
          <button
            onClick={() => setQuickAddOpen(true)}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            + Quick add
          </button>
        </div>
      </div>

      {loadError && <p className="mt-4 text-sm text-red-500">{loadError}</p>}

      {/* Stat ribbon — answers "how's my team right now" before a single
          card is read. All four numbers come from data already fetched
          above; no extra endpoint. */}
      {!loading && team.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xl font-semibold text-gray-900">{team.length}</p>
            <p className="mt-0.5 text-xs text-gray-500">Direct reports</p>
          </div>
          <div className={`rounded-lg border px-4 py-3 ${dueCount > 0 ? "border-amber-200 bg-amber-50/60" : "border-gray-200 bg-white"}`}>
            <p className={`text-xl font-semibold ${dueCount > 0 ? "text-amber-700" : "text-gray-900"}`}>{dueCount}</p>
            <p className={`mt-0.5 text-xs ${dueCount > 0 ? "text-amber-700/80" : "text-gray-500"}`}>Due for a 1:1</p>
          </div>
          <div className={`rounded-lg border px-4 py-3 ${atRiskGoalCount > 0 ? "border-red-200 bg-red-50/60" : "border-gray-200 bg-white"}`}>
            <p className={`text-xl font-semibold ${atRiskGoalCount > 0 ? "text-red-700" : "text-gray-900"}`}>{atRiskGoalCount}</p>
            <p className={`mt-0.5 text-xs ${atRiskGoalCount > 0 ? "text-red-700/80" : "text-gray-500"}`}>
              Goal{atRiskGoalCount === 1 ? "" : "s"} at risk
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xl font-semibold text-gray-900">{Math.round(totalAvailableHours)}h</p>
            <p className="mt-0.5 text-xs text-gray-500">Available this week</p>
          </div>
        </div>
      )}

      {/* AI insight — real endpoint, null most days by design. */}
      {insight && insight.insight && !insightDismissed && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600">
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-sm text-indigo-900">{insight.insight}</p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {insight.cta_label && insight.cta_direct_report_id && (
              <Link
                href={`/app/reports/${insight.cta_direct_report_id}`}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                {insight.cta_label} →
              </Link>
            )}
            <button onClick={() => setInsightDismissed(true)} className="text-indigo-400 hover:text-indigo-600" aria-label="Dismiss">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {loading && <p className="mt-8 text-gray-500">Loading...</p>}

      {/* THE GRID — 3 sections across the top. Capacity is deliberately NOT
          a fourth column: it's a snapshot stat per person, not a triage
          list, so it reads better as a wide strip below than a narrow
          column competing for the same vertical space. */}
      {!loading && (
        <div className="mt-8 grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
          {/* Individual Performance */}
          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
                Individual Performance{team.length > 0 && ` (${team.length})`}
              </h2>
              <Link href="/app/assessments" className="text-xs text-gray-400 hover:text-gray-600">
                Assessments →
              </Link>
            </div>
            {team.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">
                No one added yet.{" "}
                <button onClick={() => setQuickAddOpen(true)} className="underline hover:text-gray-700">
                  Add your first direct report
                </button>
                .
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {team.map((r) => {
                  const due = needsOneOnOne(r.last_one_on_one_at);
                  const initials = r.name
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <li key={r.id}>
                      <Link href={`/app/reports/${r.id}`} className="block px-5 py-3.5 hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                              due ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                              {r.latest_level_label && (
                                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                                  {r.latest_level_label}
                                </span>
                              )}
                            </div>
                            <p className={`mt-0.5 text-xs ${due ? "text-amber-600" : "text-gray-400"}`}>
                              {lastOneOnOneLabel(r.last_one_on_one_at)}
                              {r.open_commitment_count > 0 &&
                                ` · ${r.open_commitment_count} open commitment${r.open_commitment_count === 1 ? "" : "s"}`}
                            </p>
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Goals */}
          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
                Goals{goals.length > 0 && ` (${goals.length})`}
              </h2>
              <Link href="/app/goals" className="text-xs text-gray-400 hover:text-gray-600">
                View all →
              </Link>
            </div>
            {goals.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">
                No organization, department, or team goals yet.{" "}
                <Link href="/app/goals" className="underline hover:text-gray-700">
                  Add one from the Goals page
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-4 px-5 py-4">
                {GOAL_CARD_LEVELS.map(({ id, label }) => {
                  const rows = goals.filter((g) => g.level === id);
                  if (rows.length === 0) return null;
                  return (
                    <div key={id}>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
                      <ul className="space-y-2">
                        {rows.map((g) => (
                          <li key={g.id} className="rounded-lg border border-gray-200 px-3.5 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <p className="min-w-0 truncate text-sm font-medium text-gray-900">{g.title}</p>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[g.status]}`}>
                                {STATUS_LABELS[g.status]}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Key Initiatives */}
          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
                Key Initiatives{projects.length > 0 && ` (${projects.length})`}
              </h2>
              <Link href="/app/projects" className="text-xs text-gray-400 hover:text-gray-600">
                View all →
              </Link>
            </div>
            {projects.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">
                No active projects.{" "}
                <Link href="/app/projects" className="underline hover:text-gray-700">
                  Add one from the Projects page
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {projects.map((p) => (
                  <li key={p.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{p.title}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {p.direct_report_name ?? "Your initiative"}
                          {p.due_date && ` · Due ${formatDate(p.due_date + "T00:00:00")}`}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* Capacity — full-width strip, this week's available hours (supply
          only, per capacity.py). Full breakdown + department rollup live on
          /app/capacity. */}
      {!loading && (
        <section className="mt-5 rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">Capacity — this week</h2>
            <Link href="/app/capacity" className="text-xs text-gray-400 hover:text-gray-600">
              View full breakdown →
            </Link>
          </div>
          {capacity.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-500">
              No one to show capacity for yet.{" "}
              <Link href="/app/capacity" className="underline hover:text-gray-700">
                Set up capacity defaults
              </Link>
              .
            </p>
          ) : (
            <div className="px-5 py-4">
              <p className="mb-4 text-sm text-gray-700">
                <span className="font-medium">{Math.round(totalAvailableHours)} hours</span> available across your team this
                week.
              </p>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {capacity.map((c) => (
                  <div key={c.direct_report_id} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm text-gray-700">{c.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gray-400"
                        style={{ width: `${Math.min(100, (c.available_hours / maxCapacityHours) * 100)}%` }}
                      />
                    </div>
                    {/* Labeled logged vs assumed (Session 14 decision) — two
                        different sources feed this number, and showing which
                        one won avoids it reading as more precise than it is. */}
                    <span className="w-24 shrink-0 text-right text-xs text-gray-500">
                      {Math.round(c.available_hours)}h <span className="text-gray-300">·{c.off_hours_source}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <QuickAddModal open={quickAddOpen} onClose={() => setQuickAddOpen(false)} directReports={team} onCreated={loadDashboard} />
    </main>
  );
}
