"use client";

// The meeting screen's three columns (build plan B3): today's agenda, the
// manager's notes, and the person's history. Each is a plain component so
// the layout can arrange them as three columns, two with tabs, or the
// phone's three tabs without duplicating anything.

import { useEffect, useMemo, useRef, useState } from "react";
import NoteField from "@/components/NoteField";
import { getCallTranscript, type CallTranscriptDetail, type Commitment, type OneOnOne } from "@/lib/api";
import { BTN_GHOST, EYEBROW, INPUT } from "@/lib/tokens";
import { dueState, instantDate, isoToDateStr, shortDate } from "@/components/team/dates";

// ── agenda ───────────────────────────────────────────────────────────────

export type AgendaRow = {
  key: string;
  title: string;
  /** Unprepped rows say where they came from. */
  kind?: string;
  attention?: boolean;
  why?: string;
  questions?: string[];
};

const Check = ({ on }: { on: boolean }) => (
  <span
    aria-hidden
    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition motion-reduce:transition-none ${
      on ? "border-brand bg-brand text-on-brand" : "border-ink-muted bg-surface"
    }`}
  >
    {on && (
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5 9-10" />
      </svg>
    )}
  </span>
);

export function AgendaColumn({
  prepped,
  openingLine,
  rows,
  covered,
  onToggle,
  onAdd,
  firstName,
  owedNotice,
  showEyebrow = true,
}: {
  prepped: boolean;
  openingLine: string | null;
  rows: AgendaRow[];
  covered: Set<string>;
  onToggle: (key: string) => void;
  onAdd: (title: string) => void;
  firstName: string;
  /** An overdue commitment the manager owes, kept in sight on the agenda. */
  owedNotice?: string | null;
  showEyebrow?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function add() {
    const t = draft.trim();
    if (t) onAdd(t);
    setDraft("");
    setAdding(false);
  }

  return (
    <section aria-label="Agenda">
      {showEyebrow && (
        prepped ? (
          <p className={EYEBROW}>Today&apos;s agenda</p>
        ) : (
          <>
            <p className={EYEBROW}>Already on the list for {firstName}</p>
            <p className="mt-1 text-xs text-ink-muted">Gathered from earlier 1:1s. Tick what you cover.</p>
          </>
        )
      )}

      {openingLine && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-brand-tint px-3.5 py-3">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-brand">Open with</p>
          <p className="mt-1 font-serif text-[15px] leading-snug text-ink">&ldquo;{openingLine}&rdquo;</p>
        </div>
      )}

      <ul className="mt-3 space-y-1">
        {rows.map((row) => {
          const on = covered.has(row.key);
          const detail = !!(row.why || row.questions?.length);
          const expanded = open.has(row.key);
          return (
            <li key={row.key} className="rounded-lg">
              <div className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-sunken">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${row.title}: covered`}
                  onClick={() => onToggle(row.key)}
                  className="rounded-[5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  <Check on={on} />
                </button>
                <div className="min-w-0 flex-1">
                  {row.kind && <p className={`text-2xs ${row.attention ? "font-medium text-amber-700" : "text-ink-muted"}`}>{row.kind}</p>}
                  <p className={`text-sm leading-snug ${on ? "text-ink-muted line-through" : "font-semibold text-ink"}`}>{row.title}</p>
                  {detail && (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setOpen((s) => {
                          const n = new Set(s);
                          if (n.has(row.key)) n.delete(row.key);
                          else n.add(row.key);
                          return n;
                        })
                      }
                      className="mt-0.5 text-xs text-ink-muted hover:text-ink-secondary"
                    >
                      Why · questions
                    </button>
                  )}
                  {detail && expanded && (
                    <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-ink-secondary">
                      {row.why && <p>{row.why}</p>}
                      {row.questions && row.questions.length > 0 && (
                        <ul className="list-disc space-y-1 pl-4">
                          {row.questions.map((q) => (
                            <li key={q}>{q}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && !prepped && <p className="mt-3 text-sm text-ink-muted">Nothing carried over yet. Add a topic, or just talk.</p>}

      {adding ? (
        <div className="mt-2 px-2">
          <label htmlFor="meet-add-topic" className="sr-only">
            New topic
          </label>
          <input
            id="meet-add-topic"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={add}
            placeholder="What else came up?"
            className={INPUT}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 px-2 py-1 text-[13px] font-medium text-brand hover:text-brand-hover">
          + Add a topic
        </button>
      )}

      {owedNotice && <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{owedNotice}</p>}
    </section>
  );
}

// ── notes ────────────────────────────────────────────────────────────────

export function NotesColumn({
  offRecord,
  notes,
  privateNotes,
  onNotes,
  onPrivateNotes,
  transcriptId,
  firstName,
  vocabulary,
  rows,
}: {
  offRecord: boolean;
  notes: string;
  privateNotes: string;
  onNotes: (v: string) => void;
  onPrivateNotes: (v: string) => void;
  transcriptId: string | null;
  firstName: string;
  vocabulary: string;
  rows: number;
}) {
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const [showPrivate, setShowPrivate] = useState(false);
  useEffect(() => {
    if (!transcriptId) setTab("notes");
  }, [transcriptId]);

  const writingPrivate = offRecord || showPrivate;

  return (
    <section aria-label="Notes">
      <div role="tablist" aria-label="Notes and transcript" className="flex gap-6 border-b border-hairline">
        {(["notes", "transcript"] as const).map((t) =>
          t === "transcript" && !transcriptId ? null : (
            <button
              key={t}
              type="button"
              role="tab"
              id={`meet-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`meet-panel-${t}`}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 py-2.5 text-sm ${tab === t ? "border-brand font-semibold text-brand" : "border-transparent text-ink-secondary hover:text-ink"}`}
            >
              {t === "notes" ? "Your notes" : "Transcript"}
            </button>
          ),
        )}
      </div>

      <div id="meet-panel-notes" role="tabpanel" aria-labelledby="meet-tab-notes" hidden={tab !== "notes"} className="pt-3">
        <label htmlFor="meet-notes" className={`block text-xs ${offRecord ? "font-semibold text-ink-body" : "text-ink-muted"}`}>
          {offRecord
            ? "Off the record. What you type now stays a private note, and it is not used in the draft."
            : showPrivate
              ? "Your private note. Kept on their page, never used in the draft."
              : "What mattered. The transcript has the rest."}
        </label>
        <NoteField
          id="meet-notes"
          value={writingPrivate ? privateNotes : notes}
          onChange={writingPrivate ? onPrivateNotes : onNotes}
          vocabulary={vocabulary}
          rows={rows}
          className={`mt-2 ${writingPrivate ? "border-carbon-500" : ""}`}
          placeholder={writingPrivate ? "" : `– Where ${firstName} landed\n– What you'll do next`}
        />
        {offRecord && notes.trim() && <p className="mt-2 text-xs text-ink-muted">Your call notes are set aside, not lost. They&apos;re back when you resume.</p>}
        {!offRecord && privateNotes.trim() && (
          <button type="button" onClick={() => setShowPrivate((v) => !v)} className="mt-2 text-xs text-ink-secondary hover:text-ink">
            {showPrivate ? "Back to your call notes" : "Private note kept · not used in the draft · View"}
          </button>
        )}
      </div>

      {transcriptId && (
        <div id="meet-panel-transcript" role="tabpanel" aria-labelledby="meet-tab-transcript" hidden={tab !== "transcript"} className="pt-3">
          {tab === "transcript" && <TranscriptView transcriptId={transcriptId} firstName={firstName} />}
        </div>
      )}
    </section>
  );
}

function TranscriptView({ transcriptId, firstName }: { transcriptId: string; firstName: string }) {
  const [data, setData] = useState<CallTranscriptDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      getCallTranscript(transcriptId)
        .then((d) => live && (setData(d), setFailed(false)))
        .catch(() => live && setFailed(true));
    load();
    // Lines arrive per 3-minute segment; once a minute is plenty.
    const id = window.setInterval(load, 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [transcriptId]);

  const items = useMemo(() => {
    if (!data) return [];
    const out: ({ type: "line"; t: number; speaker: string; text: string } | { type: "gap"; t: number; label: string })[] = data.lines.map((l) => ({
      type: "line",
      t: l.t_ms,
      speaker: l.speaker === "self" ? "You" : l.speaker === "other" ? firstName : "",
      text: l.text,
    }));
    for (const g of data.gaps) {
      const mins = Math.max(1, Math.round(((g.end_ms ?? g.start_ms) - g.start_ms) / 60000));
      const what = g.kind === "pause" ? "Paused" : g.kind === "off_record" ? "Off the record" : "Not transcribed";
      out.push({ type: "gap", t: g.start_ms, label: g.end_ms === null ? `${what} · now` : `${what} · ${mins} min` });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [data, firstName]);

  return (
    <div>
      <p className="text-xs text-ink-muted">Machine transcript · updates every few minutes · audio is discarded once transcribed</p>
      {failed && !data && <p className="mt-4 text-sm text-ink-muted">Couldn&apos;t load the transcript just now.</p>}
      {data && items.length === 0 && <p className="mt-4 text-sm text-ink-muted">Nothing transcribed yet. Lines appear a few minutes in.</p>}
      <ol className="mt-3 space-y-2.5">
        {items.map((it, i) =>
          it.type === "gap" ? (
            <li key={`g${i}`} className="flex items-center gap-3 text-2xs text-ink-muted">
              <span className="h-px flex-1 border-t border-dashed border-control" />
              {it.label}
              <span className="h-px flex-1 border-t border-dashed border-control" />
            </li>
          ) : (
            <li key={`l${i}`} className="text-sm leading-relaxed text-ink-body">
              <span className="mr-2 font-sans text-2xs tabular-nums text-ink-muted">{clock(it.t)}</span>
              {it.speaker && <span className="mr-1.5 font-semibold text-ink">{it.speaker}</span>}
              {it.text}
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── history ──────────────────────────────────────────────────────────────

export function HistoryColumn({
  firstName,
  completed,
  commitments,
  onCommitment,
  showEyebrow = true,
}: {
  firstName: string;
  completed: OneOnOne[];
  commitments: Commitment[];
  onCommitment: (c: Commitment, status: "done" | "dropped") => void;
  showEyebrow?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState("");
  const last = completed[0] ?? null;
  const earlier = completed.slice(1);
  const ql = q.trim().toLowerCase();
  const shown = ql ? earlier.filter((s) => (s.summary ?? s.display_summary ?? "").toLowerCase().includes(ql)) : earlier.slice(0, 6);
  const opening = last ? firstSentence(last.summary ?? last.display_summary ?? "") : "";
  const sorted = [...commitments].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <section aria-label={`${firstName}'s history`}>
      {showEyebrow && <p className={EYEBROW}>{firstName} · history</p>}

      {last ? (
        <div className="mt-3">
          <p className="text-xs text-ink-muted">Last time · {last.meeting_date ? instantDate(last.meeting_date) : "date unknown"}</p>
          <p className="mt-1 font-serif text-[15px] leading-snug text-ink">{expanded ? last.summary : opening}</p>
          {(last.summary ?? "").length > opening.length && (
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs text-ink-muted hover:text-ink-secondary">
              {expanded ? "Show less" : "Read the rest"}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">Your first 1:1 with {firstName}. History starts here.</p>
      )}

      <p className={`${EYEBROW} mt-6`}>Open commitments</p>
      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing open either way.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {sorted.map((c) => {
            const yours = c.committed_by !== "direct_report";
            const state = dueState(c.due_date);
            return (
              <li key={c.id} className="group rounded-lg border border-hairline bg-surface px-3 py-2.5">
                <p className="text-sm text-ink">{c.description}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${yours ? "bg-brand-tint text-brand" : "bg-blue-50 text-blue-700"}`}>
                    {yours ? "You" : firstName}
                  </span>
                  {c.due_date && (
                    <span className={`text-xs ${state === "overdue" ? "font-medium text-amber-700" : "text-ink-muted"}`}>
                      {state === "overdue" ? `Overdue · ${shortDate(c.due_date)}` : `Due ${shortDate(c.due_date)}`}
                    </span>
                  )}
                  <span className="ml-auto flex gap-1">
                    <button type="button" onClick={() => onCommitment(c, "done")} className={`${BTN_GHOST} px-2 py-0.5 text-xs`}>
                      Done
                    </button>
                    <button type="button" onClick={() => onCommitment(c, "dropped")} className={`${BTN_GHOST} px-2 py-0.5 text-xs`}>
                      Drop
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {earlier.length > 0 && (
        <>
          <div className="mt-6 flex items-center justify-between gap-3">
            <p className={EYEBROW}>Earlier</p>
          </div>
          {earlier.length > 3 && (
            <>
              <label htmlFor="meet-history-search" className="sr-only">
                Search earlier conversations
              </label>
              <input
                id="meet-history-search"
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search earlier 1:1s"
                className={`mt-2 ${INPUT}`}
              />
            </>
          )}
          <ul className="mt-2 space-y-2.5">
            {shown.map((s) => (
              <li key={s.id}>
                <p className="text-xs text-ink-muted">{s.meeting_date ? instantDate(s.meeting_date) : "—"}</p>
                <p className="line-clamp-2 text-sm text-ink-body">{s.summary ?? s.display_summary}</p>
              </li>
            ))}
            {ql && shown.length === 0 && <li className="text-sm text-ink-muted">No earlier 1:1 mentions that.</li>}
          </ul>
        </>
      )}
    </section>
  );
}

export function firstSentence(text: string) {
  const t = text.trim();
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

export function dateOf(session: OneOnOne | null): string | null {
  if (!session?.scheduled_at) return null;
  return isoToDateStr(session.scheduled_at);
}
