"use client";

// ---------------------------------------------------------------------------
// The wrap-up, in place on the meeting screen (build plan B7).
//
// End 1:1 turns the same screen into this, with no page change:
//
//   Left    Covered (ticked topics), then "Carry into the next 1:1": topics
//           left unticked, pre-ticked here, plus what the draft found open.
//   Centre  The draft. A progress line, then Summary, Commitments and "Open
//           next time with", skeletons until the draft lands.
//   Right   "What's kept": transcript and gap minutes, audio discarded,
//           private notes, how a gap reads in the report's copy, the
//           off-the-record note itself, and Delete the transcript.
//
// The left and right columns need no AI, so they show at once. The draft
// waits for the transcript to finish (the last segment is usually still
// uploading when End 1:1 is pressed), then one AI call drafts from the call
// notes plus the transcript. Off-the-record notes are never sent: the
// request has no field for them.
//
// Save log stays disabled until the draft is ready, so End 1:1 → Save log
// is two clicks. Draft-then-review: nothing from the transcript enters the
// record until the manager saves.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCallTranscript,
  getCallTranscript,
  listCallTranscripts,
  wrapUpOneOnOne,
  type CallTranscriptDetail,
  type CommittedBy,
  type DirectReport,
  type OneOnOne,
  type WrapUpCommitment,
  type WrapUpDraft,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INPUT } from "@/lib/tokens";
import NoteField from "@/components/NoteField";
import PageShell from "@/components/PageShell";
import PersonAvatar from "@/components/team/PersonAvatar";
import { localDateStr, mediumDate } from "@/components/team/dates";
import { joinDraft } from "@/lib/aiDraftTelemetry";
import { useAiDraft } from "@/lib/useAiDraft";
import { saveOneOnOneLog } from "@/lib/one-on-one-save";
import { stashOneOnOneReceipt } from "@/lib/one-on-one-receipt";
import type { MeetingDraft } from "@/lib/meeting-draft";
import type { AgendaRow } from "./MeetingColumns";

/** How long the wrap-up waits for the last segments before drafting anyway. */
const READY_WAIT_MS = Number(process.env.NEXT_PUBLIC_WRAPUP_READY_WAIT_MS) || 20_000;
const POLL_MS = 1_500;

type Phase = "finishing" | "drafting" | "ready" | "failed";
type EditableCommitment = WrapUpCommitment & { key: number };
type CarryItem = { key: string; title: string; on: boolean };

/** Milliseconds into the call as m:ss, or h:mm:ss past an hour. */
export function callClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Whole minutes for a duration, "under a minute" below one. */
function minutes(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute" : `${m} min`;
}

/** Transcribed and not-transcribed time from the transcript's own record. */
export function keptTimes(t: CallTranscriptDetail | null): { transcribedMs: number; gapMs: number } | null {
  if (!t) return null;
  const started = Date.parse(t.started_at);
  const spanMs =
    t.ended_at_ms != null ? t.ended_at_ms : t.ended_at ? Math.max(0, Date.parse(t.ended_at) - started) : null;
  const lastLine = t.lines.length ? t.lines[t.lines.length - 1].t_ms : 0;
  const span = spanMs ?? lastLine;
  let gapMs = 0;
  for (const g of t.gaps) {
    const end = g.end_ms ?? span;
    gapMs += Math.max(0, Math.min(end, span) - g.start_ms);
  }
  return { transcribedMs: Math.max(0, span - gapMs), gapMs };
}

export default function MeetingWrapUp({
  widthRef,
  report,
  session,
  draft,
  rows,
  covered,
  transcriptId: liveTranscriptId,
  layout,
  onBack,
  onSaved,
}: {
  /** The meeting screen measures its content column through this. */
  widthRef: (el: HTMLDivElement | null) => void;
  report: DirectReport;
  session: OneOnOne;
  draft: MeetingDraft;
  rows: AgendaRow[];
  covered: Set<string>;
  /** The meeting's transcript, when the recorder still knows it. */
  transcriptId: string | null;
  layout: "three" | "two" | "phone";
  onBack: () => void;
  /** Called once the log is saved, before the page moves to the Desk. */
  onSaved: () => void;
}) {
  const router = useRouter();
  const first = report.name.split(" ")[0] || "them";
  const today = localDateStr();

  // ── the transcript ───────────────────────────────────────────────────────
  const [transcriptId, setTranscriptId] = useState<string | null>(liveTranscriptId);
  const [transcript, setTranscript] = useState<CallTranscriptDetail | null>(null);
  const [transcriptDeleted, setTranscriptDeleted] = useState(false);
  const [resolved, setResolved] = useState(!!liveTranscriptId);

  // After a reload or an Undo the recorder no longer holds the id: the 1:1's
  // own transcript is the newest one that has ended.
  useEffect(() => {
    if (liveTranscriptId) return;
    let live = true;
    listCallTranscripts({ one_on_one_id: session.id })
      .then(({ transcripts }) => {
        if (!live) return;
        const t = transcripts.find((x) => x.status !== "recording");
        setTranscriptId(t?.id ?? null);
      })
      .catch(() => live && setTranscriptId(null))
      .finally(() => live && setResolved(true));
    return () => {
      live = false;
    };
  }, [liveTranscriptId, session.id]);

  // ── the draft ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("finishing");
  const [result, setResult] = useState<WrapUpDraft | null>(null);
  const [lateEnd, setLateEnd] = useState(false);
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    const alive = () => runId.current === id;
    setPhase("finishing");
    setLateEnd(false);
    let tid = transcriptId;
    if (tid) {
      // Wait for the last segments, but never longer than READY_WAIT_MS:
      // a draft from nearly all of the call beats keeping the manager waiting.
      const deadline = Date.now() + READY_WAIT_MS;
      for (;;) {
        try {
          const t = await getCallTranscript(tid);
          if (!alive()) return;
          setTranscript(t);
          if (t.status === "ready" || t.status === "failed") break;
        } catch {
          if (!alive()) return;
          tid = null; // gone or unreadable: draft from the notes alone
          break;
        }
        if (Date.now() >= deadline) {
          setLateEnd(true);
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive()) return;
      }
    }
    setPhase("drafting");
    if (!draft.notes.trim() && !tid) {
      setResult({ summary: "", commitments: [], follow_up_items: [], opening_line: "", transcript: null });
      setPhase("ready");
      return;
    }
    try {
      // Call notes only. draft.privateNotes is never sent anywhere but the
      // log save's private_notes field.
      const r = await wrapUpOneOnOne({ direct_report_id: report.id, raw_notes: draft.notes, transcript_id: tid });
      if (!alive()) return;
      setResult(r);
      setPhase("ready");
    } catch {
      if (alive()) setPhase("failed");
    }
  }, [transcriptId, draft.notes, report.id]);

  useEffect(() => {
    if (!resolved) return;
    void run();
    return () => {
      runId.current++;
    };
    // Draft once per End 1:1 (and on Try again); notes don't change here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // ── editable state ───────────────────────────────────────────────────────
  const [summary, setSummary] = useState("");
  const [commitments, setCommitments] = useState<EditableCommitment[]>([]);
  const [opening, setOpening] = useState("");
  const [editingOpening, setEditingOpening] = useState(false);
  const nextKey = useRef(0);

  const unticked = useMemo(
    () =>
      rows
        .filter((r) => !covered.has(r.key) && (r.key.startsWith("a-") || r.key.startsWith("add-") || r.key.startsWith("cf-")))
        .map((r) => r.title),
    [rows, covered],
  );
  const coveredRows = useMemo(() => rows.filter((r) => covered.has(r.key)), [rows, covered]);
  const [carry, setCarry] = useState<CarryItem[]>(() => unticked.map((t, i) => ({ key: `u-${i}`, title: t, on: true })));
  const [addingTopic, setAddingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");

  const telemetry = useAiDraft("one_on_one_wrapup");
  useEffect(() => {
    if (!result) return;
    setSummary(result.summary);
    setCommitments(result.commitments.map((c) => ({ ...c, key: nextKey.current++ })));
    setOpening(result.opening_line ?? "");
    // What the draft found left open joins the carry list, ticked.
    setCarry((items) => {
      const seen = new Set(items.map((i) => i.title.trim().toLowerCase()));
      const extra = result.follow_up_items
        .filter((t) => !seen.has(t.trim().toLowerCase()))
        .map((t, i) => ({ key: `d-${i}-${t}`, title: t, on: true }));
      return [...items, ...extra];
    });
    telemetry.start({
      text: joinDraft([result.summary, ...result.commitments.map((c) => c.description), ...result.follow_up_items, result.opening_line]),
      items: result.commitments.map((c) => c.description),
    });
  }, [result, telemetry]);

  const update = (key: number, p: Partial<EditableCommitment>) =>
    setCommitments((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c)));

  // ── save ─────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const ready = phase === "ready";
  const canSave = ready && !!summary.trim() && !saving;

  async function save() {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const kept = carry.filter((c) => c.on).map((c) => c.title.trim()).filter(Boolean);
    try {
      const outcome = await saveOneOnOneLog({
        direct_report_id: report.id,
        summary: summary.trim(),
        notes: draft.notes,
        meeting_date: today,
        new_commitments: commitments
          .map(({ description, committed_by, due_date }) => ({ description: description.trim(), committed_by, due_date }))
          .filter((c) => c.description),
        carry_forward_items: kept,
        opening_line: opening.trim() || null,
        one_on_one_id: session.id,
        ...(draft.privateNotes.trim() ? { private_notes: draft.privateNotes } : {}),
      });
      telemetry.accept({
        text: joinDraft([summary, ...commitments.map((c) => c.description), ...kept, opening]),
        items: commitments.map((c) => c.description),
      });
      onSaved();
      if (outcome.kind === "saved") {
        stashOneOnOneReceipt({ ...outcome.result, personId: report.id });
        router.push(`/app/reports/${report.id}?logged=${outcome.result.meeting.id}`);
      } else {
        router.push(`/app/reports/${report.id}?logged=${outcome.meetingId}&reconciled=1`);
      }
    } catch {
      setSaveError("Couldn't save this 1:1. Your wrap-up is still here. Try again.");
      savingRef.current = false;
      setSaving(false);
    }
  }

  function back() {
    telemetry.discard();
    onBack();
  }

  // ── delete the transcript ────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  async function removeTranscript() {
    if (!transcriptId) return;
    setDeleting(true);
    setDeleteError(false);
    try {
      await deleteCallTranscript(transcriptId);
      setTranscriptDeleted(true);
      setConfirmDelete(false);
    } catch {
      setDeleteError(true);
    } finally {
      setDeleting(false);
    }
  }

  // ── pieces ───────────────────────────────────────────────────────────────
  const hasTranscript = !!transcriptId && !transcriptDeleted;
  const micOnly = !!result?.transcript?.mic_only;
  const anyUnsure = commitments.some((c) => c.owner_unsure);
  const progress =
    phase === "ready"
      ? "Draft ready. Edit anything, then save."
      : phase === "failed"
        ? "Couldn't draft the log. Your notes are safe."
        : transcriptId
          ? "Finishing the last few minutes of transcript and drafting from your notes and the call. Usually 10 to 25 seconds."
          : "Drafting from your notes. Usually 10 to 25 seconds.";

  const header = (
    <div className="flex flex-wrap items-center gap-3 border-b border-hairline pb-4 sm:gap-4">
      <PersonAvatar id={report.id} name={report.name} size={layout === "phone" ? "lg" : "xl"} />
      <div className="min-w-0 flex-1">
        <h1 className="font-serif text-2xl font-normal leading-tight tracking-[-0.01em] text-ink sm:text-[1.75rem]">
          Wrap up your 1:1 with {first}
        </h1>
        <p className="mt-0.5 text-sm text-ink-secondary">{mediumDate(today)} · nothing is saved until you save it</p>
      </div>
      <button type="button" onClick={back} className={BTN_GHOST}>
        Back to the 1:1
      </button>
      {layout !== "phone" && (
        <button type="button" onClick={() => void save()} disabled={!canSave} className={BTN_PRIMARY} aria-describedby="wrapup-progress">
          {saving ? "Saving…" : "Save log"}
        </button>
      )}
    </div>
  );

  const left = (
    <section aria-label="What happened to the agenda" className="min-w-0">
      <p className={EYEBROW}>Covered</p>
      {coveredRows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing was ticked.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {coveredRows.map((r) => (
            <li key={r.key} className="flex gap-2.5 text-sm text-ink-secondary">
              <span aria-hidden className="font-bold text-brand">✓</span>
              <span className="min-w-0">{r.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-t border-divider pt-5">
        <p className={EYEBROW}>Carry into the next 1:1</p>
        {unticked.length > 0 && <p className="mt-1 text-xs text-ink-muted">You didn&apos;t tick these. Untick any you&apos;d rather drop.</p>}
        {carry.length === 0 && !ready && <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-sunken motion-reduce:animate-none" />}
        {carry.length === 0 && ready && <p className="mt-2 text-sm text-ink-muted">Nothing left open.</p>}
        <ul className="mt-2 space-y-0.5">
          {carry.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={c.on}
                onClick={() => setCarry((items) => items.map((x) => (x.key === c.key ? { ...x, on: !x.on } : x)))}
                className="flex min-h-10 w-full items-start gap-2.5 rounded-md px-1 py-2 text-left text-sm hover:bg-sunken"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] ${
                    c.on ? "border-brand bg-brand text-on-brand" : "border-ink-muted bg-surface"
                  }`}
                >
                  {c.on && (
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  )}
                </span>
                <span className={c.on ? "text-ink" : "text-ink-muted line-through"}>{c.title}</span>
              </button>
            </li>
          ))}
        </ul>
        {addingTopic ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const t = topicDraft.trim();
              if (t) setCarry((items) => [...items, { key: `n-${Date.now()}`, title: t, on: true }]);
              setTopicDraft("");
              setAddingTopic(false);
            }}
          >
            <input autoFocus value={topicDraft} onChange={(e) => setTopicDraft(e.target.value)} aria-label="Topic to carry" className={INPUT} />
            <button type="submit" className={BTN_SECONDARY}>
              Add
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAddingTopic(true)} className="mt-2 text-sm font-medium text-brand hover:text-brand-hover">
            + Add a topic
          </button>
        )}
      </div>
    </section>
  );

  const skeleton = (h: string, w = "w-full") => <div className={`${h} ${w} animate-pulse rounded-md bg-sunken motion-reduce:animate-none`} />;
  const drafting = phase === "finishing" || phase === "drafting";

  const centre = (
    <section aria-label="The draft" className="min-w-0">
      <p id="wrapup-progress" role="status" className={`flex items-start gap-2 text-sm ${ready ? "text-brand" : "text-ink-secondary"}`}>
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${phase === "failed" ? "bg-amber-500" : "bg-brand"}`} />
        <span>
          {progress}
          {ready && lateEnd && " The last minute or so of the transcript hadn't arrived yet, so check the end of the call."}
          {ready && result?.transcript?.truncated && " The call ran long, so the draft used the first part of the transcript."}
        </span>
      </p>
      {phase === "failed" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void run()} className={BTN_PRIMARY}>
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              setResult({ summary: "", commitments: [], follow_up_items: [], opening_line: "", transcript: null });
              setPhase("ready");
            }}
            className={BTN_SECONDARY}
          >
            Write it myself
          </button>
        </div>
      )}

      <p className={`${EYEBROW} mt-6`}>Summary</p>
      {drafting ? (
        <div className="mt-2 space-y-2">
          {skeleton("h-3.5", "w-[94%]")}
          {skeleton("h-3.5", "w-[88%]")}
          {skeleton("h-3.5", "w-1/2")}
        </div>
      ) : phase === "ready" ? (
        <div className="animate-fade-in motion-reduce:animate-none">
          {!result?.summary && <p className="mt-1 text-sm text-amber-700">Nothing to draft a summary from. Write a quick one.</p>}
          <NoteField value={summary} onChange={setSummary} rows={4} className="mt-2" aria-label="Summary" vocabulary={report.name} />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={EYEBROW}>Commitments</p>
        {ready && micOnly && commitments.length > 0 && (
          <p className="text-xs text-ink-muted">Only your mic was on, so check who owns each one. Tap a name to switch it.</p>
        )}
        {ready && !micOnly && anyUnsure && <p className="text-xs text-ink-muted">Check the owner where it&apos;s marked. Tap a name to switch it.</p>}
      </div>
      {drafting ? (
        <div className="mt-2 space-y-3">
          {skeleton("h-9")}
          {skeleton("h-9")}
        </div>
      ) : phase === "ready" ? (
        <div className="animate-fade-in motion-reduce:animate-none">
          {commitments.length === 0 && <p className="mt-2 text-sm text-ink-muted">None picked up. Add one if something was agreed.</p>}
          <ul>
            {commitments.map((c) => (
              <CommitmentRow
                key={c.key}
                c={c}
                first={first}
                onOwner={(committed_by) => update(c.key, { committed_by, owner_unsure: false })}
                onChange={(p) => update(c.key, p)}
                onRemove={() => setCommitments((cs) => cs.filter((x) => x.key !== c.key))}
              />
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              setCommitments((cs) => [...cs, { key: nextKey.current++, description: "", committed_by: "manager", due_date: null }])
            }
            className="mt-2 text-sm font-medium text-brand hover:text-brand-hover"
          >
            + Add a commitment
          </button>
        </div>
      ) : null}

      <p className={`${EYEBROW} mt-6`}>Open next time with</p>
      {drafting ? (
        <div className="mt-2">{skeleton("h-4", "w-3/5")}</div>
      ) : phase === "ready" ? (
        editingOpening || !opening ? (
          <div className="mt-2 animate-fade-in motion-reduce:animate-none">
            <input
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              onBlur={() => setEditingOpening(false)}
              autoFocus={editingOpening}
              placeholder={`How would you like to start with ${first} next time?`}
              aria-label="Opening line for the next 1:1"
              className={INPUT}
            />
          </div>
        ) : (
          <p className="mt-1.5 animate-fade-in font-serif text-lg leading-snug text-ink motion-reduce:animate-none">
            &ldquo;{opening}&rdquo;{" "}
            <button type="button" onClick={() => setEditingOpening(true)} className="font-sans text-sm font-medium text-brand hover:text-brand-hover">
              Edit
            </button>
          </p>
        )
      ) : null}

      {saveError && (
        <p role="alert" className="mt-5 text-sm text-red-700">
          {saveError}
        </p>
      )}
    </section>
  );

  const times = transcriptDeleted ? null : keptTimes(transcript);
  const privateNote = draft.privateNotes.trim();
  const right = (
    <section aria-label="What's kept" className="min-w-0">
      <p className={EYEBROW}>What&apos;s kept</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-muted">Transcript</dt>
        <dd className="text-ink-body">
          {transcriptDeleted
            ? "Deleted"
            : !transcriptId
              ? "None for this 1:1"
              : times
                ? `${minutes(times.transcribedMs)} · ${first} can read it`
                : `${first} can read it`}
        </dd>
        {times && times.gapMs > 0 && (
          <>
            <dt className="text-ink-muted">Not transcribed</dt>
            <dd className="text-ink-body">{minutes(times.gapMs)} · paused or off the record</dd>
          </>
        )}
        {(transcriptId || transcriptDeleted) && (
          <>
            <dt className="text-ink-muted">Audio</dt>
            <dd className="text-ink-body">Discarded once transcribed</dd>
          </>
        )}
        <dt className="text-ink-muted">Private notes</dt>
        <dd className="text-ink-body">{privateNote ? "1 · only you see it" : "None"}</dd>
      </dl>

      {times && times.gapMs > 0 && (
        <div className="mt-4 rounded-lg bg-sunken px-3.5 py-3 text-sm">
          <p className="font-semibold text-ink-body">How the gap reads in {first}&apos;s copy</p>
          <p className="mt-1.5 flex items-center gap-2.5 text-xs text-ink-secondary">
            <span aria-hidden className="flex-1 border-t border-dashed border-ink-faint" />
            Not transcribed · {minutes(times.gapMs)}
            <span aria-hidden className="flex-1 border-t border-dashed border-ink-faint" />
          </p>
        </div>
      )}

      {privateNote && (
        <div className="mt-4 text-sm">
          <p className="font-semibold text-ink-body">Off-the-record note</p>
          <p className="mt-0.5 text-xs text-ink-muted">Kept as a private note on {first}&apos;s page. Not used in this draft.</p>
          <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-hairline px-3 py-2 text-ink-body">{privateNote}</p>
        </div>
      )}

      {hasTranscript &&
        (confirmDelete ? (
          <div role="alertdialog" aria-label="Delete the transcript" className="mt-5 rounded-lg border border-hairline px-3.5 py-3 text-sm">
            <p className="text-ink-body">Delete the transcript? {first} won&apos;t be able to read it, and it can&apos;t be brought back. Your draft stays.</p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={() => void removeTranscript()} disabled={deleting} className={BTN_SECONDARY}>
                {deleting ? "Deleting…" : "Delete it"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={BTN_GHOST}>
                Keep it
              </button>
            </div>
            {deleteError && <p className="mt-2 text-xs text-red-700">Couldn&apos;t delete it just now. Try again.</p>}
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="mt-5 text-sm text-ink-muted hover:text-ink-secondary">
            Delete the transcript
          </button>
        ))}
    </section>
  );

  return (
    <PageShell maxWidth="8xl" className={layout === "phone" ? "pb-32" : ""}>
      <div ref={widthRef}>
      {header}
      {layout === "three" && (
        <div className="mt-6 grid grid-cols-[minmax(15rem,0.85fr)_minmax(0,1.6fr)_minmax(15rem,0.9fr)] gap-8">
          <div className="min-w-0">{left}</div>
          <div className="min-w-0">{centre}</div>
          <div className="min-w-0 border-l border-hairline pl-8">{right}</div>
        </div>
      )}
      {layout === "two" && (
        <div className="mt-6 grid grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.4fr)] gap-8">
          <div className="min-w-0 space-y-8">
            {left}
            <div className="border-t border-divider pt-6">{right}</div>
          </div>
          <div className="min-w-0">{centre}</div>
        </div>
      )}
      {layout === "phone" && (
        <>
          <div className="mt-5 space-y-8">
            {centre}
            <div className="border-t border-divider pt-6">{left}</div>
            <div className="border-t border-divider pt-6">{right}</div>
          </div>
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <button type="button" onClick={() => void save()} disabled={!canSave} className={`${BTN_PRIMARY} w-full py-3`}>
              {saving ? "Saving…" : "Save log"}
            </button>
          </div>
        </>
      )}
      </div>
    </PageShell>
  );
}

/** One commitment's wording: wraps and grows instead of cutting long lines off. */
function GrowingText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      placeholder="What was agreed?"
      aria-label="Commitment"
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-5 text-ink-body placeholder-ink-faint focus:outline-none focus:ring-0"
    />
  );
}

function CommitmentRow({
  c,
  first,
  onOwner,
  onChange,
  onRemove,
}: {
  c: EditableCommitment;
  first: string;
  onOwner: (who: CommittedBy) => void;
  onChange: (p: Partial<EditableCommitment>) => void;
  onRemove: () => void;
}) {
  const mine = c.committed_by === "manager";
  const source =
    c.source === "call" && c.source_ms != null
      ? `From the call, ${callClock(c.source_ms)}`
      : c.source === "notes"
        ? "From your notes"
        : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-divider py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-start">
      <button
        type="button"
        onClick={() => onOwner(mine ? "direct_report" : "manager")}
        aria-label={`Owner: ${mine ? "you" : first}. Switch to ${mine ? first : "you"}`}
        className={`inline-flex min-h-7 items-center gap-1 justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          mine ? "bg-brand-tint text-brand" : "bg-sunken text-ink"
        } ${c.owner_unsure ? "outline-dashed outline-1 outline-offset-1 outline-amber-500" : ""}`}
      >
        {mine ? "You" : first}
        <svg aria-hidden width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      <div className="min-w-0">
        <GrowingText value={c.description} onChange={(description) => onChange({ description })} />
        {(source || c.owner_unsure) && (
          <p className="mt-0.5 text-xs text-ink-muted">
            {source}
            {source && c.owner_unsure ? " · " : ""}
            {c.owner_unsure ? "check the owner" : ""}
          </p>
        )}
      </div>
      <input
        type="date"
        value={c.due_date ?? ""}
        onChange={(e) => onChange({ due_date: e.target.value || null })}
        aria-label="Due date"
        className="col-start-2 rounded-md border border-hairline bg-transparent px-2 py-1 text-xs text-ink-secondary focus:border-control focus:outline-none sm:col-start-auto"
      />
      <button type="button" onClick={onRemove} className="col-start-2 justify-self-start text-xs text-ink-muted hover:text-ink-secondary sm:col-start-auto">
        Remove
      </button>
    </li>
  );
}
