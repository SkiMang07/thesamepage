// Where each thing the manager said goes, on the batch intake review
// (docs/BATCH_INTAKE_PLACEMENT_SCOPING.md, "The bigger option", built light).
//
// Every promise, kept thought, role line and not-yet-placed sentence is one
// Item with a lane and a person. The server's pick is the default; a tap on a
// chip moves it. Nothing here is required: a manager who changes nothing saves
// what the model proposed, as before. What changes is that a wrong lane or
// person costs one tap instead of a bad record.
//
// A role draft reads only the sentences whose lane is "About the role". They
// are sent back as role_sentences, whole sentences of what was typed, so the
// server can cut them from the text itself.
//
// Pure: no React, no network. Tested in notesDumpPlacement.test.mjs.

import type { NotesDumpDraft } from "./api";

export type Lane = "you_owe" | "they_owe" | "role" | "private";

export const LANES: { value: Lane; label: string }[] = [
  { value: "you_owe", label: "You owe" },
  { value: "they_owe", label: "They owe you" },
  { value: "role", label: "About the role" },
  { value: "private", label: "Private thought" },
];

// The person chip's "someone who is not on the team": nothing is saved.
export const NOT_ON_TEAM = "none";

export type Item = {
  id: string;
  kind: "commitment" | "note" | "role" | "unplaced";
  // The words the review shows (and the manager can edit, except a role line).
  text: string;
  // Whole sentences of what was typed that this stands for: what "About the
  // role" tags. Empty when there is nothing of the typed text behind it.
  sentences: string[];
  // Where the server put it (null: nowhere, an unplaced sentence).
  lane: Lane | null;
  // Who the server put it with (null: nobody yet).
  person: string | null;
  dueDate: string | null;
  // When a kept thought happened, as the notes said (shown on its label).
  occurredOn: string | null;
  excerpt: string | null;
  low: boolean;
};

// A change the manager made on a chip. person NOT_ON_TEAM saves nothing.
export type Move = { lane?: Lane | null; person?: string | null };
export type Moves = Record<string, Move>;

// Whether a person's role row can take role lines: it exists and is kept,
// exists but is not kept, or exists but is blocked (a draft or approved
// expectations already). No entry: no role row from this read.
export type RoleRowState = Record<string, "ok" | "unchecked" | "blocked">;

export function roleLineId(expKey: string, index: number): string {
  return `${expKey}:r${index}`;
}

export function buildItems(d: NotesDumpDraft): Item[] {
  const items: Item[] = [];
  for (const c of d.commitments ?? []) {
    items.push({
      id: c.key, kind: "commitment", text: c.description, sentences: c.sentences ?? [],
      lane: c.committed_by === "direct_report" ? "they_owe" : "you_owe", person: c.report_id,
      dueDate: c.due_date, occurredOn: null, excerpt: c.excerpt, low: c.low,
    });
  }
  for (const n of d.person_notes ?? []) {
    items.push({
      id: n.key, kind: "note", text: n.text, sentences: n.sentences ?? [], lane: "private", person: n.report_id,
      dueDate: null, occurredOn: n.occurred_on, excerpt: n.excerpt, low: n.low,
    });
  }
  for (const e of d.expectations ?? []) {
    (e.role_sentences ?? []).forEach((s, i) => {
      items.push({
        id: roleLineId(e.key, i), kind: "role", text: s, sentences: [s], lane: "role", person: e.report_id,
        dueDate: null, occurredOn: null, excerpt: null, low: false,
      });
    });
  }
  for (const u of d.unplaced ?? []) {
    items.push({
      id: u.key, kind: "unplaced", text: u.text, sentences: [u.text], lane: null, person: u.report_id,
      dueDate: null, occurredOn: null, excerpt: null, low: true,
    });
  }
  return items;
}

// Which rows start checked. Role lines and promises follow the model's own
// confidence, role lines come with their role row, and an unplaced sentence
// starts unchecked: it saves nothing until the manager places it.
export function initialKept(d: NotesDumpDraft): Record<string, boolean> {
  const kept: Record<string, boolean> = {};
  for (const item of buildItems(d)) kept[item.id] = item.kind === "role" ? true : item.kind === "unplaced" ? false : !item.low;
  return kept;
}

export function effective(item: Item, moves: Moves): { lane: Lane | null; person: string | null } {
  const m = moves[item.id] ?? {};
  return {
    lane: m.lane !== undefined ? m.lane : item.lane,
    person: m.person !== undefined ? m.person : item.person,
  };
}

function first(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "them";
}

// Why an item can't be saved where it is now, in the app's plain voice; null
// when it can.
export function problem(
  item: Item,
  moves: Moves,
  roleRows: RoleRowState,
  nameOf: (id: string) => string | undefined,
): string | null {
  const { lane, person } = effective(item, moves);
  if (lane === null) return "Choose where this goes.";
  if (person === null) return "Choose who it is about.";
  if (person === NOT_ON_TEAM) return "Not on your team, so nothing is saved.";
  if (lane === "role") {
    const who = first(nameOf(person));
    const state = roleRows[person];
    if (!state) return `${who} has no role row from this read, so this can’t be saved as a role line. Pick another lane.`;
    if (state === "unchecked") return `Keep ${who}’s role row to save this as a role line.`;
    if (state === "blocked") return `${who}’s role already has a draft or approved expectations, so a role line isn’t used.`;
    if (item.sentences.length === 0) return "There is no sentence of what you typed behind this to tag.";
  }
  return null;
}

export type Resolved = {
  commitments: { report_id: string; description: string; due_date: string | null; committed_by: "manager" | "direct_report" }[];
  person_notes: { report_id: string; text: string }[];
  // report id -> the sentences tagged About the role, in the order found.
  roleSentences: Record<string, string[]>;
};

// What to save from the items the manager kept, where each now sits.
export function resolve(
  items: Item[],
  moves: Moves,
  kept: Record<string, boolean>,
  edits: Record<string, string>,
  roleRows: RoleRowState,
  nameOf: (id: string) => string | undefined,
): Resolved {
  const out: Resolved = { commitments: [], person_notes: [], roleSentences: {} };
  for (const item of items) {
    if (!kept[item.id] || problem(item, moves, roleRows, nameOf)) continue;
    const { lane, person } = effective(item, moves);
    if (!lane || !person) continue;
    // A role line is the manager's sentence as said; anything else may be edited.
    const text = (lane === "role" ? item.text : edits[item.id] ?? item.text).trim();
    if (lane === "role") {
      const list = (out.roleSentences[person] ??= []);
      for (const s of item.sentences) if (!list.includes(s)) list.push(s);
    } else if (!text) {
      continue;
    } else if (lane === "private") {
      out.person_notes.push({ report_id: person, text });
    } else {
      // A due date belongs to the promise it was read with, not to a sentence moved in.
      const dueDate = item.kind === "commitment" ? item.dueDate : null;
      out.commitments.push({
        report_id: person, description: text, due_date: dueDate, committed_by: lane === "they_owe" ? "direct_report" : "manager",
      });
    }
  }
  return out;
}

// Which section an item sits in now. A role line whose person has no role row
// (or whose row is blocked) can't sit in a role row, so it is shown with the
// unplaced sentences, with the reason.
export type Placement = "you_owe" | "they_owe" | "private" | "unplaced" | { role: string };

export function placement(item: Item, moves: Moves, roleRows: RoleRowState): Placement {
  const { lane, person } = effective(item, moves);
  if (lane === "role") {
    // A blocked row shows no role lines, so a line sent there is shown with the unplaced sentences.
    return person && person !== NOT_ON_TEAM && roleRows[person] && roleRows[person] !== "blocked" ? { role: person } : "unplaced";
  }
  return lane ?? "unplaced";
}
