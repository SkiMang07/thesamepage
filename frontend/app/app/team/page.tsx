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
//      Meetings keeps a hero card + a carousel of logged meetings, though
//      what sits behind it was rebuilt on 2026-08-24 — see below.
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
//
// 2026-08-24 — team meetings (see the team_meetings_scoping project memory
// note). The old panel showed the agenda you planned and, underneath it, a
// "Log a past meeting" box that wrote a completely unrelated row: the agenda
// and the write-up were two team_meeting_notes rows with nothing joining
// them, so there was no way to log notes against the meeting on screen, one
// meeting rendered as two cards, and the hero stuck all day after the
// meeting had been held. Now a meeting is one row plus structured agenda
// items, on an optional 1-4 week series, and:
//   - deriveNextMeeting() keys off `status` (derived from summary on the
//     backend), never off whether the date has passed. Logging is what
//     closes a meeting.
//   - Quick log gives each agenda item its own notes box; anything left
//     unticked is offered as carry-forward into the next meeting.
//   - "Wrap up & log" runs an AI draft and hands it to
//     components/team/MeetingWrapUpReview.tsx. NOTHING IS WRITTEN until the
//     manager confirms there — same locked rule as the 1:1 wrap-up. That
//     component is shared from this first pass on purpose: the dedicated
//     meeting screen (/app/team/meetings/[id], pass 2) reuses it.
//   - Extracted commitments may be the manager's own (null
//     direct_report_id), which is why the owner picker offers "You".
//
// Session 56 white-space audit — widened to PageShell's new `8xl` tier
// (this is a wide multi-section page, one of the ones the audit flagged as
// most starved for width on a wide monitor) and the entrance gap (subtitle
// -> first section) now uses the shared SECTION_GAP token instead of a
// bare mt-8. The page's own internal space-y-10 between its 5 major
// sections (KPI strip / this week's focus / meetings / development /
// roster) is left as-is — that's already one consistent value, not the
// per-block drift the audit was about, and wasn't part of the approved
// comparison canvas.

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
  TeamMeeting,
  TeamMeetingWrapUpDraft,
  createTeamCommitment,
  createTeamMeeting,
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
  getTeamMeetings,
  inviteDirectReport,
  sendTeamMessage,
  updateCommitment,
  updateTeamCallout,
  updateTeamDevFocus,
  updateTeamMeeting,
  wrapUpTeamMeeting,
} from "@/lib/api";
import MeetingWrapUpReview, { AgendaOutcome } from "@/components/team/MeetingWrapUpReview";
import { roleLabel } from "@/components/RolePicker";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import { IDENTITY_BG, IDENTITY_BORDER, IDENTITY_TEXT, HEX, FEATURE_SURFACE, EYEBROW, TILE, TILE_TONE, TILE_VALUE, TILE_LABEL, TileTone, BTN_PRIMARY_SM, BTN_SECONDARY, BTN_GHOST, INPUT, SELECT, TEXTAREA, LABEL, META, ERROR_TEXT } from "@/lib/tokens";

// Same status vocabulary as Goals/Projects.
const STATUS_STYLES: Record<string, string> = {
  active: "bg-sunken text-ink-secondary",
  on_track: "bg-teal-50 text-teal-700",
  at_risk: "bg-amber-50 text-amber-700",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-sunken text-ink-muted",
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
  active: "border-control",
  on_track: "border-brand",
  at_risk: "border-amber-500",
  completed: "border-blue-300",
  cancelled: "border-hairline",
};

// Same subset Mission Control's Key Initiatives card uses (dashboard.py) —
// "what's currently happening," full history stays on /app/projects.
const ACTIVE_STATUSES = new Set(["active", "on_track", "at_risk"]);

// A small fixed palette cycled by roster order, so a person's avatar color
// on the roster row matches their commitment/initiative accent color
// elsewhere on the page. Purely a display convenience — not stored anywhere.
// Session 58: these were an off-system rainbow (indigo/rose/teal/amber/
// violet/cyan) and, worse, CARD_ACCENTS below was a five-item copy of this
// six-item list, so a person's avatar and their card accent desynchronised
// past index 4. Both now read the one brand-derived identity palette in
// lib/tokens.ts.
const AVATAR_PALETTE = IDENTITY_BG;
const AVATAR_BORDER_PALETTE = IDENTITY_BORDER;

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

// The meeting the page is "on": the soonest one that hasn't been logged.
// Shared by the KPI strip and the Meetings panel so both answer the question
// the same way. Note what it does NOT do — it never looks at whether the date
// has passed. Logging is what closes a meeting, so an unlogged meeting from
// last Monday stays here (as "needs logging") instead of vanishing, and a
// meeting logged at 3pm today drops out immediately instead of sitting in the
// slot until midnight. Undated meetings (carry-forward with no series) sort
// last, so a real upcoming date always wins the hero.
function deriveNextMeeting(meetings: TeamMeeting[]): TeamMeeting | null {
  const open = meetings
    .filter((m) => m.status !== "logged")
    .sort((a, b) => {
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      return a.scheduled_at < b.scheduled_at ? -1 : 1;
    });
  return open[0] ?? null;
}

// scheduled_at is a timestamp encoded at noon UTC; the local calendar date is
// what every display helper here expects.
function isoToDateStr(iso: string) {
  return localDateStr(new Date(iso));
}

function repeatLabel(weeks: number) {
  return weeks === 1 ? "repeats weekly" : `repeats every ${weeks} weeks`;
}

// One agenda item per line, the way the manager typed it.
function splitAgenda(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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
  const [meetings, setMeetings] = useState<TeamMeeting[]>([]);
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
      getTeamMeetings(),
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
        setMeetings(n);
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
      : commitments.filter(
          // A manager-owned team commitment (2026-08-24) has no direct report
          // to derive a team from, so it shows under every team — same
          // convention as a null org_unit_id callout or meeting.
          (c) => c.direct_report_id == null || reportOrgUnitId(c.direct_report_id) === selectedTeamId
        );
  const visibleMeetings =
    selectedTeamId === null
      ? meetings
      : meetings.filter((m) => m.org_unit_id === null || m.org_unit_id === selectedTeamId);
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
    <PageShell maxWidth="8xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{ledOrgUnits.length > 0 ? selectedTeamName : "Team"}</h1>
        {ledOrgUnits.length > 0 && (
          <select
            value={selectedTeamId ?? ""}
            onChange={(e) => setSelectedTeamId(e.target.value || null)}
            className="rounded-md border border-control bg-surface px-2 py-1 text-sm text-ink-body"
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
      <p className="mt-1 text-sm text-ink-secondary">
        Everything your team is working on, how goals and commitments are tracking, and a shared space
        for meetings — this week&apos;s must-knows included.
      </p>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className={`${SECTION_GAP} text-ink-secondary`}>Loading...</p>
      ) : (
        <div className={`${SECTION_GAP} space-y-10`}>
          <KpiStrip
            goals={visibleGoals}
            initiatives={visibleInitiatives}
            commitments={visibleCommitments}
            meetings={visibleMeetings}
          />

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
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
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
              Meetings
            </h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)]">
              <CalloutsPanel
                callout={activeCallout}
                scopeLabel={selectedTeamName}
                onSaved={upsertCallout}
              />
              <MeetingsPanel
                meetings={visibleMeetings}
                setMeetings={setMeetings}
                members={visibleMembers}
                orgUnitId={selectedTeamId}
              />
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
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
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({
  goals,
  initiatives,
  commitments,
  meetings,
}: {
  goals: TeamGoal[];
  initiatives: Project[];
  commitments: TeamCommitment[];
  meetings: TeamMeeting[];
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
      ? "neutral"
      : onTrackGoals === 0
        ? "attention"
        : "brand";

  const today = localDateStr();
  const weekOut = addDaysStr(today, 7);
  const dueThisWeek = commitments.filter(
    (c) => c.status === "open" && c.due_date && c.due_date >= today && c.due_date <= weekOut
  ).length;

  // Reads the same open-meeting rule as the panel. An unlogged meeting whose
  // date has passed reports as needing a write-up rather than as a negative
  // countdown.
  const nextMeeting = deriveNextMeeting(meetings);
  const meetingDays =
    nextMeeting?.scheduled_at != null
      ? daysBetweenTodayAnd(isoToDateStr(nextMeeting.scheduled_at))
      : null;
  const needsLog = nextMeeting?.status === "needs_log";
  const meetingLabel = needsLog ? "—" : meetingDays != null ? `${Math.max(meetingDays, 0)}d` : "—";
  const meetingSubLabel = needsLog
    ? "Meeting needs logging"
    : nextMeeting == null
      ? "No meeting planned"
      : meetingDays == null
        ? "Next meeting needs a date"
        : "Until next meeting";

  const tiles: { value: string; label: string; tone: TileTone }[] = [
    { value: goalsLabel, label: "Goals on track", tone: goalsTileTone },
    // Both of these were blue purely so the row had four colours in it —
    // blue is Scribe's and a KPI is not AI. Neither is a status: a count of
    // initiatives and a countdown to a meeting are just numbers.
    { value: String(initiatives.length), label: "Active initiatives", tone: "neutral" },
    { value: String(dueThisWeek), label: "Commitments due this week", tone: dueThisWeek > 0 ? "attention" : "neutral" },
    { value: meetingLabel, label: meetingSubLabel, tone: needsLog ? "attention" : "neutral" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={TILE}>
          <p className={`${TILE_VALUE} ${TILE_TONE[t.tone]}`}>{t.value}</p>
          <p className={TILE_LABEL}>{t.label}</p>
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
    <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Initiatives</p>
        {initiatives.length > 0 && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
            {initiatives.length} active
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-ink-muted">No active initiatives.</p>
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
                  <span className="truncate text-sm text-ink-body">{p.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </div>
                <p className="text-xs text-ink-muted">
                  {p.direct_report_name ?? "You"}
                  {p.due_date ? ` · Due ${formatDate(p.due_date)}` : ""}
                  {inherited ? ` · From ${p.org_unit_name}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/app/projects" className="mt-3 inline-block text-xs text-ink-secondary underline hover:text-ink-body">
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
    <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-muted">Goal progress</p>
      {goals.length === 0 ? (
        <p className="text-sm text-ink-muted">No company or team goals yet.</p>
      ) : (
        <div className="flex items-start gap-4">
          <svg width="52" height="52" viewBox="0 0 36 36" className="shrink-0">
            <path
              d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
              fill="none"
              stroke={HEX.track}
              strokeWidth="3"
            />
            {avgProgress != null && (
              <path
                d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
                fill="none"
                stroke={HEX.brand}
                strokeWidth="3"
                strokeDasharray={dash}
                strokeLinecap="round"
              />
            )}
            <text x="18" y="21" textAnchor="middle" fontSize="9" fill={HEX.ink} fontWeight="600">
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
                  <span className="min-w-0 truncate text-ink-body" title={g.title}>
                    {g.title}
                    {sourceLabel && <span className="text-ink-muted"> · {sourceLabel}</span>}
                  </span>
                  <span
                    className={`shrink-0 h-2 w-2 rounded-full ${
                      g.status === "on_track" ? "bg-brand" : g.status === "at_risk" ? "bg-amber-500" : "bg-carbon-300"
                    }`}
                    title={STATUS_LABELS[g.status]}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link href="/app/goals" className="mt-3 inline-block text-xs text-ink-secondary underline hover:text-ink-body">
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
    if (!description.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createTeamCommitment({
        directReportId: reportId || null,
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
    <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Team commitments{open.length > 0 && ` (${open.length})`}
        </p>
        <button
          onClick={() => setAdding((a) => !a)}
          className="text-xs font-medium text-ink-secondary underline hover:text-ink-body"
        >
          {adding ? "Cancel" : "Add"}
        </button>
      </div>

      {adding && (
        <div className="mt-2 rounded-lg border border-hairline bg-canvas/60 px-3 py-3">
          <label className="mb-1 block text-xs font-medium text-ink-secondary">Assigned to</label>
          <select
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
            className="w-full rounded-md border border-control px-2 py-1.5 text-sm"
          >
            {/* "You" is a real owner, not a missing one — a lot of what a team
                meeting produces is the manager's own work. */}
            <option value="">You</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <label className="mb-1 mt-2 block text-xs font-medium text-ink-secondary">Commitment</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-control px-3 py-2 text-sm"
          />
          <label className="mb-1 mt-2 block text-xs font-medium text-ink-secondary">Due date (optional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-md border border-control px-3 py-1.5 text-sm"
          />
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={submit}
              disabled={saving || !description.trim()}
              className="rounded-md bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No open team commitments.</p>
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
                <p className="truncate text-sm text-ink-body">{c.description}</p>
                <p className="text-xs text-ink-muted">
                  {c.direct_report_name ?? "You"}
                  {c.due_date ? ` · Due ${formatDate(c.due_date)}` : ""}
                </p>
              </div>
              <button
                onClick={() => markDone(c.id)}
                disabled={completingId === c.id}
                className="shrink-0 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:opacity-50"
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
    <div className="flex flex-col rounded-xl border border-hairline bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Critical callouts</p>
        {!editing && (
          <button onClick={startEditing} className="text-xs text-ink-muted hover:text-ink-secondary">
            Edit
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        This week&apos;s must-knows for {scopeLabel} — written by you, visible to the whole team.
      </p>

      {editing ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder={"One callout per line, e.g.\nEnterprise tier scope is cut this quarter.\nQ3 roadmap draft due Friday."}
            className="w-full rounded-md border border-control px-3 py-2 text-sm"
          />
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : lines.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          No callouts yet —{" "}
          <button onClick={startEditing} className="underline hover:text-ink-secondary">
            add what your team should know this week
          </button>
          .
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5 text-sm text-ink-body">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-ink-faint">•</span>
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
    <div className="flex flex-col rounded-xl border border-hairline bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Training focus</p>
        {!editing && (
          <button onClick={startEditing} className="text-xs text-ink-muted hover:text-ink-secondary">
            Edit
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        What {scopeLabel} is focused on developing right now — written by you.
      </p>

      {editing ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder={"e.g. Q3 focus: leveling up async communication and stakeholder updates."}
            className="w-full rounded-md border border-control px-3 py-2 text-sm"
          />
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : devFocus.message.trim() === "" ? (
        <p className="mt-3 text-sm text-ink-muted">
          No focus set yet —{" "}
          <button onClick={startEditing} className="underline hover:text-ink-secondary">
            set this month&apos;s training focus
          </button>
          .
        </p>
      ) : (
        <p className="mt-3 whitespace-pre-line text-sm text-ink-body">{devFocus.message}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meetings (2026-08-24 rebuild)
//
// The old panel had a "Next meeting" hero and, underneath it, a free-text
// "Log a past meeting" box that wrote a completely unrelated row. There was
// no way to log against the meeting you were looking at. Now the meeting IS
// the surface: the agenda is on the card, and logging happens on it.
//
// Three actions, matching the approved option: Open meeting (the dedicated
// screen — pass 2), Quick log (expands in place), Edit agenda.
// ---------------------------------------------------------------------------

function MeetingsPanel({
  meetings,
  setMeetings,
  members,
  orgUnitId,
}: {
  meetings: TeamMeeting[];
  setMeetings: React.Dispatch<React.SetStateAction<TeamMeeting[]>>;
  members: TeamMember[];
  orgUnitId: string | null;
}) {
  const [mode, setMode] = useState<"idle" | "plan" | "edit" | "log" | "review">("idle");
  const [selected, setSelected] = useState<TeamMeeting | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Plan / edit form
  const [formDate, setFormDate] = useState("");
  const [formAgenda, setFormAgenda] = useState("");
  const [formRepeat, setFormRepeat] = useState<number | "">("");
  const [formSaving, setFormSaving] = useState(false);

  // Quick log
  const [outcomes, setOutcomes] = useState<AgendaOutcome[]>([]);
  const [extraNotes, setExtraNotes] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState<TeamMeetingWrapUpDraft | null>(null);

  const next = deriveNextMeeting(meetings);
  const logged = meetings.filter((m) => m.status === "logged");

  function reset() {
    setMode("idle");
    setDraft(null);
    setExtraNotes("");
    setOutcomes([]);
    setError(null);
  }

  function openPlan() {
    setFormDate("");
    setFormAgenda("");
    setFormRepeat("");
    setMode("plan");
  }

  function openEdit(meeting: TeamMeeting) {
    setFormDate(meeting.scheduled_at ? isoToDateStr(meeting.scheduled_at) : "");
    setFormAgenda(meeting.agenda_items.map((i) => i.item).join("\n"));
    setFormRepeat(meeting.recurrence_weeks ?? "");
    setMode("edit");
  }

  function openLog(meeting: TeamMeeting) {
    setOutcomes(meeting.agenda_items.map((i) => ({ id: i.id, covered: true, notes: "" })));
    setExtraNotes("");
    setDraft(null);
    setMode("log");
  }

  async function savePlan() {
    if (!formDate || formSaving) return;
    setFormSaving(true);
    setError(null);
    try {
      const created = await createTeamMeeting({
        scheduledAt: formDate,
        agendaItems: splitAgenda(formAgenda),
        orgUnitId,
        recurrenceWeeks: formRepeat === "" ? null : Number(formRepeat),
      });
      setMeetings((rows) => [created, ...rows]);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to plan meeting");
    } finally {
      setFormSaving(false);
    }
  }

  async function saveEdit() {
    if (!next || formSaving) return;
    setFormSaving(true);
    setError(null);
    try {
      const updated = await updateTeamMeeting(next.id, {
        scheduledAt: formDate || null,
        agendaItems: splitAgenda(formAgenda),
        recurrenceWeeks: formRepeat === "" ? null : Number(formRepeat),
        clearRecurrence: formRepeat === "",
      });
      setMeetings((rows) => rows.map((m) => (m.id === updated.id ? updated : m)));
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save agenda");
    } finally {
      setFormSaving(false);
    }
  }

  // The notes the wrap-up actually reads: each agenda item that has notes,
  // headed by the item so the model knows which topic it belongs to, plus
  // whatever came up off-agenda.
  function assembleRawNotes(meeting: TeamMeeting) {
    const parts = meeting.agenda_items
      .map((item) => {
        const outcome = outcomes.find((o) => o.id === item.id);
        if (!outcome?.notes.trim()) return null;
        return `${item.item}:\n${outcome.notes.trim()}`;
      })
      .filter(Boolean) as string[];
    if (extraNotes.trim()) parts.push(`Other:\n${extraNotes.trim()}`);
    return parts.join("\n\n");
  }

  async function runWrapUp(meeting: TeamMeeting) {
    const rawNotes = assembleRawNotes(meeting);
    if (!rawNotes.trim() || extracting) return;
    setExtracting(true);
    setError(null);
    try {
      const result = await wrapUpTeamMeeting(meeting.id, rawNotes);
      setDraft(result);
      setMode("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft the wrap-up");
    } finally {
      setExtracting(false);
    }
  }

  function onLogged(result: { meeting: TeamMeeting; next_meeting: TeamMeeting | null }) {
    setMeetings((rows) => {
      const merged = rows.map((m) => (m.id === result.meeting.id ? result.meeting : m));
      if (result.next_meeting && !merged.some((m) => m.id === result.next_meeting!.id)) {
        return [result.next_meeting, ...merged];
      }
      return result.next_meeting
        ? merged.map((m) => (m.id === result.next_meeting!.id ? result.next_meeting! : m))
        : merged;
    });
    reset();
  }

  const CARD_ACCENTS = IDENTITY_BG;

  return (
    <div>
      {next ? (
        <div className={`${FEATURE_SURFACE} px-5 py-4`}>
          <div className="flex items-center justify-between gap-2">
            <p className={EYEBROW}>
              {next.status === "needs_log" ? "Needs logging" : "Next meeting"}
              {next.recurrence_weeks ? ` · ${repeatLabel(next.recurrence_weeks)}` : ""}
            </p>
            <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-body">
              {next.scheduled_at ? formatMeetingDate(isoToDateStr(next.scheduled_at)) : "No date yet"}
            </span>
          </div>

          {next.agenda_items.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {next.agenda_items.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" />
                  <span>{item.item}</span>
                  {item.carried_from_item_id && (
                    <span className="mt-0.5 shrink-0 rounded-full border border-hairline px-1.5 text-[10px] text-ink-muted">
                      carried
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">No agenda yet.</p>
          )}

          {mode === "idle" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {/* Pass 2 turns this into a link to /app/team/meetings/[id] —
                  the two-column live screen. Until then Quick log is the
                  whole logging path, so the button is not shown yet. */}
              <button onClick={() => openLog(next)} className={BTN_PRIMARY_SM}>
                Log what happened
              </button>
              <button onClick={() => openEdit(next)} className={BTN_SECONDARY}>
                Edit agenda
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-hairline px-4 py-3">
          <p className="text-xs text-ink-muted">No meeting planned.</p>
        </div>
      )}

      {mode === "idle" && (
        <div className="mt-2">
          <button onClick={openPlan} className={BTN_GHOST}>
            {next ? "Plan another meeting" : "Plan a meeting"}
          </button>
        </div>
      )}

      {(mode === "plan" || mode === "edit") && (
        <div className="mt-3 rounded-xl border border-hairline bg-surface px-4 py-3">
          <p className={EYEBROW}>{mode === "plan" ? "Plan a meeting" : "Edit agenda"}</p>
          <label className={`${LABEL} mt-2`} htmlFor="meeting-date">
            Meeting date
          </label>
          <input
            id="meeting-date"
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            className={INPUT}
          />
          <label className={`${LABEL} mt-2`} htmlFor="meeting-agenda">
            Agenda — one item per line
          </label>
          <textarea
            id="meeting-agenda"
            value={formAgenda}
            onChange={(e) => setFormAgenda(e.target.value)}
            rows={4}
            className={`${TEXTAREA} text-sm`}
            placeholder={"Update on Max's account\nDiscuss hiring for new CSM"}
          />
          <label className={`${LABEL} mt-2`} htmlFor="meeting-repeat">
            Repeat
          </label>
          <select
            id="meeting-repeat"
            value={formRepeat}
            onChange={(e) => setFormRepeat(e.target.value === "" ? "" : Number(e.target.value))}
            className={`${SELECT} w-auto`}
          >
            <option value="">Doesn&apos;t repeat</option>
            <option value={1}>Every week</option>
            <option value={2}>Every 2 weeks</option>
            <option value={3}>Every 3 weeks</option>
            <option value={4}>Every 4 weeks</option>
          </select>
          {/* Said plainly so a manager never waits on an invite that isn't
              coming — same honesty posture as store-only team messages. */}
          <p className={`${META} mt-1`}>The Same Page doesn&apos;t send calendar invites.</p>
          {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={reset} className={BTN_SECONDARY} disabled={formSaving}>
              Cancel
            </button>
            <button
              onClick={mode === "plan" ? savePlan : saveEdit}
              disabled={formSaving || !formDate}
              className={BTN_PRIMARY_SM}
            >
              {formSaving ? "Saving..." : mode === "plan" ? "Plan meeting" : "Save agenda"}
            </button>
          </div>
        </div>
      )}

      {mode === "log" && next && (
        <div className="mt-3 rounded-xl border border-hairline bg-surface px-4 py-3">
          <p className={EYEBROW}>
            Logging ·{" "}
            {next.scheduled_at ? formatMeetingDate(isoToDateStr(next.scheduled_at)) : "undated"}
          </p>
          {next.agenda_items.map((item) => {
            const outcome = outcomes.find((o) => o.id === item.id);
            return (
              <div key={item.id} className="mt-3">
                <label className="flex items-center gap-2 text-sm font-medium text-ink-body">
                  <input
                    type="checkbox"
                    checked={outcome?.covered ?? false}
                    onChange={(e) =>
                      setOutcomes((rows) =>
                        rows.map((o) => (o.id === item.id ? { ...o, covered: e.target.checked } : o))
                      )
                    }
                    className="h-3.5 w-3.5 rounded border-control"
                  />
                  {item.item}
                  {!outcome?.covered && (
                    <span className="rounded-full border border-hairline px-1.5 text-[10px] font-normal text-ink-muted">
                      carries forward
                    </span>
                  )}
                </label>
                {outcome?.covered && (
                  <textarea
                    value={outcome.notes}
                    onChange={(e) =>
                      setOutcomes((rows) =>
                        rows.map((o) => (o.id === item.id ? { ...o, notes: e.target.value } : o))
                      )
                    }
                    rows={2}
                    className={`${TEXTAREA} mt-1 text-sm`}
                    placeholder="What happened..."
                    aria-label={`Notes for ${item.item}`}
                  />
                )}
              </div>
            );
          })}

          <label className={`${LABEL} mt-3`} htmlFor="meeting-other">
            {next.agenda_items.length > 0 ? "Anything else" : "Notes"}
          </label>
          <textarea
            id="meeting-other"
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            rows={3}
            className={`${TEXTAREA} text-sm`}
            placeholder="Off-agenda notes, or paste from a recorder..."
          />
          {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={reset} className={BTN_SECONDARY} disabled={extracting}>
              Cancel
            </button>
            <button
              onClick={() => runWrapUp(next)}
              disabled={extracting || !assembleRawNotes(next).trim()}
              className={BTN_PRIMARY_SM}
            >
              {extracting ? "Drafting..." : "Wrap up & log →"}
            </button>
          </div>
        </div>
      )}

      {mode === "review" && next && draft && (
        <div className="mt-3">
          <MeetingWrapUpReview
            meeting={next}
            members={members.map((m) => ({ id: m.id, name: m.name }))}
            rawNotes={assembleRawNotes(next)}
            draft={draft}
            outcomes={outcomes}
            onBack={() => setMode("log")}
            onSaved={onLogged}
          />
        </div>
      )}

      {logged.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No meetings logged yet.</p>
      ) : (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {logged.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className="w-56 shrink-0 overflow-hidden rounded-xl border border-hairline bg-surface text-left hover:border-control hover:shadow-sm"
            >
              <div className={`h-1.5 ${CARD_ACCENTS[i % CARD_ACCENTS.length]}`} />
              <div className="px-3 py-2.5">
                <p className="text-xs text-ink-muted">
                  {m.scheduled_at ? formatMeetingDate(isoToDateStr(m.scheduled_at)) : timeAgo(m.created_at)}
                </p>
                <p className="mt-1 text-sm text-ink-body">{snippet(m.summary ?? "", 90)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && <LoggedMeetingModal meeting={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// One meeting, agenda and outcome together — the thing the old two-row model
// could not show at all.
function LoggedMeetingModal({ meeting, onClose }: { meeting: TeamMeeting; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <p className={EYEBROW}>
            {meeting.scheduled_at
              ? formatMeetingDate(isoToDateStr(meeting.scheduled_at))
              : timeAgo(meeting.created_at)}
          </p>
          <button onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink-body">
            &times;
          </button>
        </div>

        <p className="mt-3 whitespace-pre-wrap text-sm text-ink-body">{meeting.summary}</p>

        {meeting.agenda_items.length > 0 && (
          <div className="mt-5">
            <p className={EYEBROW}>Agenda</p>
            <ul className="mt-2 space-y-2">
              {meeting.agenda_items.map((item) => (
                <li key={item.id} className="rounded-lg border border-hairline bg-sunken px-3 py-2">
                  <p className="text-sm text-ink-body">
                    {item.item}
                    {!item.covered && (
                      <span className="ml-2 rounded-full border border-hairline px-1.5 text-[10px] text-ink-muted">
                        not covered
                      </span>
                    )}
                  </p>
                  {item.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-ink-secondary">{item.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">Your team</h2>

      {members.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-ink-body">
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
                className={`flex items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left hover:border-control ${
                  expandedId === m.id ? "border-brand" : "border-hairline"
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${IDENTITY_TEXT} ${avatarColor(
                    m.id,
                    members
                  )}`}
                >
                  {initials(m.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                  {hasRole ? (
                    chipText && <p className="truncate text-xs text-ink-secondary">{chipText}</p>
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
    <div className="rounded-xl border border-hairline bg-canvas/60 px-4 py-4">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Priorities{member.priorities.length > 0 && ` (${member.priorities.length})`}
          </p>
          {member.priorities.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">None set.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {member.priorities.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink-body">{g.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[g.status]}`}>
                    {STATUS_LABELS[g.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">
            Projects{member.projects.length > 0 && ` (${member.projects.length})`}
          </p>
          {member.projects.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">None active.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {member.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink-body">{p.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/app/reports/${member.id}`}
            className="mt-3 inline-block text-xs text-ink-secondary underline hover:text-ink-body"
          >
            Open full profile
          </Link>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">
            Log update for {member.name}
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-control px-3 py-2 text-sm"
            placeholder="Not sent anywhere yet — just kept on record here until reports can log in."
          />
          <div className="mt-2">
            <button
              onClick={submitMessage}
              disabled={sending || !draft.trim()}
              className="rounded-md bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
            >
              {sending ? "Saving..." : "Save update"}
            </button>
          </div>

          {history && history.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">History</p>
              <ul className="mt-1.5 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {history.map((msg) => (
                  <li key={msg.id} className="text-sm text-ink-secondary">
                    <span className="text-xs text-ink-muted">{timeAgo(msg.created_at)}</span> — {msg.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Account</p>
          {member.user_id ? (
            <p className="mt-1 text-xs text-ink-secondary">Account linked — they can log in.</p>
          ) : inviting ? (
            <div className="mt-1">
              {inviteUrl ? (
                <div>
                  <p className="text-xs text-ink-secondary">Share this link with them — it expires in 7 days:</p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteUrl}
                      onFocus={(e) => e.target.select()}
                      className="w-full truncate rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink-secondary"
                    />
                    <button
                      onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                      className="shrink-0 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary hover:bg-surface"
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
                    className="w-full rounded-md border border-control px-2 py-1 text-xs"
                  />
                  <button
                    onClick={submitInvite}
                    disabled={inviteSending || !inviteEmail.trim()}
                    className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs text-on-brand disabled:opacity-50"
                  >
                    {inviteSending ? "Sending…" : "Send"}
                  </button>
                </div>
              )}
              {inviteError && <p className="mt-1 text-xs text-red-700">{inviteError}</p>}
            </div>
          ) : (
            <button
              onClick={() => setInviting(true)}
              className="mt-1 text-xs font-medium text-ink-secondary underline hover:text-ink-body"
            >
              Invite to log in
            </button>
          )}

          {member.latest_message && (
            <p className="mt-4 text-xs text-ink-muted">
              Last update {timeAgo(member.latest_message.created_at)}: &ldquo;{member.latest_message.message}&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
