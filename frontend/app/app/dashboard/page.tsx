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
import { useQuickAdd } from "@/lib/quick-add-context";
import { TrendArrow, isStale } from "@/components/CheckInPanel";
import {
  CadenceSource,
  CapacityOverviewItem,
  DashboardInsight,
  Goal,
  GoalLevel,
  GoalStatus,
  OneOnOneOverviewItem,
  Project,
  TeamAssessmentItem,
  TeamOverviewItem,
  getCapacityOverview,
  getDashboardInsight,
  getGoals,
  getOneOnOnesOverview,
  getProjects,
  getTeamAssessments,
  getTeamOverview,
} from "@/lib/api";
import { useZoneData, ZoneMap } from "@/components/ZoneMap";
import PageShell from "@/components/PageShell";

function daysSince(iso: string) {
  const then = new Date(iso).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

// days_since_last comes straight from GET /api/one-on-ones/overview — the
// frontend no longer computes 1:1 staleness itself (nav rework pass 2,
// Session 38; see docs/ONE_ON_ONES_PAGE_SPEC.md section 4). This is display
// formatting only, not a staleness calculation.
function lastOneOnOneLabel(daysSinceLast: number | null) {
  if (daysSinceLast === null) return "No 1:1s yet";
  if (daysSinceLast === 0) return "Last 1:1 today";
  if (daysSinceLast === 1) return "Last 1:1 yesterday";
  return `Last 1:1 ${daysSinceLast} days ago`;
}

// Honesty convention Capacity uses for logged-vs-assumed hours (spec
// section 3): say which source resolved this person's cadence.
function cadenceSourceLabel(days: number, source: CadenceSource) {
  if (source === "custom") return `every ${days} days (custom)`;
  if (source === "org") return `every ${days} days (org default)`;
  return `every ${days} days (default)`;
}

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

// ---------------------------------------------------------------------------
// Exception-first triage (Session 26) — the Goals and Key Initiatives cards
// lead with what needs the manager, not a uniform list. A row earns a spot
// in the attention section for any of: at-risk status, overdue / due within
// DUE_SOON_DAYS, no check-in in STALE_CHECK_IN_DAYS (or ever — a stale green
// is more dangerous than an honest yellow), or (goals only) no initiative
// attached — a "what" with no "how". Everything healthy collapses into a
// one-line count that expands on demand. Same worst-first philosophy as the
// Individual Performance column's sort, applied to the other two columns.
// ---------------------------------------------------------------------------

const DUE_SOON_DAYS = 14;

const DOT_STYLES: Record<GoalStatus, string> = {
  active: "bg-gray-400",
  on_track: "bg-green-500",
  at_risk: "bg-amber-500",
  completed: "bg-blue-500",
  cancelled: "bg-gray-300",
};

type AttentionReason = { label: string; severe: boolean };

type TriagedItem = {
  id: string;
  title: string;
  subtitle: string | null;
  status: GoalStatus;
  progress?: number | null;
  trend?: Goal["trend"];
  reasons: AttentionReason[];
};

function daysUntil(isoDate: string) {
  const target = new Date(isoDate + "T00:00:00").getTime();
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / (1000 * 60 * 60 * 24));
}

function dueReason(dueDate: string | null): AttentionReason | null {
  if (!dueDate) return null;
  const d = daysUntil(dueDate);
  if (d < 0) return { label: `Overdue ${-d}d`, severe: true };
  if (d === 0) return { label: "Due today", severe: true };
  if (d <= DUE_SOON_DAYS) return { label: `Due in ${d}d`, severe: false };
  return null;
}

function staleReason(lastCheckInAt: string | null | undefined): AttentionReason | null {
  if (!isStale(lastCheckInAt)) return null;
  if (!lastCheckInAt) return { label: "Never checked in", severe: false };
  return { label: `No check-in in ${daysSince(lastCheckInAt)}d`, severe: false };
}

function severity(item: TriagedItem) {
  // At-risk beats overdue beats everything else; more reasons break ties.
  if (item.status === "at_risk") return 0;
  if (item.reasons.some((r) => r.severe)) return 1;
  return 2;
}

function triage(items: TriagedItem[]): { attention: TriagedItem[]; healthy: TriagedItem[] } {
  const attention = items
    .filter((i) => i.reasons.length > 0)
    .sort((a, b) => severity(a) - severity(b) || b.reasons.length - a.reasons.length);
  const healthy = items.filter((i) => i.reasons.length === 0);
  return { attention, healthy };
}

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

// Individual Performance row — getTeamOverview (open commitments) merged
// client-side with getOneOnOnesOverview (the canonical is_due/cadence
// computation, nav rework pass 2 — see docs/ONE_ON_ONES_PAGE_SPEC.md) and
// getTeamAssessments (latest rating), all by direct_report_id.
type PerformanceRow = TeamOverviewItem & {
  latest_level_label: string | null;
  assessed_at: string | null;
  days_since_last: number | null;
  cadence_days: number;
  cadence_source: CadenceSource;
  is_due: boolean;
};

export default function DashboardPage() {
  const zone = useZoneData();
  const [team, setTeam] = useState<PerformanceRow[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [capacity, setCapacity] = useState<CapacityOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [insight, setInsight] = useState<DashboardInsight | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  // Distinct from `insight === null`, which is the legitimate "nothing to
  // flag today" response (200, insight: null) and should occupy no space.
  // insightFailed means the call itself failed (network/5xx/etc) — that's
  // not "all clear," it's "we don't know," and silently rendering nothing
  // made a real failure look identical to a healthy team (2026-08-12
  // data-trust bug #4). Degrades visibly but quietly: a small muted line,
  // not an error banner.
  const [insightFailed, setInsightFailed] = useState(false);
  // Quick Add's own open/close state moved to the global quick-add context
  // (Session 51 nav rework) — the button now lives in AppNav's header, not
  // here. This page still triggers it from the "add your first direct
  // report" empty state below, via the shared open() from that context.
  const { open: openQuickAdd } = useQuickAdd();

  const weekRange = useMemo(() => {
    const start = startOfWeek(new Date());
    return { start, end: addDays(start, 6) };
  }, []);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    return Promise.all([
      getTeamOverview(),
      getOneOnOnesOverview(),
      getTeamAssessments(),
      getGoals(),
      getProjects(),
      getCapacityOverview(toISODate(weekRange.start), toISODate(weekRange.end)),
    ])
      .then(([overview, oneOnOnes, assessments, allGoals, allProjects, capacityRows]) => {
        const ratingByReport = new Map<string, TeamAssessmentItem>(assessments.map((a) => [a.id, a]));
        const cadenceByReport = new Map<string, OneOnOneOverviewItem>(
          oneOnOnes.map((o) => [o.direct_report_id, o])
        );
        const merged: PerformanceRow[] = overview.map((r) => {
          const cad = cadenceByReport.get(r.id);
          return {
            ...r,
            latest_level_label: ratingByReport.get(r.id)?.latest_level_label ?? null,
            assessed_at: ratingByReport.get(r.id)?.assessed_at ?? null,
            days_since_last: cad?.days_since_last ?? null,
            cadence_days: cad?.cadence_days ?? 21,
            cadence_source: cad?.cadence_source ?? "default",
            is_due: cad?.is_due ?? true,
          };
        });
        // Worst-first: due for a 1:1 sorts before everyone who isn't, then
        // longest gap (never-met first), then by open commitment count.
        // is_due/days_since_last come straight from GET
        // /api/one-on-ones/overview — the single canonical "who's due"
        // computation (nav rework pass 2). This is the single
        // highest-leverage change in the grid redesign — a manager scanning
        // three columns should see problems before people who are fine.
        merged.sort((a, b) => {
          const aDue = a.is_due ? 0 : 1;
          const bDue = b.is_due ? 0 : 1;
          if (aDue !== bDue) return aDue - bDue;
          const aGap = a.days_since_last ?? Number.POSITIVE_INFINITY;
          const bGap = b.days_since_last ?? Number.POSITIVE_INFINITY;
          if (aGap !== bGap) return bGap - aGap;
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
    // The insight call is separate and allowed to fail without blocking or
    // erroring out the rest of the page — it's a nice-to-have banner, not
    // core dashboard data. But "failed" and "legitimately nothing to flag"
    // are different states and must render differently (bug #4 fix below).
    getDashboardInsight()
      .then((i) => {
        setInsight(i);
        setInsightFailed(false);
      })
      .catch(() => {
        setInsight(null);
        setInsightFailed(true);
      });
  }, [loadDashboard]);

  // Exception-first triage inputs (Session 26). Completed/cancelled goals
  // sit out of triage — they're history, not workload.
  const triagedGoals = useMemo(() => {
    const open = goals.filter((g) => g.status !== "completed" && g.status !== "cancelled");
    return triage(
      open.map((g) => {
        const reasons: AttentionReason[] = [];
        if (g.status === "at_risk") reasons.push({ label: "At risk", severe: true });
        const due = dueReason(g.due_date);
        if (due) reasons.push(due);
        const stale = staleReason(g.last_check_in_at);
        if (stale) reasons.push(stale);
        // A "what" with no "how" — the one goal-only smell.
        if (!projects.some((p) => p.goal_id === g.id)) reasons.push({ label: "No initiative", severe: false });
        return {
          id: g.id,
          title: g.title,
          subtitle: GOAL_CARD_LEVELS.find((l) => l.id === g.level)?.label ?? null,
          status: g.status,
          progress: g.progress,
          trend: g.trend,
          reasons,
        };
      })
    );
  }, [goals, projects]);

  const triagedProjects = useMemo(
    () =>
      triage(
        projects.map((p) => {
          const reasons: AttentionReason[] = [];
          if (p.status === "at_risk") reasons.push({ label: "At risk", severe: true });
          const due = dueReason(p.due_date);
          if (due) reasons.push(due);
          const stale = staleReason(p.last_check_in_at);
          if (stale) reasons.push(stale);
          return {
            id: p.id,
            title: p.title,
            subtitle: p.direct_report_name ?? "Your initiative",
            status: p.status,
            progress: p.progress,
            trend: p.trend,
            reasons,
          };
        })
      ),
    [projects]
  );

  // Individual Performance, exception-first (spec section 7) — same
  // treatment Goals/Key Initiatives got in Session 26. `team` is already
  // sorted worst-first in loadDashboard, so attention/healthy are a plain
  // filter, not a re-sort.
  const dueTeam = useMemo(() => team.filter((r) => r.is_due), [team]);
  const healthyTeam = useMemo(() => team.filter((r) => !r.is_due), [team]);

  const totalAvailableHours = capacity.reduce((sum, c) => sum + c.available_hours, 0);
  const maxCapacityHours = Math.max(1, ...capacity.map((c) => c.available_hours));

  return (
    <PageShell maxWidth="7xl">
      {/* Header — cross-page nav (Team/Goals/etc links), Quick add, the
          Scribe toggle, and the account avatar all moved into the
          persistent global nav (components/AppNav.tsx + Sidebar.tsx)
          rendered from app/app/layout.tsx (Session 51 nav rework). */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Mission Control</h1>
        <p className="mt-1 text-sm text-gray-500">Your team, at a glance.</p>
      </div>

      {loadError && <p className="mt-4 text-sm text-red-500">{loadError}</p>}

      {/* Zone map — replaces the old stat ribbon in place (Session 36/37
          decision: the map's door counts already carry the numbers a ribbon
          would have shown, so keeping both said the same things twice). Only
          counts that need attention are colored; everything healthy stays
          grey — see components/ZoneMap.tsx. */}
      {!zone.loading && (
        <div className="mt-6">
          <ZoneMap doorStates={zone.doorStates} />
        </div>
      )}

      {/* AI insight — real endpoint, null most days by design. A legitimate
          null (nothing to flag) renders nothing, same as always. A failed
          call is a distinct state (bug #4, 2026-08-12 data-trust review) —
          it must not look identical to "all clear," so it gets a small
          muted line instead of silence. */}
      {insightFailed && !insightDismissed && (
        <p className="mt-6 text-xs text-gray-400">
          Couldn&apos;t check for anything to flag right now.
        </p>
      )}
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
          {/* Individual Performance — exception-first (spec section 7):
              only who's due for a 1:1 leads, everyone else collapses behind
              "Show N on track". Same treatment Goals/Key Initiatives got in
              Session 26; resolves the duplication pass 1 introduced between
              the zone map's "N due" and this column. */}
          <IndividualPerformanceCard
            team={team}
            dueTeam={dueTeam}
            healthyTeam={healthyTeam}
            onAddFirst={openQuickAdd}
          />

          {/* Goals — exception-first (Session 26) */}
          <TriageCard
            title="Goals"
            href="/app/goals"
            linkLabel="View all"
            total={goals.length}
            attention={triagedGoals.attention}
            healthy={triagedGoals.healthy}
            emptyState={
              <p className="px-5 py-6 text-sm text-gray-500">
                No organization, department, or team goals yet.{" "}
                <Link href="/app/goals" className="underline hover:text-gray-700">
                  Add one from the Goals page
                </Link>
                .
              </p>
            }
          />

          {/* Key Initiatives — exception-first (Session 26) */}
          <TriageCard
            title="Key Initiatives"
            href="/app/projects"
            linkLabel="View all"
            total={projects.length}
            attention={triagedProjects.attention}
            healthy={triagedProjects.healthy}
            emptyState={
              <p className="px-5 py-6 text-sm text-gray-500">
                No active projects.{" "}
                <Link href="/app/projects" className="underline hover:text-gray-700">
                  Add one from the Projects page
                </Link>
                .
              </p>
            }
          />
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

    </PageShell>
  );
}

// Individual Performance — exception-first (spec section 7, nav rework
// pass 2). Same collapse pattern TriageCard below uses for Goals/Key
// Initiatives, but not built on TriageCard itself: a person row (avatar,
// name, rating badge, last-1:1 label) isn't goal-status shaped, so this is
// its own small component rather than forcing TriagedItem's shape onto it.
function IndividualPerformanceCard({
  team,
  dueTeam,
  healthyTeam,
  onAddFirst,
}: {
  team: PerformanceRow[];
  dueTeam: PerformanceRow[];
  healthyTeam: PerformanceRow[];
  onAddFirst: () => void;
}) {
  const [showHealthy, setShowHealthy] = useState(false);

  function initialsOf(name: string) {
    return name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  // Badly overdue (past 2x cadence, or never met) gets rose instead of
  // amber — same convention /app/1-1s's Due now section uses (spec
  // section 6).
  function severityStyles(r: PerformanceRow) {
    const badlyOverdue = r.days_since_last === null || r.days_since_last > r.cadence_days * 2;
    if (badlyOverdue) return { avatar: "bg-rose-100 text-rose-700", text: "text-rose-600" };
    return { avatar: "bg-amber-100 text-amber-700", text: "text-amber-600" };
  }

  function Row({ r }: { r: PerformanceRow }) {
    const sev = severityStyles(r);
    return (
      <li>
        <Link href={`/app/reports/${r.id}`} className="block px-5 py-3.5 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${sev.avatar}`}>
              {initialsOf(r.name)}
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
              <p className={`mt-0.5 text-xs ${sev.text}`}>
                {lastOneOnOneLabel(r.days_since_last)}
                {r.open_commitment_count > 0 &&
                  ` · ${r.open_commitment_count} open commitment${r.open_commitment_count === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
        </Link>
      </li>
    );
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
          Individual Performance{team.length > 0 && ` (${team.length})`}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/app/1-1s" className="text-xs text-gray-400 hover:text-gray-600">
            1:1s →
          </Link>
          <Link href="/app/assessments" className="text-xs text-gray-400 hover:text-gray-600">
            Assessments →
          </Link>
        </div>
      </div>
      {team.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">
          No one added yet.{" "}
          <button onClick={onAddFirst} className="underline hover:text-gray-700">
            Add your first direct report
          </button>
          .
        </p>
      ) : (
        <div>
          {dueTeam.length === 0 ? (
            <p className="px-5 pb-1 pt-4 text-sm text-gray-500">Everyone&apos;s on cadence. 🎯</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {dueTeam.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </ul>
          )}
          {healthyTeam.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-3">
              <button onClick={() => setShowHealthy((s) => !s)} className="text-xs text-gray-400 hover:text-gray-600">
                {showHealthy ? "Hide" : "Show"} {healthyTeam.length} on track {showHealthy ? "▴" : "▾"}
              </button>
              {showHealthy && (
                <ul className="mt-2 space-y-1.5">
                  {healthyTeam.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/app/reports/${r.id}`}
                        className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-gray-50"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-600">{r.name}</span>
                        <span className="shrink-0 text-[11px] text-gray-400">{lastOneOnOneLabel(r.days_since_last)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Exception-first card (Session 26) — attention rows first (worst first),
// healthy rows collapsed into a one-line count that expands on demand. Every
// row clicks through to the owning page; rows carry status dot, progress %,
// trend arrow (from the check-ins layer), and reason chips explaining WHY
// something is in the attention section.
function TriageCard({
  title,
  href,
  linkLabel,
  total,
  attention,
  healthy,
  emptyState,
}: {
  title: string;
  href: string;
  linkLabel: string;
  total: number;
  attention: TriagedItem[];
  healthy: TriagedItem[];
  emptyState: React.ReactNode;
}) {
  const [showHealthy, setShowHealthy] = useState(false);
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
          {title}
          {total > 0 && ` (${total})`}
        </h2>
        <Link href={href} className="text-xs text-gray-400 hover:text-gray-600">
          {linkLabel} →
        </Link>
      </div>
      {total === 0 ? (
        emptyState
      ) : (
        <div>
          {attention.length === 0 ? (
            <p className="px-5 pb-1 pt-4 text-sm text-gray-500">Nothing needs your attention. 🎯</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {attention.map((item) => (
                <li key={item.id}>
                  <Link href={href} className="block px-5 py-3 hover:bg-gray-50">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_STYLES[item.status]}`} />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{item.title}</p>
                      {item.progress != null && (
                        <span className="shrink-0 text-xs font-medium text-gray-600">{item.progress}%</span>
                      )}
                      <TrendArrow trend={item.trend} />
                    </div>
                    {item.progress != null && (
                      <div className="ml-4 mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${item.status === "at_risk" ? "bg-amber-500" : "bg-green-500"}`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                    <div className="ml-4 mt-1.5 flex flex-wrap items-center gap-1.5">
                      {item.subtitle && <span className="text-[11px] text-gray-400">{item.subtitle}</span>}
                      {item.reasons.map((r) => (
                        <span
                          key={r.label}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            r.severe ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {healthy.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-3">
              <button
                onClick={() => setShowHealthy((s) => !s)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {showHealthy ? "Hide" : "Show"} {healthy.length} on track {showHealthy ? "▴" : "▾"}
              </button>
              {showHealthy && (
                <ul className="mt-2 space-y-1.5">
                  {healthy.map((item) => (
                    <li key={item.id}>
                      <Link href={href} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_STYLES[item.status]}`} />
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-600">{item.title}</span>
                        {item.progress != null && (
                          <span className="shrink-0 text-[11px] text-gray-400">{item.progress}%</span>
                        )}
                        <TrendArrow trend={item.trend} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
