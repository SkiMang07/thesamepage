"use client";

// Promises in your note (onboarding review 2026-10-05, finding #4).
//
// Right after a prep sheet is built from a note, the same note goes through
// the capture-by-person reader (POST /api/person-intake/{id}/draft, source
// "prep_note"; docs/decisions/capture-by-person.md). Only its commitments are
// shown: kept thoughts are already on the sheet. The reader's guards hold as
// they are: every row quotes the note, a sentence naming someone else on the
// team is not read, a side the note did not state is never guessed, and a
// commitment already open on the same side is not drafted again.
//
// AI drafts, the manager confirms (Hard Rule 6): each row is added through
// POST /api/commitments only when the manager chooses "Add to commitments".
// A row added or set aside is remembered for this tab by its quote, so
// rebuilding the sheet from the same note does not ask about it again.
//
// The state lives in useNotePromises(), held by the prep page, so leaving the
// sheet for the wrap-up and coming back does not read the note a second time.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, Commitment, createCommitment, draftPersonIntake } from "@/lib/api";
import { joinDraft } from "@/lib/aiDraftTelemetry";
import { useAiDraft } from "@/lib/useAiDraft";
import { BTN_GHOST, BTN_PRIMARY_SM, INPUT } from "@/lib/tokens";

type Side = "manager" | "direct_report" | null;
type RowState = "open" | "saving" | "saved" | "dismissed";
export type PromiseRow = {
  key: string;
  description: string;
  side: Side;
  due: string;
  quote: string;
  state: RowState;
  error: string | null;
};
type Phase = "idle" | "reading" | "ready" | "error";

const HANDLED = (reportId: string) => `tsp:prep-promises-handled:${reportId}`;

// Same normalisation as the reader's quote check (person_intake._norm).
export function normQuote(s: string): string {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
}

function readHandled(reportId: string): string[] {
  try {
    const v = window.sessionStorage.getItem(HANDLED(reportId));
    return v ? (JSON.parse(v) as string[]) : [];
  } catch {
    return [];
  }
}
function markHandled(reportId: string, quote: string) {
  try {
    const next = Array.from(new Set([...readHandled(reportId), normQuote(quote)]));
    window.sessionStorage.setItem(HANDLED(reportId), JSON.stringify(next));
  } catch {
    /* storage can be unavailable; a rebuild may then ask again */
  }
}

export function useNotePromises(reportId: string, onAdded?: (c: Commitment) => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<PromiseRow[]>([]);
  const [alreadyOpen, setAlreadyOpen] = useState(0);
  const [notRead, setNotRead] = useState(0);
  const lastNote = useRef("");
  const seq = useRef(0);
  const added = useRef(onAdded);
  added.current = onAdded;
  const telemetry = useAiDraft("prep_note_promises");
  const drafted = useRef<string[]>([]);

  const read = useCallback(
    async (note: string) => {
      const text = note.trim();
      const mine = ++seq.current;
      setRows([]);
      if (!text) {
        setPhase("idle");
        return;
      }
      lastNote.current = text;
      setPhase("reading");
      try {
        const d = await draftPersonIntake(reportId, text, "prep_note");
        if (mine !== seq.current) return;
        const handled = readHandled(reportId);
        const fresh = d.commitments.filter((c) => !handled.includes(normQuote(c.quote)));
        setRows(fresh.map((c) => ({
          key: c.key, description: c.description, side: c.committed_by, due: c.due_date ?? "",
          quote: c.quote, state: "open", error: null,
        })));
        setAlreadyOpen(d.already_there);
        setNotRead(d.mentions.length);
        setPhase("ready");
        drafted.current = fresh.map((c) => c.description);
        if (fresh.length) telemetry.start({ text: joinDraft(drafted.current), items: drafted.current });
      } catch {
        if (mine === seq.current) setPhase("error");
      }
    },
    [reportId, telemetry],
  );

  const retry = useCallback(() => read(lastNote.current), [read]);

  const update = useCallback((key: string, patch: Partial<PromiseRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const add = useCallback(
    async (row: PromiseRow) => {
      if (row.state !== "open" || !row.side || !row.description.trim()) return;
      update(row.key, { state: "saving", error: null });
      try {
        const c = await createCommitment({
          description: row.description.trim(),
          direct_report_id: reportId,
          committed_by: row.side,
          due_date: row.due || null,
        });
        markHandled(reportId, row.quote);
        update(row.key, { state: "saved" });
        added.current?.(c);
      } catch (e) {
        const msg = e instanceof ApiError && e.status < 500 ? e.detail : "That didn’t save. Try again.";
        update(row.key, { state: "open", error: msg });
      }
    },
    [reportId, update],
  );

  const setAside = useCallback(
    (row: PromiseRow) => {
      if (row.state !== "open") return;
      markHandled(reportId, row.quote);
      update(row.key, { state: "dismissed" });
    },
    [reportId, update],
  );

  // One draft, one resolution: once no row is waiting, the draft is accepted
  // if anything was added, discarded if every row was set aside.
  useEffect(() => {
    if (phase !== "ready" || rows.length === 0 || !telemetry.isOpen()) return;
    if (rows.some((r) => r.state === "open" || r.state === "saving")) return;
    const saved = rows.filter((r) => r.state === "saved").map((r) => r.description.trim());
    if (saved.length) telemetry.accept({ text: joinDraft(saved), items: saved });
    else telemetry.discard();
  }, [phase, rows, telemetry]);

  const waiting = rows.filter((r) => r.state === "open" || r.state === "saving").length;
  return { phase, rows, alreadyOpen, notRead, waiting, read, retry, update, add, setAside };
}

export type NotePromisesState = ReturnType<typeof useNotePromises>;

function first(name: string) {
  return name.trim().split(/\s+/)[0] || "them";
}

export default function NotePromises({ np, reportName }: { np: NotePromisesState; reportName: string }) {
  const who = first(reportName);
  const { phase, rows, alreadyOpen, notRead, waiting } = np;

  if (phase === "idle") return null;
  if (phase === "reading") {
    return <p className="mt-8 text-xs text-ink-muted" aria-live="polite">Reading your note for promises…</p>;
  }
  if (phase === "error") {
    return (
      <p className="mt-8 text-xs text-ink-muted" role="status">
        Could not read your note for promises.{" "}
        <button type="button" onClick={np.retry} className="font-medium text-brand hover:text-brand-hover">
          Try again
        </button>
      </p>
    );
  }
  const shown = rows.filter((r) => r.state !== "dismissed");
  if (shown.length === 0) return null;
  const saved = rows.filter((r) => r.state === "saved").length;

  return (
    <section id="note-promises" aria-labelledby="note-promises-title" className="mt-8 scroll-mt-8">
      <h2 id="note-promises-title" className="text-sm font-medium uppercase tracking-wide text-ink-muted">
        Promises in your note
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        Nothing is added until you choose Add. Each row quotes your note. Choose who owes it.
      </p>
      <ul className="mt-3 divide-y divide-hairline rounded-lg border border-hairline bg-surface">
        {shown.map((r) => {
          const locked = r.state !== "open";
          return (
            <li key={r.key} className="px-4 py-3">
              {r.state === "saved" ? (
                <p className="text-sm text-ink-body">
                  {r.description}
                  <span className="ml-1 text-xs text-ink-muted">
                    ({r.side === "direct_report" ? who : "yours"}{r.due && ` · due ${r.due}`}) · Added to commitments
                  </span>
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div role="group" aria-label="Who owes this" className="inline-flex overflow-hidden rounded-full border border-control text-xs">
                      {([["manager", `You owe ${who}`], ["direct_report", `${who} owes you`]] as const).map(([value, label]) => (
                        <button
                          key={value} type="button" disabled={locked} aria-pressed={r.side === value}
                          onClick={() => np.update(r.key, { side: value })}
                          className={`px-2.5 py-1 ${r.side === value ? "bg-brand/20 text-ink" : "text-ink-secondary hover:text-ink"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                      due
                      <input
                        type="date" className={`${INPUT} w-auto py-1 text-xs`} value={r.due} disabled={locked}
                        onChange={(e) => np.update(r.key, { due: e.target.value })}
                      />
                    </label>
                  </div>
                  <input
                    aria-label="Commitment" className={`${INPUT} mt-2`} value={r.description} disabled={locked}
                    onChange={(e) => np.update(r.key, { description: e.target.value })}
                  />
                  {r.side === null && (
                    <p className="mt-1 text-xs text-amber-700">Your note did not say who owes this. Choose one.</p>
                  )}
                  <p className="mt-1 text-xs text-ink-muted">From your note: “{r.quote}”</p>
                  {r.error && <p role="alert" className="mt-1 text-xs text-red-700">{r.error}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button" onClick={() => np.add(r)}
                      disabled={locked || r.side === null || !r.description.trim()}
                      className={BTN_PRIMARY_SM}
                    >
                      {r.state === "saving" ? "Adding…" : "Add to commitments"}
                    </button>
                    <button type="button" onClick={() => np.setAside(r)} disabled={locked} className={BTN_GHOST}>
                      Not a promise
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {(alreadyOpen > 0 || notRead > 0 || (saved > 0 && waiting === 0)) && (
        <div className="mt-2 space-y-1 text-xs text-ink-muted">
          {saved > 0 && waiting === 0 && (
            <p>Added {saved} to {who}’s commitments. They show on {who}’s page and on the next prep sheet.</p>
          )}
          {alreadyOpen > 0 && (
            <p>{alreadyOpen} already {alreadyOpen === 1 ? "an open commitment" : "open commitments"} for {who}, so not listed again.</p>
          )}
          {notRead > 0 && (
            <p>
              {notRead} {notRead === 1 ? "sentence names" : "sentences name"} someone else on your team and {notRead === 1 ? "was" : "were"} not read here.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
