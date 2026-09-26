"use client";

// "+ Add a thought" — option A's shortcut from the continuity card into the
// next conversation's private prep. The thought is saved on that upcoming
// meeting, shows beside its carried topics, and goes into prep when the
// manager prepares. It is not an agreed commitment, and nothing is sent.

import { useState } from "react";
import { BeyondPrepItem, addBeyondPrepItem } from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, ERROR_TEXT, META, TEXTAREA } from "@/lib/tokens";
import { dayShort } from "@/app/app/beyond/shared";

export default function ThoughtBox({
  meetingId,
  meetingDate,
  withLabel,
  onSaved,
  compact = false,
}: {
  meetingId: string;
  meetingDate: string | null;
  // "Priya" or "Launch sync" — who or what the conversation is.
  withLabel: string;
  onSaved: (item: BeyondPrepItem) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BeyondPrepItem | null>(null);
  const when = meetingDate ? `${dayShort(meetingDate)} conversation` : "next conversation";

  async function save() {
    const value = text.trim();
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      const { item } = await addBeyondPrepItem(meetingId, { text: value });
      setSaved(item);
      setText("");
      setOpen(false);
      onSaved(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that thought");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className={compact ? "" : "min-w-0"}>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSaved(null);
          }}
          className="text-sm text-brand hover:text-brand-hover"
        >
          + Add a thought
        </button>
        {saved && (
          <p className={`${META} mt-1`} role="status">
            Saved to your {when} with {withLabel}. It shows beside carried topics and goes into prep. Private — nothing
            was sent.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg bg-sunken p-3">
      <label className="block text-sm font-medium text-ink" htmlFor={`thought-${meetingId}`}>
        For your {when} with {withLabel}
      </label>
      <textarea
        id={`thought-${meetingId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        rows={2}
        maxLength={500}
        autoFocus
        className={`${TEXTAREA} mt-2 text-sm`}
        placeholder="Something you want to raise next time"
      />
      {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={saving || !text.trim()} className={BTN_PRIMARY_SM}>
          {saving ? "Saving..." : "Save to meeting prep"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={BTN_GHOST}>
          Cancel
        </button>
        <span className={META}>Private · Not an agreed commitment · Nothing is sent</span>
      </div>
    </div>
  );
}
