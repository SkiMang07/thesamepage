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

// ---------------------------------------------------------------------------
// Year strip — the overview's four-quarter history per person. A record of
// what was assessed, not a schedule: empty quarters are neutral, never overdue.
// ---------------------------------------------------------------------------

export type StripReview = {
  id: string;
  status: "draft" | "completed";
  period_start: string | null;
  period_end: string | null;
};

export type StripState = "completed" | "in_progress" | "legacy" | "none";

export type StripSlot = {
  year: number;
  quarter: number; // 1-4
  label: string; // "Q3"
  current: boolean; // the quarter a manager would naturally assess now
  state: StripState;
  reviewId: string | null;
  /** The same assessment also covers the next slot (a biannual spans two). */
  joinsNext: boolean;
  /** A short off-cycle assessment ended in this quarter without covering it. */
  offCycle: "completed" | "in_progress" | null;
};

const DAY_MS = 86_400_000;

function quarterBounds(year: number, quarter: number): { start: Date; end: Date } {
  const m = (quarter - 1) * 3;
  return { start: new Date(year, m, 1), end: new Date(year, m + 3, 0) };
}

function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = Math.max(aStart.getTime(), bStart.getTime());
  const e = Math.min(aEnd.getTime(), bEnd.getTime());
  return e < s ? 0 : Math.round((e - s) / DAY_MS) + 1;
}

/** The four quarters ending with the one a quarterly assessment would cover today. */
export function stripQuarters(today: Date): { year: number; quarter: number }[] {
  const anchor = parseDay(suggestPeriod("quarterly", today).start);
  const out: { year: number; quarter: number }[] = [];
  for (let back = 3; back >= 0; back--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - back * 3, 1);
    out.push({ year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 });
  }
  return out;
}

/**
 * Place a person's assessments on the four-quarter strip. An assessment covers
 * a quarter when at least half of that quarter falls inside its period, so a
 * quarterly fills one slot and a biannual two; a completed assessment wins over
 * a draft. A shorter off-cycle assessment is a small mark in the quarter it
 * ended in. A legacy rolling rating (not a period assessment) only marks an
 * otherwise empty quarter.
 */
export function buildYearStrip(reviews: StripReview[], legacyAt: string | null, today: Date): StripSlot[] {
  const quarters = stripQuarters(today);
  const slots: StripSlot[] = quarters.map(({ year, quarter }, i) => ({
    year,
    quarter,
    label: `Q${quarter}`,
    current: i === quarters.length - 1,
    state: "none",
    reviewId: null,
    joinsNext: false,
    offCycle: null,
  }));
  const rank = (s: StripState) => (s === "completed" ? 2 : s === "in_progress" ? 1 : 0);

  for (const r of reviews) {
    if (!r.period_start || !r.period_end) continue;
    const rs = parseDay(r.period_start);
    const re = parseDay(r.period_end);
    const state: StripState = r.status === "completed" ? "completed" : "in_progress";
    let covered = false;
    slots.forEach((slot) => {
      const q = quarterBounds(slot.year, slot.quarter);
      const qDays = Math.round((q.end.getTime() - q.start.getTime()) / DAY_MS) + 1;
      if (overlapDays(rs, re, q.start, q.end) * 2 >= qDays) {
        covered = true;
        if (rank(state) > rank(slot.state)) {
          slot.state = state;
          slot.reviewId = r.id;
        }
      }
    });
    if (!covered) {
      const slot = slots.find((s) => {
        const q = quarterBounds(s.year, s.quarter);
        return re >= q.start && re <= q.end;
      });
      if (slot && (slot.offCycle !== "completed")) slot.offCycle = state as "completed" | "in_progress";
    }
  }
  for (let i = 0; i < slots.length - 1; i++) {
    slots[i].joinsNext = !!slots[i].reviewId && slots[i].reviewId === slots[i + 1].reviewId;
  }
  if (legacyAt) {
    const at = parseDay(legacyAt);
    const slot = slots.find((s) => {
      const q = quarterBounds(s.year, s.quarter);
      return at >= q.start && at <= q.end;
    });
    if (slot && slot.state === "none") slot.state = "legacy";
  }
  return slots;
}
