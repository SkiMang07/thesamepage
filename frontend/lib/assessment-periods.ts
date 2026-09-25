// Period presets and display helpers for period assessments.
// Pure functions (no React, no API) so they can be tested with Node's runner:
//   node --experimental-strip-types --test lib/assessment-periods.test.mjs
//
// A preset only fills the start/end dates for the assessment being started.
// It is not a schedule: there is no org-wide cycle, reminder or due date.

export type Cadence = "quarterly" | "biannual" | "off_cycle";

export type Period = { start: string; end: string };

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function lastDay(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex + 1, 0);
}

/** Days before a period's end when it becomes the natural one to assess. */
export const CLOSING_WINDOW_DAYS = 21;

/**
 * The period a manager most likely means today.
 * Quarterly / biannual: the current quarter or half once it is within its last
 * three weeks, otherwise the most recent completed one. Off-cycle: the last 90
 * days up to today. Every date stays editable.
 */
export function suggestPeriod(cadence: Cadence, today: Date): Period {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (cadence === "off_cycle") {
    const start = new Date(y, m, today.getDate() - 89);
    return { start: isoDay(start), end: isoDay(today) };
  }
  const span = cadence === "quarterly" ? 3 : 6;
  const blockStartMonth = Math.floor(m / span) * span;
  const blockEnd = lastDay(y, blockStartMonth + span - 1);
  const daysLeft = Math.round((blockEnd.getTime() - new Date(y, m, today.getDate()).getTime()) / 86_400_000);
  if (daysLeft <= CLOSING_WINDOW_DAYS) {
    return { start: isoDay(new Date(y, blockStartMonth, 1)), end: isoDay(blockEnd) };
  }
  const prevStart = new Date(y, blockStartMonth - span, 1);
  const prevEnd = lastDay(prevStart.getFullYear(), prevStart.getMonth() + span - 1);
  return { start: isoDay(prevStart), end: isoDay(prevEnd) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDay(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "undated";
  const d = parseDay(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ""}`;
}

export function formatSpan(start: string, end: string): string {
  const s = parseDay(start);
  const e = parseDay(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${formatDay(start, !sameYear)} – ${formatDay(end, true)}`;
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  quarterly: "Quarterly",
  biannual: "Biannual",
  off_cycle: "Off-cycle",
};

/** "quarter", "half" or "period" — for headings like "Maya’s quarter". */
export function periodNoun(cadence: Cadence | null | undefined, start: string, end: string): string {
  const s = parseDay(start);
  const e = parseDay(end);
  const months = (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth() + 1;
  if (cadence === "quarterly" && months === 3 && s.getDate() === 1) return "quarter";
  if (cadence === "biannual" && months === 6 && s.getDate() === 1) return "half";
  return "period";
}

/** Whether a period is still running (records after today can't exist yet). */
export function periodStillOpen(end: string, today: Date): boolean {
  return parseDay(end).getTime() > new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
}

export function firstName(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0] || "They";
}

export function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}
