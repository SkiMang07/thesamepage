// From their role: a person's role expectations as their starting goals
// (docs/systems/goals.md -> From their role). Pure helpers, no React and no
// network, so Node's test runner can load them (npm run test:role-goals).
//
// Honesty rules: an expectation's reading is only ever a value the manager
// entered (or a completed assessment recorded); a verdict is a factual line
// about that reading against the role's bar, never a status.

type Period = "month" | "week" | "quarter" | "annual" | "none" | null | undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The period a new reading is for, prefilled from the expectation's measurement period. Editable. */
export function defaultPeriod(period: Period, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === "month") return `${MONTHS[m]} ${y}`;
  if (period === "quarter") return `Q${Math.floor(m / 3) + 1} ${y}`;
  if (period === "annual") return String(y);
  if (period === "week") {
    const monday = new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7));
    return `Week of ${MONTHS[monday.getMonth()]} ${monday.getDate()}, ${monday.getFullYear()}`;
  }
  return `${MONTHS[m]} ${now.getDate()}, ${y}`;
}

/** "92 (Oct 2026)" — a reading as the manager entered it. */
export function readingText(value: number, period: string | null | undefined): string {
  const v = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  return period ? `${v} (${period})` : v;
}

export function verdictText(verdict: "meets" | "below" | null | undefined): string | null {
  if (verdict === "meets") return "Latest reading meets the bar.";
  if (verdict === "below") return "Latest reading is below the bar.";
  return null;
}

type SourceLike = { kind: "metric" | "responsibility" | "skill"; name: string | null; retired: boolean } | null | undefined;

/** The line under a personalised goal's title: where it started from. A goal
 *  on a measured expectation is a stretch only when it carries its own target. */
export function sourceLine(source: SourceLike, hasTarget = false): string | null {
  if (!source) return null;
  const head = source.name
    ? `${source.kind === "metric" && hasTarget ? "Stretch on" : "Builds on"} “${source.name}”`
    : "Started from a role expectation";
  return source.retired ? `${head} · that expectation was retired` : head;
}

/** The parse a typed reading must pass: any finite number, 0 included. */
export function parseReading(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: false, error: "Enter the reading." };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: "A reading must be a number." };
  return { ok: true, value: n };
}

type ExpectationLike = {
  kind: "metric" | "responsibility" | "skill";
  id: string;
  name: string;
  target?: string | null;
  bar?: { value: number; direction: "at_least" | "at_most" } | null;
};

/** What "Make it their own goal" opens the New goal form with. The title is
 *  the expectation's name for the manager to rewrite; the target is left blank
 *  beside the role's bar. Shape matches lib/goalDraft.ts's GoalDraft. */
export function draftFromExpectation(item: ExpectationLike, role: string | null) {
  return {
    title: item.name,
    dueDate: null,
    parentGoalId: null,
    measure:
      item.kind === "metric"
        ? { label: item.name, format: "number" as const, direction: item.bar?.direction === "at_most" ? ("at_most" as const) : ("at_least" as const) }
        : null,
    source: { kind: "expectation" as const, label: item.name, role, where: null },
    targetHint: item.kind === "metric" ? item.target ?? null : null,
    link: { kind: item.kind === "metric" ? ("metric" as const) : ("skill" as const), id: item.id },
    drafted: 1,
    shownAt: Date.now(),
  };
}
