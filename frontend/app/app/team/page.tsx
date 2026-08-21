"use client";

// Team Mission Control (Session 22, 2026-08-08) — expands Team View
// (Session 21, that session's roster-only /app/team) into a multi-surface
// page, reworked in place at the same route/nav item per Andrew's explicit
// call. See docs/SESSION_HISTORY.md and the team_mission_control project
// memory note for the scoping conversation.
//
// Session 23 (2026-08-09) follow-up: meeting-notes agenda surfacing
// (meeting_date-derived "next meeting" hero) + past-meeting card/detail UI +
// team-level commitments (commitments.is_team_commitment).
//
// Session 24 (2026-08-09) — full visual layout rework, Andrew's explicit
// call after dogfooding the 3-column grid (see the team_page_redesign_brief
// and team_page_redesign_options project memory notes for the scoping +
// mockup-review conversation). New structure, top to bottom:
//   1. A KPI strip — goals on track, active initiatives, commitments due
//      this week, days until the next meeting.
//   2. A "this week's focus" row pairing Initiatives (team-wide active
//      projects, same active/on_track/at_risk framing as Mission Control's
//      Key Initiatives card — see dashboard.py), Goals, and Commitments —
//      goals+commitments paired was the one explicit structural ask in the
//      brief; Initiatives joining them was Andrew's addition once he saw the
//      first round of mockups.
//   3. A Critical callouts + Meetings row. Callouts is "key updates" — the
//      manager-authored broadcast idea scoped and then explicitly deferred
//      in Sessions 22 and 23 — revived here deliberately small (one
//      overwritten text block, not a dated log; see lib/api.ts's
//      TeamCallout comment and team.py's get_team_callout/update_team_callout).
//      Meetings keeps Session 23's hero-agenda + plan/log forms + detail
//      modal, restyled from a 2-col grid to a horizontal card carousel.
//   4. The team roster, now a row of compact cards at the very bottom
//      (previously a left column) — click a card to expand priorities,
//      projects, log-update, and invite actions in a detail panel below the
//      row. Same data/actions as before, just relocated.
//
// Scoping for this pass (AskUserQuestion round before the mockups, another
// before writing the callouts migration): write access stays
// manager-authored with the team just viewing — no new IC-facing write UI
// here, matching where IC login actually is today (auth primitives only,
// see direct_report_invites). Visual style leans more colorful/engaging
// than the rest of the app on purpose, Andrew's explicit call over the
// safer close-to-today option.
//
// Session 45 (2026-08-19) — team dropdown. A manager/director who leads more
// than one org_unit had no way to tell which team they were looking at; the
// page always showed every direct report combined. Now the header carries a
// team-name + dropdown (options = getLedOrgUnits(), plus "All teams" as the
// default, matching today's combined view). Selecting a team filters
// everything on the page: roster, initiatives, goals, commitments, meeting
// notes, and callouts. Roster/initiatives/goals/commitments filter
// client-side off data that already exists (direct_reports.org_unit_id /
// goals.org_unit_id — no backend change); meeting notes and callouts gained
// a real org_unit_id column since neither had any per-team signal before
// (null = "applies to all teams", same treatment as a company-level goal).
// See the team_dropdown_scoping project memory note for the scoping
// conversation.
//
// Session 46 (2026-08-20) — goal/project team hierarchy. Andrew wanted a
// team's goals and initiatives to also include anything attached to a
// PARENT org_unit (a department's goal should show on every team beneath
// it), and wanted projects attachable to a team directly instead of only
// via their assignee. ancestorChain() (below) walks org_units'
// parent_unit_id upward from the selected team, client-side, off the
// already-fetched orgUnits list — goals/initiatives now filter against that
// whole chain instead of an exact org_unit_id match. Projects gained a real
// org_unit_id column (projects.py, Session 46) — the assignee-proxy
// filtering Session 45 used as a stand-in is gone. See the
// team_project_goal_hierarchy project memory note for the scoping
// conversation.

import { useEffect, useState } from "react";
import Link from "next/link";
import { averageProgress } from "@/components/CheckInPanel";
import {
  DirectReport,
  OrgUnit,
  Project,
  RoleFamily,
  RoleLevel,
  SetupStatus,
  TeamCallout,
  TeamCommitment,
  TeamDevFocus,
  TeamGoal,
  TeamMember,
  TeamMessage,
  TeamNote,
  createTeamCommitment,
  createTeamNote,
  getDirectReports,
  getLedOrgUnits,
  getOrgUnits,
  getProjects,
  getRoleFamilies,
  getRoleLevels,
  getSetupStatus,
  getTeam,
  getTeamCallout,
  getTeamCommitments,
  getTeamDevFocus,
  getTeamGoals,
  getTeamMessages,
  getTeamNotes,
  inviteDirectReport,
  sendTeamMessage,
  updateCommitment,
  updateTeamCallout,
  updateTeamDevFocus,
} from "@/lib/api";
import { roleLabel } from "@/components/RolePicker";

// Same status vocabulary as Goals/Projects.
const STATUS_STYLES: Record<string, string> = {
  active: "bg-gray-100 text-gray-600",
  on_track: "bg-green-50 text-green-600",
  at_risk: "bg-amber-50 text-amber-600",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-gray-100 text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Left-border accent per status — Initiatives/Goals lean on this for the
// more colorful Session 24 treatment; STATUS_STYLES pills stay too since
// they still carry the text label.
const STATUS_BORDER: Record<string, string> = {
  active: "border-gray-300",
  on_track: "border-green-500",
  at_risk: "border-amber-500",
  completed: "border-blue-300",
  cancelled: "border-gray-200",
};

// Same subset Mission Control's Key Initiatives card uses (dashboard.py) —
// "what's currently happening," full history stays on /app/projects.
const ACTIVE_STATUSES = new Set(["active", "on_track", "at_risk"]);

// A small fixed palette cycled by roster order, so a person's avatar color
// on the roster row matches their commitment/initiative accent color
// elsewhere on the page. Purely a display convenience — not stored anywhere.
const AVATAR_PALETTE = [
  "bg-indigo-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-cyan-600",
];
const AVATAR_BORDER_PALETTE = [
  "border-indigo-500",
  "border-rose-500",
  "border-teal-500",
  "border-amber-500",
  "border-violet-500",
  "border-cyan-600",
];

function memberIndex(memberId: string | null | undefined, members: TeamMember[]) {
  if (!memberId) return -1;
  return members.findIndex((m) => m.id === memberId);
}

function avatarColor(memberId: string | null | undefined, members: TeamMember[]) {
  const idx = memberIndex(memberId, members);
  return AVATAR_PALETTE[idx >= 0 ? idx % AVATAR_PALETTE.length : 0];
}

function borderColor(memberId: string | null | undefined, members: TeamMember[]) {
  const idx = memberIndex(memberId, members);
  return AVATAR_BORDER_PALETTE[idx >= 0 ? idx % AVATAR_BORDER_PALETTE.length : 0];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Local (not UTC) YYYY-MM-DD — meeting_date/due_date are date-only columns;
// parsing via new Date(dateStr) treats them as UTC midnight, which reads as
// "yesterday" in any timezone west of UTC. Everything below that touches a
// bare date string goes through these helpers instead.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysStr(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateStr(dt);
}

function daysBetweenTodayAnd(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMeetingDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function snippet(text: string, max = 110) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

// Soonest note dated today-or-later — the surfaced "next meeting" hero.
// Shared by the KPI strip and the Meetings panel so both derive the same
// answer from the same rule (see team_meeting_notes' meeting_date comment
// in lib/api.ts).
function deriveNextAgenda(notes: TeamNote[]): TeamNote | null {
  const today = localDateStr();
  const upcoming = notes
    .filter((n) => n.meeting_date && n.meeting_date >= today)
    .sort((a, b) => (a.meeting_date! < b.meeting_date! ? -1 : 1));
  return upcoming[0] ?? null;
}

// Session 46 (team_project_goal_hierarchy project memory note): the set of
// org_unit ids "relevant to" a selected team — itself plus every ancestor
// walking up parent_unit_id, so a department's goal/project also shows on
// every team beneath it. Capped at 20 hops as a cycle guard: org_units.py
// only blocks a unit being its own DIRECT parent, not a deeper cycle (see
// its module docstring), so an unguarded walk on bad data could loop
// forever.
function ancestorChain(orgUnitId: string, orgUnits: OrgUnit[]): Set<string> {
  const byId = new Map(orgUnits.map((u) => [u.id, u]));
  const chain = new Set<string>();
  let current: string | null | undefined = orgUnitId;
  let hops = 0;
  while (current && !chain.has(current) && hops < 20) {
    chain.add(current);
    current = byId.get(current)?.parent_unit_id;
    hops++;
  }
  return chain;
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [notes, setNotes] = useState<TeamNote[]>([]);
  const [commitments, setCommitments] = useState<TeamCommitment[]>([]);
  const [initiatives, setInitiatives] = useState<Project[]>([]);
  // Session 45: every callout row for this manager (one per led team that's
  // ever had one saved, plus at most one org_unit_id-null "all teams" row) —
  // see lib/api.ts's TeamCallout comment. The row shown/edited is derived
  // below from selectedTeamId, not stored separately.
  const [callouts, setCallouts] = useState<TeamCallout[]>([]);
  // Session 47: same list-of-rows shape as callouts above, for the
  // "training focus" panel — see lib/api.ts's TeamDevFocus comment.
  const [devFocuses, setDevFocuses] = useState<TeamDevFocus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup-status visibility on the roster cards (Session 42, Plan S4+S5) —
  // role · team chip + amber "no role" badge. TeamMember (from getTeam())
  // only carries the legacy role_title, so role_level_id/org_unit_id come
  // from getDirectReports() and get joined client-side by person id; names
  // resolve against getRoleLevels()/getRoleFamilies()/getOrgUnits(). Reuses
  // getSetupStatus() for the has_role flag rather than recomputing it here.
  const [directReports, setDirectReports] = useState<DirectReport[]>([]);
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [roleFamilies, setRoleFamilies] = useState<RoleFamily[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  // Session 45: which led org_unit is selected. null = "All teams" (today's
  // combined view, and the default) — see this file's header comment.
  const [ledOrgUnits, setLedOrgUnits] = useState<OrgUnit[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getTeam(),
      getTeamGoals(),
      getTeamNotes(),
      getTeamCommitments(),
      getProjects(),
      getTeamCallout(),
      getTeamDevFocus(),
      getDirectReports(),
      getRoleLevels(),
      getRoleFamilies(),
      getOrgUnits(),
      getSetupStatus(),
      getLedOrgUnits(),
    ])
      .then(([m, g, n, c, p, calloutRows, devFocusRows, drs, rls, rfs, ous, status, led]) => {
        setMembers(m);
        setGoals(g);
        setNotes(n);
        setCommitments(c);
        setInitiatives(p.filter((proj) => ACTIVE_STATUSES.has(proj.status)));
        setCallouts(calloutRows);
        setDevFocuses(devFocusRows);
        setDirectReports(drs);
        setRoleLevels(rls);
        setRoleFamilies(rfs);
        setOrgUnits(ous);
        setSetupStatus(status);
        setLedOrgUnits(led);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Team-scoping (Session 45): everything below filters off data already on
  // the page — no re-fetch on team switch. direct_reports.org_unit_id is the
  // one source of truth for "which team is this report on"; commitments key
  // off a direct_report_id, goals/initiatives carry org_unit_id directly
  // (initiatives as of Session 46 — see below), and meeting notes/callouts
  // carry their own org_unit_id column (Session 45). null org_unit_id on a
  // goal/note/callout means "applies to all teams," so it stays visible
  // under every specific team's filter, not just "All teams."
  const directReportById = new Map(directReports.map((dr) => [dr.id, dr]));
  const reportOrgUnitId = (reportId: string | null | undefined): string | null =>
    reportId ? (directReportById.get(reportId)?.org_unit_id ?? null) : null;

  // Session 46 (team_project_goal_hierarchy project memory note): goals and
  // initiatives now also inherit down from a selected team's PARENT
  // org_units — a department's goal shows on every team beneath it, not
  // just an exact org_unit_id match. ancestorChain() walks parent_unit_id
  // upward from the selected team using the already-fetched orgUnits list,
  // so this stays client-side like the rest of Session 45's filtering.
  const ancestorIds = selectedTeamId ? ancestorChain(selectedTeamId, orgUnits) : null;

  const visibleMembers =
    selectedTeamId === null
      ? members
      : members.filter((m) => reportOrgUnitId(m.id) === selectedTeamId);
  // Initiatives no longer proxy through the assignee's org_unit_id (that was
  // a Session 45 stand-in for projects having no team of their own) —
  // projects.py now carries a real org_unit_id (Session 46), so a project
  // with none set is simply unassigned, same posture as an unassigned
  // direct report.
  const visibleInitiatives =
    selectedTeamId === null
      ? initiatives
      : initiatives.filter((p) => p.org_unit_id != null && (ancestorIds?.has(p.org_unit_id) ?? false));
  const visibleGoals =
    selectedTeamId === null
      ? goals
      : goals.filter(
          (g) => g.level === "company" || (g.org_unit_id != null && (ancestorIds?.has(g.org_unit_id) ?? false))
        );
  const visibleCommitments =
    selectedTeamId === null
      ? commitments
      : commitments.filter((c) => reportOrgUnitId(c.direct_report_id) === selectedTeamId);
  const visibleNotes =
    selectedTeamId === null
      ? notes
      : notes.filter((n) => n.org_unit_id === null || n.org_unit_id === selectedTeamId);
  const activeCallout: TeamCallout =
    callouts.find((c) => c.org_unit_id === selectedTeamId) ?? {
      message: "",
      updated_at: null,
      org_unit_id: selectedTeamId,
    };

  function upsertCallout(updated: TeamCallout) {
    setCallouts((cs) => {
      const idx = cs.findIndex((c) => c.org_unit_id === updated.org_unit_id);
      if (idx === -1) return [...cs, updated];
      const copy = [...cs];
      copy[idx] = updated;
      return copy;
    });
  }

  const activeDevFocus: TeamDevFocus =
    devFocuses.find((d) => d.org_unit_id === selectedTeamId) ?? {
      message: "",
      updated_at: null,
      org_unit_id: selectedTeamId,
    };

  function upsertDevFocus(updated: TeamDevFocus) {
    setDevFocuses((ds) => {
      const idx = ds.findIndex((d) => d.org_unit_id === updated.org_unit_id);
      if (idx === -1) return [...ds, updated];
      const copy = [...ds];
      copy[idx] = updated;
      return copy;
    });
  }

  const selectedTeamName =
    selectedTeamId === null
      ? "All teams"
      : (ledOrgUnits.find((u) => u.id === selectedTeamId)?.name ?? "Team");

  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{ledOrgUnits.length > 0 ? selectedTeamName : "Team"}</h1>
        {ledOrgUnits.length > 0 && (
          <select
            value={selectedTeamId ?? ""}
            onChange={(e) => setSelectedTeamId(e.target.value || null)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700"
            aria-label="Select team"
          >
            <option value="">All teams</option>
            {ledOrgUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Everything your team is working on, how goals and commitments are tracking, and a shared space
        for meetings — this week&apos;s must-knows included.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : (
        <div className="mt-8 space-y-10">
          <KpiStrip
            goals={visibleGoals}
            initiatives={visibleInitiatives}
            commitments={visibleCommitments}
            notes={visibleNotes}
          />

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              This week&apos;s focus
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <InitiativesCard initiatives={visibleInitiatives} members={visibleMembers} selectedTeamId={selectedTeamId} />
              <GoalsCard goals={visibleGoals} selectedTeamId={selectedTeamId} />
              <CommitmentsCard
                members={visibleMembers}
                commitments={visibleCommitments}
                setCommitments={setCommitments}
              />
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Meetings
            </h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)]">
              <CalloutsPanel
                callout={activeCallout}
                scopeLabel={selectedTeamName}
                onSaved={upsertCallout}
              />
              <MeetingsPanel notes={visibleNotes} setNotes={setNotes} orgUnitId={selectedTeamId} />
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Development
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DevFocusPanel
                devFocus={activeDevFocus}
                scopeLabel={selectedTeamName}
                onSaved={upsertDevFocus}
              />
            </div>
          </div>

          <RosterRow
            members={visibleMembers}
            setMembers={setMembers}
            directReports={directReports}
            roleLevels={roleLevels}
            roleFamilies={roleFamilies}
            orgUnits={orgUnits}
            setupStatus={setupStatus}
          />
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({
  goals,
  initiatives,
  commitments,
  notes,
}: {
  goals: TeamGoal[];
  initiatives: Project[];
  commitments: TeamCommitment[];
  notes: TeamNote[];
}) {
  const scoredGoals = goals.filter((g) => g.status !== "cancelled");
  const onTrackGoals = scoredGoals.filter((g) => g.status === "on_track").length;
  const goalsLabel = scoredGoals.length > 0 ? `${onTrackGoals}/${scoredGoals.length}` : "—";
  // Data-trust fix (2026-08-12 review, spec section 8 #2): this tile used a
  // fixed green gradient regardless of value, so "0/5 on track" rendered as
  // a success color — zero is not success. Amber once there's real signal
  // and nothing is on track yet; gray when there's nothing to score at all.
  const goalsTileTone =
    scoredGoals.length === 0
      ? { from: "from-gray-400", to: "to-gray-500" }
      : onTrackGoals === 0
        ? { from: "from-amber-500", to: "to-amber-600" }
        : { from: "from-green-500", to: "to-green-600" };

  const today = localDateStr();
  const weekOut = addDaysStr(today, 7);
  const dueThisWeek = commitments.filter(
    (c) => c.status === "open" && c.due_date && c.due_date >= today && c.due_date <= weekOut
  ).length;

  const nextAgenda = deriveNextAgenda(notes);
  const meetingLabel = nextAgenda ? `${Math.max(daysBetweenTodayAnd(nextAgenda.meeting_date!), 0)}d` : "—";
  const meetingSubLabel = nextAgenda ? "Until next meeting" : "No meeting planned";

  const tiles = [
    { value: goalsLabel, label: "Goals on track", from: goalsTileTone.from, to: goalsTileTone.to },
    { value: String(initiatives.length), label: "Active initiatives", from: "from-sky-500", to: "to-sky-600" },
    { value: String(dueThisWeek), label: "Commitments due this week", from: "from-amber-500", to: "to-amber-600" },
    { value: meetingLabel, label: meetingSubLabel, from: "from-indigo-500", to: "to-indigo-600" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-xl bg-gradient-to-br ${t.from} ${t.to} px-4 py-3 text-white`}>
          <p className="text-2xl font-semibold">{t.value}</p>
          <p className="text-xs text-white/80">{t.label}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// This week's focus row — Initiatives / Goals / Commitments
// ---------------------------------------------------------------------------

function InitiativesCard({
  initiatives,
  members,
  selectedTeamId,
}: {
  initiatives: Project[];
  members: TeamMember[];
  selectedTeamId: string | null;
}) {
  const sorted = [...initiatives].sort((a, b) => {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Initiatives</p>
        {initiatives.length > 0 && (
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-600">
            {initiatives.length} active
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">No active initiatives.</p>
      ) : (
        <ul className="space-y-2.5">
          {sorted.map((p) => {
            // Session 46: a project whose org_unit_id isn't the exact
            // selected team is here via hierarchy (inherited from a parent
            // department) — name the source so it doesn't read as "this
            // team's own" work.
            const inherited = selectedTeamId != null && p.org_unit_id !== selectedTeamId && p.org_unit_name;
            return (
              <li key={p.id} className={`border-l-4 py-0.5 pl-2.5 ${STATUS_BORDER[p.status]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-gray-700">{p.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {p.direct_report_name ?? "You"}
                  {p.due_date ? ` · Due ${formatDate(p.due_date)}` : ""}
                  {inherited ? ` · From ${p.org_unit_name}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/app/projects" className="mt-3 inline-block text-xs text-gray-500 underline hover:text-gray-700">
        Manage projects
      </Link>
    </div>
  );
}

function GoalsCard({ goals, selectedTeamId }: { goals: TeamGoal[]; selectedTeamId: string | null }) {
  const scored = goals.filter((g) => g.status !== "cancelled");
  // Data-trust fix (2026-08-12 review, spec section 8 #3): this ring used to
  // compute "% of goals with status on_track" — a status count, not actual
  // progress — so it could read 0% while Mission Control showed real
  // per-goal check-in progress (e.g. 25%/10%) for the very same goals.
  // averageProgress() reads the same `progress` field both surfaces share
  // (see CheckInPanel.tsx). null (nobody's checked in yet) renders as an
  // honest "–" rather than a misleading 0%.
  const avgProgress = averageProgress(scored);
  const pct = avgProgress ?? 0;
  const dash = `${pct}, 100`;
  const sorted = [...goals].sort((a, b) => (a.level === b.level ? 0 : a.level === "company" ? -1 : 1));

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">Goal progress</p>
      {goals.length === 0 ? (
        <p className="text-sm text-gray-400">No company or team goals yet.</p>
      ) : (
        <div className="flex items-start gap-4">
          <svg width="52" height="52" viewBox="0 0 36 36" className="shrink-0">
            <path
              d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="3"
            />
            {avgProgress != null && (
              <path
                d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
                fill="none"
                stroke="#22c55e"
                strokeWidth="3"
                strokeDasharray={dash}
                strokeLinecap="round"
              />
            )}
            <text x="18" y="21" textAnchor="middle" fontSize="9" fill="#111827" fontWeight="600">
              {avgProgress != null ? `${pct}%` : "–"}
            </text>
          </svg>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {sorted.map((g) => {
              // Session 46: name where an inherited goal comes from —
              // company-wide, or a parent department — so it doesn't read
              // as this team's own goal when it's really cascading down.
              const sourceLabel =
                selectedTeamId == null || g.org_unit_id === selectedTeamId
                  ? null
                  : g.level === "company"
                    ? "Company"
                    : g.org_unit_name;
              return (
                <li key={g.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-gray-700" title={g.title}>
                    {g.title}
                    {sourceLabel && <span className="text-gray-400"> · {sourceLabel}</span>}
                  </span>
                  <span
                    className={`shrink-0 h-2 w-2 rounded-full ${
                      g.status === "on_track" ? "bg-green-500" : g.status === "at_risk" ? "bg-amber-500" : "bg-gray-300"
                    }`}
                    title={STATUS_LABELS[g.status]}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link href="/app/goals" className="mt-3 inline-block text-xs text-gray-500 underline hover:text-gray-700">
        Manage goals
      </Link>
    </div>
  );
}

function CommitmentsCard({
  members,
  commitments,
  setCommitments,
}: {
  members: TeamMember[];
  commitments: TeamCommitment[];
  setCommitments: React.Dispatch<React.SetStateAction<TeamCommitment[]>>;
}) {
  const [adding, setAdding] = useState(false);
  const [reportId, setReportId] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const open = commitments.filter((c) => c.status === "open");

  async function submit() {
    if (!reportId || !description.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createTeamCommitment({
        directReportId: reportId,
        description: description.trim(),
        dueDate: dueDate || null,
      });
      setCommitments((c) => [created, ...c]);
      setDescription("");
      setDueDate("");
      setReportId("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add commitment");
    } finally {
      setSaving(false);
    }
  }

  async function markDone(id: string) {
    setCompletingId(id);
    try {
      const updated = await updateCommitment(id, "done");
      setCommitments((c) => c.map((item) => (item.id === id ? updated : item)));
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Team commitments{open.length > 0 && ` (${open.length})`}
        </p>
        <button
          onClick={() => setAdding((a) => !a)}
          className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
        >
          {adding ? "Cancel" : "Add"}
        </button>
      </div>

      {adding && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-3">
          <label className="mb-1 block text-xs font-medium text-gray-500">Assigned to</label>
          <select
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Choose a person...</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <label className="mb-1 mt-2 block text-xs font-medium text-gray-500">Commitment</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <label className="mb-1 mt-2 block text-xs font-medium text-gray-500">Due date (optional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={submit}
              disabled={saving || !reportId || !description.trim()}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No open team commitments.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {open.map((c) => (
            <li
              key={c.id}
              className={`flex items-center justify-between gap-2 border-l-4 py-1 pl-2.5 ${borderColor(
                c.direct_report_id,
                members
              )}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-gray-700">{c.description}</p>
                <p className="text-xs text-gray-400">
                  {c.direct_report_name}
                  {c.due_date ? ` · Due ${formatDate(c.due_date)}` : ""}
                </p>
              </div>
              <button
                onClick={() => markDone(c.id)}
                disabled={completingId === c.id}
                className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {completingId === c.id ? "Saving..." : "Done"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Critical callouts (Session 24) — "key updates," revived deliberately
// small. One manager-authored text block, overwritten on each edit. Each
// non-empty line renders as its own bullet.
// ---------------------------------------------------------------------------

function CalloutsPanel({
  callout,
  scopeLabel,
  onSaved,
}: {
  callout: TeamCallout;
  scopeLabel: string;
  onSaved: (updated: TeamCallout) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(callout.message);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local edit state when the selected team changes (Session 45) —
  // this panel stays mounted across team switches, so without this a
  // half-written draft for one team could get saved against another.
  useEffect(() => {
    setEditing(false);
    setDraft(callout.message);
    setError(null);
  }, [callout.org_unit_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = callout.message
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  function startEditing() {
    setDraft(callout.message);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTeamCallout(draft, callout.org_unit_id);
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Critical callouts</p>
        {!editing && (
          <button onClick={startEditing} className="text-xs text-gray-400 hover:text-gray-600">
            Edit
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        This week&apos;s must-knows for {scopeLabel} — written by you, visible to the whole team.
      </p>

      {editing ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder={"One callout per line, e.g.\nEnterprise tier scope is cut this quarter.\nQ3 roadmap draft due Friday."}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : lines.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">
          No callouts yet —{" "}
          <button onClick={startEditing} className="underline hover:text-gray-600">
            add what your team should know this week
          </button>
          .
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5 text-sm text-gray-700">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-gray-300">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dev focus (Session 47) — the team-level half of Development. Deliberately
// a near-copy of CalloutsPanel above (same pinned-block-overwritten-in-
// place shape via team_dev_focus), rendered as its own labeled panel so it
// doesn't collide with Critical Callouts' "key updates" concept.
// ---------------------------------------------------------------------------

function DevFocusPanel({
  devFocus,
  scopeLabel,
  onSaved,
}: {
  devFocus: TeamDevFocus;
  scopeLabel: string;
  onSaved: (updated: TeamDevFocus) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(devFocus.message);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local edit state when the selected team changes — same reason as
  // CalloutsPanel's identical effect.
  useEffect(() => {
    setEditing(false);
    setDraft(devFocus.message);
    setError(null);
  }, [devFocus.org_unit_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEditing() {
    setDraft(devFocus.message);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTeamDevFocus(draft, devFocus.org_unit_id);
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Training focus</p>
        {!editing && (
          <button onClick={startEditing} className="text-xs text-gray-400 hover:text-gray-600">
            Edit
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        What {scopeLabel} is focused on developing right now — written by you.
      </p>

      {editing ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder={"e.g. Q3 focus: leveling up async communication and stakeholder updates."}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : devFocus.message.trim() === "" ? (
        <p className="mt-3 text-sm text-gray-400">
          No focus set yet —{" "}
          <button onClick={startEditing} className="underline hover:text-gray-600">
            set this month&apos;s training focus
          </button>
          .
        </p>
      ) : (
        <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{devFocus.message}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meetings — hero agenda + plan/log forms (unchanged from Session 23) with
// the past-meetings list restyled from a 2-col grid to a horizontal
// carousel; detail-on-click still opens the same modal.
// ---------------------------------------------------------------------------

function MeetingsPanel({
  notes,
  setNotes,
  orgUnitId,
}: {
  notes: TeamNote[];
  setNotes: React.Dispatch<React.SetStateAction<TeamNote[]>>;
  orgUnitId: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agendaDraft, setAgendaDraft] = useState("");
  const [agendaDate, setAgendaDate] = useState("");
  const [agendaSaving, setAgendaSaving] = useState(false);
  const [agendaError, setAgendaError] = useState<string | null>(null);

  const [selected, setSelected] = useState<TeamNote | null>(null);

  const today = localDateStr();
  const nextAgenda = deriveNextAgenda(notes);
  const past = notes.filter((n) => n.id !== nextAgenda?.id);

  // Decorative only — cycles a color per card position so the carousel
  // doesn't read as one flat gray strip. Not tied to any data.
  const CARD_ACCENTS = ["bg-indigo-500", "bg-rose-500", "bg-teal-500", "bg-amber-500", "bg-violet-500"];

  async function submitLog() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createTeamNote(draft.trim(), null, orgUnitId);
      setNotes((n) => [created, ...n]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  async function submitAgenda() {
    if (!agendaDraft.trim() || !agendaDate || agendaSaving) return;
    setAgendaSaving(true);
    setAgendaError(null);
    try {
      const created = await createTeamNote(agendaDraft.trim(), agendaDate, orgUnitId);
      setNotes((n) => [created, ...n]);
      setAgendaDraft("");
      setAgendaDate("");
    } catch (e) {
      setAgendaError(e instanceof Error ? e.message : "Failed to save agenda");
    } finally {
      setAgendaSaving(false);
    }
  }

  return (
    <div>
      {nextAgenda ? (
        <div className="rounded-xl bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Next meeting</p>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium">
              {formatMeetingDate(nextAgenda.meeting_date!)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{nextAgenda.note}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">No upcoming meeting planned.</p>
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
          Plan next meeting
        </summary>
        <div className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-gray-500">Meeting date</label>
          <input
            type="date"
            value={agendaDate}
            onChange={(e) => setAgendaDate(e.target.value)}
            min={today}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <label className="mb-1 mt-2 block text-xs font-medium text-gray-500">Agenda</label>
          <textarea
            value={agendaDraft}
            onChange={(e) => setAgendaDraft(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="What you want to cover..."
          />
          {agendaError && <p className="mt-1 text-xs text-red-500">{agendaError}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={submitAgenda}
              disabled={agendaSaving || !agendaDraft.trim() || !agendaDate}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {agendaSaving ? "Saving..." : "Save agenda"}
            </button>
          </div>
        </div>
      </details>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <label className="mb-1 block text-xs font-medium text-gray-500">Log a past meeting</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="What happened, what to remember..."
        />
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        <div className="mt-2 flex justify-end">
          <button
            onClick={submitLog}
            disabled={saving || !draft.trim()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Log note"}
          </button>
        </div>
      </div>

      {past.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">No past meetings logged yet.</p>
      ) : (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {past.map((n, i) => (
            <button
              key={n.id}
              onClick={() => setSelected(n)}
              className="w-56 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white text-left hover:border-gray-300 hover:shadow-sm"
            >
              <div className={`h-1.5 ${CARD_ACCENTS[i % CARD_ACCENTS.length]}`} />
              <div className="px-3 py-2.5">
                <p className="text-xs text-gray-400">
                  {n.meeting_date ? formatMeetingDate(n.meeting_date) : timeAgo(n.created_at)}
                </p>
                <p className="mt-1 text-sm text-gray-700">{snippet(n.note, 90)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSelected(null)}
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {selected.meeting_date ? formatMeetingDate(selected.meeting_date) : timeAgo(selected.created_at)}
              </p>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-700"
              >
                &times;
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{selected.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster row (Session 24) — moved from a left column to a horizontal row at
// the bottom. Same data/actions as the old RosterColumn (priorities,
// projects, log-update, invite-to-log-in); clicking a card now opens a
// shared detail panel below the row instead of expanding the card in place.
// ---------------------------------------------------------------------------

function RosterRow({
  members,
  setMembers,
  directReports,
  roleLevels,
  roleFamilies,
  orgUnits,
  setupStatus,
}: {
  members: TeamMember[];
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  directReports: DirectReport[];
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
  orgUnits: OrgUnit[];
  setupStatus: SetupStatus | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(memberId: string) {
    setExpandedId((cur) => (cur === memberId ? null : memberId));
  }

  const expanded = members.find((m) => m.id === expandedId) ?? null;
  const directReportById = new Map(directReports.map((dr) => [dr.id, dr]));
  const roleLevelById = new Map(roleLevels.map((rl) => [rl.id, rl]));
  const orgUnitById = new Map(orgUnits.map((ou) => [ou.id, ou]));
  const setupPersonById = new Map((setupStatus?.people ?? []).map((p) => [p.id, p]));

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Your team</h2>

      {members.length === 0 ? (
        <p className="text-sm text-gray-500">
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-gray-700">
            Add your first one
          </Link>
          .
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {members.map((m) => {
            // has_role (Session 3's setup-status) is the source of truth for
            // the amber badge — never recomputed locally. When it's true,
            // resolve the role/team labels client-side for the chip text
            // (roleLabel/orgUnitLabel formatting, same as Settings and the
            // direct-report page).
            const setupPerson = setupPersonById.get(m.id);
            const hasRole = setupPerson?.has_role ?? false;
            const dr = directReportById.get(m.id);
            const rl = dr?.role_level_id ? roleLevelById.get(dr.role_level_id) : undefined;
            const ou = dr?.org_unit_id ? orgUnitById.get(dr.org_unit_id) : undefined;
            const chipText = rl ? `${roleLabel(rl)}${ou ? ` · ${ou.name}` : ""}` : null;

            return (
              <button
                key={m.id}
                onClick={() => toggleExpand(m.id)}
                className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left hover:border-gray-300 ${
                  expandedId === m.id ? "border-gray-900" : "border-gray-200"
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(
                    m.id,
                    members
                  )}`}
                >
                  {initials(m.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{m.name}</p>
                  {hasRole ? (
                    chipText && <p className="truncate text-xs text-gray-500">{chipText}</p>
                  ) : (
                    <span className="mt-0.5 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      No role
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {expanded && (
        <div className="mt-3">
          <MemberDetailPanel member={expanded} members={members} setMembers={setMembers} />
        </div>
      )}
    </div>
  );
}

function MemberDetailPanel({
  member,
  members,
  setMembers,
}: {
  member: TeamMember;
  members: TeamMember[];
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
}) {
  const [history, setHistory] = useState<TeamMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState(member.email ?? "");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);

  useEffect(() => {
    setHistory(null);
    setDraft("");
    setInviting(false);
    setInviteEmail(member.email ?? "");
    setInviteUrl(null);
    setInviteError(null);
    getTeamMessages(member.id)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [member.id, member.email]);

  async function submitMessage() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const created = await sendTeamMessage(member.id, draft.trim());
      setHistory((h) => [created, ...(h ?? [])]);
      setMembers((ms) => ms.map((m) => (m.id === member.id ? { ...m, latest_message: created } : m)));
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  async function submitInvite() {
    const email = inviteEmail.trim();
    if (!email || inviteSending) return;
    setInviteSending(true);
    setInviteError(null);
    try {
      const { invite_url } = await inviteDirectReport(member.id, email);
      setInviteUrl(invite_url);
      setMembers((ms) => ms.map((m) => (m.id === member.id ? { ...m, email } : m)));
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setInviteSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-4">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Priorities{member.priorities.length > 0 && ` (${member.priorities.length})`}
          </p>
          {member.priorities.length === 0 ? (
            <p className="mt-1 text-sm text-gray-400">None set.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {member.priorities.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-gray-700">{g.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[g.status]}`}>
                    {STATUS_LABELS[g.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-400">
            Projects{member.projects.length > 0 && ` (${member.projects.length})`}
          </p>
          {member.projects.length === 0 ? (
            <p className="mt-1 text-sm text-gray-400">None active.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {member.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-gray-700">{p.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/app/reports/${member.id}`}
            className="mt-3 inline-block text-xs text-gray-500 underline hover:text-gray-700"
          >
            Open full profile
          </Link>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
            Log update for {member.name}
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Not sent anywhere yet — just kept on record here until reports can log in."
          />
          <div className="mt-2">
            <button
              onClick={submitMessage}
              disabled={sending || !draft.trim()}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {sending ? "Saving..." : "Save update"}
            </button>
          </div>

          {history && history.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">History</p>
              <ul className="mt-1.5 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {history.map((msg) => (
                  <li key={msg.id} className="text-sm text-gray-600">
                    <span className="text-xs text-gray-400">{timeAgo(msg.created_at)}</span> — {msg.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Account</p>
          {member.user_id ? (
            <p className="mt-1 text-xs text-gray-500">Account linked — they can log in.</p>
          ) : inviting ? (
            <div className="mt-1">
              {inviteUrl ? (
                <div>
                  <p className="text-xs text-gray-500">Share this link with them — it expires in 7 days:</p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteUrl}
                      onFocus={(e) => e.target.select()}
                      className="w-full truncate rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600"
                    />
                    <button
                      onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                      className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-white"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="their@email.com"
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                  />
                  <button
                    onClick={submitInvite}
                    disabled={inviteSending || !inviteEmail.trim()}
                    className="shrink-0 rounded-md bg-gray-900 px-2.5 py-1 text-xs text-white disabled:opacity-50"
                  >
                    {inviteSending ? "Sending…" : "Send"}
                  </button>
                </div>
              )}
              {inviteError && <p className="mt-1 text-xs text-red-500">{inviteError}</p>}
            </div>
          ) : (
            <button
              onClick={() => setInviting(true)}
              className="mt-1 text-xs font-medium text-gray-500 underline hover:text-gray-700"
            >
              Invite to log in
            </button>
          )}

          {member.latest_message && (
            <p className="mt-4 text-xs text-gray-400">
              Last update {timeAgo(member.latest_message.created_at)}: &ldquo;{member.latest_message.message}&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
