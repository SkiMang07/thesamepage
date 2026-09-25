"use client";

// ---------------------------------------------------------------------------
// "Add something to discuss…" — one line onto a planned meeting's agenda.
//
// The point is that capturing a thought costs nothing: type, press Enter,
// keep typing. So the rules are about trust, not ceremony:
//   - it says "Added" only after the server has the row, never before;
//   - a failed save keeps the text in the box and says so;
//   - it can't double-submit (the button and Enter are locked while saving);
//   - a line already on the agenda isn't sent at all;
//   - it only ever appends one item (addTeamMeetingAgendaItem), so the items
//     already there keep their ids — and the notes the meeting screen holds
//     against those ids — intact.
// A logged meeting's agenda is frozen; callers don't render this for one, and
// the server refuses it anyway.
//
// No person/work association: agenda items have no column for one yet (see
// docs/systems/team.md → Meeting preparation), and a capture that required
// one would stop being a capture.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { ApiError, TeamAgendaItem, TeamMeeting, addTeamMeetingAgendaItem } from "@/lib/api";

type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; text: string }
  | { kind: "duplicate"; text: string }
  | { kind: "error"; message: string };

export default function AgendaCapture({
  meeting,
  onAdded,
  seed,
  onSeedConsumed,
  compact = false,
}: {
  meeting: TeamMeeting;
  onAdded: (item: TeamAgendaItem) => void;
  /** Wording offered by preparation ("Add to agenda"). It fills the box for
   *  the manager to edit and confirm; it is never saved on its own. */
  seed?: string | null;
  onSeedConsumed?: () => void;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  // A different meeting is a different agenda: drop anything half-typed for
  // the previous one rather than risk adding it to this one.
  useEffect(() => {
    setText("");
    setState({ kind: "idle" });
  }, [meeting.id]);

  useEffect(() => {
    if (!seed) return;
    setText(seed);
    setState({ kind: "idle" });
    inputRef.current?.focus();
    onSeedConsumed?.();
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Added" fades back to the resting hint after a few seconds.
  useEffect(() => {
    if (state.kind !== "saved" && state.kind !== "duplicate") return;
    const timer = setTimeout(() => setState({ kind: "idle" }), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  async function submit() {
    const value = text.trim();
    if (!value || inFlight.current) return;
    if (meeting.agenda_items.some((i) => i.item.trim().toLowerCase() === value.toLowerCase())) {
      setState({ kind: "duplicate", text: value });
      setText("");
      return;
    }
    inFlight.current = true;
    setState({ kind: "saving" });
    try {
      const { item, created } = await addTeamMeetingAgendaItem(meeting.id, value);
      if (created) onAdded(item);
      setText("");
      setState(created ? { kind: "saved", text: item.item } : { kind: "duplicate", text: item.item });
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 409
          ? "This meeting has been logged, so its agenda can't change. Your text is still here."
          : e instanceof ApiError && e.status === 422
            ? `${e.detail}. Your text is still here.`
            : "Couldn't add that. Your text is still here — try again.";
      setState({ kind: "error", message });
    } finally {
      inFlight.current = false;
      inputRef.current?.focus();
    }
  }

  const saving = state.kind === "saving";
  const inputId = `agenda-capture-${meeting.id}`;

  return (
    <div className={compact ? "" : "mt-3"}>
      <label htmlFor={inputId} className="sr-only">
        Add something to discuss
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (state.kind === "error") setState({ kind: "idle" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={500}
          placeholder="Add something to discuss…"
          aria-describedby={`${inputId}-status`}
          className="min-w-0 flex-1 rounded-md border border-control bg-sunken/80 px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-600/40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={saving || !text.trim()}
          className="shrink-0 rounded-md border border-control px-3 py-2 text-sm font-medium text-ink-body hover:border-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
      <p
        id={`${inputId}-status`}
        aria-live="polite"
        className={`mt-1.5 min-h-[1rem] text-2xs ${state.kind === "error" ? "text-amber-700" : state.kind === "saved" ? "text-brand" : "text-ink-muted"}`}
      >
        {state.kind === "saving" && "Saving to the agenda…"}
        {state.kind === "saved" && `Added to the agenda: “${state.text}”`}
        {state.kind === "duplicate" && `Already on the agenda: “${state.text}”`}
        {state.kind === "error" && state.message}
        {state.kind === "idle" && "Press Enter to add. It saves straight to this meeting's agenda."}
      </p>
    </div>
  );
}
