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
  PrepResponse,
  AgendaItem,
  WrapUpDraft,
  CaptureNote,
} from "@/lib/api";
import WrapUpReview from "../wrap-up-review";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgendaCard({ item, index }: { item: AgendaItem; index: number }) {
  const [open, setOpen] = useState(index === 0); // first card open by default

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
        </div>
        <span className="ml-4 mt-1 shrink-0 text-ink-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-divider px-5 pb-5 pt-4">
          <p className="text-sm text-ink-secondary italic">{item.rationale}</p>
          <ul className="mt-4 space-y-3">
            {item.suggested_questions.map((q, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-ink-faint">→</span>
                <p className="text-ink-body">{q}</p>
              </li>
            ))}
          </ul>
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

  const [step, setStep] = useState<Step>(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<PrepResponse | null>(null);
  const [reportName, setReportName] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [recurrenceWeeks, setRecurrenceWeeks] = useState<RecurrenceWeeks | null>(null);
  const [carryForwardItems, setCarryForwardItems] = useState<string[]>([]);
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

  // Captures (Session 50) — quick between-sessions jots from the Person
  // Page's cockpit box, folded into step 1's raw-notes textarea so they
  // "land on the next prep sheet" per the person_page_redesign scoping note.
  // Only relevant on a fresh /prep pass, not a resumed one (a resumed sheet
  // was already generated, so its notes are frozen in prep_guide already).
  const [captures, setCaptures] = useState<CaptureNote[]>([]);

  // Step 2 — notes taken during the call (typed live or pasted afterward)
  const [callNotes, setCallNotes] = useState("");
  const [wrappingUp, setWrappingUp] = useState(false);
  const [draft, setDraft] = useState<WrapUpDraft | null>(null);

  useEffect(() => {
    // Name only — used for the "who owes this" toggle on the review screen.
    getDirectReport(id)
      .then((dr) => setReportName(dr.name))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    // Skip when resuming — a resumed sheet is already generated, so there's
    // no step-1 textarea to prefill.
    if (resumeId) return;
    getCaptureNotes(id)
      .then((cs) => {
        setCaptures(cs);
        if (cs.length > 0) {
          // Oldest first reads as a timeline of what came up since the last
          // 1:1, same chronological framing as everywhere else notes stack.
          setNotes([...cs].reverse().map((c) => c.content).join("\n"));
        }
      })
      .catch(() => {});
  }, [id, resumeId]);

  useEffect(() => {
    const loadSession = resumeId ? getOneOnOne(resumeId) : getOpenOneOnOne(id);
    loadSession
      .then((session) => {
        if (!session) return;
        if (session.direct_report_id !== id || session.status === "completed") {
          setResumeError("This prep sheet is no longer available.");
          return;
        }
        setOneOnOneId(session.id);
        setScheduleDate(scheduledAtToDate(session.scheduled_at));
        setRecurrenceWeeks(session.recurrence_weeks ?? null);
        setCarryForwardItems(session.carry_forward_items ?? []);
        if (session.prep_guide) {
          setPrep({
            id: session.id,
            situation_summary: session.prep_guide.situation_summary,
            agenda_items: session.prep_guide.agenda_items,
            open_commitments_to_check: session.prep_guide.open_commitments_to_check,
            scheduled_at: session.scheduled_at,
            recurrence_weeks: session.recurrence_weeks ?? null,
            carry_forward_items: session.carry_forward_items ?? [],
          });
          setStep(2);
        }
      })
      .catch(() => {
        if (resumeId) setResumeError("This prep sheet is no longer available.");
      })
      .finally(() => setResumeLoading(false));
  }, [resumeId, id]);

  // Step 1 → 2: call AI prep endpoint
  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim() && carryForwardItems.length === 0) return;
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
      });
      setPrep(result);
      setOneOnOneId(result.id);
      setScheduleDate(scheduledAtToDate(result.scheduled_at));
      setRecurrenceWeeks(result.recurrence_weeks);
      setCarryForwardItems(result.carry_forward_items);
      setStep(2);
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
      setScheduleDate(scheduledAtToDate(saved.scheduled_at));
      setRecurrenceWeeks(saved.recurrence_weeks ?? null);
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
  // Step 1 — Notes input
  // ---------------------------------------------------------------------------
  if (step === 1) {
    return (
      <PageShell maxWidth="2xl">
        <Link href={`/app/reports/${id}`} className="text-sm text-ink-secondary hover:underline">
          ← Back
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Prep for 1:1</h1>
        <p className="mt-2 text-ink-secondary">
          Jot down what&apos;s on your mind before the meeting — what&apos;s going on with
          this person, anything you&apos;re worried about, anything you want to celebrate.
          The more specific, the better the prep sheet.
        </p>
        {captures.length > 0 && (
          <p className="mt-2 text-xs text-ink-muted">
            Prefilled with {captures.length} thing{captures.length > 1 ? "s" : ""} you captured since the last 1:1 — edit freely below.
          </p>
        )}

        <form onSubmit={handleGenerate} className={SECTION_GAP}>
          <div className="mb-5 grid gap-4 rounded-xl border border-hairline bg-surface p-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink-body">Meeting date</span>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  setScheduleDate(nextDate);
                  if (!nextDate) setRecurrenceWeeks(null);
                }}
                className="mt-2 w-full rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink-body focus:border-brand focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-body">Repeat this 1:1</span>
              <select
                value={recurrenceWeeks ?? ""}
                disabled={!scheduleDate}
                onChange={(e) =>
                  setRecurrenceWeeks(e.target.value ? (Number(e.target.value) as RecurrenceWeeks) : null)
                }
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
              This schedules the rhythm inside The Same Page. Calendar invitations will come with calendar sync.
            </p>
          </div>

          {carryForwardItems.length > 0 && (
            <div className="mb-5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Carried forward from your last 1:1
              </p>
              <ul className="mt-2 space-y-1">
                {carryForwardItems.map((item, index) => (
                  <li key={index} className="flex gap-2 text-sm text-ink-body">
                    <span className="text-amber-500">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. She's been quiet in standups lately. She closed the Acme deal last week — worth calling out. There's a commitment from two weeks ago about the onboarding doc I need to follow up on."
            rows={8}
            className="w-full rounded-lg border border-control px-4 py-3 text-ink-body placeholder-ink-faint focus:border-brand focus:outline-none"
          />
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading || (!notes.trim() && carryForwardItems.length === 0)}
            className="mt-4 w-full rounded-md bg-brand px-4 py-3 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
          >
            {loading ? "Generating prep sheet…" : "Generate prep sheet →"}
          </button>
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
          ← Edit prep notes
        </button>

        <div className={`${SECTION_GAP} grid gap-10 lg:grid-cols-2`}>
          {/* Left — the prep sheet, what you planned to talk about */}
          <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Your prep sheet</h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {reportName ? `1:1 with ${reportName}` : "Upcoming 1:1"}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted">Meeting date</span>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      setScheduleDate(nextDate);
                      if (!nextDate) setRecurrenceWeeks(null);
                    }}
                    onBlur={() => persistSchedule(scheduleDate, scheduleDate ? recurrenceWeeks : null)}
                    className="mt-1 rounded-md border border-control bg-sunken px-2.5 py-1.5 text-sm text-ink-body focus:border-brand focus:outline-none"
                  />
                </label>
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
          </div>

          {/* Right — what's actually happening on the call */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <h2 className="text-2xl font-semibold">Call notes</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              Type as you talk, or paste your notes afterward — from Granola or
              whatever you record with. When you&apos;re done, we&apos;ll draft the
              summary and pull out the commitments for you to review.
            </p>
            <textarea
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder={"– Pipeline looking thin for Q4, she's worried about the Acme renewal\n– I'll intro her to Sam on the design team\n– She'll draft the QBR deck by Friday"}
              rows={18}
              className="mt-4 w-full rounded-lg border border-control px-4 py-3 text-ink-body placeholder-ink-faint focus:border-brand focus:outline-none"
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
        willRecur={recurrenceWeeks !== null}
      />
    );
  }

  return null;
}
