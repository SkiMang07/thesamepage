// ---------------------------------------------------------------------------
// The meeting screen's local draft, one per 1:1 row.
//
// The capture engine's audio queue survives a reload, so the manager's notes
// must too. Kept in localStorage, keyed by the one_on_ones id, and cleared on
// Save log. Call notes and off-the-record notes are separate fields from the
// start: off-the-record notes become one_on_ones.private_notes and are never
// sent to the wrap-up.
//
// Covered ticks and added topics live here too. Nothing on the server knows
// about them until the wrap-up turns unticked topics into carry-forwards.
// ---------------------------------------------------------------------------

const PREFIX = "tsp:meeting-draft:";
const MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

export type MeetingDraft = {
  notes: string;
  privateNotes: string;
  /** Keys of agenda rows ticked as covered. */
  covered: string[];
  /** Topics added during the meeting with "+ Add a topic". */
  added: string[];
  updatedAt: number;
};

export const EMPTY_DRAFT: MeetingDraft = { notes: "", privateNotes: "", covered: [], added: [], updatedAt: 0 };

export function loadDraft(oneOnOneId: string): MeetingDraft {
  try {
    const raw = window.localStorage.getItem(PREFIX + oneOnOneId);
    if (!raw) return EMPTY_DRAFT;
    const d = JSON.parse(raw) as Partial<MeetingDraft>;
    return {
      notes: typeof d.notes === "string" ? d.notes : "",
      privateNotes: typeof d.privateNotes === "string" ? d.privateNotes : "",
      covered: Array.isArray(d.covered) ? d.covered.filter((x): x is string => typeof x === "string") : [],
      added: Array.isArray(d.added) ? d.added.filter((x): x is string => typeof x === "string") : [],
      updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(oneOnOneId: string, draft: MeetingDraft) {
  try {
    const empty = !draft.notes && !draft.privateNotes && !draft.covered.length && !draft.added.length;
    if (empty) window.localStorage.removeItem(PREFIX + oneOnOneId);
    else window.localStorage.setItem(PREFIX + oneOnOneId, JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    /* storage unavailable or full: the notes stay on screen */
  }
}

export function clearDraft(oneOnOneId: string) {
  try {
    window.localStorage.removeItem(PREFIX + oneOnOneId);
  } catch {
    /* nothing to clear */
  }
}

/** Drops drafts nobody came back to in three weeks. */
export function pruneDrafts() {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const d = JSON.parse(window.localStorage.getItem(key) || "{}") as Partial<MeetingDraft>;
      if (!d.updatedAt || Date.now() - d.updatedAt > MAX_AGE_MS) stale.push(key);
    }
    stale.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* best effort */
  }
}
