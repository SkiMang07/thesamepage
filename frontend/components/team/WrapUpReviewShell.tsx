"use client";

// ---------------------------------------------------------------------------
// The shared body of every meeting wrap-up review: summary, commitments with
// an owner picker, and the Back / Save footer. Team meetings
// (MeetingWrapUpReview.tsx) and meetings beyond the team
// (app/app/beyond/BeyondWrapUpReview.tsx) both render this, each adding its
// own sections as children, so the rule that must not drift lives in one
// place:
//
//   NOTHING IS WRITTEN UNTIL THE MANAGER CONFIRMS.
//
// The shell is controlled and never saves. Each caller owns its state and
// its save call, because what a confirmed wrap-up writes differs per meeting
// type — but what the manager sees and edits before it does, doesn't.
// ---------------------------------------------------------------------------

import { ReactNode } from "react";
import NoteField from "@/components/NoteField";
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
} from "@/lib/tokens";

// owner is an opaque key the caller defines. "" always means "You" — a null
// owner is the manager's own commitment, not a missing value
// (docs/decisions/nullable-commitment-owner.md).
export type ReviewCommitment = { description: string; owner: string; due_date: string | null };

export type OwnerOption = { value: string; label: string };
export type OwnerGroup = { label: string | null; options: OwnerOption[] };

export default function WrapUpReviewShell({
  summary,
  onSummaryChange,
  summaryPlaceholder,
  commitments,
  onCommitmentsChange,
  ownerGroups,
  commitmentsTitle,
  unresolvedOwnerLabel = "Pick who owes this",
  saving,
  error,
  canSave,
  saveLabel,
  onBack,
  onSave,
  children,
}: {
  summary: string;
  onSummaryChange: (value: string) => void;
  summaryPlaceholder: string;
  commitments: ReviewCommitment[];
  onCommitmentsChange: (rows: ReviewCommitment[]) => void;
  ownerGroups: OwnerGroup[];
  commitmentsTitle: string;
  unresolvedOwnerLabel?: string;
  saving: boolean;
  error: string | null;
  canSave: boolean;
  saveLabel: string;
  onBack: () => void;
  onSave: () => void;
  children?: ReactNode;
}) {
  // INPUT/SELECT carry w-full; the owner and date controls sit on one row,
  // so their width overrides are marked important (!w-auto) — without it
  // w-full won and every control stacked full-width.
  const known = new Set(["", ...ownerGroups.flatMap((g) => g.options.map((o) => o.value))]);

  function update(index: number, patch: Partial<ReviewCommitment>) {
    onCommitmentsChange(commitments.map((row, i) => (i === index ? { ...row, ...patch } : row)));
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
          onChange={onSummaryChange}
          rows={4}
          className="text-sm"
          placeholder={summaryPlaceholder}
        />
        {!summary.trim() && (
          <p className={`${META} mt-1`}>
            A summary is required — write one if the draft came back empty.
          </p>
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className={EYEBROW}>{commitmentsTitle}</p>
          <button
            type="button"
            onClick={() => onCommitmentsChange([...commitments, { description: "", owner: "", due_date: null }])}
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
                  onChange={(e) => update(i, { description: e.target.value })}
                  className={`${INPUT} bg-surface`}
                  placeholder="What was agreed..."
                  aria-label="Commitment"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={c.owner}
                    onChange={(e) => update(i, { owner: e.target.value })}
                    className={`${SELECT} !w-auto max-w-56 bg-surface`}
                    aria-label="Owner"
                  >
                    {!known.has(c.owner) && (
                      <option value={c.owner} disabled>
                        {unresolvedOwnerLabel}
                      </option>
                    )}
                    <option value="">You</option>
                    {ownerGroups.map((group, g) =>
                      group.label ? (
                        <optgroup key={g} label={group.label}>
                          {group.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                        group.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))
                      )
                    )}
                  </select>
                  <input
                    type="date"
                    value={c.due_date ?? ""}
                    onChange={(e) => update(i, { due_date: e.target.value || null })}
                    className={`${INPUT} !w-auto bg-surface`}
                    aria-label="Due date"
                  />
                  <button
                    type="button"
                    onClick={() => onCommitmentsChange(commitments.filter((_, j) => j !== i))}
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

      {children}

      {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onBack} className={BTN_SECONDARY} disabled={saving}>
          Back to notes
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !canSave || !summary.trim()}
          className={BTN_PRIMARY_SM}
        >
          {saving ? "Saving..." : saveLabel}
        </button>
      </div>
    </div>
  );
}
