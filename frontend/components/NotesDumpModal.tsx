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
// Voice: literal labels, no cheer. Counts and fixed values only go to analytics
// (sent by the server; the browser sends only how many rows were edited).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  NotesDumpApplyResult,
  NotesDumpDraft,
  applyNotesDump,
  parseNotesDump,
  reportNotesDumpSkipped,
} from "@/lib/api";
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

export default function NotesDumpModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NotesDumpDraft | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Edits>({});
  const [result, setResult] = useState<NotesDumpApplyResult | null>(null);
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
      setKept(Object.fromEntries(allRows(d).map((r) => [r.key, !r.low])));
      setEdits({});
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
  const keptCount = rows.filter((r) => kept[r.key]).length;
  const editedCount = rows.filter((r) => kept[r.key] && edits[r.key] !== undefined && edits[r.key] !== r.original).length;

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
        person_notes: draft.person_notes.filter((n) => on(n.key)).map((n) => ({
          report_id: n.report_id, text: val(n.key, n.text),
        })),
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
              Add what you already have
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              Notes from past conversations, who does what, the goals you were given. Talk, type, paste, or attach files.
              You review everything before it is saved.
            </p>

            <NoteField
              id="notes-dump-text"
              aria-label="Your notes"
              value={text}
              onChange={setText}
              disabled={phase === "reading"}
              rows={9}
              placeholder="e.g. Priya joined in March from the sales team and owns onboarding. Sam runs renewals, and wants to move into management. Our goal this year is to cut churn to 8%."
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
                This is read once to draft suggestions. The text and files are not kept. Only the rows you choose to save
                are stored, as ordinary records you can edit or delete. Leave out anything you aren’t allowed to share
                outside your company.
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
          </>
        )}

        {(phase === "review" || phase === "saving") && draft && (
          <>
            <p className={EYEBROW}>Review</p>
            <h2 id="notes-dump-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              {rows.length === 0 ? "Nothing to save from that" : `${plural(rows.length, "suggestion", "suggestions")} from your notes`}
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {rows.length === 0
                ? "Nothing in it matched your team, roles or goals. Nothing was saved."
                : "Nothing is saved until you choose Save selected. Rows the notes did not state plainly start unchecked."}
            </p>

            <Section title="Teams and departments" show={draft.org_units.length > 0}>
              {draft.org_units.map((u) => (
                <Row key={u.key} rowKey={u.key} kept={kept} setKept={setKept} excerpt={u.excerpt} low={u.low}
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

            <Section title="Goals" show={draft.goals.length > 0}>
              {draft.goals.map((g) => (
                <Row key={g.key} rowKey={g.key} kept={kept} setKept={setKept} excerpt={g.excerpt} low={g.low}
                  label={`${g.level[0].toUpperCase()}${g.level.slice(1)} goal${g.org_unit_name ? ` · ${g.org_unit_name}` : ""}${g.due_date ? ` · due ${g.due_date}` : ""}`}>
                  <input aria-label="Goal" className={INPUT} value={edits[g.key] ?? g.title} onChange={(e) => setEdits({ ...edits, [g.key]: e.target.value })} />
                  {g.success_metrics && <p className="mt-1 text-xs text-ink-muted">Measure: {g.success_metrics}</p>}
                </Row>
              ))}
            </Section>

            <Section title="About each person" show={draft.person_notes.length > 0}>
              {draft.person_notes.map((n) => (
                <Row key={n.key} rowKey={n.key} kept={kept} setKept={setKept} excerpt={n.excerpt} low={n.low}
                  label={`${n.person_name}${n.occurred_on ? ` · ${n.occurred_on}` : ""}`}>
                  <textarea
                    aria-label={`Note about ${n.person_name}`}
                    rows={3}
                    className={`${INPUT} leading-relaxed`}
                    value={edits[n.key] ?? n.text}
                    onChange={(e) => setEdits({ ...edits, [n.key]: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-ink-muted">Saved as a private note. Your next prep sheet for them reads it.</p>
                </Row>
              ))}
            </Section>

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
            <p className="mt-2 text-sm text-ink-secondary">What is still open stays on the setup card.</p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className={BTN_PRIMARY}>
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
    ...d.goals.map((r) => ({ key: r.key, low: r.low, original: r.title })),
    ...d.person_notes.map((r) => ({ key: r.key, low: r.low, original: r.text })),
  ];
}

function receiptLine(r: NotesDumpApplyResult) {
  const s = r.saved;
  const parts = [
    s.org_units && plural(s.org_units, "team or department", "teams or departments"),
    s.roles && plural(s.roles, "role or team assignment", "role or team assignments"),
    s.goals && plural(s.goals, "goal", "goals"),
    s.notes && plural(s.notes, "note about a person", "notes about people"),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing was saved";
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

function Row({
  rowKey, kept, setKept, label, excerpt, low, children,
}: {
  rowKey: string;
  kept: Record<string, boolean>;
  setKept: (k: Record<string, boolean>) => void;
  label: string;
  excerpt: string | null;
  low: boolean;
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
        {excerpt && <p className="mt-1 text-xs text-ink-muted">From your notes: “{excerpt}”</p>}
      </div>
    </li>
  );
}
