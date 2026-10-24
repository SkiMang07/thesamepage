"use client";

// One way to start a 1:1, shared by the Meet picker, the Relationship Desk's
// Start 1:1, the Last → next card and Mission Control (build plan B2).
//
// Picking a person goes straight to the meeting screen, transcribing from
// the mic. If "Ask for the call tab whenever I start a meeting" is on, the
// browser's share dialog opens from that same click (so `begin` must be
// called directly from the click handler); cancelling it never blocks the
// meeting. A call already running elsewhere (409 already_recording) is
// offered back rather than silently replaced.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ensureOpenOneOnOne } from "@/lib/api";
import { useRecorder, type ActiveMeeting } from "@/lib/recorder/RecorderProvider";
import { getAskForTab } from "@/lib/recorder/prefs";
import { BTN_PRIMARY_SM, BTN_SECONDARY } from "@/lib/tokens";

export type MeetPerson = { id: string; name: string };

type Problem =
  | { kind: "already_recording"; person: MeetPerson; transcriptId: string | null; meeting: ActiveMeeting | null }
  | { kind: "refused"; person: MeetPerson; message: string };

export function useStartMeeting() {
  const recorder = useRecorder();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  /** Call straight from the click: the share dialog needs that gesture. */
  function begin(person: MeetPerson, opts: { transcribe: boolean; consentConfirmed: boolean }) {
    const tab = opts.transcribe && recorder.supportsCallTab && getAskForTab() ? recorder.startCallTabInClick() : null;
    return run(person, opts, tab);
  }

  async function run(person: MeetPerson, opts: { transcribe: boolean; consentConfirmed: boolean }, tab: ReturnType<typeof recorder.startCallTabInClick> | null) {
    setPending(true);
    setProblem(null);
    try {
      const session = await ensureOpenOneOnOne(person.id);
      const result = await recorder.startMeeting({
        personId: person.id,
        personName: person.name,
        oneOnOneId: session.id,
        transcribe: opts.transcribe,
        consentConfirmed: opts.consentConfirmed,
        tab,
      });
      if (result.ok) {
        router.push(`/app/reports/${person.id}/meet`);
        return true;
      }
      if (result.code === "already_recording") {
        setProblem({ kind: "already_recording", person, transcriptId: result.transcriptId, meeting: result.meeting });
      } else {
        setProblem({ kind: "refused", person, message: result.message });
      }
      return false;
    } catch {
      setProblem({ kind: "refused", person, message: `Couldn't open the 1:1 with ${person.name.split(" ")[0]}. Try again.` });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function goBackToRunning() {
    if (problem?.kind !== "already_recording") return;
    const m = problem.meeting ?? (problem.transcriptId ? await recorder.adoptRunning(problem.transcriptId) : null);
    setProblem(null);
    if (m) router.push(`/app/reports/${m.personId}/meet`);
  }

  async function endRunningAndStart() {
    if (problem?.kind !== "already_recording") return;
    const { person, transcriptId, meeting } = problem;
    setPending(true);
    const id = transcriptId ?? meeting?.transcriptId ?? null;
    if (id) await recorder.endRunning(id);
    if (meeting) recorder.finishMeeting();
    // No share dialog here: this click isn't the one that asked for the meeting.
    await run(person, { transcribe: true, consentConfirmed: true }, null);
  }

  async function startWithout() {
    if (!problem) return;
    await run(problem.person, { transcribe: false, consentConfirmed: false }, null);
  }

  return { begin, pending, problem, clearProblem: () => setProblem(null), goBackToRunning, endRunningAndStart, startWithout };
}

/** What went wrong starting, with the way forward. Rendered by each start surface. */
export function StartProblem({ start }: { start: ReturnType<typeof useStartMeeting> }) {
  const p = start.problem;
  if (!p) return null;
  if (p.kind === "already_recording") {
    const other = p.meeting?.personName.split(" ")[0];
    return (
      <div role="alert" className="mt-3 rounded-lg border border-amber-500/50 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
        <p>{other ? `You're still transcribing your 1:1 with ${other}.` : "Another call is still being transcribed."}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className={BTN_PRIMARY_SM} onClick={() => void start.goBackToRunning()}>
            Go back to it
          </button>
          <button type="button" className={BTN_SECONDARY} disabled={start.pending} onClick={() => void start.endRunningAndStart()}>
            End it and start this one
          </button>
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="mt-3 rounded-lg border border-amber-500/50 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
      <p>{p.message}</p>
      <div className="mt-2.5">
        <button type="button" className={BTN_SECONDARY} disabled={start.pending} onClick={() => void start.startWithout()}>
          Start without transcribing
        </button>
      </div>
    </div>
  );
}
