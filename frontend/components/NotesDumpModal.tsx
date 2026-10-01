"use client";

// Notes dump (setup mode chunk B; docs/design-proposals/2026-09-29-onboarding-path/
// CHUNK_B_PLAN.md). One modal, three states: input, review, receipt.
//
// Input: talk, type or paste (NoteField, dictation built in), or attach files.
// "Read this" is the one AI call (POST .../notes-dump/parse). It returns drafts
// only; nothing is saved and the input is not kept. Review: a ranked, capped
// list. Rows the model was unsure about start unchecked. Nothing saves until
// "Save selected", and only the checked rows are sent (Hard Rule 6). What is
// not found is not listed here: the setup card recomputes and shows what is left.
//
// Role expectations (batch intake, Build 3a): one input about several people
// yields, per person, their role (existing, or new with an editable level), the
// assignment, and a first draft of the role's expectations for up to max_roles
// roles, preselected by soonest 1:1. The typed text goes back to apply only when
// a draft is queued, because each role's draft keeps that person's slice of it.
// The privacy box says so. Attached files are never sent back or kept.
//
// What the manager owes people ("I owe her quarterly priorities") is its own
// section, saved as open commitments they own, never as a note: the prep sheet
// lists open commitments, and a promise must not compete with notes for a slot.
//
// Placement (lib/notesDumpPlacement.ts): every promise, kept thought, role line
// and not-yet-placed sentence is one item with a lane (You owe, They owe you,
// About the role, Private thought) and a person (or "Not on my team", which
// saves nothing). The model's pick is the default and the two chips on a row
// change it with a tap; nothing is required. A role draft reads only the
// sentences whose lane is About the role, sent back as role_sentences. A pasted
// sentence no suggestion cites is listed under "Not placed" with the same chips,
// so nothing the manager said is silently dropped.
//
// Voice: literal labels, no cheer. Counts and fixed values only go to analytics
// (sent by the server; the browser sends only how many rows were edited).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  NotesDumpApplyResult,
  NotesDumpDraft,
  NotesDumpExpectation,
  NotesDumpExpectationBody,
  NotesDumpPerson,
  applyNotesDump,
  parseNotesDump,
  reportNotesDumpSkipped,
} from "@/lib/api";
import WaitNote from "@/components/WaitNote";
import { roleDraftCapLine } from "@/lib/roleDraftCap";
import {
  LANES, NOT_ON_TEAM, buildItems, effective, initialKept, placement, problem, resolve,
  type Item, type Lane, type Move, type Moves, type RoleRowState,
} from "@/lib/notesDumpPlacement";
import NoteField from "@/components/NoteField";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INPUT } from "@/lib/tokens";

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
const MAX_FILES = 5;

type Phase = "input" | "reading" | "review" | "saving" | "receipt";

// What the manager can change in a row, keyed by the server's row key.
type Edits = Record<string, string>;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

// The role a row drafts: an existing level, or a new title and level. Two rows
// on the same role share one draft.
function roleKey(row: NotesDumpExpectation, title: string, level: number) {
  return row.role_level_id ?? `new:${title.trim().toLowerCase().replace(/\s+/g, " ")}|${level}`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

// A role that already has a working draft or approved expectations can't take a
// new draft. "no_text" (nothing typed is about them) is not a hard block: a
// sentence the manager tags About the role gives the draft something to read.
function hardBlocked(row: NotesDumpExpectation) {
  return row.blocked === "open_draft" || row.blocked === "approved";
}

function blockedText(row: NotesDumpExpectation) {
  const who = firstName(row.person_name);
  if (row.blocked === "open_draft") return `${who} already has a working draft — this won’t change it.`;
  if (row.blocked === "approved") return `${who}’s role already has approved expectations — this won’t change them.`;
  if (row.blocked === "no_text") return `Nothing you typed is about ${who}, so there’s nothing to draft from. Attached files aren’t kept.`;
  return null;
}

// The seniority word behind a level number, in the bands the intake prompt reads from
// ("senior" is 4-5). Only for saying what was read; ladders keep the number.
function seniorityWord(level: number): string {
  if (level <= 2) return "junior, ";
  if (level === 3) return "mid-level, ";
  if (level <= 5) return "senior, ";
  if (level <= 7) return "staff or principal, ";
  return "";
}

export default function NotesDumpModal({ onClose, intent }: { onClose: () => void; intent?: "expectations" }) {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NotesDumpDraft | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Edits>({});
  // Where the manager moved a row, by item id (a row key, or a role line's id).
  const [moves, setMoves] = useState<Moves>({});
  const [result, setResult] = useState<NotesDumpApplyResult | null>(null);
  // Role expectation rows: whether to draft now, and the new role's level.
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [nextPass, setNextPass] = useState(false);
  const shownAt = useRef<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = phase === "reading" || phase === "saving";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_FILES));
  }

  async function read() {
    setError(null);
    setPhase("reading");
    try {
      const d = await parseNotesDump({ text, files });
      setDraft(d);
      setKept({ ...Object.fromEntries(allRows(d).map((r) => [r.key, !r.low])), ...initialKept(d) });
      setEdits({});
      setMoves({});
      setDrafts(Object.fromEntries(d.expectations.map((e) => [e.key, e.draft])));
      setLevels(Object.fromEntries(d.expectations.filter((e) => e.new_role).map((e) => [e.key, e.new_role!.job_level])));
      shownAt.current = Date.now();
      setPhase("review");
    } catch (e) {
      setError(readable(e));
      setPhase("input");
    }
  }

  function skip() {
    void reportNotesDumpSkipped();
    onClose();
  }

  const rows = useMemo(() => (draft ? allRows(draft) : []), [draft]);
  const changed = (key: string, original: string) => edits[key] !== undefined && edits[key] !== original;
  const editedCount = rows.filter((r) => kept[r.key] && edits[r.key] !== undefined && edits[r.key] !== r.original).length;

  const expRows = draft?.expectations ?? [];
  const maxRoles = draft?.max_roles ?? 5;
  const people: NotesDumpPerson[] = draft?.people ?? [];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name;
  const items = useMemo(() => (draft ? buildItems(draft) : []), [draft]);
  // Which people can take a role line: they have a role row from this read, and it is kept and not blocked.
  const roleRows: RoleRowState = Object.fromEntries(
    expRows.map((e) => [e.report_id, hardBlocked(e) ? "blocked" : kept[e.key] ? "ok" : "unchecked"]),
  );
  const resolved = resolve(items, moves, kept, edits, roleRows, nameOf);
  const inLane = (p: "you_owe" | "they_owe" | "private" | "unplaced") => items.filter((it) => placement(it, moves, roleRows) === p);
  const keptCount =
    [...(draft?.org_units ?? []), ...(draft?.role_assignments ?? []), ...expRows, ...(draft?.goals ?? [])].filter((r) => kept[r.key]).length +
    resolved.commitments.length +
    resolved.person_notes.length;
  const titleOf = (e: NotesDumpExpectation) => (edits[e.key] ?? e.new_role?.job_role ?? "").trim();
  const levelOf = (e: NotesDumpExpectation) => levels[e.key] ?? e.new_role?.job_level ?? 1;
  const nothingHere = rows.length === 0 && items.length === 0;
  const roleLines = (e: NotesDumpExpectation) => resolved.roleSentences[e.report_id] ?? [];
  // A draft needs something tagged About the role to read.
  const drafting = (e: NotesDumpExpectation) => !!kept[e.key] && !!drafts[e.key] && !hardBlocked(e) && roleLines(e).length > 0;
  const chosenRoles = new Set(expRows.filter(drafting).map((e) => roleKey(e, titleOf(e), levelOf(e))));
  const canDraft = (e: NotesDumpExpectation) =>
    !hardBlocked(e) && !!kept[e.key] && roleLines(e).length > 0 &&
    (drafting(e) || chosenRoles.size < maxRoles || chosenRoles.has(roleKey(e, titleOf(e), levelOf(e))));

  // Move an item. Placing a sentence that was not placed checks it: choosing
  // where it goes is the manager saying they want it saved.
  function move(it: Item, patch: Move) {
    setMoves((m) => ({ ...m, [it.id]: { ...m[it.id], ...patch } }));
    if (it.kind === "unplaced") setKept((k) => ({ ...k, [it.id]: true }));
  }

  function expectationBody(e: NotesDumpExpectation, draftNow: boolean, roleLevelId?: string): NotesDumpExpectationBody {
    return {
      report_id: e.report_id,
      role_level_id: roleLevelId ?? e.role_level_id,
      job_role: roleLevelId || e.role_level_id ? null : titleOf(e) || e.new_role?.job_role || null,
      job_level: roleLevelId || e.role_level_id ? null : levelOf(e),
      statement: e.statement,
      role_sentences: roleLines(e),
      draft: draftNow,
    };
  }

  async function save() {
    if (!draft) return;
    setError(null);
    setPhase("saving");
    const on = (key: string) => !!kept[key];
    const val = (key: string, original: string) => (edits[key] !== undefined ? edits[key].trim() || original : original);
    try {
      const r = await applyNotesDump({
        org_units: draft.org_units.filter((u) => on(u.key)).map((u) => ({
          name: val(u.key, u.name), unit_type: u.unit_type, parent_name: u.parent_name,
        })),
        role_assignments: draft.role_assignments.filter((x) => on(x.key)).map((x) => ({
          report_id: x.report_id, role_level_id: x.role_level_id, role_title: x.role_title, org_unit_name: x.org_unit_name,
        })),
        goals: draft.goals.filter((g) => on(g.key)).map((g) => ({
          level: g.level, title: val(g.key, g.title), success_metrics: g.success_metrics,
          org_unit_name: g.org_unit_name, due_date: g.due_date,
        })),
        // Where each item sits now, which the manager may have changed.
        person_notes: resolved.person_notes,
        commitments: resolved.commitments,
        expectations: expRows.filter((e) => on(e.key)).map((e) => expectationBody(e, drafting(e))),
        // Only when a draft is queued: each role's draft keeps that person's part.
        ...(expRows.some(drafting) ? { text, other_names: draft.other_names } : {}),
        proposed: rows.length,
        edited: editedCount,
        seconds_to_confirm: Math.max(0, Math.round((Date.now() - shownAt.current) / 1000)),
      });
      setResult(r);
      setPhase("receipt");
    } catch (e) {
      setError(readable(e));
      setPhase("review");
    }
  }

  // Second pass: the kept roles not drafted last time, the next max_roles of
  // them, from the same text (still on this screen, never stored for this).
  async function draftNext() {
    if (!draft || !result) return;
    setError(null);
    setNextPass(true);
    const byReport = Object.fromEntries(expRows.map((e) => [e.report_id, e]));
    const roles: string[] = [];
    const next = offerable(result).filter((w) => {
      if (roles.includes(w.role_level_id)) return true;
      if (roles.length >= maxRoles) return false;
      roles.push(w.role_level_id);
      return true;
    });
    try {
      const r = await applyNotesDump({
        org_units: [], role_assignments: [], goals: [], person_notes: [],
        expectations: next.filter((w) => byReport[w.report_id]).map((w) => expectationBody(byReport[w.report_id], true, w.role_level_id)),
        text, other_names: draft.other_names,
        proposed: 0, edited: 0, seconds_to_confirm: 0,
      });
      const done = new Set(next.map((w) => w.report_id));
      // Anyone the server skipped this pass keeps its reason and leaves "waiting".
      setResult({
        ...result,
        drafting: [...result.drafting, ...r.drafting],
        not_drafted: [...result.not_drafted, ...r.not_drafted],
        waiting: result.waiting.filter((w) => !done.has(w.report_id)),
        refused: [...result.refused, ...r.refused],
      });
    } catch (e) {
      setError(readable(e));
    } finally {
      setNextPass(false);
    }
  }

  const forRoles = intent === "expectations";

  // The review screen's own verdict on a row, by person. The server judges
  // every kept row too (a role with a working draft or approved expectations
  // is never "waiting"); this keeps the receipt consistent with the rows the
  // manager just read even when the server couldn't judge (no text was sent).
  const blockedBy = Object.fromEntries(expRows.filter((e) => e.blocked).map((e) => [e.report_id, e]));
  function offerable(r: NotesDumpApplyResult) {
    return r.waiting.filter((w) => !blockedBy[w.report_id]);
  }
  function skippedLines(r: NotesDumpApplyResult) {
    const named = new Set(r.not_drafted.map((x) => x.report_id ?? x.person_name));
    const extra = r.waiting
      .filter((w) => blockedBy[w.report_id] && !named.has(w.report_id))
      .map((w) => blockedText(blockedBy[w.report_id]) ?? "");
    return [...r.not_drafted.map((x) => x.reason), ...extra].filter(Boolean);
  }

  const laneNote = (lane: Lane | null, who: string) =>
    lane === "you_owe"
      ? `Saved as a commitment you owe ${who}. It’s on your prep sheet for them until you mark it done.`
      : lane === "they_owe"
        ? `Saved as a commitment ${who} owes you. It’s on your prep sheet for them until you mark it done.`
        : lane === "private"
          ? "Kept as a thought for your next prep sheet with them. Only you see it."
          : lane === "role"
            ? `Read by ${who}’s first role draft.`
            : null;

  // One item, wherever it sits now: the row, then the two chips that move it.
  function itemRow(it: Item) {
    const { lane, person } = effective(it, moves);
    const named = person && person !== NOT_ON_TEAM ? nameOf(person) : undefined;
    const who = named ? firstName(named) : "them";
    const due = it.dueDate && (lane === "you_owe" || lane === "they_owe") && it.kind === "commitment" ? ` · due ${it.dueDate}` : "";
    const label =
      lane === "you_owe" ? `You owe ${named ? who : "…"}${due}`
      : lane === "they_owe" ? `${named ? who : "Someone"} owes you${due}`
      : lane === "private" ? `${named ?? "A person"}${it.occurredOn ? ` · ${it.occurredOn}` : ""}`
      : lane === "role" ? `About the role${named ? ` · ${named}` : ""}`
      : "Not placed";
    const why = problem(it, moves, roleRows, nameOf);
    const editable = lane === "you_owe" || lane === "they_owe" || lane === "private";
    return (
      <Row key={it.id} rowKey={it.id} kept={kept} setKept={setKept} excerpt={it.kind === "role" || it.kind === "unplaced" ? null : it.excerpt}
        low={it.kind === "commitment" || it.kind === "note" ? it.low : false} edited={changed(it.id, it.text)} label={label}>
        {!editable ? (
          <p className="text-sm text-ink">{it.text}</p>
        ) : lane === "private" ? (
          <textarea
            aria-label={`Kept thought${named ? ` about ${named}` : ""}`}
            rows={3}
            className={`${INPUT} leading-relaxed`}
            value={edits[it.id] ?? it.text}
            onChange={(e) => setEdits({ ...edits, [it.id]: e.target.value })}
          />
        ) : (
          <input
            aria-label={lane === "you_owe" ? `What you owe ${named ?? "them"}` : `What ${named ?? "they"} ${named ? "owes" : "owe"} you`}
            className={INPUT}
            value={edits[it.id] ?? it.text}
            onChange={(e) => setEdits({ ...edits, [it.id]: e.target.value })}
          />
        )}
        <PlaceChips item={it} lane={lane} person={person} people={people} onMove={(patch) => move(it, patch)} />
        <p className="mt-1 text-xs text-ink-muted">{why ?? laneNote(lane, who)}</p>
      </Row>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-10"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notes-dump-title"
        className="w-full max-w-2xl rounded-xl border border-hairline bg-surface p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {(phase === "input" || phase === "reading") && (
          <>
            <p className={EYEBROW}>Setup</p>
            <h2 id="notes-dump-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              {forRoles ? "What you expect of each person" : "Add what you already have"}
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {forRoles
                ? "Take them one at a time: their role, what they own, how you’d tell it’s going well, anything you ask of them on a schedule. Talk or type. Each role gets a first draft for you to review before anything is approved."
                : "Notes from past conversations, who does what, the goals you were given. Talk, type, paste, or attach files. You review everything before it is saved."}
            </p>

            <NoteField
              id="notes-dump-text"
              aria-label="Your notes"
              value={text}
              onChange={setText}
              disabled={phase === "reading"}
              rows={9}
              placeholder={
                forRoles
                  ? "e.g. Priya, senior CSM. She owns onboarding for new accounts, and I want a written update from her every Friday. Sam runs renewals, mid-level. Good for him is no renewal surprises in the last month of a quarter."
                  : "e.g. Priya joined in March from the sales team and owns onboarding. Sam runs renewals, and wants to move into management. Our goal this year is to cut churn to 8%."
              }
              className="mt-4 text-sm leading-relaxed"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <button
                type="button"
                disabled={phase === "reading" || files.length >= MAX_FILES}
                onClick={() => fileInput.current?.click()}
                className="font-medium text-brand hover:text-brand-hover disabled:opacity-50"
              >
                Attach files
              </button>
              <span>PDF, Word or text · up to {MAX_FILES}</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-control bg-sunken px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink">
                      {f.name} <span className="ml-1 text-ink-muted">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    </span>
                    <button
                      type="button"
                      disabled={phase === "reading"}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="shrink-0 text-ink-secondary hover:text-ink"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 rounded-lg bg-sunken px-4 py-3 text-[13px] leading-relaxed text-ink-secondary">
              <p className="font-medium text-ink">What is stored</p>
              <p className="mt-1">
                This is read once to draft suggestions. Only the rows you choose to save are stored, as ordinary records
                you can edit or delete.
              </p>
              <p className="mt-1">
                If you keep a first draft of someone’s role expectations, what you typed about that person is stored on
                that role’s draft and shown above it when you open it. The rest of the text is not kept, and attached
                files are not kept. Leave out anything you aren’t allowed to share outside your company.
              </p>
            </div>

            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button type="button" disabled={phase === "reading"} onClick={skip} className={BTN_GHOST}>
                Nothing to add
              </button>
              <div className="flex items-center gap-2">
                <button type="button" disabled={phase === "reading"} onClick={onClose} className={BTN_SECONDARY}>
                  Close
                </button>
                <button
                  type="button"
                  onClick={read}
                  disabled={phase === "reading" || (!text.trim() && files.length === 0)}
                  className={BTN_PRIMARY}
                >
                  {phase === "reading" ? "Reading…" : "Read this"}
                </button>
              </div>
            </div>
            <WaitNote active={phase === "reading"} typical="10 to 40 seconds" className="mt-2 text-right" />
          </>
        )}

        {(phase === "review" || phase === "saving") && draft && (
          <>
            <p className={EYEBROW}>Review</p>
            <h2 id="notes-dump-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              {nothingHere ? "Nothing to save from that" : rows.length === 0 ? "Nothing suggested from that" : `${plural(rows.length, "suggestion", "suggestions")} from your notes`}
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {nothingHere
                ? "Nothing in it matched your team, roles or goals. Nothing was saved."
                : "Nothing is saved until you choose Save selected. Rows the notes did not state plainly start unchecked. The two tags on a row say where it goes and who it is about; change them if the guess is wrong."}
            </p>

            <Section title="Teams and departments" show={draft.org_units.length > 0}>
              {draft.org_units.map((u) => (
                <Row key={u.key} rowKey={u.key} kept={kept} setKept={setKept} excerpt={u.excerpt} low={u.low} edited={changed(u.key, u.name)}
                  label={`New ${u.unit_type}${u.parent_name ? `, under ${u.parent_name}` : ""}`}>
                  <input aria-label="Name" className={INPUT} value={edits[u.key] ?? u.name} onChange={(e) => setEdits({ ...edits, [u.key]: e.target.value })} />
                </Row>
              ))}
            </Section>

            <Section title="Roles and teams for people" show={draft.role_assignments.length > 0}>
              {draft.role_assignments.map((r) => (
                <Row key={r.key} rowKey={r.key} kept={kept} setKept={setKept} excerpt={r.excerpt} low={r.low} label={r.person_name}>
                  <p className="text-sm text-ink">
                    {[r.role_label && `Role: ${r.role_label}`, r.role_title && `Title: ${r.role_title}`, r.org_unit_name && `Team: ${r.org_unit_name}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {r.role_title && !r.role_level_id && (
                    <p className="mt-0.5 text-xs text-ink-muted">Saved as a title. No matching role yet, so no expectations apply.</p>
                  )}
                </Row>
              ))}
            </Section>

            <Section title="Role expectations" show={expRows.length > 0}>
              <li className="px-3 py-2.5 text-[13px] text-ink-secondary">
                {roleDraftCapLine(
                  maxRoles,
                  chosenRoles.size,
                  expRows.filter((e) => !hardBlocked(e) && !!kept[e.key] && roleLines(e).length > 0 && !drafting(e) && !chosenRoles.has(roleKey(e, titleOf(e), levelOf(e)))).map((e) => firstName(e.person_name)),
                )}
              </li>
              {expRows.map((e) => {
                const hard = hardBlocked(e);
                const blocked = hard || (e.blocked === "no_text" && roleLines(e).length === 0) ? blockedText(e) : null;
                const title = titleOf(e);
                return (
                  <Row key={e.key} rowKey={e.key} kept={kept} setKept={setKept} excerpt={e.excerpt} low={e.low} edited={changed(e.key, e.new_role?.job_role ?? "")} label={e.person_name}>
                    {e.new_role ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                        <span className="text-ink-secondary">New role:</span>
                        <input
                          aria-label={`New role for ${e.person_name}`}
                          className={`${INPUT} w-auto min-w-[12rem] flex-1`}
                          value={edits[e.key] ?? e.new_role.job_role}
                          onChange={(ev) => setEdits({ ...edits, [e.key]: ev.target.value })}
                        />
                        <label className="flex items-center gap-1.5 text-ink-secondary">
                          level
                          <input
                            type="number"
                            min={1}
                            max={10}
                            aria-label={`Level for ${e.person_name}`}
                            className={`${INPUT} w-16`}
                            value={levelOf(e)}
                            onChange={(ev) => setLevels({ ...levels, [e.key]: Math.min(10, Math.max(1, Number(ev.target.value) || 1)) })}
                          />
                        </label>
                        <span className="text-xs text-ink-muted">
                          {e.new_role.level_stated
                            ? `Read as ${seniorityWord(e.new_role.job_level)}level ${e.new_role.job_level} from how you described them. The title leaves seniority out. Check the level.`
                            : "No seniority stated, so it starts at 1. Check it."}
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm text-ink">Role: {e.role_label ?? "their current role"}</p>
                    )}
                    {e.statement && <p className="mt-1 text-sm text-ink-body">What you expect: {e.statement}</p>}
                    {blocked ? (
                      <p className="mt-1 text-xs text-ink-muted">{blocked}</p>
                    ) : (
                      <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-secondary">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={drafting(e)}
                          disabled={!canDraft(e) || (!title && !e.role_level_id)}
                          onChange={(ev) => setDrafts({ ...drafts, [e.key]: ev.target.checked })}
                        />
                        Write a first draft now
                        {!drafting(e) && kept[e.key] && chosenRoles.size >= maxRoles && !chosenRoles.has(roleKey(e, title, levelOf(e))) && (
                          <span className="text-ink-muted">· {maxRoles} roles chosen already. This one can go next.</span>
                        )}
                      </label>
                    )}
                    {!hard && !blocked &&
                      (items.some((it) => {
                        const p = placement(it, moves, roleRows);
                        return typeof p === "object" && p.role === e.report_id;
                      }) ? (
                        <details className="mt-1.5 text-xs text-ink-muted">
                          <summary className="cursor-pointer">
                            What the draft will read · {plural(roleLines(e).length, "sentence", "sentences")}
                          </summary>
                          <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline">
                            {items
                              .filter((it) => {
                                const p = placement(it, moves, roleRows);
                                return typeof p === "object" && p.role === e.report_id;
                              })
                              .map(itemRow)}
                          </ul>
                          <p className="mt-1.5">
                            The draft reads only these. Everything else you said about {firstName(e.person_name)} is under What you owe people,
                            What people owe you, About each person or Not placed.
                          </p>
                        </details>
                      ) : (
                        <p className="mt-1.5 text-xs text-ink-muted">
                          Nothing is tagged as about {firstName(e.person_name)}’s role, so there is nothing to draft from. Place a sentence under Not placed to change that.
                        </p>
                      ))}
                  </Row>
                );
              })}
            </Section>

            <Section title="What you owe people" show={inLane("you_owe").length > 0}>
              {inLane("you_owe").map(itemRow)}
            </Section>

            <Section title="What people owe you" show={inLane("they_owe").length > 0}>
              {inLane("they_owe").map(itemRow)}
            </Section>

            <Section title="Goals" show={draft.goals.length > 0}>
              {draft.goals.map((g) => (
                <Row key={g.key} rowKey={g.key} kept={kept} setKept={setKept} excerpt={g.excerpt} low={g.low} edited={changed(g.key, g.title)}
                  label={`${g.level[0].toUpperCase()}${g.level.slice(1)} goal${g.org_unit_name ? ` · ${g.org_unit_name}` : ""}${g.due_date ? ` · due ${g.due_date}` : ""}`}>
                  <input aria-label="Goal" className={INPUT} value={edits[g.key] ?? g.title} onChange={(e) => setEdits({ ...edits, [g.key]: e.target.value })} />
                  {g.success_metrics && <p className="mt-1 text-xs text-ink-muted">Measure: {g.success_metrics}</p>}
                </Row>
              ))}
            </Section>

            <Section title="About each person" show={inLane("private").length > 0}>
              {inLane("private").map(itemRow)}
            </Section>

            <Section title={`Not placed · ${inLane("unplaced").length}`} show={inLane("unplaced").length > 0}>
              <li className="px-3 py-2.5 text-[13px] text-ink-secondary">
                Sentences from your notes that none of the suggestions above are built from. Nothing is saved from one unless you place it.
              </li>
              {inLane("unplaced").map(itemRow)}
            </Section>
            {draft.unplaced_more > 0 && (
              <p className="mt-2 text-[13px] text-ink-secondary">
                {plural(draft.unplaced_more, "more sentence was", "more sentences were")} not shown here and will not be saved.
              </p>
            )}

            {draft.unmatched_people.length > 0 && (
              <p className="mt-4 text-[13px] text-ink-secondary">
                Named in your notes but not on your team: {draft.unmatched_people.map((p) => p.name).join(", ")}. Nothing is saved for them.
              </p>
            )}
            {draft.overflow > 0 && (
              <p className="mt-2 text-[13px] text-ink-secondary">
                {plural(draft.overflow, "more suggestion was", "more suggestions were")} found and not shown, and will not be saved. Run it again with a shorter text to see them.
              </p>
            )}
            {draft.truncated && (
              <p className="mt-2 text-[13px] text-ink-secondary">
                Your notes were longer than we can read at once. Only the first part was read.
              </p>
            )}

            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button type="button" disabled={phase === "saving"} onClick={() => setPhase("input")} className={BTN_GHOST}>
                Back to notes
              </button>
              <div className="flex items-center gap-2">
                <button type="button" disabled={phase === "saving"} onClick={onClose} className={BTN_SECONDARY}>
                  Close without saving
                </button>
                <button type="button" onClick={save} disabled={phase === "saving" || keptCount === 0} className={BTN_PRIMARY}>
                  {phase === "saving" ? "Saving…" : `Save ${keptCount} selected`}
                </button>
              </div>
            </div>
          </>
        )}

        {phase === "receipt" && result && (
          <>
            <p className={EYEBROW}>Saved</p>
            <h2 id="notes-dump-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              {receiptLine(result)}
            </h2>
            {result.skipped_existing > 0 && (
              <p className="mt-2 text-sm text-ink-secondary">{plural(result.skipped_existing, "row was", "rows were")} already there and not duplicated.</p>
            )}
            {result.refused.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-secondary">
                {result.refused.map((r, i) => (
                  <li key={i}>Not saved: {r.reason}</li>
                ))}
              </ul>
            )}
            {result.drafting.length > 0 && (
              <div className="mt-3 rounded-lg bg-sunken px-4 py-3 text-sm text-ink-secondary">
                <p className="text-ink">
                  Writing {plural(result.drafting.length, "first draft", "first drafts")} of role expectations, for{" "}
                  {result.drafting.map((d) => d.people.map(firstName).join(" and ")).join(", ")}.
                </p>
                <p className="mt-1">
                  It takes about a minute. They’ll be on{" "}
                  <Link href="/app/expectations" className="font-medium text-brand hover:text-brand-hover">
                    Roles &amp; expectations
                  </Link>
                  , unapproved, for you to review.
                </p>
              </div>
            )}
            {skippedLines(result).length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-secondary">
                {skippedLines(result).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            {offerable(result).length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline px-4 py-3 text-sm">
                <p className="min-w-0 flex-1 text-ink-secondary">
                  {offerable(result).map((w) => firstName(w.person_name)).join(", ")}{" "}
                  {offerable(result).length === 1 ? "has" : "have"} a role now and no draft yet.
                </p>
                {expRows.length > 0 && (
                  <button type="button" onClick={draftNext} disabled={nextPass} className={`${BTN_SECONDARY} shrink-0`}>
                    {nextPass ? "Queuing…" : `Draft the next ${Math.min(maxRoles, new Set(offerable(result).map((w) => w.role_level_id)).size)}`}
                  </button>
                )}
              </div>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
            <p className="mt-2 text-sm text-ink-secondary">What is still open stays on the setup card.</p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} disabled={nextPass} className={BTN_PRIMARY}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

type FlatRow = { key: string; low: boolean; original: string };

function allRows(d: NotesDumpDraft): FlatRow[] {
  return [
    ...d.org_units.map((r) => ({ key: r.key, low: r.low, original: r.name })),
    ...d.role_assignments.map((r) => ({ key: r.key, low: r.low, original: "" })),
    ...d.expectations.map((r) => ({ key: r.key, low: r.low, original: r.new_role?.job_role ?? "" })),
    ...d.goals.map((r) => ({ key: r.key, low: r.low, original: r.title })),
    ...d.person_notes.map((r) => ({ key: r.key, low: r.low, original: r.text })),
    ...(d.commitments ?? []).map((r) => ({ key: r.key, low: r.low, original: r.description })),
  ];
}

function receiptLine(r: NotesDumpApplyResult) {
  const s = r.saved;
  const parts = [
    s.org_units && plural(s.org_units, "team or department", "teams or departments"),
    r.roles_created && plural(r.roles_created, "new role", "new roles"),
    s.roles && plural(s.roles, "role or team assignment", "role or team assignments"),
    s.goals && plural(s.goals, "goal", "goals"),
    s.notes && plural(s.notes, "kept thought about a person", "kept thoughts about people"),
    s.commitments && plural(s.commitments, "thing you owe someone", "things you owe people"),
    s.owed_to_you && plural(s.owed_to_you, "thing someone owes you", "things people owe you"),
  ].filter(Boolean);
  if (parts.length) return parts.join(", ");
  // Drafts queued with nothing else new is not "nothing": the drafts are the result.
  if (r.drafting.length) return `${plural(r.drafting.length, "first draft", "first drafts")} started`;
  return "Nothing new was saved";
}

function readable(e: unknown) {
  if (e instanceof ApiError) {
    try {
      const d = JSON.parse(e.detail)?.detail;
      if (typeof d === "string") return d;
    } catch {
      /* not JSON */
    }
    return e.status < 500 ? e.detail : "That didn’t work. Your notes are still here, try again.";
  }
  return "That didn’t work. Your notes are still here, try again.";
}

function Section({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <section className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline">{children}</ul>
    </section>
  );
}

const CHIP =
  "max-w-full rounded-full border border-control bg-sunken px-2.5 py-1 text-xs text-ink-secondary hover:text-ink " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-600/40";

// The two tags on a row: where it goes and who it is about. Native selects, so
// they are closed chips until tapped and need no layout of their own.
function PlaceChips({
  item, lane, person, people, onMove,
}: {
  item: Item;
  lane: Lane | null;
  person: string | null;
  people: NotesDumpPerson[];
  onMove: (patch: Move) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <select
        aria-label="Where this goes"
        className={CHIP}
        value={lane ?? ""}
        onChange={(e) => onMove({ lane: e.target.value as Lane })}
      >
        {lane === null && <option value="" disabled>Place it…</option>}
        {LANES.map((l) => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>
      <select
        aria-label="Who it is about"
        className={CHIP}
        value={person ?? ""}
        onChange={(e) => onMove({ person: e.target.value })}
      >
        {person === null && <option value="" disabled>Who?</option>}
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
        <option value={NOT_ON_TEAM}>Not on my team</option>
      </select>
    </div>
  );
}

function Row({
  rowKey, kept, setKept, label, excerpt, low, edited, children,
}: {
  rowKey: string;
  kept: Record<string, boolean>;
  setKept: (k: Record<string, boolean>) => void;
  label: string;
  excerpt: string | null;
  low: boolean;
  // The manager changed the row's text: the quote is then what the notes said, not the source of what is shown.
  edited?: boolean;
  children: React.ReactNode;
}) {
  const id = `nd-${rowKey}`;
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <input
        id={id}
        type="checkbox"
        checked={!!kept[rowKey]}
        onChange={(e) => setKept({ ...kept, [rowKey]: e.target.checked })}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-xs font-medium text-ink-secondary">
          {label}
          {low && <span className="ml-2 font-normal text-ink-muted">· not stated plainly</span>}
        </label>
        <div className="mt-1">{children}</div>
        {excerpt && (
          <p className="mt-1 text-xs text-ink-muted">
            {edited ? "You edited this. Your notes said" : "From your notes"}: “{excerpt}”
          </p>
        )}
      </div>
    </li>
  );
}
