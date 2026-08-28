"use client";

// Standalone "Log a 1:1" — for conversations that happened without prep
// (hallway chats, ad-hoc calls). Same notes → AI wrap-up → review flow as
// the prep page, minus the prep sheet.
//
// Two things here exist because of what this path used to do silently. It
// asks WHEN the conversation happened, because it is the path most likely to
// be used days later and the date is what history and the next prep sheet
// count from. And when there is already a prep sheet saved for an upcoming
// meeting, it asks WHICH conversation this was, because completing that
// occurrence with unrelated notes throws the prep away and files the meeting
// under the wrong date. Neither question is asked when there is nothing to
// get wrong.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDirectReport,
  getOpenOneOnOne,
  wrapUpOneOnOne,
  OneOnOne,
  WrapUpDraft,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import WrapUpReview from "../wrap-up-review";

import NoteField from "@/components/NoteField";
// Local calendar day, not the UTC one — "today" west of UTC is otherwise
// "tomorrow" for most of the evening. Same helper goals/team already use.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

// "This is the meeting I prepped" vs "a different conversation".
type WhichMeeting = "prepped" | "separate";

export default function LogOneOnOnePage() {
  const { id } = useParams<{ id: string }>();

  const [notes, setNotes] = useState("");
  const [meetingDate, setMeetingDate] = useState(localDateStr());
  const [reportName, setReportName] = useState("");
  const [preppedSession, setPreppedSession] = useState<OneOnOne | null>(null);
  const [whichMeeting, setWhichMeeting] = useState<WhichMeeting | null>(null);
  const [wrappingUp, setWrappingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WrapUpDraft | null>(null);

  useEffect(() => {
    getDirectReport(id)
      .then((dr) => setReportName(dr.name))
      .catch(() => {});
    // Only a PREPPED occurrence forces the question. A gathering or merely
    // scheduled workspace holds no work worth protecting, so logging just
    // completes it the way it always did.
    getOpenOneOnOne(id)
      .then((session) => setPreppedSession(session?.status === "planned" ? session : null))
      .catch(() => {});
  }, [id]);

  function chooseMeeting(choice: WhichMeeting) {
    setWhichMeeting(choice);
    // Saying "this is the one I prepped" also answers the date question:
    // that occurrence already carries the day it was planned for.
    if (choice === "prepped" && preppedSession?.scheduled_at) {
      setMeetingDate(preppedSession.scheduled_at.slice(0, 10));
    }
  }

  const needsChoice = preppedSession !== null && whichMeeting === null;

  async function handleWrapUp(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim() || needsChoice) return;
    setWrappingUp(true);
    setError(null);
    try {
      const result = await wrapUpOneOnOne({ direct_report_id: id, raw_notes: notes });
      setDraft(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setWrappingUp(false);
    }
  }

  if (draft) {
    const attachToPrepped = whichMeeting === "prepped" && preppedSession !== null;
    return (
      <WrapUpReview
        directReportId={id}
        reportName={reportName}
        rawNotes={notes}
        draft={draft}
        onBack={() => setDraft(null)}
        backLabel="Back to notes"
        oneOnOneId={attachToPrepped ? preppedSession!.id : undefined}
        separateOccurrence={whichMeeting === "separate"}
        initialMeetingDate={meetingDate}
        willRecur={attachToPrepped ? Boolean(preppedSession!.recurrence_weeks) : false}
      />
    );
  }

  return (
    <PageShell maxWidth="2xl">
      <Link href={`/app/reports/${id}`} className="text-sm text-ink-secondary hover:underline">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">
        Log a 1:1{reportName && ` with ${reportName.split(" ")[0]}`}
      </h1>
      <p className="mt-2 text-ink-secondary">
        For conversations that happened without prep. Type what you talked
        about, or paste your notes from Granola or whatever you record with —
        we&apos;ll draft the summary and pull out the commitments for you to review.
      </p>

      {preppedSession && (
        <div className="mt-6 rounded-lg border border-amber-500 bg-amber-50 px-4 py-4">
          <p className="text-sm font-medium text-amber-700">
            You have prep saved
            {preppedSession.scheduled_at
              ? ` for ${formatDate(preppedSession.scheduled_at)}`
              : " for your next 1:1"}
            {reportName && ` with ${reportName.split(" ")[0]}`}.
          </p>
          <p className="mt-1 text-sm text-ink-secondary">
            Which conversation are you logging?
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => chooseMeeting("prepped")}
              aria-pressed={whichMeeting === "prepped"}
              className={`flex-1 rounded-md border px-3 py-2 text-left text-sm ${
                whichMeeting === "prepped"
                  ? "border-brand bg-brand-tint text-ink-body"
                  : "border-control bg-surface text-ink-secondary hover:bg-sunken"
              }`}
            >
              <span className="block font-medium text-ink-body">That meeting</span>
              <span className="block text-xs">Completes it and keeps the prep with it.</span>
            </button>
            <button
              type="button"
              onClick={() => chooseMeeting("separate")}
              aria-pressed={whichMeeting === "separate"}
              className={`flex-1 rounded-md border px-3 py-2 text-left text-sm ${
                whichMeeting === "separate"
                  ? "border-brand bg-brand-tint text-ink-body"
                  : "border-control bg-surface text-ink-secondary hover:bg-sunken"
              }`}
            >
              <span className="block font-medium text-ink-body">A different one</span>
              <span className="block text-xs">Logs on its own. Your prep stays waiting.</span>
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleWrapUp} className={SECTION_GAP}>
        <div className="mb-4">
          <label htmlFor="log-meeting-date" className="block text-sm font-medium text-ink-body">
            Meeting date{" "}
            <span className="font-normal text-ink-muted">— the day you actually talked</span>
          </label>
          <input
            id="log-meeting-date"
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="mt-2 rounded-md border border-control px-3 py-2 text-sm text-ink-body focus:border-brand focus:outline-none"
          />
        </div>

        <NoteField
          value={notes}
          onChange={setNotes}
          placeholder={"– Caught up after standup about the Acme renewal\n– I'll pull the usage numbers before Thursday\n– She'll set up a call with their new champion"}
          rows={10}
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        {needsChoice && (
          <p className="mt-2 text-sm text-amber-700">
            Pick which conversation this was before drafting.
          </p>
        )}
        <button
          type="submit"
          disabled={wrappingUp || !notes.trim() || needsChoice}
          className="mt-4 w-full rounded-md bg-brand px-4 py-3 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          {wrappingUp ? "Drafting your log…" : "Wrap up & log →"}
        </button>
      </form>
    </PageShell>
  );
}
