// Date helpers for the Team page and the team meeting screen.
//
// due_date is a date-only column and scheduled_at is a date encoded at noon
// UTC. Parsing a bare "YYYY-MM-DD" through new Date() treats it as UTC
// midnight, which reads as "yesterday" anywhere west of Greenwich — so bare
// dates are always split and built in local time here.

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateStr(dt);
}

// scheduled_at (noon UTC) -> the local calendar date.
export function isoToDateStr(iso: string): string {
  return localDateStr(new Date(iso));
}

function fromDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Sep 24" */
export function shortDate(dateStr: string): string {
  return fromDateStr(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Thu, Sep 24" */
export function mediumDate(dateStr: string): string {
  return fromDateStr(dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "Thursday, September 24" */
export function longDate(dateStr: string): string {
  return fromDateStr(dateStr).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** A timestamp's local calendar date, short: "Sep 24". */
export function instantDate(iso: string): string {
  return shortDate(isoToDateStr(iso));
}

export type DueState = "overdue" | "soon" | "later" | "none";

// Due within seven days is "soon" — the same window the page has always used.
export function dueState(dueDate: string | null | undefined, today: string = localDateStr()): DueState {
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate <= addDaysStr(today, 7)) return "soon";
  return "later";
}

export function dueLabel(dueDate: string | null | undefined, today: string = localDateStr()): string {
  const state = dueState(dueDate, today);
  if (state === "none" || !dueDate) return "No due date";
  if (state === "overdue") return `Overdue · ${shortDate(dueDate)}`;
  if (state === "soon") return `Due soon · ${shortDate(dueDate)}`;
  return `Due ${shortDate(dueDate)}`;
}

export function meetingDateStr(scheduledAt: string | null): string | null {
  return scheduledAt ? isoToDateStr(scheduledAt) : null;
}
