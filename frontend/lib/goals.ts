// Goals page helpers: formatting, the measure comparison, scope matching and
// plot geometry. Pure functions, no fetching. See docs/systems/goals.md.
//
// Honesty rules these helpers carry: a reading is only ever a value someone
// entered (never inferred from prose, status or completion %); the target is
// always the CURRENT target; completion % and a percent-valued measure are
// different things and are formatted differently.

import type {
  CheckIn,
  DirectReport,
  Goal,
  GoalLevel,
  GoalMeasure,
  GoalMeasureDirection,
  GoalMeasureFormat,
  GoalReading,
  GoalStatus,
  OrgUnit,
} from "@/lib/api";

export const LEVELS: { id: GoalLevel; label: string }[] = [
  { id: "individual", label: "Individual" },
  { id: "team", label: "Team" },
  { id: "department", label: "Department" },
  { id: "company", label: "Company" },
];

export const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_ORDER: GoalStatus[] = ["active", "on_track", "at_risk", "completed", "cancelled"];

export const FORMAT_LABEL: Record<GoalMeasureFormat, string> = {
  count: "Count (whole numbers)",
  number: "Number",
  percent: "Percentage",
};

export const DIRECTION_LABEL: Record<GoalMeasureDirection, string> = {
  at_least: "At least",
  at_most: "At most",
  below: "Below",
};

const DIRECTION_SYMBOL: Record<GoalMeasureDirection, string> = { at_least: "≥", at_most: "≤", below: "<" };

// Past this many days without a check-in an open goal needs review. Same
// constant as CheckInPanel (docs/systems/check-ins.md).
export const STALE_DAYS = 14;

export function isOpen(g: Pick<Goal, "status">) {
  return g.status !== "completed" && g.status !== "cancelled";
}

// --- dates ------------------------------------------------------------------

/** A date-only column (due_date) in local time, never UTC midnight. */
export function formatDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A timestamp (created_at) in the viewer's own timezone. */
export function formatMoment(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function localDay(d: Date = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayNumber(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(new Date(y, m - 1, d).getTime() / 86_400_000);
}

export function daysSince(iso: string, now: Date = new Date()) {
  return dayNumber(localDay(now)) - dayNumber(localDay(new Date(iso)));
}

export function dueLabel(g: Pick<Goal, "due_date" | "status">, today = localDay()) {
  if (!g.due_date) return "No due date";
  const diff = dayNumber(g.due_date) - dayNumber(today);
  if (isOpen(g) && diff >= 0 && diff <= 14) {
    return `Due ${formatDay(g.due_date)} · ${diff === 0 ? "today" : `in ${diff} day${diff === 1 ? "" : "s"}`}`;
  }
  return `Due ${formatDay(g.due_date)}`;
}

// --- review reasons -----------------------------------------------------------

export function reviewReasons(g: Goal, today = localDay(), now = new Date()): string[] {
  if (!isOpen(g)) return [];
  const out: string[] = [];
  if (g.status === "at_risk") out.push("Marked at risk");
  if (g.due_date && g.due_date < today) out.push(`Past due · ${formatDay(g.due_date)}`);
  if (g.last_check_in_at) {
    const age = daysSince(g.last_check_in_at, now);
    if (age > STALE_DAYS) out.push(`Last check-in ${age} days ago`);
  }
  return out;
}

export function hasNoCheckIn(g: Goal) {
  return isOpen(g) && !g.last_check_in_at;
}

// --- measure formatting -------------------------------------------------------

export function formatNumber(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** "12 handoffs", "112.5%", "3.2" (a number with no unit). */
export function formatValue(value: number, m: Pick<GoalMeasure, "format" | "unit">) {
  if (m.format === "percent") return `${formatNumber(value)}%`;
  return m.unit ? `${formatNumber(value)} ${m.unit}` : formatNumber(value);
}

/** The big-number pieces: "112.5%" + "" or "12" + "handoffs". */
export function valueParts(value: number, m: Pick<GoalMeasure, "format" | "unit">) {
  if (m.format === "percent") return { number: `${formatNumber(value)}%`, unit: "" };
  return { number: formatNumber(value), unit: m.unit ?? "" };
}

export function targetSymbol(m: Pick<GoalMeasure, "direction">) {
  return DIRECTION_SYMBOL[m.direction];
}

/** "At least 20 handoffs". */
export function targetText(m: GoalMeasure) {
  return `${DIRECTION_LABEL[m.direction]} ${formatValue(m.target, m)}`;
}

/** "≥20" / "<15%" — compact target for the board. */
export function targetShort(m: GoalMeasure) {
  return `${targetSymbol(m)}${formatNumber(m.target)}${m.format === "percent" ? "%" : ""}`;
}

/** Does a recorded value satisfy the CURRENT target? A fact about one
 *  reading, never a status change and never an evaluation of a person. */
export function meetsTarget(value: number, m: GoalMeasure) {
  if (m.direction === "at_least") return value >= m.target;
  if (m.direction === "at_most") return value <= m.target;
  return value < m.target;
}

// --- input parsing ------------------------------------------------------------

export type Parsed = { ok: true; value: number | null } | { ok: false; error: string };

/** A measured value from a text field. Blank = no new value; "0" = zero. */
export function parseMeasuredValue(raw: string, format: GoalMeasureFormat): Parsed {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number, or leave it blank." };
  if (format === "count" && (n < 0 || !Number.isInteger(n))) {
    return { ok: false, error: "A count is a whole number of zero or more." };
  }
  return { ok: true, value: n };
}

/** Completion % (0-100, whole). Blank = unchanged. */
export function parseCompletion(raw: string): Parsed {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    return { ok: false, error: "Completion is a whole number from 0 to 100." };
  }
  return { ok: true, value: n };
}

// --- scope ----------------------------------------------------------------------

/** "all" = every goal at the level; "none" = goals with no association
 *  (distinct from all); otherwise a direct report id or org unit id. */
export type Scope = "all" | "none" | string;

export function associationId(g: Pick<Goal, "level" | "direct_report_id" | "org_unit_id">) {
  if (g.level === "individual") return g.direct_report_id;
  if (g.level === "team" || g.level === "department") return g.org_unit_id;
  return null;
}

export function inScope(g: Goal, level: GoalLevel, scope: Scope) {
  if (g.level !== level) return false;
  if (scope === "all" || level === "company") return true;
  const id = associationId(g);
  return scope === "none" ? id == null : id === scope;
}

export function unlinkedLabel(level: GoalLevel) {
  return level === "individual" ? "No person linked" : level === "department" ? "No department linked" : "No team linked";
}

export function allLabel(level: GoalLevel) {
  return level === "individual" ? "All people" : level === "team" ? "All teams" : level === "department" ? "All departments" : "Company";
}

export type ScopeOption = { id: Scope; label: string };

/** Scope choices for a level, keyed by id. Labels come from the people and
 *  org units lists; a repeated name gets a counter so two people named Sam
 *  never read as one. */
export function scopeOptions(level: GoalLevel, goals: Goal[], reports: DirectReport[], units: OrgUnit[]): ScopeOption[] {
  if (level === "company") return [];
  const levelGoals = goals.filter((g) => g.level === level);
  const ids = new Set(levelGoals.map(associationId).filter((id): id is string => !!id));
  const named: { id: string; label: string }[] = [];
  for (const id of ids) {
    const fromList =
      level === "individual" ? reports.find((r) => r.id === id)?.name : units.find((u) => u.id === id)?.name;
    const fromGoal = levelGoals.find((g) => associationId(g) === id);
    const label =
      fromList ?? (level === "individual" ? fromGoal?.direct_report_name : fromGoal?.org_unit_name) ?? "Unnamed";
    named.push({ id, label });
  }
  named.sort((a, b) => a.label.localeCompare(b.label));
  const seen = new Map<string, number>();
  const options: ScopeOption[] = named.map((n) => {
    const count = (seen.get(n.label) ?? 0) + 1;
    seen.set(n.label, count);
    return { id: n.id, label: count > 1 ? `${n.label} (${count})` : n.label };
  });
  const out: ScopeOption[] = [{ id: "all", label: allLabel(level) }, ...options];
  if (levelGoals.some((g) => associationId(g) == null)) out.push({ id: "none", label: unlinkedLabel(level) });
  return out;
}

/** The small label above a goal title. */
export function scopeLabel(g: Goal) {
  if (g.level === "company") return "Company";
  if (g.level === "individual") return g.direct_report_name ?? unlinkedLabel("individual");
  return g.org_unit_name ?? unlinkedLabel(g.level);
}

export function matchesQuery(g: Goal, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [g.title, scopeLabel(g), g.success_metrics ?? "", g.measure?.label ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

// --- plot -------------------------------------------------------------------------

export type PlotPoint = { x: number; y: number; reading: GoalReading };

/** Readings positioned by TIME (not by index) in a width x height box, plus
 *  the current target's y. Needs at least two readings; one reading has no
 *  line. The y range always includes the target and zero. */
export function plotGeometry(readings: GoalReading[], target: number, width: number, height: number, pad = 6) {
  const pts = [...readings].sort((a, b) => a.at.localeCompare(b.at));
  if (pts.length < 2) return null;
  const t0 = new Date(pts[0].at).getTime();
  const t1 = new Date(pts[pts.length - 1].at).getTime();
  const span = t1 - t0 || 1;
  const values = pts.map((p) => p.value);
  const hi = Math.max(target, ...values, 0);
  const lo = Math.min(target, ...values, 0);
  const range = hi - lo || 1;
  const top = hi + range * 0.12;
  const y = (v: number) => pad + ((top - v) / (top - lo)) * (height - pad * 2);
  const x = (at: string) => pad + ((new Date(at).getTime() - t0) / span) * (width - pad * 2);
  return {
    points: pts.map((reading) => ({ x: x(reading.at), y: y(reading.value), reading })) as PlotPoint[],
    targetY: y(target),
    first: pts[0],
    last: pts[pts.length - 1],
  };
}

// --- updates ----------------------------------------------------------------------

/** What an update row may say about numbers: only what that check-in itself
 *  recorded. A note-only row never re-states an older reading. */
export function checkInFacts(ci: CheckIn, goal: Goal | undefined) {
  const facts: string[] = [`Recorded status: ${STATUS_LABEL[ci.status]}`];
  if (ci.measured_value != null && goal?.measure) facts.push(`Value entered: ${formatValue(ci.measured_value, goal.measure)}`);
  else if (ci.measured_value != null) facts.push(`Value entered: ${formatNumber(ci.measured_value)}`);
  if (ci.progress != null) facts.push(`${ci.progress}% completion`);
  return facts;
}

export function sourceHref(ci: Pick<CheckIn, "source_type" | "source_id">) {
  if (ci.source_type === "outside_meeting" && ci.source_id) return `/app/beyond/meetings/${ci.source_id}`;
  return null;
}

export function newRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for very old browsers: RFC 4122 v4 shape from Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
