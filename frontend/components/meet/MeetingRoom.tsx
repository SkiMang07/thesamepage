"use client";

// ---------------------------------------------------------------------------
// The meeting screen, /app/reports/[id]/meet (build plan B3, B5, B6).
//
// Everything about the relationship in one view, so the 1:1 needs no
// navigation: today's agenda with covered ticks, the manager's notes, and
// the person's history and open commitments. Recording lives in the pill
// (RecordingPill), not here.
//
//   Content ≥ 980px   three columns (desktop at 1280 and up)
//   Content ≥ 640px   two: Agenda / history tabbed on the left, notes right
//                     (laptop 1024–1279, and desktop with Scribe open)
//   Narrower          the phone: Agenda / Notes / Jordan tabs, End 1:1 at
//                     the bottom
//
// Widths follow the content column, not the window, because Scribe takes
// 400–640px of the window when it's open.
//
// Notes survive a reload: a local draft per 1:1 row (lib/meeting-draft.ts),
// call notes and off-the-record notes kept apart, cleared on Save log.
//
// End 1:1 turns the same screen into the wrap-up (MeetingWrapUp, build plan
// B7), drafted from the call notes plus the transcript.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ensureOpenOneOnOne,
  getCaptureNotes,
  getCommitments,
  getDirectReport,
  getOneOnOne,
  getOneOnOneHistory,
  updateCommitment,
  type CaptureNote,
  type Commitment,
  type DirectReport,
  type OneOnOne,
} from "@/lib/api";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/tokens";
import PageShell from "@/components/PageShell";
import PersonAvatar from "@/components/team/PersonAvatar";
import MeetingWrapUp from "./MeetingWrapUp";
import { dueState, instantDate, localDateStr, mediumDate, shortDate } from "@/components/team/dates";
import { clearDraftKeepingForUndo, EMPTY_DRAFT, loadDraft, pruneDrafts, saveDraft, type MeetingDraft } from "@/lib/meeting-draft";
import { useMeetingClock, useRecorder } from "@/lib/recorder/RecorderProvider";
import { AgendaColumn, HistoryColumn, NotesColumn, dateOf, type AgendaRow } from "./MeetingColumns";

type Loaded = {
  report: DirectReport;
  session: OneOnOne;
  completed: OneOnOne[];
  commitments: Commitment[];
  captures: CaptureNote[];
};

// A callback ref, so the observer attaches whenever the room mounts (it
// renders only once its data has loaded, after the skeleton).
function useContentWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { ref, width };
}

export default function MeetingRoom({ personId }: { personId: string }) {
  const recorder = useRecorder();
  const { meeting, rec, hydrated } = recorder;
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MeetingDraft>(EMPTY_DRAFT);
  const [draftReady, setDraftReady] = useState(false);
  const { ref: widthRef, width } = useContentWidth();
  const layout = width >= 980 ? "three" : width >= 640 ? "two" : width > 0 ? "phone" : "three";

  const otherMeeting = meeting && meeting.personId !== personId ? meeting : null;

  // ── load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    const sessionFor = meeting?.personId === personId ? getOneOnOne(meeting.oneOnOneId) : ensureOpenOneOnOne(personId);
    Promise.all([
      getDirectReport(personId),
      sessionFor,
      getOneOnOneHistory(personId).catch(() => [] as OneOnOne[]),
      getCommitments({ directReportId: personId, status: "open" }).catch(() => [] as Commitment[]),
      getCaptureNotes(personId).catch(() => [] as CaptureNote[]),
    ])
      .then(([report, session, history, commitments, captures]) => {
        if (!live) return;
        setData({
          report,
          session,
          completed: history.filter((s) => s.status === "completed"),
          commitments,
          captures,
        });
      })
      .catch(() => live && setLoadError("Couldn't open this 1:1. Go back and try again."));
    return () => {
      live = false;
    };
    // The meeting's identity, not every recorder tick, decides what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, personId, meeting?.oneOnOneId]);

  // Walking into /meet with nothing running is walking into the 1:1, unless
  // this screen just saved the log and is on its way out.
  const finishedRef = useRef(false);
  useEffect(() => {
    if (data && hydrated && !meeting && !finishedRef.current) {
      recorder.enterNotesOnly({ oneOnOneId: data.session.id, personId, personName: data.report.name });
    }
  }, [data, hydrated, meeting, personId, recorder]);

  // ── local draft ──────────────────────────────────────────────────────────
  const sessionId = data?.session.id ?? null;
  useEffect(() => {
    if (!sessionId) return;
    pruneDrafts();
    setDraft(loadDraft(sessionId));
    setDraftReady(true);
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || !draftReady) return;
    const id = window.setTimeout(() => saveDraft(sessionId, draft), 300);
    return () => window.clearTimeout(id);
  }, [draft, sessionId, draftReady]);
  useEffect(() => {
    if (!sessionId || !draftReady) return;
    const flush = () => saveDraft(sessionId, draft);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [draft, sessionId, draftReady]);

  const patch = useCallback((p: Partial<MeetingDraft>) => setDraft((d) => ({ ...d, ...p })), []);

  // ── agenda rows ──────────────────────────────────────────────────────────
  const first = data?.report.name.split(" ")[0] ?? "";
  const prepped = data?.session.status === "planned" && !!data.session.prep_guide?.agenda_items?.length;
  const today = localDateStr();

  const rows: AgendaRow[] = useMemo(() => {
    if (!data) return [];
    const out: AgendaRow[] = [];
    if (prepped) {
      data.session.prep_guide!.agenda_items.forEach((item, i) =>
        out.push({ key: `a-${i}`, title: item.title, why: item.rationale, questions: item.suggested_questions }),
      );
    } else {
      const lastDate = data.completed[0]?.meeting_date;
      const carried = lastDate ? `Carried from ${instantDate(lastDate)}` : "Carried forward";
      data.session.carry_forward_items.forEach((t, i) => out.push({ key: `cf-${i}`, kind: carried, title: t }));
      [...data.captures].reverse().forEach((c) => out.push({ key: `cap-${c.id}`, kind: "A thought you kept", title: c.content }));
      data.commitments
        .filter((c) => c.committed_by !== "direct_report")
        .forEach((c) => {
          const overdue = dueState(c.due_date, today) === "overdue";
          out.push({ key: `c-${c.id}`, kind: `You owe ${first}`, title: `${c.description}${overdue ? " · overdue" : ""}`, attention: overdue });
        });
      data.commitments
        .filter((c) => c.committed_by === "direct_report")
        .forEach((c) =>
          out.push({ key: `c-${c.id}`, kind: `${first} owes you`, title: `${c.description}${c.due_date ? ` · due ${shortDate(c.due_date)}` : ""}` }),
        );
    }
    draft.added.forEach((t, i) => out.push({ key: `add-${i}`, title: t, kind: "Added today" }));
    return out;
  }, [data, prepped, draft.added, first, today]);

  const covered = useMemo(() => new Set(draft.covered), [draft.covered]);
  const toggle = useCallback(
    (key: string) => setDraft((d) => ({ ...d, covered: d.covered.includes(key) ? d.covered.filter((k) => k !== key) : [...d.covered, key] })),
    [],
  );
  const addTopic = useCallback((t: string) => setDraft((d) => ({ ...d, added: [...d.added, t] })), []);

  // An overdue commitment the manager owes stays on the agenda side, so
  // tabbing history away never hides it (laptop and phone).
  const owed = data?.commitments.find((c) => c.committed_by !== "direct_report" && dueState(c.due_date, today) === "overdue") ?? null;
  const owedNotice = owed && prepped ? `You owe ${first}: ${owed.description} · overdue` : null;

  async function onCommitment(c: Commitment, status: "done" | "dropped") {
    setData((d) => (d ? { ...d, commitments: d.commitments.filter((x) => x.id !== c.id) } : d));
    try {
      await updateCommitment(c.id, status, "person");
    } catch {
      setData((d) => (d ? { ...d, commitments: [...d.commitments, c] } : d));
    }
  }

  // ── states before the room ───────────────────────────────────────────────
  if (loadError) {
    return (
      <PageShell maxWidth="2xl">
        <Link href={`/app/reports/${personId}`} className="text-sm text-brand hover:text-brand-hover">
          ← Back
        </Link>
        <p className="mt-4 text-ink-body">{loadError}</p>
      </PageShell>
    );
  }
  if (otherMeeting) {
    return (
      <PageShell maxWidth="2xl">
        <div className="rounded-xl border border-hairline bg-surface p-6">
          <p className="text-ink">You&apos;re in a 1:1 with {otherMeeting.personName.split(" ")[0]} right now.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/app/reports/${otherMeeting.personId}/meet`} className={BTN_PRIMARY}>
              Return to it
            </Link>
            <Link href={`/app/reports/${personId}`} className={BTN_SECONDARY}>
              Back to the Relationship Desk
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }
  if (!data || !draftReady) {
    return (
      <PageShell maxWidth="8xl">
        <div className="h-12 w-72 animate-pulse rounded-md bg-sunken motion-reduce:animate-none" />
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-sunken motion-reduce:animate-none" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (meeting?.phase === "ending") {
    return (
        <MeetingWrapUp
          widthRef={widthRef}
          report={data.report}
          session={data.session}
          draft={draft}
          rows={rows}
          covered={covered}
          transcriptId={meeting.transcriptId}
          layout={layout}
          onBack={() => void recorder.backToMeeting()}
          onSaved={() => {
            finishedRef.current = true;
            clearDraftKeepingForUndo(data.session.id, draft);
            recorder.finishMeeting();
          }}
        />
    );
  }

  // ── the room ─────────────────────────────────────────────────────────────
  const date = dateOf(data.session) ?? today;
  const lastMet = data.completed[0]?.meeting_date;
  const daysSince = lastMet ? Math.max(0, Math.round((Date.parse(today) - Date.parse(localDateStr(new Date(lastMet)))) / 86400000)) : null;
  const sub = prepped
    ? `${mediumDate(date)} · prepped · ${rows.length} ${rows.length === 1 ? "topic" : "topics"}`
    : `${mediumDate(date)} · not prepped${
        daysSince === null ? "" : daysSince === 0 ? " · last met today" : ` · last met ${daysSince} ${daysSince === 1 ? "day" : "days"} ago`
      }`;
  const offRecord = rec.kind === "off_record";
  const coveredCount = rows.filter((r) => covered.has(r.key)).length;

  const agenda = (eyebrow = true) => (
    <AgendaColumn
      prepped={prepped}
      openingLine={data.session.opening_line ?? null}
      rows={rows}
      covered={covered}
      onToggle={toggle}
      onAdd={addTopic}
      firstName={first}
      owedNotice={layout === "three" ? null : owedNotice}
      showEyebrow={eyebrow}
    />
  );
  const notesCol = (rowsCount: number) => (
    <NotesColumn
      offRecord={offRecord}
      notes={draft.notes}
      privateNotes={draft.privateNotes}
      onNotes={(v) => patch({ notes: v })}
      onPrivateNotes={(v) => patch({ privateNotes: v })}
      transcriptId={meeting?.transcriptId ?? null}
      firstName={first}
      vocabulary={data.report.name}
      rows={rowsCount}
    />
  );
  const history = (eyebrow = true) => (
    <HistoryColumn firstName={first} completed={data.completed} commitments={data.commitments} onCommitment={onCommitment} showEyebrow={eyebrow} />
  );

  return (
    <PageShell maxWidth="8xl" className={layout === "phone" ? "pb-36" : ""}>
      <div ref={widthRef}>
        <header className="flex flex-wrap items-center gap-3 sm:gap-4">
          <PersonAvatar id={data.report.id} name={data.report.name} size={layout === "phone" ? "lg" : "xl"} />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl font-normal leading-tight tracking-[-0.01em] text-ink sm:text-[1.75rem]">
              1:1 with {layout === "phone" ? first : data.report.name}
            </h1>
            <p className="mt-0.5 text-sm text-ink-secondary">{sub}</p>
          </div>
          {layout !== "phone" && (
            <button type="button" onClick={() => void recorder.endMeeting()} className={BTN_SECONDARY}>
              End 1:1
            </button>
          )}
        </header>

        <AutoStopNotice onEnd={() => void recorder.endMeeting()} />

        {layout === "three" && (
          <div className="mt-7 grid grid-cols-[minmax(15rem,0.9fr)_minmax(0,1.5fr)_minmax(15rem,0.95fr)] gap-8">
            <div className="min-w-0">{agenda()}</div>
            <div className="min-w-0">{notesCol(18)}</div>
            <div className="min-w-0 border-l border-hairline pl-8">{history()}</div>
          </div>
        )}

        {layout === "two" && (
          <TwoColumn
            first={first}
            coveredCount={coveredCount}
            total={rows.length}
            agenda={agenda(false)}
            history={history(false)}
            notes={notesCol(16)}
          />
        )}

        {layout === "phone" && <PhoneTabs first={first} agenda={agenda(false)} notes={notesCol(12)} history={history(false)} onEnd={() => void recorder.endMeeting()} />}
      </div>
    </PageShell>
  );
}

// ── laptop: two columns, agenda and history tabbed ────────────────────────

function TwoColumn({
  first,
  coveredCount,
  total,
  agenda,
  history,
  notes,
}: {
  first: string;
  coveredCount: number;
  total: number;
  agenda: React.ReactNode;
  history: React.ReactNode;
  notes: React.ReactNode;
}) {
  const [tab, setTab] = useState<"agenda" | "history">("agenda");
  const tabs: [typeof tab, string][] = [
    ["agenda", total ? `Agenda · ${coveredCount} of ${total}` : "Agenda"],
    ["history", `${first} · history`],
  ];
  return (
    <div className="mt-7 grid grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.3fr)] gap-8">
      <div className="min-w-0">
        <Tabs id="meet-side" tabs={tabs} value={tab} onChange={setTab} />
        <div role="tabpanel" id={`meet-side-panel-${tab}`} aria-labelledby={`meet-side-tab-${tab}`} className="pt-4">
          {tab === "agenda" ? agenda : history}
        </div>
      </div>
      <div className="min-w-0">{notes}</div>
    </div>
  );
}

// ── phone: Agenda / Notes / Jordan, End 1:1 at the bottom ────────────────

function PhoneTabs({
  first,
  agenda,
  notes,
  history,
  onEnd,
}: {
  first: string;
  agenda: React.ReactNode;
  notes: React.ReactNode;
  history: React.ReactNode;
  onEnd: () => void;
}) {
  const { rec } = useRecorder();
  const [tab, setTab] = useState<"agenda" | "notes" | "history">("agenda");
  const listening = rec.kind === "transcribing";
  return (
    <>
      <div className="mt-5">
        <Tabs
          id="meet-phone"
          tabs={[
            ["agenda", "Agenda"],
            ["notes", "Notes"],
            ["history", first],
          ]}
          value={tab}
          onChange={setTab}
          stretch
        />
        <div role="tabpanel" id={`meet-phone-panel-${tab}`} aria-labelledby={`meet-phone-tab-${tab}`} className="pt-4">
          {tab === "agenda" ? agenda : tab === "notes" ? notes : history}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {listening && <p className="mb-2 text-center text-xs text-ink-muted">Keep this screen on. Your phone stops listening when it locks.</p>}
        <button type="button" onClick={onEnd} className={`${BTN_PRIMARY} w-full py-3`}>
          End 1:1
        </button>
      </div>
    </>
  );
}

function Tabs<T extends string>({
  id,
  tabs,
  value,
  onChange,
  stretch = false,
}: {
  id: string;
  tabs: [T, string][];
  value: T;
  onChange: (v: T) => void;
  stretch?: boolean;
}) {
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length][0];
    onChange(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }
  return (
    <div role="tablist" className="flex gap-6 border-b border-hairline">
      {tabs.map(([v, label], i) => (
        <button
          key={v}
          id={`${id}-tab-${v}`}
          type="button"
          role="tab"
          aria-selected={value === v}
          aria-controls={`${id}-panel-${v}`}
          tabIndex={value === v ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={(e) => onKey(e, i)}
          className={`-mb-px border-b-2 py-2.5 text-sm transition-colors motion-reduce:transition-none ${stretch ? "flex-1" : ""} ${
            value === v ? "border-brand font-semibold text-brand" : "border-transparent text-ink-secondary hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── stopped by itself (build plan B6) ──────────────────────────────────────

function AutoStopNotice({ onEnd }: { onEnd: () => void }) {
  const recorder = useRecorder();
  const now = useMeetingClock();
  const { rec, meeting } = recorder;
  if (rec.kind !== "stopped" || meeting?.phase !== "live" || !meeting.transcriptId) return null;
  const canResume = recorder.canResumeAfterStop(now);
  const headline =
    rec.reason === "silence"
      ? "Transcription stopped. No sound for 10 minutes."
      : rec.reason === "max_length"
        ? "Transcription stopped at 2 hours."
        : rec.reason === "share_ended"
          ? "Transcription stopped. The call tab closed."
          : "You stopped transcribing.";
  const auto = rec.reason !== "manual";
  return (
    <div
      role="status"
      className={`mt-6 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3.5 ${
        auto ? "border border-amber-500/50 bg-amber-50 text-amber-900" : "border border-hairline bg-surface text-ink-body"
      }`}
    >
      {auto && (
        <span aria-hidden className="text-amber-700">
          ▲
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{headline}</p>
        <p className="mt-0.5 text-sm opacity-90">
          Everything up to then is kept. Your notes and the 1:1 are still open.
          {!canResume && rec.reason !== "max_length" && " It's been more than 30 minutes, so it can't resume."}
        </p>
      </div>
      {canResume && (
        <button type="button" onClick={() => void recorder.resume()} className={BTN_SECONDARY}>
          Resume transcribing
        </button>
      )}
      <button type="button" onClick={onEnd} className={BTN_PRIMARY}>
        End 1:1
      </button>
    </div>
  );
}
