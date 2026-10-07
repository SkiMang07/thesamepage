"use client";

// Moving a 1:1's date. One control for every place a 1:1 date shows: the
// prep sheet (step 1 review and the step 2 header), the person page's next
// conversation, and the selected 1:1 in Mission Control's week strip.
//
// Nothing saves while the date is being typed or picked. A date input passes
// through an empty value while a date is typed by keyboard, and blur lands on
// the calendar icon before it leaves the field, so a save on change or blur
// either sent a half-typed date or none at all. Here the new date waits in
// the field until the manager answers the one question that matters:
//
//   repeating 1:1  → "Just this 1:1" or "This and every one after", every time
//   one-off 1:1    → "Save date"
//
// Moving never touches the prep sheet.

import { useEffect, useRef, useState } from "react";
import { updateOneOnOneSchedule, type OneOnOne } from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY } from "@/lib/tokens";

type RecurrenceWeeks = 1 | 2 | 3 | 4;
export type MoveScope = "occurrence" | "series";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayLabel(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export default function MoveOneOnOne({
  sessionId,
  date,
  recurrenceWeeks,
  usualDate,
  onMoved,
  variant = "action",
  inputId,
  label = "Meeting date",
  compact = false,
  actionLabel = "Move",
}: {
  sessionId: string;
  /** The saved date, YYYY-MM-DD, or "" when none is set. */
  date: string;
  recurrenceWeeks: RecurrenceWeeks | number | null | undefined;
  /** The series' usual day when this one 1:1 was moved by itself. */
  usualDate?: string | null;
  onMoved: (saved: OneOnOne) => void;
  /** "field": the date input is always shown. "action": a Move link opens it. */
  variant?: "field" | "action";
  inputId?: string;
  label?: string;
  compact?: boolean;
  actionLabel?: string;
}) {
  const [open, setOpen] = useState(variant === "field");
  const [draft, setDraft] = useState(date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow the saved date when it changes from outside (a save elsewhere, a
  // reload), unless the manager is partway through a move here.
  const lastSaved = useRef(date);
  useEffect(() => {
    if (lastSaved.current !== date) {
      lastSaved.current = date;
      setDraft(date);
    }
  }, [date]);

  const repeats = Boolean(recurrenceWeeks);
  const dirty = draft !== date;
  const valid = DATE_RE.test(draft);
  const clearing = dirty && draft === "" && date !== "";
  const movedAlone = Boolean(usualDate && date && usualDate !== date);

  function cancel() {
    setDraft(date);
    setError(null);
    if (variant === "action") setOpen(false);
  }

  async function save(scope: MoveScope) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMoved(false);
    try {
      const saved = await updateOneOnOneSchedule(sessionId, {
        scheduled_at: draft ? `${draft}T12:00:00.000Z` : null,
        // A cleared date stops the repeat (a repeating 1:1 needs a date).
        // Otherwise the repeat rule is unchanged.
        recurrence_weeks: draft ? ((recurrenceWeeks || null) as RecurrenceWeeks | null) : null,
        timezone: browserTimezone(),
        scope,
      });
      lastSaved.current = (saved.scheduled_at ?? "").slice(0, 10);
      setDraft(lastSaved.current);
      setMoved(true);
      onMoved(saved);
      if (variant === "action") setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not move this 1:1.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      // The prep page's step 1 field sits inside the "build agenda" form.
      e.preventDefault();
      if (dirty && valid && !repeats) void save("series");
    } else if (e.key === "Escape" && dirty) {
      // Undo the typed date only; don't also close the panel around it.
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  useEffect(() => {
    if (open && variant === "action") inputRef.current?.focus();
  }, [open, variant]);

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setMoved(false); setOpen(true); }}
          className="text-xs font-medium text-brand hover:text-brand-hover focus-visible:underline"
        >
          {actionLabel}
        </button>
        {moved && <span className="text-xs text-ink-muted" aria-live="polite">Moved.</span>}
      </span>
    );
  }

  const inputClass = compact
    ? "mt-1 rounded-md border border-control bg-sunken px-2.5 py-1.5 text-sm text-ink-body focus:border-brand focus:outline-none"
    : "mt-2 w-full rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink-body focus:border-brand focus:outline-none";
  const labelClass = compact
    ? "block text-[11px] font-medium uppercase tracking-wide text-ink-muted"
    : "text-sm font-medium text-ink-body";

  return (
    <div className="min-w-0">
      <label className="block">
        <span className={labelClass}>{label}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="date"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setMoved(false); setError(null); }}
          onKeyDown={onKeyDown}
          disabled={saving}
          className={inputClass}
        />
      </label>

      {movedAlone && !dirty && (
        <p className="mt-1 text-xs text-ink-muted">Moved from its usual day, {dayLabel(usualDate!)}.</p>
      )}

      {dirty && (valid || clearing) && (
        <div className="mt-2" role="group" aria-label={repeats && !clearing ? "Which 1:1s move" : "Confirm the date"}>
          {clearing ? (
            <p className="text-xs text-ink-secondary">
              Remove the date{repeats ? ". It stops repeating." : "?"}
            </p>
          ) : repeats ? (
            <p className="text-xs text-ink-secondary">Move to {dayLabel(draft)}. Which 1:1s move?</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {clearing ? (
              <button type="button" disabled={saving} onClick={() => save("series")} className={BTN_SECONDARY}>
                Remove date
              </button>
            ) : repeats ? (
              <>
                <button type="button" disabled={saving} onClick={() => save("occurrence")} className={BTN_PRIMARY_SM}>
                  Just this 1:1
                </button>
                <button type="button" disabled={saving} onClick={() => save("series")} className={BTN_SECONDARY}>
                  This and every one after
                </button>
              </>
            ) : (
              <button type="button" disabled={saving} onClick={() => save("series")} className={BTN_PRIMARY_SM}>
                Save date
              </button>
            )}
            <button type="button" disabled={saving} onClick={cancel} className={BTN_GHOST}>
              Cancel
            </button>
            {saving && <span className="text-xs text-ink-muted">Saving…</span>}
          </div>
        </div>
      )}

      {variant === "action" && !dirty && (
        <button type="button" onClick={cancel} className="mt-1.5 text-xs text-ink-secondary hover:text-ink">
          Cancel
        </button>
      )}
      <p className="text-xs" aria-live="polite">
        {error ? <span className="text-red-700">{error}</span> : moved && !dirty ? <span className="text-ink-muted">Moved.</span> : null}
      </p>
    </div>
  );
}
