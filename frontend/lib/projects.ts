// Projects page helpers: the portfolio overview's counts, attention reasons,
// ordering and scope matching. Pure functions, no fetching, no path-alias
// imports (lib/projects.test.mjs runs this file directly under Node).
// See docs/systems/projects.md.
//
// Honesty rules these carry: every count is of records, never a score;
// attention categories overlap and are never summed; "missing a recent
// update" is missing context, not project risk; unknown is never zero.

import type { Project, ProjectStatus } from "./api";

/** An open project with no update for more than this many days is "missing
 *  a recent update". Same threshold as goals and check-ins. */
export const STALE_DAYS = 14;

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ["active", "on_track", "at_risk", "completed", "cancelled"];

export type OwnerKey = "all" | "you" | string; // "you" = unassigned (the manager's own)
export type AttentionFilter = "all" | "attention" | "missing";

export function isClosed(p: Pick<Project, "status">) {
  return p.status === "completed" || p.status === "cancelled";
}

// --- local dates -------------------------------------------------------------

export function localDay(d: Date = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayNumber(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(new Date(y, m - 1, d).getTime() / 86_400_000);
}

/** Whole local calendar days between a timestamp and now. */
export function daysSince(iso: string, now: Date = new Date()) {
  return dayNumber(localDay(now)) - dayNumber(localDay(new Date(iso)));
}

/** A date-only column (due_date) in local time, never UTC midnight. */
export function formatDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A timestamp (created_at) as the viewer's local date. */
export function formatMoment(iso: string, withYear = true) {
  return new Date(iso).toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
}

// --- attention ---------------------------------------------------------------

export function isPastDue(p: Pick<Project, "due_date" | "status">, today = localDay()) {
  return !isClosed(p) && !!p.due_date && p.due_date < today;
}

/** At risk OR past due — one project counts once however many apply. */
export function needsAttention(p: Pick<Project, "status" | "due_date">, today = localDay()) {
  return !isClosed(p) && (p.status === "at_risk" || isPastDue(p, today));
}

/** No update ever, or the newest one is older than STALE_DAYS. */
export function isMissingUpdate(p: Pick<Project, "status" | "last_check_in_at">, now = new Date()) {
  if (isClosed(p)) return false;
  if (!p.last_check_in_at) return true;
  return daysSince(p.last_check_in_at, now) > STALE_DAYS;
}

export type Reason = { text: string; tone: "attention" | "context" };

export function attentionReasons(p: Project, now = new Date()): Reason[] {
  if (isClosed(p)) return [];
  const today = localDay(now);
  const out: Reason[] = [];
  if (p.status === "at_risk") out.push({ text: "Marked at risk", tone: "attention" });
  if (isPastDue(p, today)) out.push({ text: `Past due · ${formatDay(p.due_date!)}`, tone: "attention" });
  if (!p.last_check_in_at) out.push({ text: "No update yet", tone: "context" });
  else if (isMissingUpdate(p, now)) out.push({ text: `No update in ${daysSince(p.last_check_in_at, now)} days`, tone: "context" });
  return out;
}

/** Exceptions first: at risk / past due, then missing an update, then the
 *  rest; within a group, soonest due date, then title. */
export function rank(p: Project, now = new Date()) {
  const today = localDay(now);
  if (needsAttention(p, today)) return 0;
  if (isMissingUpdate(p, now)) return 1;
  return 2;
}

export function compareProjects(a: Project, b: Project, now = new Date()) {
  const r = rank(a, now) - rank(b, now);
  if (r) return r;
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date && !b.due_date) return -1;
  if (!a.due_date && b.due_date) return 1;
  return a.title.localeCompare(b.title);
}

// --- scope -------------------------------------------------------------------

export function ownerKey(p: Pick<Project, "direct_report_id">): string {
  return p.direct_report_id ?? "you";
}

export function ownerName(p: Pick<Project, "direct_report_name" | "direct_report_id">) {
  return p.direct_report_id ? p.direct_report_name ?? "Former report" : "You";
}

export function matchesScope(p: Project, owner: OwnerKey, query: string) {
  if (owner !== "all" && ownerKey(p) !== owner) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.title, p.description, ownerName(p), p.org_unit_name, p.goal_title]
    .filter(Boolean)
    .some((s) => String(s).toLowerCase().includes(q));
}

export type Overview = {
  open: number;
  attention: number;
  missing: number;
  /** Open next moves in scope, closed projects included. null = unknown. */
  nextMoves: number | null;
};

/** Counts for the band, over the owner/search scope only — the selected
 *  attention filter never shrinks them. */
export function overview(scoped: Project[], now = new Date()): Overview {
  const today = localDay(now);
  const open = scoped.filter((p) => !isClosed(p));
  const unknown = scoped.some((p) => p.next_move_available === false);
  return {
    open: open.length,
    attention: open.filter((p) => needsAttention(p, today)).length,
    missing: open.filter((p) => isMissingUpdate(p, now)).length,
    nextMoves: unknown ? null : scoped.filter((p) => p.next_move?.status === "open").length,
  };
}

export function applyAttention(open: Project[], filter: AttentionFilter, now = new Date()) {
  if (filter === "attention") return open.filter((p) => needsAttention(p, localDay(now)));
  if (filter === "missing") return open.filter((p) => isMissingUpdate(p, now));
  return open;
}

export function parseCompletion(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 100) return { ok: false, error: "Completion must be a whole number from 0 to 100, or blank." };
  return { ok: true, value: n };
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
