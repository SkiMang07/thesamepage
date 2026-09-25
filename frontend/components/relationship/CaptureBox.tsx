"use client";

// Keep a thought for the next conversation — one field, one explicit action.
// Saves through the existing capture endpoint: a private between-meetings
// note that waits for source review, not a message and not an agenda item.
// The text clears only after the server confirms; on failure it stays put.

import { useRef, useState } from "react";
import NoteField from "@/components/NoteField";
import { BTN_SECONDARY } from "@/lib/tokens";

export default function CaptureBox({
  personFirstName,
  onSave,
  disabled = false,
}: {
  personFirstName: string;
  /** Resolves when the server has saved it; rejects with a readable error. */
  onSave: (content: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous guard against a double click or ⌘↵ + click racing.
  const inFlight = useRef(false);

  async function keep() {
    const content = text.trim();
    if (!content || inFlight.current || disabled) return;
    inFlight.current = true;
    setState("saving");
    setError(null);
    try {
      await onSave(content);
      setText("");
      setState("saved");
      fieldRef.current?.focus();
    } catch {
      // The raw API error isn't useful here; what matters is that nothing
      // was saved and the text is still in the field.
      setState("failed");
      setError("Couldn't keep that. Your text is still here — try again.");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="mt-6">
      <label htmlFor="keep-thought" className="text-sm text-ink">
        Keep a thought for the next conversation
      </label>
      <NoteField
        id="keep-thought"
        ref={fieldRef}
        value={text}
        onChange={(v) => {
          setText(v);
          if (state === "saved") setState("idle");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            keep();
          }
        }}
        rows={3}
        placeholder="A question, a moment, something to come back to…"
        className="mt-2 text-sm"
        disabled={disabled}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted" aria-live="polite">
          {state === "saving"
            ? "Keeping…"
            : state === "saved"
              ? "Kept. It's waiting in your source review."
              : state === "failed"
                ? <span className="text-red-700">{error}</span>
                : `Private · Reviewed before it becomes prep · Nothing is sent to ${personFirstName}`}
        </p>
        <button
          type="button"
          onClick={keep}
          disabled={disabled || state === "saving" || !text.trim()}
          className={BTN_SECONDARY}
        >
          {state === "saving" ? "Keeping…" : "Keep for next 1:1"}
        </button>
      </div>
    </div>
  );
}
