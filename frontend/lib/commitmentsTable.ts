// The commitments table's rules (components/commitments/CommitmentsTable.tsx),
// kept pure so lib/commitmentsTable.test.mjs can pin them. Dates are bare
// "YYYY-MM-DD" strings in the manager's local calendar; nothing here reads
// the clock.

import type { BoardCommitment } from "./api";

export type StateFilter = "open" | "overdue" | "week" | "undated" | "done";
/** "you" | "team" (your people owe it) | "outside" | "everyone" | a direct report id */
export type OwnerFilter = string;

// Open this long with no date, or overdue this long, gets "Still on?".
export const STALE_OPEN_DAYS = 30;
export const STALE_OVERDUE_DAYS = 14;

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function ageWords(days: number): string {
  if (days >= 14) return `${Math.floor(days / 7)} weeks`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function firstName(name: string | null | undefined): string {
  return name ? name.split(/\s+/)[0] : "";
}

type Row = Pick<BoardCommitment, "status" | "due_date" | "owner" | "direct_report_id" | "created_at" | "completed_at">;

export function stateOf(c: Row, today: string): "done" | "dropped" | "overdue" | "week" | "later" | "undated" {
  if (c.status === "done") return "done";
  if (c.status === "dropped") return "dropped";
  if (!c.due_date) return "undated";
  if (c.due_date < today) return "overdue";
  if (c.due_date <= addDays(today, 7)) return "week";
  return "later";
}

export function matchesState(c: Row, f: StateFilter, today: string): boolean {
  const s = stateOf(c, today);
  if (f === "done") return s === "done";
  if (c.status !== "open") return false;
  if (f === "open") return true;
  return s === f;
}

export function matchesOwner(c: Row, f: OwnerFilter): boolean {
  if (f === "everyone") return true;
  if (f === "you") return c.owner === "you";
  if (f === "team") return c.owner === "report";
  if (f === "outside") return c.owner === "counterpart";
  // A person: everything between you and them, whichever side owes it.
  return c.direct_report_id === f;
}

// Overdue first (longest waiting first), then by due date, then undated
// oldest first, so the item most likely costing trust is on top. Done reads
// most recent first.
export function sortRows<T extends Row>(rows: T[], today: string): T[] {
  const rank = (c: Row) => {
    const s = stateOf(c, today);
    return s === "overdue" ? 0 : s === "week" || s === "later" ? 1 : s === "undated" ? 2 : 3;
  };
  return [...rows].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (a.status === "done" && b.status === "done") return (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
    return a.created_at.localeCompare(b.created_at);
  });
}

/** "Still on?" prompt for an open row that has gone quiet, or null. createdDay is the local day it was made. */
export function staleNote(c: Row, createdDay: string, today: string): string | null {
  if (c.status !== "open") return null;
  if (!c.due_date) {
    const age = daysBetween(createdDay, today);
    return age > STALE_OPEN_DAYS ? `Open ${ageWords(age)}, no date. Still on?` : null;
  }
  return daysBetween(c.due_date, today) > STALE_OVERDUE_DAYS ? "Still on?" : null;
}

/**
 * Which board rows the Team page's table holds (docs/systems/commitments.md).
 * By default only commitments made for the team: team-meeting rows and ones
 * added on the Team page (is_team_commitment), in the selected team. The
 * page will be seen by people on the team, so 1:1 commitments are added only
 * when the manager asks, and then only for people in this team.
 */
export function inTeamTable(
  c: Pick<BoardCommitment, "is_team_commitment" | "org_unit_id" | "direct_report_id" | "owner">,
  opts: { teamId: string | null; memberIds: Set<string>; includeOneOnOnes: boolean }
): boolean {
  if (c.is_team_commitment) return opts.teamId === null || c.org_unit_id === opts.teamId;
  if (!opts.includeOneOnOnes || c.owner === "counterpart" || !c.direct_report_id) return false;
  return opts.memberIds.has(c.direct_report_id);
}
