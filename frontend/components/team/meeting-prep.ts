// ---------------------------------------------------------------------------
// Meeting preparation — what a team meeting should know about before it runs,
// assembled deterministically from records the manager already has. No AI,
// no inferred health, no new storage. Every entry carries its source, its
// date and the reason it is shown, so the manager can check it.
//
//   Carried over   agenda items carried in from an earlier meeting (lineage
//                  via carried_from_item_id), and commitments made at the
//                  last logged meeting that are still open.
//   What changed   records with a real timestamp after a named boundary —
//                  the last LOGGED meeting for the same team: goal/project
//                  check-ins, commitments marked done, commitments added.
//                  With no earlier logged meeting there is no boundary, and
//                  nothing is called "changed".
//   Decisions      The Same Page does not record decision requests or
//                  blockers. The panel says so rather than inferring one
//                  from an overdue date or an at-risk status.
//
// Privacy: team-level records only. 1:1 notes, assessments, Relationship
// Desk notes and the private per-person update record never enter this.
// ---------------------------------------------------------------------------

import type { Project, TeamCommitment, TeamGoal, TeamMeeting } from "@/lib/api";
import { instantDate, meetingDateStr, shortDate } from "./dates";
import {
  TeamScope,
  inScopeCommitment,
  inScopeGoal,
  inScopeProject,
} from "./scope";

export type PrepSource = { label: string; href: string | null };

export type PrepEntry = {
  key: string;
  title: string;
  detail: string;
  /** ISO timestamp or YYYY-MM-DD of the underlying record, when known. */
  date: string | null;
  source: PrepSource;
  why: string;
  /** Wording offered for the agenda if the manager chooses to add it. */
  suggestion: string;
  ownerId?: string | null;
  ownerName?: string | null;
};

export type PrepBoundary = { meeting: TeamMeeting; at: string };

export type MeetingPrep = {
  boundary: PrepBoundary | null;
  carried: PrepEntry[];
  changed: PrepEntry[];
  /** Sources that failed to load — a gap, never "nothing changed". */
  unavailable: string[];
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function meetingLabel(m: Pick<TeamMeeting, "scheduled_at">): string {
  const d = meetingDateStr(m.scheduled_at);
  return d ? `the ${shortDate(d)} meeting` : "an undated meeting";
}

function loggedAt(m: TeamMeeting): string | null {
  return m.logged_at ?? m.scheduled_at ?? null;
}

// The last logged meeting for exactly the same team (null = All teams) —
// the same "same team" rule rollover uses. Not an ancestor or sibling team.
export function previousLoggedMeeting(meeting: TeamMeeting, meetings: TeamMeeting[]): PrepBoundary | null {
  const candidates = meetings
    .filter((m) => m.id !== meeting.id && m.status === "logged" && m.org_unit_id === meeting.org_unit_id)
    .map((m) => ({ meeting: m, at: loggedAt(m) }))
    .filter((c): c is PrepBoundary => c.at !== null)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return candidates[0] ?? null;
}

function ownerName(c: TeamCommitment): string {
  return c.direct_report_name ?? "You";
}

export function commitmentSource(
  c: TeamCommitment,
  meetings: TeamMeeting[],
  work: { goals: TeamGoal[]; projects: Project[] }
): PrepSource {
  if (c.source_type === "team_meeting" && c.source_id) {
    const m = meetings.find((row) => row.id === c.source_id);
    return {
      label: m ? `From ${meetingLabel(m)}` : "From a team meeting",
      href: `/app/team/meetings/${c.source_id}`,
    };
  }
  if (c.source_type === "project" && c.source_id) {
    const p = work.projects.find((row) => row.id === c.source_id);
    return { label: p ? `From the project ${p.title}` : "From a project", href: "/app/projects" };
  }
  if (c.source_type === "goal" && c.source_id) {
    const g = work.goals.find((row) => row.id === c.source_id);
    return { label: g ? `From the goal ${g.title}` : "From a goal", href: "/app/goals" };
  }
  if (c.source_type === "one_on_one") {
    return {
      label: "From a 1:1",
      href: c.direct_report_id ? `/app/reports/${c.direct_report_id}` : null,
    };
  }
  if (c.source_type === "outside_meeting") return { label: "From a meeting beyond the team", href: "/app/beyond" };
  return { label: "Added on the Team page", href: null };
}

export function derivePrep(args: {
  meeting: TeamMeeting;
  meetings: TeamMeeting[];
  commitments: TeamCommitment[];
  goals: TeamGoal[];
  projects: Project[];
  scope: TeamScope;
  unavailable?: string[];
}): MeetingPrep {
  const { meeting, meetings, commitments, goals, projects, scope } = args;
  const boundary = previousLoggedMeeting(meeting, meetings);
  const work = { goals, projects };

  // --- carried over ---------------------------------------------------------
  const itemIndex = new Map<string, { item: TeamMeeting["agenda_items"][number]; meeting: TeamMeeting }>();
  for (const m of meetings) for (const item of m.agenda_items) itemIndex.set(item.id, { item, meeting: m });

  const carried: PrepEntry[] = [];
  for (const item of meeting.agenda_items) {
    if (!item.carried_from_item_id) continue;
    const origin = itemIndex.get(item.carried_from_item_id);
    carried.push({
      key: `carried-${item.id}`,
      title: item.item,
      detail: origin
        ? origin.item.covered
          ? `Carried from ${meetingLabel(origin.meeting)}`
          : `Carried from ${meetingLabel(origin.meeting)}, where it wasn't covered`
        : "Carried from an earlier meeting",
      date: origin?.meeting.scheduled_at ?? null,
      source: origin
        ? { label: `Open ${meetingLabel(origin.meeting)}`, href: `/app/team/meetings/${origin.meeting.id}` }
        : { label: "Earlier meeting no longer available", href: null },
      why: "Chosen to carry forward when that meeting was logged. It is already on this agenda.",
      suggestion: item.item,
    });
  }

  if (boundary) {
    for (const c of commitments) {
      if (c.status !== "open" || c.source_type !== "team_meeting" || c.source_id !== boundary.meeting.id) continue;
      carried.push({
        key: `open-${c.id}`,
        title: c.description,
        detail: `${ownerName(c)} · still open from ${meetingLabel(boundary.meeting)}${c.due_date ? ` · due ${shortDate(c.due_date)}` : ""}`,
        date: c.created_at,
        source: commitmentSource(c, meetings, work),
        why: "Agreed at your last logged meeting for this team and not marked done since.",
        suggestion: `Follow up: ${c.description}`,
        ownerId: c.direct_report_id ?? null,
        ownerName: ownerName(c),
      });
    }
  }

  // --- what changed ---------------------------------------------------------
  const changed: PrepEntry[] = [];
  if (boundary) {
    const since = boundary.at;
    const sinceLabel = `after ${meetingLabel(boundary.meeting)} was logged`;

    for (const g of goals) {
      if (!inScopeGoal(scope, g) || !g.last_check_in_at || g.last_check_in_at <= since) continue;
      changed.push({
        key: `goal-${g.id}`,
        title: g.title,
        detail: checkInDetail(g),
        date: g.last_check_in_at,
        source: { label: "Open Goals", href: "/app/goals" },
        why: `Its latest check-in was recorded ${sinceLabel}.`,
        suggestion: g.title,
      });
    }
    for (const p of projects) {
      if (!inScopeProject(scope, p) || !p.last_check_in_at || p.last_check_in_at <= since) continue;
      changed.push({
        key: `project-${p.id}`,
        title: p.title,
        detail: checkInDetail(p),
        date: p.last_check_in_at,
        source: { label: "Open Projects", href: "/app/projects" },
        why: `Its latest check-in was recorded ${sinceLabel}.`,
        suggestion: p.title,
        ownerId: p.direct_report_id,
        ownerName: p.direct_report_name ?? "You",
      });
    }
    for (const c of commitments) {
      if (!inScopeCommitment(scope, c)) continue;
      if (c.status === "done" && c.completed_at && c.completed_at > since) {
        changed.push({
          key: `done-${c.id}`,
          title: c.description,
          detail: `${ownerName(c)} · marked done ${instantDate(c.completed_at)}`,
          date: c.completed_at,
          source: commitmentSource(c, meetings, work),
          why: `Marked done ${sinceLabel}.`,
          suggestion: c.description,
          ownerId: c.direct_report_id ?? null,
          ownerName: ownerName(c),
        });
        continue;
      }
      // Commitments the boundary meeting itself created are its outcomes,
      // not a change since — they are listed under Carried over while open.
      if (c.status === "open" && c.created_at > since && c.source_id !== boundary.meeting.id) {
        changed.push({
          key: `added-${c.id}`,
          title: c.description,
          detail: `${ownerName(c)} · added ${instantDate(c.created_at)}${c.due_date ? ` · due ${shortDate(c.due_date)}` : ""}`,
          date: c.created_at,
          source: commitmentSource(c, meetings, work),
          why: `Added ${sinceLabel}.`,
          suggestion: c.description,
          ownerId: c.direct_report_id ?? null,
          ownerName: ownerName(c),
        });
      }
    }
    changed.sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? 1 : -1));
  }

  return { boundary, carried, changed, unavailable: args.unavailable ?? [] };
}

function checkInDetail(row: {
  status: string;
  progress?: number | null;
  last_check_in_at?: string | null;
  last_check_in_note?: string | null;
}): string {
  const parts = [`Check-in ${row.last_check_in_at ? instantDate(row.last_check_in_at) : ""}`.trim(), STATUS_LABEL[row.status] ?? row.status];
  // Only a recorded percentage is shown; no progress recorded is not 0%.
  if (row.progress != null) parts.push(`${row.progress}%`);
  const base = parts.join(" · ");
  return row.last_check_in_note ? `${base} — “${row.last_check_in_note}”` : base;
}

export function onAgenda(meeting: TeamMeeting, text: string): boolean {
  const key = text.trim().toLowerCase();
  return meeting.agenda_items.some((item) => item.item.trim().toLowerCase() === key);
}
