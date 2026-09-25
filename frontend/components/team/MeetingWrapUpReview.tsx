"use client";

// ---------------------------------------------------------------------------
// Team meeting wrap-up review (2026-08-24)
//
// Since Beyond the team, the shared body (summary, commitments, footer) is
// WrapUpReviewShell.tsx; this file is the team-meeting adapter around it.
//
// The confirm step between an AI draft and the record. A shared component on
// purpose: /app/team's quick log, the dedicated meeting screen
// (/app/team/meetings/[id]) and the pending external-notes ingestion all land
// here, and a second review surface would drift from this one on the exact
// rule that must not drift —
//
//   NOTHING IS WRITTEN UNTIL THE MANAGER CONFIRMS.
//
// Commitments are accountability records; a hallucinated one costs trust in
// the whole product. Every row here is editable and removable before save,
// and the summary is required, so an empty or garbled extraction degrades
// into "write it yourself" rather than into a bad record. Same locked rule
// as the 1:1 wrap-up review.
// ---------------------------------------------------------------------------

import { useState } from "react";
import WrapUpReviewShell, { ReviewCommitment } from "@/components/team/WrapUpReviewShell";
import {
  ApiError,
  TeamAgendaItem,
  TeamMeeting,
  TeamMeetingLogResult,
  TeamMeetingWrapUpDraft,
  logTeamMeeting,
} from "@/lib/api";
import { BTN_GHOST, BTN_SECONDARY, EYEBROW, INPUT, META } from "@/lib/tokens";

export type AgendaOutcome = { id: string; covered: boolean; notes: string };

// What the server saved — the caller builds its receipt from this, never from
// the draft below.
export type WrapUpResult = TeamMeetingLogResult;

// The summary, commitments and footer are the shared WrapUpReviewShell; this
// component adds what only a team meeting has — carry-forward into the next
// occurrence — and its own save call.
export default function MeetingWrapUpReview({
  meeting,
  members,
  rawNotes,
  draft,
  outcomes,
  onBack,
  onSaved,
  onAlreadyLogged,
}: {
  meeting: TeamMeeting;
  members: { id: string; name: string }[];
  rawNotes: string;
  draft: TeamMeetingWrapUpDraft;
  outcomes: AgendaOutcome[];
  onBack: () => void;
  onSaved: (result: WrapUpResult) => void;
  /** The server refused because this meeting is already logged — a retry
   *  after a lost response, or another tab. Nothing was saved a second time;
   *  the caller should load and show what the first save stored. */
  onAlreadyLogged?: () => void;
}) {
  const [summary, setSummary] = useState(draft.summary);
  // Owner key is the direct report id, "" for the manager.
  const [commitments, setCommitments] = useState<ReviewCommitment[]>(() =>
    draft.commitments.map((c) => ({ description: c.description, owner: c.direct_report_id ?? "", due_date: c.due_date }))
  );
  // Anything the manager did not tick as covered is offered as carry-forward
  // alongside whatever the model suggested — an unreached agenda item is the
  // most common thing to carry, and making the manager retype it is the
  // fastest way to get carry-forward abandoned.
  const [carried, setCarried] = useState<string[]>(() =>
    dedupe([...uncoveredItems(meeting.agenda_items, outcomes), ...draft.carry_forward_items])
  );
  const [newCarry, setNewCarry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!summary.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await logTeamMeeting(meeting.id, {
        summary: summary.trim(),
        rawNotes,
        agendaOutcomes: outcomes.map((o) => ({
          id: o.id,
          covered: o.covered,
          notes: o.notes.trim() || null,
        })),
        commitments: commitments
          .filter((c) => c.description.trim())
          .map((c) => ({
            description: c.description.trim(),
            direct_report_id: c.owner || null,
            due_date: c.due_date || null,
          })),
        carryForwardItems: carried,
      });
      onSaved(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && onAlreadyLogged) {
        onAlreadyLogged();
        return;
      }
      // The draft stays exactly as it is, so confirming again is one click.
      // Honest about the unknown: a lost response can hide a save that did
      // happen. Trying again is safe — the server refuses a second log (409)
      // and the caller then shows what the first one stored.
      setError(
        e instanceof ApiError && e.status < 500
          ? `Couldn't save the meeting: ${e.detail}. Your review is still here.`
          : "The save couldn't be confirmed. Your review is still here — try again; the meeting won't be saved twice."
      );
    } finally {
      setSaving(false);
    }
  }

  function addCarry() {
    const text = newCarry.trim();
    if (!text) return;
    setCarried((rows) => dedupe([...rows, text]));
    setNewCarry("");
  }

  return (
    <WrapUpReviewShell
      summary={summary}
      onSummaryChange={setSummary}
      summaryPlaceholder="What the team actually covered..."
      commitments={commitments}
      onCommitmentsChange={setCommitments}
      // Null owner is a real answer, not a missing one — plenty of what
      // comes out of a team meeting is the manager's.
      ownerGroups={[{ label: null, options: members.map((m) => ({ value: m.id, label: m.name })) }]}
      commitmentsTitle="Team commitments"
      saving={saving}
      error={error}
      canSave
      saveLabel="Save meeting"
      onBack={onBack}
      onSave={save}
    >
      <div className="mt-5">
        <p className={EYEBROW}>Carry into the next meeting</p>
        {carried.length === 0 ? (
          <p className={`${META} mt-2`}>Nothing carrying forward.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {carried.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 rounded-lg border border-hairline bg-sunken px-3 py-1.5 text-sm"
              >
                <span className="flex-1">{item}</span>
                <button
                  type="button"
                  onClick={() => setCarried((rows) => rows.filter((row) => row !== item))}
                  className={BTN_GHOST}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex gap-2">
          <input
            value={newCarry}
            onChange={(e) => setNewCarry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCarry();
              }
            }}
            className={INPUT}
            placeholder="Add something to carry forward..."
            aria-label="Add carry-forward item"
          />
          <button type="button" onClick={addCarry} className={BTN_SECONDARY}>
            Add
          </button>
        </div>
      </div>
    </WrapUpReviewShell>
  );
}

function uncoveredItems(items: TeamAgendaItem[], outcomes: AgendaOutcome[]): string[] {
  const covered = new Set(outcomes.filter((o) => o.covered).map((o) => o.id));
  return items.filter((item) => !covered.has(item.id)).map((item) => item.item);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}
