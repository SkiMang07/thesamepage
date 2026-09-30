"use client";

// ---------------------------------------------------------------------------
// AttachFile — a button beside a NoteField that puts a file's text into it.
//
// A manager who records or transcribes their calls (Granola, Gemini, Zoom
// captions, a Word doc of notes) should not have to open the file, select all,
// copy and come back. This reads the file on the server and adds its text to
// the field they are already writing in.
//
// WHAT IT DOES NOT DO. It does not save, and no model reads the file here. The
// text lands in the manager's own field as plain text, and the field's
// existing button is still what drafts or saves. That keeps it outside
// draft-then-review, the same boundary dictation sits on: the words are the
// manager's material, not something a model wrote. Nothing is uploaded to
// storage and the server does not keep the text
// (backend/routes/file_text.py).
//
// Add, never replace: the text goes after whatever is already in the field,
// and "Undo" puts the field back exactly as it was until the next edit.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import { ApiError, extractFileText } from "@/lib/api";
import { BTN_SECONDARY, ERROR_TEXT, META } from "@/lib/tokens";

const ACCEPT =
  ".docx,.pdf,.txt,.md,.vtt,.srt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/vtt";

type Added = { name: string; before: string; after: string; truncated: boolean };

export default function AttachFile({
  value,
  onChange,
  surface,
  disabled,
  label = "Attach a transcript or file",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Which screen this is, for the count-only usage event. */
  surface: "one_on_one_notes" | "team_meeting_notes" | "beyond_meeting_notes";
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The read takes a moment; the manager may keep typing. Join against what
  // the field holds when the text arrives, not when the file was chosen.
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same file again should still fire
    if (!file) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const result = await extractFileText(file, surface);
      const before = valueRef.current;
      const after = before.trim() ? `${before.trimEnd()}\n\n${result.text}` : result.text;
      valueRef.current = after;
      onChange(after);
      setAdded({ name: result.name, before, after, truncated: result.truncated });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.detail : "Couldn’t read that file. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Undo is offered only while the field still holds exactly what this added.
  const canUndo = added !== null && value === added.after;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          className={BTN_SECONDARY}
        >
          {busy ? "Reading…" : label}
        </button>
        <span className={META}>Word, PDF, text, or a .vtt / .srt captions file</span>
      </div>
      <div aria-live="polite">
        {added && (
          <p className={`${META} mt-1.5`}>
            Added {added.name}.{" "}
            {added.truncated && "It was long, so only the first part was added. "}
            {canUndo && (
              <button
                type="button"
                onClick={() => {
                  valueRef.current = added.before;
                  onChange(added.before);
                  setAdded(null);
                }}
                className="text-ink-secondary underline hover:text-ink"
              >
                Undo
              </button>
            )}
          </p>
        )}
        {error && <p className={`${ERROR_TEXT} mt-1.5`}>{error}</p>}
      </div>
    </div>
  );
}
