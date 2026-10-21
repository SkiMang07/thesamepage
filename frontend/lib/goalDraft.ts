// Two small pieces of the team-goals step (docs/design-proposals/2026-10-20-team-goals-step/).
// No React and no network here, so Node's test runner can load it.
//
// 1. The hand-off from a suggestion to the New goal form. The suggestion is
//    held in sessionStorage for one read only: the Goals page takes it when
//    it opens with ?new=1&draft=1, and nothing is saved until "Add goal".
//    Storage can be missing or throw (private windows); then the form simply
//    opens empty.
//
// 2. "This reads like an expectation." A goal with no due date that reads as
//    ongoing ("maintain", "every week", "or above"), or that repeats one of
//    the roles' expectations, is probably the role's standard rather than
//    something the team is changing. The form asks once, on save.

export type GoalDraftMeasure = {
  label: string;
  format: "count" | "number" | "percent";
  direction: "at_least" | "at_most" | "below";
};

export type GoalDraft = {
  title: string;
  dueDate: string | null;
  parentGoalId: string | null;
  measure: GoalDraftMeasure | null;
  // Where the suggestion came from, shown above the form.
  source: { kind: "expectation" | "goal"; label: string; role: string | null; where?: string | null };
  // The role's bar, shown beside the target the manager sets.
  targetHint: string | null;
  // From their role (lib/roleGoals.ts): the expectation an individual goal
  // keeps a link to. Not an AI suggestion, so no AI-draft telemetry.
  link?: { kind: "metric" | "skill"; id: string } | null;
  // For AI-draft telemetry: how many were suggested, and when they were shown.
  drafted: number;
  shownAt: number;
};

const KEY = "tsp.goalDraft";

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

function store(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveGoalDraft(draft: GoalDraft, s: Store | null = store()): boolean {
  try {
    if (!s) return false;
    s.setItem(KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Read once and clear. Anything malformed reads as no draft. */
export function takeGoalDraft(s: Store | null = store()): GoalDraft | null {
  try {
    if (!s) return null;
    const raw = s.getItem(KEY);
    s.removeItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.title !== "string" || !d.title.trim() || !d.source || typeof d.source.label !== "string") return null;
    return {
      title: d.title,
      dueDate: typeof d.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate) ? d.dueDate : null,
      parentGoalId: typeof d.parentGoalId === "string" ? d.parentGoalId : null,
      measure:
        d.measure && typeof d.measure.label === "string" && ["count", "number", "percent"].includes(d.measure.format) &&
        ["at_least", "at_most", "below"].includes(d.measure.direction)
          ? { label: d.measure.label, format: d.measure.format, direction: d.measure.direction }
          : null,
      source: {
        kind: d.source.kind === "goal" ? "goal" : "expectation",
        label: d.source.label,
        role: typeof d.source.role === "string" ? d.source.role : null,
        where: typeof d.source.where === "string" ? d.source.where : null,
      },
      targetHint: typeof d.targetHint === "string" ? d.targetHint : null,
      link:
        d.link && (d.link.kind === "metric" || d.link.kind === "skill") && typeof d.link.id === "string" && d.link.id
          ? { kind: d.link.kind, id: d.link.id }
          : null,
      drafted: Number.isFinite(d.drafted) ? d.drafted : 1,
      shownAt: Number.isFinite(d.shownAt) ? d.shownAt : Date.now(),
    };
  } catch {
    return null;
  }
}

// --- "This reads like an expectation" ------------------------------------------

export type ExpectationRef = { name: string; roleLevelId: string | null; role: string | null };

export type ExpectationOverlap = { ongoing: boolean; match: ExpectationRef | null };

const ONGOING =
  /\b(maintain(ing)?|keep(ing)?|always|stay(ing)?|consistently|continue to|ongoing|every (day|week|month|quarter|case|call|customer)|each (day|week|month|quarter)|per (day|week|month|quarter)|a (day|week|month)|at or above|at or below|or above|or below|or better|or more|or less|or fewer|no more than|no less than|at least)\b/i;

const STOP = new Set(
  "the a an and or of to for on in at by with from our their your team teams they them who what each every per all any more less than above below least keep get make".split(" "),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+%?$/.test(t));
}

/** The expectation a title repeats, if any: two shared words, or all of a short expectation's words. */
export function matchingExpectation(title: string, expectations: ExpectationRef[]): ExpectationRef | null {
  const have = new Set(tokens(title));
  let best: { ref: ExpectationRef; score: number } | null = null;
  for (const ref of expectations) {
    const want = Array.from(new Set(tokens(ref.name)));
    if (!want.length) continue;
    const shared = want.filter((t) => have.has(t)).length;
    const hit = shared >= 2 || (want.length <= 2 && shared === want.length);
    if (hit && (!best || shared > best.score)) best = { ref, score: shared };
  }
  return best?.ref ?? null;
}

/** Null when the goal is fine: it has a due date, or it neither reads as ongoing nor repeats an expectation. */
export function readsLikeExpectation(title: string, dueDate: string, expectations: ExpectationRef[]): ExpectationOverlap | null {
  if (!title.trim() || dueDate) return null;
  const ongoing = ONGOING.test(title);
  const match = matchingExpectation(title, expectations);
  return ongoing || match ? { ongoing, match } : null;
}
