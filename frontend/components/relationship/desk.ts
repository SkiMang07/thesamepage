// Pure helpers for the Relationship Desk (/app/reports/[id]). No fetching,
// no state: the page passes real records in and renders what comes out.
//
// Everything here is literal or counted. Excerpts are the reviewed text's own
// opening words, never a rewrite; counts come from explicit record links
// (a commitment's source_id), never from shared owners or similar wording.

import type { Commitment, Goal, OneOnOne, Project } from "@/lib/api";
import { isoToDateStr, localDateStr } from "@/components/team/dates";

/** The opening sentence of a reviewed text, cut at a word near `max`. */
export function excerpt(text: string | null | undefined, max = 160): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, "")}…`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "Sep 25, 2026" from a YYYY-MM-DD local date. */
export function fullDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A session's meeting date as a local YYYY-MM-DD, or null when none is recorded. */
export function sessionDate(session: Pick<OneOnOne, "meeting_date"> | null | undefined): string | null {
  return session?.meeting_date ? isoToDateStr(session.meeting_date) : null;
}

export function recurrenceLabel(weeks: number | null | undefined): string | null {
  if (!weeks) return null;
  return weeks === 1 ? "Every week" : `Every ${weeks} weeks`;
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

export type Owner = "manager" | "direct_report";

export function ownerOf(c: Commitment): Owner {
  return c.committed_by === "direct_report" ? "direct_report" : "manager";
}

/**
 * Deterministic follow-through order: dated before undated, earliest due
 * first (so overdue leads), then oldest created, then id. Undated records
 * stay reachable at the end rather than hidden.
 */
export function sortOpenCommitments(list: Commitment[]): Commitment[] {
  return [...list].sort((a, b) => {
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Most recently resolved first. */
export function sortResolvedCommitments(list: Commitment[]): Commitment[] {
  return [...list].sort((a, b) => {
    const at = a.completed_at ?? a.created_at;
    const bt = b.completed_at ?? b.created_at;
    if (at !== bt) return at < bt ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
}

/** Commitments explicitly linked to one 1:1 occurrence. */
export function commitmentsFromSession(list: Commitment[], sessionId: string): Commitment[] {
  return list.filter((c) => c.source_type === "one_on_one" && c.source_id === sessionId);
}

export type CommitmentSource =
  | { kind: "conversation"; session: OneOnOne; date: string | null }
  | { kind: "conversation-unavailable" }
  | { kind: "other"; label: string }
  | { kind: "unknown" };

const OTHER_SOURCE_LABELS: Record<string, string> = {
  manual: "Added directly",
  goal: "Added from a goal",
  project: "Added from a project",
  team_meeting: "From a team meeting",
  outside_meeting: "From a meeting beyond the team",
};

/**
 * Where a commitment was made, resolved only against records this manager
 * could read on this page. A 1:1 link that doesn't resolve (deleted, not yet
 * logged, or not this person's) is reported as unavailable, never guessed.
 */
export function commitmentSource(c: Commitment, completedSessions: OneOnOne[]): CommitmentSource {
  if (c.source_type === "one_on_one") {
    const session = c.source_id ? completedSessions.find((s) => s.id === c.source_id) : undefined;
    return session
      ? { kind: "conversation", session, date: sessionDate(session) }
      : { kind: "conversation-unavailable" };
  }
  if (c.source_type && OTHER_SOURCE_LABELS[c.source_type]) {
    return { kind: "other", label: OTHER_SOURCE_LABELS[c.source_type] };
  }
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Next conversation
// ---------------------------------------------------------------------------

export type CadenceTruth =
  | { kind: "due"; days: number; cadenceDays: number; custom: boolean }
  | { kind: "unknown" };

/** Cadence due-ness from the last completed meeting date. Never a scheduled date. */
export function cadenceTruth(
  lastDate: string | null,
  cadenceDays: number,
  custom: boolean,
  today: string = localDateStr()
): CadenceTruth {
  if (!lastDate) return { kind: "unknown" };
  const [y, m, d] = lastDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const since = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
  return { kind: "due", days: cadenceDays - since, cadenceDays, custom };
}

export function cadenceSentence(truth: CadenceTruth): string | null {
  if (truth.kind !== "due") return null;
  const rule = `every ${truth.cadenceDays} days, ${truth.custom ? "your setting for this person" : "your default"}`;
  if (truth.days > 0) return `Due by cadence in ${truth.days} day${truth.days === 1 ? "" : "s"} (${rule})`;
  if (truth.days === 0) return `Due by cadence today (${rule})`;
  return `Past due by cadence, ${Math.abs(truth.days)} day${truth.days === -1 ? "" : "s"} (${rule})`;
}

// ---------------------------------------------------------------------------
// Work updates
// ---------------------------------------------------------------------------

export type WorkUpdate = {
  key: string;
  kind: "Goal" | "Project";
  title: string;
  status: string;
  at: string; // ISO timestamp of the latest check-in
  note: string | null;
  href: string;
};

/** Every person-scoped goal/project with a recorded check-in, newest first. */
export function recordedWorkUpdates(goals: Goal[], projects: Project[]): WorkUpdate[] {
  const updates: WorkUpdate[] = [];
  goals.forEach((g) => {
    if (g.last_check_in_at)
      updates.push({ key: `goal-${g.id}`, kind: "Goal", title: g.title, status: g.status, at: g.last_check_in_at, note: g.last_check_in_note ?? null, href: "/app/goals" });
  });
  projects.forEach((p) => {
    if (p.last_check_in_at)
      updates.push({ key: `project-${p.id}`, kind: "Project", title: p.title, status: p.status, at: p.last_check_in_at, note: p.last_check_in_note ?? null, href: "/app/projects" });
  });
  return updates.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? -1 : 1));
}

/**
 * Updates recorded after the last conversation's date. Null when there is no
 * known prior meeting date, so the caller labels the basis as "latest
 * recorded" instead of claiming "since the last 1:1".
 */
export function updatesSince(updates: WorkUpdate[], lastDate: string | null): WorkUpdate[] | null {
  if (!lastDate) return null;
  return updates.filter((u) => isoToDateStr(u.at) > lastDate);
}
