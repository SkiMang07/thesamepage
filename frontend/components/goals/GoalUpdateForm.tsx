"use client";

// "Add an update" — opens in place on a goal sheet (and in Details). Status,
// then either a measured value (measured goal) or a completion % (unmeasured
// goal), then an optional note. Blank means no new number; 0 is a number.
//
// The draft lives in the page (GoalsPage keeps it per goal), so a failed save
// or an accidental close keeps what was typed. `requestId` is the draft's
// idempotency key: a retry after a network failure re-sends the same key and
// the server returns the row it may already have written instead of saving
// twice. A validation error (4xx) means nothing was written, so the next
// submit gets a fresh key.

import { useEffect, useRef, useState } from "react";
import NoteField from "@/components/NoteField";
import type { Goal, GoalStatus } from "@/lib/api";
import { BTN_PRIMARY_SM, INPUT, LABEL } from "@/lib/tokens";
import { STATUS_LABEL, STATUS_ORDER, formatValue, parseCompletion, parseMeasuredValue, targetText } from "@/lib/goals";

export type UpdateDraft = {
  status: GoalStatus;
  value: string;
  completion: string;
  note: string;
  requestId: string;
};

export function isDraftDirty(d: UpdateDraft, goal: Goal) {
  return d.status !== goal.status || d.value.trim() !== "" || d.completion.trim() !== "" || d.note.trim() !== "";
}

export default function GoalUpdateForm({
  goal,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  vocabulary,
}: {
  goal: Goal;
  draft: UpdateDraft;
  onDraftChange: (d: UpdateDraft) => void;
  onSubmit: (parsed: { status: GoalStatus; value: number | null; completion: number | null; note: string | null }) => Promise<void>;
  onCancel: () => void;
  vocabulary?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const m = goal.measure;

  useEffect(() => {
    statusRef.current?.focus({ preventScroll: true });
  }, []);

  const set = (patch: Partial<UpdateDraft>) => onDraftChange({ ...draft, ...patch });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const value = m ? parseMeasuredValue(draft.value, m.format) : ({ ok: true, value: null } as const);
    const completion = m ? ({ ok: true, value: null } as const) : parseCompletion(draft.completion);
    if (!value.ok) return setError(value.error);
    if (!completion.ok) return setError(completion.error);
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        status: draft.status,
        value: value.value,
        completion: completion.value,
        note: draft.note.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The update wasn't saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const last = goal.latest_reading;
  const fieldId = `goal-${goal.id}-update`;
  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving) {
          e.stopPropagation();
          onCancel();
        }
      }}
      aria-labelledby={`${fieldId}-heading`}
      className="pt-1"
    >
      <h3 id={`${fieldId}-heading`} className="text-base font-semibold text-ink">
        Add an update
      </h3>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${fieldId}-status`} className={LABEL}>
            Status
          </label>
          <select
            id={`${fieldId}-status`}
            ref={statusRef}
            value={draft.status}
            onChange={(e) => set({ status: e.target.value as GoalStatus })}
            className={INPUT}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {m ? (
          <div>
            <label htmlFor={`${fieldId}-value`} className={LABEL}>
              Measured value · optional
            </label>
            <input
              id={`${fieldId}-value`}
              type="number"
              inputMode="decimal"
              step={m.format === "count" ? 1 : "any"}
              min={m.format === "count" ? 0 : undefined}
              value={draft.value}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={last ? `Last: ${formatValue(last.value, m)}` : "No value yet"}
              aria-describedby={`${fieldId}-value-help`}
              className={INPUT}
            />
            <p id={`${fieldId}-value-help`} className="mt-1 text-xs text-ink-muted">
              {m.label} · current target {targetText(m).toLowerCase()}
            </p>
          </div>
        ) : (
          <div>
            <label htmlFor={`${fieldId}-completion`} className={LABEL}>
              Completion % · optional
            </label>
            <input
              id={`${fieldId}-completion`}
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              max={100}
              value={draft.completion}
              onChange={(e) => set({ completion: e.target.value })}
              placeholder={goal.progress != null ? `Last: ${goal.progress}%` : "Leave blank"}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-ink-muted">How much of the work is done, as you judge it.</p>
          </div>
        )}
      </div>
      <div className="mt-4">
        <label htmlFor={`${fieldId}-note`} className={LABEL}>
          Update · optional
        </label>
        <NoteField
          id={`${fieldId}-note`}
          ref={noteRef}
          value={draft.note}
          onChange={(note) => set({ note })}
          rows={3}
          vocabulary={vocabulary}
          placeholder="What changed? What needs a decision?"
        />
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {m
          ? "A blank value keeps the last recorded value and its original date."
          : "A blank percentage keeps the last recorded one and its original date."}
      </p>
      <div role="alert" aria-live="assertive">
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={saving} className={BTN_PRIMARY_SM}>
          {saving ? "Saving..." : "Save update"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="text-sm text-ink-secondary hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
