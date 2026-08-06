"use client";

// Mission Control — replaces the old dashboard as the landing page (Session
// 18, 2026-08-06; scoped via AskUserQuestion with Andrew before building —
// see docs/SESSION_HISTORY.md and the mission_control project memory note).
//
// PRODUCT_VISION.md's load-bearing sentence: a single "mission control"
// surface that answers top-level questions about the team without digging
// through separate dashboards. Four cards below, each a summary with a link
// to the full page — same "summary here, edit there" pattern already used
// on the DR detail page for Goals/Projects/Assessment/Capacity.
//
// v1 scope, confirmed with Andrew (all four recommended defaults):
//   - Replaces /app/dashboard outright. Today's "who needs a 1:1" list
//     doesn't get its own page anymore — it folds into Individual
//     Performance below.
//   - Only cards backed by real data today. No placeholders for Team
//     Health, Team/Dept Operations (demand/staffing/forecasting/budget/
//     compensation), or People Operations (recruiting/feedback/improvement
//     plans/formal reviews) — matches the existing "no coming-soon
//     placeholders" precedent from Settings.
//   - Manager view only. Session 15's led-org-unit rollup infrastructure
//     exists but isn't wired in here — no Department Head toggle this pass.
//   - Individual Performance lists each report's latest assessment rating
//     as-is. No synthesized team-level score.
//
// No new backend routes. Every card is a client-side merge of endpoints
// that already exist: getTeamOverview + getTeamAssessments for Individual
// Performance, getGoals + getProjects for Goals/Key Initiatives,
// getCapacityOverview for the Capacity snapshot.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CapacityOverviewItem,
  Goal,
  GoalLevel,
  GoalStatus,
  Project,
  TeamAssessmentItem,
  TeamOverviewItem,
  createDirectReport,
  getCapacityOverview,
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

export default function DashboardPage() {
  const [team, setTeam] = useState<PerformanceRow[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [capacity, setCapacity] = useState<CapacityOverviewItem[]>([]);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const weekRange = useMemo(() => {
    const start = startOfWeek(new Date());
    return { start, end: addDays(start, 6) };
  }, []);

  useEffect(() => {
    Promise.all([
      getTeamOverview(),
      getTeamAssessments(),
      getGoals(),
      getProjects(),
      getCapacityOverview(toISODate(weekRange.start), toISODate(weekRange.end)),
    ])
      .then(([overview, assessments, allGoals, allProjects, capacityRows]) => {
        const ratingByReport = new Map<string, TeamAssessmentItem>(assessments.map((a) => [a.id, a]));
        setTeam(
          overview.map((r) => ({
            ...r,
            latest_level_label: ratingByReport.get(r.id)?.latest_level_label ?? null,
            assessed_at: ratingByReport.get(r.id)?.assessed_at ?? null,
          }))
        );
        setGoals(allGoals.filter((g) => g.level !== "individual"));
        setProjects(allProjects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)));
        setCapacity(capacityRows);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [weekRange]);

  async function addReport(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || adding) return;
    setAdding(true);
    try {
      const created = await createDirectReport({ name: name.trim() });
      setTeam((t) => [
        ...t,
        {
          id: created.id,
          name: created.name,
          role_title: created.role_title,
          last_one_on_one_at: null,
          open_commitment_count: 0,
          latest_level_label: null,
          assessed_at: null,
        },
      ]);
      setName("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  const dueCount = team.filter((r) => needsOneOnOne(r.last_one_on_one_at)).length;
  const totalAvailableHours = capacity.reduce((sum, c) => sum + c.available_hours, 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mission Control</h1>
          <p className="mt-1 text-sm text-gray-500">Your team, at a glance.</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <Link href="/app/assessments" className="hover:text-gray-900">
            Assessments
          </Link>
          <Link href="/app/goals" className="hover:text-gray-900">
            Goals
          </Link>
          <Link href="/app/projects" className="hover:text-gray-900">
            Projects
          </Link>
          <Link href="/app/capacity" className="hover:text-gray-900">
            Capacity
          </Link>
          <Link href="/app/org" className="hover:text-gray-900">
            Org
          </Link>
          <Link href="/app/settings" className="hover:text-gray-900">
            Settings
          </Link>
        </div>
      </div>

      {loadError && <p className="mt-4 text-sm text-red-500">{loadError}</p>}
      {loading && <p className="mt-8 text-gray-500">Loading...</p>}

      {/* Individual Performance — the board's per-person status card. Folds
          in what the old dashboard already did (1:1 cadence, open
          commitments) alongside each report's latest assessment rating. */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Individual Performance{team.length > 0 && ` (${team.length})`}
          </h2>
          <Link href="/app/assessments" className="text-xs text-gray-400 hover:text-gray-600">
            Assessments →
          </Link>
        </div>
        {!loading && team.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">
            {dueCount === 0
              ? "You're up to date with everyone."
              : `${dueCount} ${dueCount === 1 ? "person is" : "people are"} due for a 1:1.`}
          </p>
        )}

        <form onSubmit={addReport} className="mt-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add a direct report"
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={adding}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Add
          </button>
        </form>

        <ul className="mt-4 space-y-3">
          {team.map((r) => {
            const due = needsOneOnOne(r.last_one_on_one_at);
            return (
              <li key={r.id}>
                <Link
                  href={`/app/reports/${r.id}`}
                  className="block rounded-lg border border-gray-200 px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{r.name}</p>
                      {r.role_title && <p className="text-sm text-gray-500">{r.role_title}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.latest_level_label && (
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
                          {r.latest_level_label}
                        </span>
                      )}
                      {due && (
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
                          Time for a 1:1
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-4 text-xs text-gray-400">
                    <span className={due ? "text-amber-600" : ""}>{lastOneOnOneLabel(r.last_one_on_one_at)}</span>
                    {r.open_commitment_count > 0 && (
                      <span>
                        {r.open_commitment_count} open commitment{r.open_commitment_count === 1 ? "" : "s"}
                      </span>
                    )}
                    {!r.latest_level_label && <span>Not yet assessed</span>}
                  </div>
                </Link>
              </li>
            );
          })}
          {!loading && team.length === 0 && (
            <p className="py-3 text-gray-500">No one added yet. Add your first direct report above to get started.</p>
          )}
        </ul>
      </div>

      {/* Organization / Department / Team Goals */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Goals{goals.length > 0 && ` (${goals.length})`}
          </h2>
          <Link href="/app/goals" className="text-xs text-gray-400 hover:text-gray-600">
            View all →
          </Link>
        </div>
        {!loading && goals.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No organization, department, or team goals yet.{" "}
            <Link href="/app/goals" className="underline hover:text-gray-700">
              Add one from the Goals page
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {GOAL_CARD_LEVELS.map(({ id, label }) => {
              const rows = goals.filter((g) => g.level === id);
              if (rows.length === 0) return null;
              return (
                <div key={id}>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</h3>
                  <ul className="mt-2 space-y-2">
                    {rows.map((g) => (
                      <li key={g.id} className="rounded-lg border border-gray-200 px-4 py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{g.title}</p>
                            {g.org_unit_name && <p className="mt-0.5 text-xs text-gray-400">{g.org_unit_name}</p>}
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[g.status]}`}
                          >
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
      </div>

      {/* Key Initiatives — active projects only (active/on_track/at_risk) */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Key Initiatives{projects.length > 0 && ` (${projects.length})`}
          </h2>
          <Link href="/app/projects" className="text-xs text-gray-400 hover:text-gray-600">
            View all →
          </Link>
        </div>
        {!loading && projects.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No active projects.{" "}
            <Link href="/app/projects" className="underline hover:text-gray-700">
              Add one from the Projects page
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {projects.map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{p.title}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {p.direct_report_name ?? "Your initiative"}
                      {p.due_date && ` · Due ${formatDate(p.due_date + "T00:00:00")}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Capacity — this week's available hours, supply only (capacity.py).
          Full breakdown + department rollup live on /app/capacity. */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">Capacity — this week</h2>
          <Link href="/app/capacity" className="text-xs text-gray-400 hover:text-gray-600">
            View full breakdown →
          </Link>
        </div>
        {!loading && capacity.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No one to show capacity for yet.{" "}
            <Link href="/app/capacity" className="underline hover:text-gray-700">
              Set up capacity defaults
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="mt-3 text-gray-700">
              <span className="font-medium">{Math.round(totalAvailableHours)} hours</span> available across your
              team this week.
            </p>
            <ul className="mt-3 space-y-1.5">
              {capacity.map((c) => (
                <li
                  key={c.direct_report_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <span className="text-gray-700">{c.name}</span>
                  <span className="text-gray-500">{c.available_hours}h</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
