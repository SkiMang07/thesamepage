"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  getDirectReport,
  getOneOnOne,
  getOpenOneOnOne,
  prepOneOnOne,
  updateOneOnOneSchedule,
  wrapUpOneOnOne,
  getCaptureNotes,
  deleteCaptureNote,
  getCommitments,
  getGoals,
  getDevelopmentPlan,
  getCareerPerson,
  type CareerPersonDetail,
  getOneOnOneHistory,
  PrepResponse,
  AgendaItem,
  WrapUpDraft,
  CaptureNote,
  Commitment,
  FIRST_RUN_STEPS,
  PATH_STEPS,
} from "@/lib/api";
import WaitNote from "@/components/WaitNote";
import WrapUpReview from "../wrap-up-review";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import { deriveOneOnOneSuggestions, OneOnOneSuggestion } from "@/lib/one-on-one-workspace";
import { isCareerDay } from "@/lib/career";

import NoteField from "@/components/NoteField";
import NotePromises, { useNotePromises } from "@/components/NotePromises";
import MoveOneOnOne from "@/components/MoveOneOnOne";

// Where each "Built without" label is fixed (setup inputs the sheet was built
// without; the labels come from prep_built_without() on the server).
const BUILT_WITHOUT_HREF: Record<string, string> = {
  "team and org": "/app/settings?section=people",
  "role expectations": "/app/expectations",
  "org goals": "/app/goals?new=1&level=company",
  "team goals": "/app/goals?new=1&level=team",
};
// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// Words the sheet used about HR or leadership that the notes never did
// (backend/prep_guard.py). The text stays; the manager sees what to check.
function NotInYourNotes({ words }: { words: string[] }) {
  if (!words.length) return null;
  return (
    <p className="mt-3 text-xs text-amber-700">
      Not in your notes: {words.map((w) => `“${w}”`).join(", ")}. Check the wording before you use it.
    </p>
  );
}

function AgendaCard({ item, index }: { item: AgendaItem; index: number }) {
  const [open, setOpen] = useState(index === 0); // first card open by default
  const held = item.held ?? [];
  const used = item.expectations_used ?? [];
  const unsupportedWords = Array.from(new Set((item.unsupported ?? []).flatMap((u) => u.words)));

  return (
    <div className="rounded-lg border border-hairline bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between px-5 py-4 text-left"
      >
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {index + 1}
          </span>
          <p className="mt-0.5 font-medium text-ink">{item.title}</p>
          {!open && held.length > 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              {held.length} {held.length === 1 ? "line" : "lines"} held for you
            </p>
          )}
        </div>
        <span className="ml-4 mt-1 shrink-0 text-ink-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-divider px-5 pb-5 pt-4">
          <p className="text-sm text-ink-secondary italic">{item.rationale}</p>
          {item.from_your_notes?.trim() && (
            <div className="mt-3 border-l-2 border-hairline pl-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">From your notes</p>
              <p className="mt-0.5 text-sm text-ink-secondary">{item.from_your_notes}</p>
            </div>
          )}
          {used.length > 0 && (
            <div className="mt-3 border-l-2 border-hairline pl-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Measured against</p>
              <ul className="mt-0.5 space-y-0.5">
                {used.map((u) => (
                  <li key={u.ref} className="text-sm text-ink-secondary">
                    {u.line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.suggested_questions.length > 0 && (
            <ul className="mt-4 space-y-3">
              {item.suggested_questions.map((q, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-ink-faint">→</span>
                  <p className="text-ink-body">{q}</p>
                </li>
              ))}
            </ul>
          )}
          {held.length > 0 && (
            <div className="mt-4 rounded-md border border-dashed border-hairline px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Held for you</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                These lines carry your own context. Say them only if you choose to.
              </p>
              <ul className="mt-3 space-y-3">
                {held.map((h, i) => (
                  <li key={i}>
                    <p className="text-sm text-ink-secondary">{h.line}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{h.label}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <NotInYourNotes words={unsupportedWords} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main prep flow: notes → prep sheet + live notes → review → saved
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3;
type RecurrenceWeeks = 1 | 2 | 3 | 4;

function scheduledAtToDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

// Local calendar day, not the UTC one. Only a fallback here: an undated
// occurrence still has to hand the review screen a meeting date.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function longDayLabel(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// The first release schedules a calendar day, not a clock time. Noon UTC
// keeps that date stable while preserving the existing timestamptz field for
// the later calendar-sync pass.
function dateToScheduledAt(value: string) {
  return value ? `${value}T12:00:00.000Z` : null;
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// useSearchParams (for ?resume=) requires a Suspense boundary — same
// pattern as app/app/login/page.tsx.
export default function PrepPage() {
  return (
    <Suspense>
      <PrepFlow />
    </Suspense>
  );
}

function PrepFlow() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get("resume");
  const editSources = searchParams.get("edit") === "1";
  // First run (/app/start) hands over the meeting date it asked for.
  const dateParam = searchParams.get("date");
  // First run is step 3 of 3 and ends in a save receipt.
  const firstRun = searchParams.get("first") === "1";
  const startDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : "";

  const [step, setStep] = useState<Step>(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<PrepResponse | null>(null);
  const [reportName, setReportName] = useState("");
  // null until the history loads. A first 1:1 means no completed one exists
  // for this person; until we know, treat it as not first (the safer rule).
  const [hasCompletedOneOnOne, setHasCompletedOneOnOne] = useState<boolean | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [career, setCareer] = useState<CareerPersonDetail | null>(null);
  const isCareer = isCareerDay(career, scheduleDate);
  const [recurrenceWeeks, setRecurrenceWeeks] = useState<RecurrenceWeeks | null>(null);
  // The series' usual day, when this one 1:1 was moved off it by itself.
  const [usualDate, setUsualDate] = useState<string | null>(null);
  const [carryForwardItems, setCarryForwardItems] = useState<string[]>([]);
  // The opener kept at the last wrap-up. Null once removed in review.
  const [openingLine, setOpeningLine] = useState<string | null>(null);
  const [suggestedTopics, setSuggestedTopics] = useState<OneOnOneSuggestion[]>([]);
  const [openCommitments, setOpenCommitments] = useState<Commitment[]>([]);
  const [excludedCommitmentIds, setExcludedCommitmentIds] = useState<string[]>([]);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // The planned one_on_ones row this prep sheet is saved to — set either by
  // a fresh /prep call below, or by loading an existing planned session when
  // resuming. Passed through to the wrap-up save so logging fills in this
  // SAME row instead of creating a second one.
  const [oneOnOneId, setOneOnOneId] = useState<string | null>(null);

  // Resuming a planned session (?resume=<id> from the DR detail page's
  // session list) skips straight to step 2 with the stored prep sheet —
  // no regenerating it.
  const [resumeLoading, setResumeLoading] = useState(true);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Captures are live workspace sources. New captures are appended to the
  // saved source notes when a prepared sheet is reopened for editing.
  const [captures, setCaptures] = useState<CaptureNote[]>([]);

  // Step 2 — notes taken during the call (typed live or pasted afterward)
  const [callNotes, setCallNotes] = useState("");
  const [wrappingUp, setWrappingUp] = useState(false);
  const [draft, setDraft] = useState<WrapUpDraft | null>(null);

  // Promises in the note the sheet was just built from, offered as
  // commitments under the sheet (components/NotePromises.tsx). Held here so
  // the step 2 / wrap-up round trip does not read the note twice. An added
  // commitment joins the open list a rebuild starts from.
  const promises = useNotePromises(id, (c) => setOpenCommitments((cs) => [...cs, c]));

  useEffect(() => {
    // Name only — used for the "who owes this" toggle on the review screen.
    getDirectReport(id)
      .then((dr) => setReportName(dr.name))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    getOneOnOneHistory(id)
      .then((rows) => setHasCompletedOneOnOne(rows.some((row) => row.status === "completed")))
      .catch(() => {});
    // Titles this 1:1 when it is the planned career conversation (2026-10-08).
    getCareerPerson(id).then(setCareer).catch(() => setCareer(null));
  }, [id]);

  useEffect(() => {
    const loadSession = resumeId ? getOneOnOne(resumeId) : getOpenOneOnOne(id);
    Promise.all([
      loadSession,
      getCaptureNotes(id).catch(() => [] as CaptureNote[]),
      getCommitments({ directReportId: id, status: "open" }).catch(() => [] as Commitment[]),
      getGoals({ directReportId: id }).catch(() => []),
      getDevelopmentPlan(id).catch(() => null),
    ])
      .then(([session, captured, commitments, goals, development]) => {
        if (session && (session.direct_report_id !== id || session.status === "completed")) {
          setResumeError("This prep sheet is no longer available.");
          return;
        }

        setCaptures(captured);
        setOpenCommitments(commitments);
        setSuggestedTopics(
          deriveOneOnOneSuggestions({
            goals,
            planText: development?.development_plan.plan_text,
          })
        );

        const savedNotes = session?.prep_guide?.source_notes?.trim() ?? "";
        const capturedNotes = [...captured].reverse().map((note) => note.content).join("\n");
        setNotes([savedNotes, capturedNotes].filter(Boolean).join("\n"));

        if (!session) {
          if (startDate) setScheduleDate(startDate);
          return;
        }
        setOneOnOneId(session.id);
        setScheduleDate(scheduledAtToDate(session.scheduled_at));
        setRecurrenceWeeks(session.recurrence_weeks ?? null);
        setUsualDate(scheduledAtToDate(session.series_slot_at) || null);
        setCarryForwardItems(session.carry_forward_items ?? []);
        setOpeningLine(session.opening_line?.trim() || null);
        if (session.prep_guide) {
          setPrep({
            id: session.id,
            situation_summary: session.prep_guide.situation_summary,
            agenda_items: session.prep_guide.agenda_items,
            open_commitments_to_check: session.prep_guide.open_commitments_to_check,
            scheduled_at: session.scheduled_at,
            recurrence_weeks: session.recurrence_weeks ?? null,
            carry_forward_items: session.carry_forward_items ?? [],
            opening_line: session.opening_line ?? null,
            prepared_by: session.prep_guide.prepared_by,
            prepared_at: session.prep_guide.prepared_at ?? null,
            drew_on: session.prep_guide.drew_on,
            built_without: session.prep_guide.built_without,
            summary_unsupported: session.prep_guide.summary_unsupported,
          });
          setStep(editSources ? 1 : 2);
        }
      })
      .catch(() => {
        setResumeError(
          resumeId
            ? "This prep sheet is no longer available."
            : "Could not assemble this 1:1. Try again."
        );
      })
      .finally(() => setResumeLoading(false));
  }, [resumeId, editSources, id, startDate]);

  // "Date & repeat" on the Relationship Desk links here with #schedule: land
  // on the canonical date control instead of a second scheduling editor.
  useEffect(() => {
    if (resumeLoading || typeof window === "undefined" || window.location.hash !== "#schedule") return;
    const field = document.getElementById("meeting-schedule");
    field?.scrollIntoView({ block: "center" });
    field?.focus();
  }, [resumeLoading, step]);

  // Step 1 → 2: call AI prep endpoint
  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const includedCommitments = openCommitments.filter(
      (commitment) => !excludedCommitmentIds.includes(commitment.id)
    );
    if (
      hasCompletedOneOnOne !== false &&
      !notes.trim() &&
      !openingLine &&
      carryForwardItems.length === 0 &&
      suggestedTopics.length === 0 &&
      includedCommitments.length === 0
    ) return;
    setLoading(true);
    setError(null);
    try {
      const result = await prepOneOnOne({
        direct_report_id: id,
        raw_notes: notes,
        one_on_one_id: oneOnOneId ?? undefined,
        scheduled_at: dateToScheduledAt(scheduleDate),
        recurrence_weeks: scheduleDate ? recurrenceWeeks : null,
        timezone: browserTimezone(),
        carry_forward_items: carryForwardItems,
        suggested_topics: suggestedTopics.map((topic) => topic.text),
        excluded_commitment_ids: excludedCommitmentIds,
        opening_line: openingLine,
      });
      setPrep(result);
      setOneOnOneId(result.id);
      setScheduleDate(scheduledAtToDate(result.scheduled_at));
      setRecurrenceWeeks(result.recurrence_weeks);
      setUsualDate(scheduledAtToDate(result.series_slot_at) || null);
      setCarryForwardItems(result.carry_forward_items);
      setStep(2);
      // Only a sheet built here from a note; a reopened sheet is not re-read.
      promises.read(notes);
      // Captured content is now folded into this sheet — clear the inbox so
      // it doesn't get pulled in again next time. Best-effort: a failure
      // here just leaves a stale row to be re-included next prep, not worth
      // surfacing as an error on an otherwise-successful generate.
      if (captures.length > 0) {
        Promise.all(captures.map((c) => deleteCaptureNote(c.id))).catch(() => {});
        setCaptures([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // What the server saved is what the page shows: a move or a repeat change
  // never touches the prep sheet, so only the schedule fields follow it.
  function applySchedule(saved: { scheduled_at: string | null; recurrence_weeks?: number | null; series_slot_at?: string | null }) {
    setScheduleDate(scheduledAtToDate(saved.scheduled_at));
    // A career conversation planned on this 1:1 moved with it.
    getCareerPerson(id).then(setCareer).catch(() => {});
    setRecurrenceWeeks((saved.recurrence_weeks ?? null) as RecurrenceWeeks | null);
    setUsualDate(scheduledAtToDate(saved.series_slot_at) || null);
    setScheduleSaved(false);
  }

  // The repeat rule. A changed date goes through MoveOneOnOne instead, which
  // asks before it saves anything.
  async function persistSchedule(nextDate: string, nextRecurrence: RecurrenceWeeks | null) {
    if (!oneOnOneId) return;
    setScheduleSaving(true);
    setScheduleSaved(false);
    setError(null);
    try {
      const saved = await updateOneOnOneSchedule(oneOnOneId, {
        scheduled_at: dateToScheduledAt(nextDate),
        recurrence_weeks: nextDate ? nextRecurrence : null,
        timezone: browserTimezone(),
      });
      applySchedule(saved);
      setScheduleSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save the meeting date.");
    } finally {
      setScheduleSaving(false);
    }
  }

  // Step 2 → 3: distill call notes into a draft log for review
  async function handleWrapUp() {
    if (!callNotes.trim()) return;
    setWrappingUp(true);
    setError(null);
    try {
      const result = await wrapUpOneOnOne({ direct_report_id: id, raw_notes: callNotes });
      setDraft(result);
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setWrappingUp(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Resuming a planned session — loading / not-found states
  // ---------------------------------------------------------------------------
  if (resumeLoading) {
    return <p className="p-8 text-ink-secondary">Loading your prep sheet…</p>;
  }
  if (resumeError) {
    return (
      <PageShell maxWidth="2xl">
        <Link href={`/app/reports/${id}`} className="text-sm text-ink-secondary hover:underline">
          ← Back
        </Link>
        <p className="mt-4 text-ink-body">{resumeError}</p>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Step 1 — Review the automatically assembled next-meeting workspace
  // ---------------------------------------------------------------------------
  if (step === 1) {
    const firstName = reportName.split(" ")[0] || "them";
    const isFirstOneOnOne = hasCompletedOneOnOne === false;
    const nothingGathered =
      captures.length === 0 &&
      carryForwardItems.length === 0 &&
      suggestedTopics.length === 0 &&
      openCommitments.length === 0 &&
      !openingLine;
    const noInputs =
      !notes.trim() &&
      !openingLine &&
      carryForwardItems.length === 0 &&
      suggestedTopics.length === 0 &&
      openCommitments.every((commitment) => excludedCommitmentIds.includes(commitment.id));
    const buildBlockedByRule = noInputs && !isFirstOneOnOne;
    return (
      <PageShell maxWidth="2xl">
        <Link href={`/app/reports/${id}`} className="text-sm text-ink-secondary hover:underline">
          ← Back
        </Link>
        {firstRun && <p className="mt-4 text-xs text-ink-muted">Step 3 of {PATH_STEPS}</p>}
        <h1 className={`${firstRun ? "mt-1" : "mt-4"} text-2xl font-semibold`}>{isCareer ? "Review the career conversation" : "Review next 1:1"}</h1>
        <p className="mt-2 text-ink-secondary">
          {nothingGathered
            ? `No earlier 1:1s with ${firstName} are recorded.`
            : `Pulled from goals, development, and your last 1:1 with ${firstName}. Remove anything you don't want in this one.`}
        </p>

        <form onSubmit={handleGenerate} className={SECTION_GAP}>
          <div className="mb-5 grid gap-4 rounded-xl border border-hairline bg-surface p-4 sm:grid-cols-2">
            {oneOnOneId ? (
              // An existing workspace moves its date here without building an
              // agenda, so "Date & repeat" from the Relationship Desk works on
              // its own. Nothing saves until the manager confirms the move.
              <MoveOneOnOne
                variant="field"
                sessionId={oneOnOneId}
                inputId="meeting-schedule"
                date={scheduleDate}
                recurrenceWeeks={recurrenceWeeks}
                usualDate={usualDate}
                onMoved={applySchedule}
              />
            ) : (
              // No workspace yet: the date is saved when the agenda is built.
              // Typing a date passes through an empty value; that must not
              // clear the repeat, which is only dropped if the date is still
              // empty when the agenda is built.
              <label className="block">
                <span className="text-sm font-medium text-ink-body">Meeting date</span>
                <input
                  id="meeting-schedule"
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                  className="mt-2 w-full rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink-body focus:border-brand focus:outline-none"
                />
              </label>
            )}
            <label className="block">
              <span className="text-sm font-medium text-ink-body">Repeat this 1:1</span>
              <select
                value={recurrenceWeeks ?? ""}
                disabled={!scheduleDate || scheduleSaving}
                onChange={(e) => {
                  const next = e.target.value ? (Number(e.target.value) as RecurrenceWeeks) : null;
                  setRecurrenceWeeks(next);
                  if (oneOnOneId) persistSchedule(scheduleDate, next);
                }}
                className="mt-2 w-full rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink-body focus:border-brand focus:outline-none disabled:opacity-50"
              >
                <option value="">Does not repeat</option>
                <option value="1">Every week</option>
                <option value="2">Every 2 weeks</option>
                <option value="3">Every 3 weeks</option>
                <option value="4">Every 4 weeks</option>
              </select>
            </label>
            <p className="text-xs text-ink-muted sm:col-span-2">
              This sets how often the 1:1 repeats. Calendar invitations will come with calendar sync.
              {oneOnOneId && (
                <span className="ml-1 text-ink-secondary" aria-live="polite">
                  {scheduleSaving ? "Saving…" : scheduleSaved ? "Saved." : ""}
                </span>
              )}
            </p>
          </div>

          {openingLine && (
            <div className="mb-5 rounded-lg border border-hairline bg-surface px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Open with · kept at your last wrap-up
              </p>
              <div className="mt-2 flex items-start justify-between gap-3 text-sm text-ink-body">
                <span>{openingLine}</span>
                <button
                  type="button"
                  onClick={() => setOpeningLine(null)}
                  className="shrink-0 text-xs text-ink-muted hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
          )}

          {carryForwardItems.length > 0 && (
            <div className="mb-5 rounded-lg border border-hairline bg-surface px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Carried forward from your last 1:1
              </p>
              <ul className="mt-2 space-y-2">
                {carryForwardItems.map((item, index) => (
                  <li key={index} className="flex items-start justify-between gap-3 text-sm text-ink-body">
                    <span>{item}</span>
                    <button
                      type="button"
                      onClick={() => setCarryForwardItems((items) => items.filter((_, i) => i !== index))}
                      className="shrink-0 text-xs text-ink-muted hover:text-red-700"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {suggestedTopics.length > 0 && (
            <div className="mb-5 rounded-lg border border-hairline bg-surface px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Suggested topics</p>
              <p className="mt-1 text-xs text-ink-muted">Pulled from goals, development, and the last conversation.</p>
              <ul className="mt-3 space-y-2">
                {suggestedTopics.map((topic) => (
                  <li key={topic.key} className="flex items-start justify-between gap-3 text-sm text-ink-body">
                    <span>{topic.text}</span>
                    <button
                      type="button"
                      onClick={() => setSuggestedTopics((topics) => topics.filter((item) => item.key !== topic.key))}
                      className="shrink-0 text-xs text-ink-muted hover:text-red-700"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {openCommitments.length > 0 && (
            <div className="mb-5 rounded-lg border border-hairline bg-surface px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Open commitments</p>
              <p className="mt-1 text-xs text-ink-muted">
                Linked live from the commitment tracker. Uncheck one to leave it out of this agenda only.
              </p>
              <ul className="mt-3 space-y-2">
                {openCommitments.map((commitment) => (
                  <li key={commitment.id} className="flex items-start gap-3 text-sm text-ink-body">
                    <input
                      type="checkbox"
                      checked={!excludedCommitmentIds.includes(commitment.id)}
                      onChange={(event) =>
                        setExcludedCommitmentIds((ids) =>
                          event.target.checked
                            ? ids.filter((id) => id !== commitment.id)
                            : [...ids, commitment.id]
                        )
                      }
                      className="mt-1 h-4 w-4 rounded border-control"
                      aria-label={`Include commitment: ${commitment.description}`}
                    />
                    <span>
                      {commitment.description}
                      <span className="ml-1 text-xs text-ink-muted">
                        {commitment.committed_by === "direct_report"
                          ? `(${reportName.split(" ")[0] || "theirs"})`
                          : "(yours)"}
                        {commitment.due_date && ` · due ${commitment.due_date}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-ink-body">Notes for this 1:1</span>
            <span className="mt-1 block text-xs text-ink-muted">
              {captures.length > 0
                ? `${captures.length} captured note${captures.length === 1 ? " is" : "s are"} already included. Edit freely.`
                : isFirstOneOnOne
                  ? `Optional. Anything you already know about ${firstName}'s work, or want to raise.`
                  : "Anything not already listed above."}
            </span>
            <NoteField
              value={notes}
              onChange={setNotes}
              placeholder={
                isFirstOneOnOne
                  ? "– Joined in March, came over from support\n– Wants more ownership of onboarding\n– Ask how they like to get feedback"
                  : "– Something noticed since the last 1:1\n– A question to ask\n– A win to mention"
              }
              rows={6}
              className="mt-2"
            />
          </label>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading || buildBlockedByRule}
            className="mt-4 w-full rounded-md bg-brand px-4 py-3 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
          >
            {loading ? "Building agenda…" : "Build agenda →"}
          </button>
          <WaitNote active={loading} typical="10 to 40 seconds" className="mt-2" />
          {buildBlockedByRule && !loading && (
            <p className="mt-2 text-xs text-ink-muted">Add a note or keep an item above to build an agenda.</p>
          )}
        </form>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Step 2 — Prep sheet (left) + live call notes (right)
  // ---------------------------------------------------------------------------
  if (step === 2 && prep) {
    return (
      <PageShell maxWidth="6xl">
        <button onClick={() => setStep(1)} className="text-sm text-ink-secondary hover:underline">
          ← Edit prep
        </button>

        {firstRun && (
          <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-brand bg-brand/10 px-5 py-4">
            <div>
              <p className="text-xs text-ink-muted">Step 3 of {PATH_STEPS}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink">Prep sheet saved</h2>
              <p className="mt-1 text-sm text-ink-body">
                {prep.agenda_items.length} {prep.agenda_items.length === 1 ? "item" : "items"}
                {scheduleDate ? ` for ${longDayLabel(scheduleDate)}` : ""}. It’s on {reportName.split(" ")[0] || "their"}’s page.
              </p>
              {promises.waiting > 0 && (
                <p className="mt-1 text-sm text-ink-body">
                  <a href="#note-promises" className="font-medium text-brand hover:text-brand-hover hover:underline">
                    {promises.waiting} {promises.waiting === 1 ? "promise" : "promises"} in your note
                  </a>{" "}
                  to add as commitments, below the agenda.
                </p>
              )}
              <p className="mt-1 text-sm text-ink-secondary">
                Steps {FIRST_RUN_STEPS + 1} to {PATH_STEPS} are next, on Mission Control: team and roles, expectations, goals.
              </p>
            </div>
            <Link href="/app/dashboard" className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-on-brand hover:bg-brand-hover">
              Go to Mission Control
            </Link>
          </div>
        )}

        <div className={`${SECTION_GAP} grid gap-10 lg:grid-cols-2`}>
          {/* Left — the prep sheet, what you planned to talk about */}
          <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Your prep sheet</h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {isCareer
                    ? `Career conversation with ${reportName || "your report"}`
                    : reportName ? `1:1 with ${reportName}` : "Upcoming 1:1"}
                </p>
                {/* Name the author and its sources on every sheet. Sheets
                    saved before drew_on existed show the author line only. */}
                <p className="mt-1 max-w-md text-xs text-ink-secondary">
                  {prep.prepared_by === "overnight" ? "Drafted overnight by AI" : "Drafted by AI"}
                  {prep.drew_on && prep.drew_on.length > 0 && ` · Drew on ${prep.drew_on.join(", ")}`}
                  {prep.built_without && prep.built_without.length > 0 && (
                    <>
                      {" · Built without "}
                      {prep.built_without.map((label, i) => (
                        <span key={label}>
                          {i > 0 && ", "}
                          <Link href={BUILT_WITHOUT_HREF[label] ?? "/app/dashboard"} className="underline decoration-hairline underline-offset-2 hover:text-ink">
                            {label}
                          </Link>
                        </span>
                      ))}
                    </>
                  )}
                  {prep.prepared_by === "overnight" && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="font-medium text-brand hover:text-brand-hover hover:underline"
                      >
                        Rebuild
                      </button>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {oneOnOneId && (
                  <MoveOneOnOne
                    variant="field"
                    compact
                    sessionId={oneOnOneId}
                    inputId="meeting-schedule"
                    date={scheduleDate}
                    recurrenceWeeks={recurrenceWeeks}
                    usualDate={usualDate}
                    onMoved={applySchedule}
                  />
                )}
                <label className="block">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted">Repeats</span>
                  <select
                    value={recurrenceWeeks ?? ""}
                    disabled={!scheduleDate || scheduleSaving}
                    onChange={(e) => {
                      const next = e.target.value ? (Number(e.target.value) as RecurrenceWeeks) : null;
                      setRecurrenceWeeks(next);
                      persistSchedule(scheduleDate, next);
                    }}
                    className="mt-1 rounded-md border border-control bg-sunken px-2.5 py-1.5 text-sm text-ink-body focus:border-brand focus:outline-none disabled:opacity-50"
                  >
                    <option value="">Does not repeat</option>
                    <option value="1">Weekly</option>
                    <option value="2">Every 2 weeks</option>
                    <option value="3">Every 3 weeks</option>
                    <option value="4">Every 4 weeks</option>
                  </select>
                </label>
                <span className="pb-2 text-[11px] text-ink-muted">
                  {scheduleSaving ? "Saving…" : scheduleSaved ? "Saved" : ""}
                </span>
              </div>
            </div>

            {/* Situation summary */}
            <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">
                Where things stand
              </p>
              <p className="mt-2 text-ink-body">{prep.situation_summary}</p>
              <NotInYourNotes words={prep.summary_unsupported ?? []} />
            </div>

            {/* Open commitments reminder */}
            {prep.open_commitments_to_check.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-500">
                  Open commitments — follow up today
                </p>
                <ul className="mt-2 space-y-1">
                  {prep.open_commitments_to_check.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-body">
                      <span className="text-amber-400">•</span>
                      <span>
                        {c.description}
                        <span className="ml-1 text-ink-muted">
                          {c.committed_by === "direct_report"
                            ? `(${reportName.split(" ")[0] || "theirs"})`
                            : "(yours)"}
                          {c.due_date && ` · due ${c.due_date}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Agenda items */}
            <div className="mt-8 space-y-3">
              <p className="text-sm font-medium uppercase tracking-wide text-ink-muted">
                Agenda — {prep.agenda_items.length} items
              </p>
              {prep.agenda_items.map((item, i) => (
                <AgendaCard key={i} item={item} index={i} />
              ))}
            </div>

            <NotePromises np={promises} reportName={reportName} />
          </div>

          {/* Right — what's actually happening on the call */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <h2 className="text-2xl font-semibold">Call notes</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              Type as you talk, or paste your notes afterward — from Granola or
              whatever you record with. When you&apos;re done, we&apos;ll draft the
              summary and pull out the commitments for you to review.
            </p>
            <NoteField
              value={callNotes}
              onChange={setCallNotes}
              placeholder={"– Wants more ownership of onboarding, unsure how to ask for it\n– I'll set up time with Sam on the design team\n– They'll send me a draft plan by Friday"}
              rows={18}
              className="mt-4"
            />
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            <button
              onClick={handleWrapUp}
              disabled={wrappingUp || !callNotes.trim()}
              className="mt-4 w-full rounded-md bg-brand px-4 py-3 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
            >
              {wrappingUp ? "Drafting your log…" : "Wrap up & log →"}
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Step 3 — Review the drafted log, then save
  // ---------------------------------------------------------------------------
  if (step === 3 && draft) {
    return (
      <WrapUpReview
        directReportId={id}
        reportName={reportName}
        rawNotes={callNotes}
        draft={draft}
        onBack={() => setStep(2)}
        backLabel="Back to the call"
        oneOnOneId={oneOnOneId ?? undefined}
        // The MEETING DATE from the sheet carries straight through, so the
        // usual case needs no second thought. It stays editable on review for
        // the meeting that slipped a day.
        initialMeetingDate={scheduleDate || localDateStr()}
        willRecur={recurrenceWeeks !== null}
      />
    );
  }

  return null;
}
