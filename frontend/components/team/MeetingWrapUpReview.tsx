"use client";

// ---------------------------------------------------------------------------
// Team meeting wrap-up review (2026-08-24)
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
import NoteField from "@/components/NoteField";
import {
  TeamAgendaItem,
  TeamMeeting,
  TeamMeetingDraftCommitment,
  TeamMeetingWrapUpDraft,
  logTeamMeeting,
} from "@/lib/api";
import {
  BTN_GHOST,
  BTN_PRIMARY_SM,
  BTN_SECONDARY,
  ERROR_TEXT,
  EYEBROW,
  INPUT,
  LABEL,
  META,
  SELECT,
  TEXTAREA,
} from "@/lib/tokens";

export type AgendaOutcome = { id: string; covered: boolean; notes: string };

export type WrapUpResult = { meeting: TeamMeeting; next_meeting: TeamMeeting | null };

export default function MeetingWrapUpReview({
  meeting,
  members,
  rawNotes,
  draft,
  outcomes,
  onBack,
  onSaved,
}: {
  meeting: TeamMeeting;
  members: { id: string; name: string }[];
  rawNotes: string;
  draft: TeamMeetingWrapUpDraft;
  outcomes: AgendaOutcome[];
  onBack: () => void;
  onSaved: (result: WrapUpResult) => void;
}) {
  const [summary, setSummary] = useState(draft.summary);
  const [commitments, setCommitments] = useState<TeamMeetingDraftCommitment[]>(draft.commitments);
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

  function updateCommitment(index: number, patch: Partial<TeamMeetingDraftCommitment>) {
    setCommitments((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

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
            direct_report_id: c.direct_report_id,
            due_date: c.due_date || null,
          })),
        carryForwardItems: carried,
      });
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save meeting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className={EYEBROW}>Review before saving</p>
        <p className={META}>Nothing is saved until you confirm</p>
      </div>

      <div className="mt-3">
        <label className={LABEL} htmlFor="wrapup-summary">
          Summary
        </label>
        <NoteField
          id="wrapup-summary"
          value={summary}
          onChange={setSummary}
          rows={4}
          className="text-sm"
          placeholder="What the team actually covered..."
        />
        {!summary.trim() && (
          <p className={`${META} mt-1`}>
            A summary is required — write one if the draft came back empty.
          </p>
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className={EYEBROW}>Team commitments</p>
          <button
            type="button"
            onClick={() =>
              setCommitments((rows) => [
                ...rows,
                { description: "", direct_report_id: null, due_date: null },
              ])
            }
            className={BTN_GHOST}
          >
            Add
          </button>
        </div>
        {commitments.length === 0 ? (
          <p className={`${META} mt-2`}>No commitments came out of this meeting.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {commitments.map((c, i) => (
              <li key={i} className="rounded-lg border border-hairline bg-sunken px-3 py-2">
                <input
                  value={c.description}
                  onChange={(e) => updateCommitment(i, { description: e.target.value })}
                  className={`${INPUT} bg-surface`}
                  placeholder="What was agreed..."
                  aria-label="Commitment"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={c.direct_report_id ?? ""}
                    onChange={(e) => updateCommitment(i, { direct_report_id: e.target.value || null })}
                    className={`${SELECT} w-auto bg-surface`}
                    aria-label="Owner"
                  >
                    {/* Null owner is a real answer, not a missing one — plenty
                        of what comes out of a team meeting is the manager's. */}
                    <option value="">You</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={c.due_date ?? ""}
                    onChange={(e) => updateCommitment(i, { due_date: e.target.value || null })}
                    className={`${INPUT} w-auto bg-surface`}
                    aria-label="Due date"
                  />
                  <button
                    type="button"
                    onClick={() => setCommitments((rows) => rows.filter((_, j) => j !== i))}
                    className={`${BTN_GHOST} ml-auto`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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

      {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onBack} className={BTN_SECONDARY} disabled={saving}>
          Back to notes
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !summary.trim()}
          className={BTN_PRIMARY_SM}
        >
          {saving ? "Saving..." : "Save meeting"}
        </button>
      </div>
    </div>
  );

  function addCarry() {
    const text = newCarry.trim();
    if (!text) return;
    setCarried((rows) => dedupe([...rows, text]));
    setNewCarry("");
  }
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
