// AI-draft quality telemetry (AI_OPPORTUNITIES E7). See
// docs/systems/product-analytics.md → "AI-draft quality".
//
// Every draft-then-review surface compares the AI's draft with what the
// manager saved, here in the browser, and reports only the result: an
// outcome, an edit bucket, seconds to confirm and a few counts. The draft and
// the saved text never leave this file. No React and no network here, so
// Node's test runner can load it; useAiDraft.ts wires it into components.

export type AiDraftSurface =
  | "one_on_one_wrapup"
  | "team_wrapup"
  | "beyond_wrapup"
  | "development_plan"
  | "development_note"
  | "scribe_proposal";

export type AiDraftOutcome = "accepted" | "discarded" | "abandoned";
export type EditBucket = "none" | "light" | "moderate" | "heavy";

export type AiDraftReport = {
  surface: AiDraftSurface;
  outcome: AiDraftOutcome;
  edit_bucket: EditBucket;
  seconds_to_confirm: number;
  items_drafted?: number;
  items_kept?: number;
  items_added?: number;
};

const MAX_WORDS = 4000;
export const MAX_SECONDS_TO_CONFIRM = 86_400;

function words(text: string | null | undefined): string[] {
  return (text ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
}

// Word-level edit distance as a share of the draft's length. Must match
// edit_bucket() in backend/analytics.py.
export function editBucket(draft: string | null | undefined, final: string | null | undefined): EditBucket {
  const a = words(draft);
  const b = words(final);
  if (a.length === b.length && a.every((w, i) => w === b[i])) return "none";
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  const ratio = prev[b.length] / Math.max(a.length, 1);
  if (ratio < 0.1) return "light";
  if (ratio < 0.4) return "moderate";
  return "heavy";
}

// A saved item counts as kept when it is recognisably one of the drafted
// items (anything short of a rewrite); every other saved item was added.
export function itemCounts(drafted: string[], saved: string[]) {
  const pool = drafted.map((d) => d.trim()).filter(Boolean);
  const finals = saved.map((s) => s.trim()).filter(Boolean);
  let kept = 0;
  for (const s of finals) {
    const i = pool.findIndex((d) => editBucket(d, s) !== "heavy");
    if (i >= 0) {
      pool.splice(i, 1);
      kept++;
    }
  }
  return { items_drafted: drafted.map((d) => d.trim()).filter(Boolean).length, items_kept: kept, items_added: finals.length - kept };
}

export type DraftShape = { text: string; items?: string[] };

// One draft's life: shown, then accepted, discarded or abandoned, once.
export class DraftTracker {
  readonly surface: AiDraftSurface;
  private readonly draft: DraftShape;
  private readonly send: (report: AiDraftReport) => void;
  private readonly now: () => number;
  private readonly shownAt: number;
  private resolved = false;

  constructor(
    surface: AiDraftSurface,
    draft: DraftShape,
    send: (report: AiDraftReport) => void,
    now: () => number = Date.now,
  ) {
    this.surface = surface;
    this.draft = draft;
    this.send = send;
    this.now = now;
    this.shownAt = now();
  }

  get isResolved() {
    return this.resolved;
  }

  private finish(outcome: AiDraftOutcome, extra: Partial<AiDraftReport> = {}) {
    if (this.resolved) return;
    this.resolved = true;
    const seconds = Math.round((this.now() - this.shownAt) / 1000);
    this.send({
      surface: this.surface,
      outcome,
      edit_bucket: "none",
      seconds_to_confirm: Math.max(0, Math.min(seconds, MAX_SECONDS_TO_CONFIRM)),
      ...extra,
    });
  }

  accept(saved: DraftShape) {
    const counts = this.draft.items ? itemCounts(this.draft.items, saved.items ?? []) : {};
    this.finish("accepted", { edit_bucket: editBucket(this.draft.text, saved.text), ...counts });
  }

  discard() {
    this.finish("discarded");
  }

  abandon() {
    this.finish("abandoned");
  }
}

export function joinDraft(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n");
}
