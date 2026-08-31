"use client";

import { useEffect, useRef } from "react";

type Props = {
  text: string;
  onChange: (text: string) => void;
  onConfirm: () => void;
  onDiscard: () => void;
};

// ---------------------------------------------------------------------------
// The pause between "stopped talking" and "words land in the field".
//
// Dictation stays outside draft-then-review — no model ever touches this
// text (see docs/systems/dictation.md) — so this is not that boundary's
// review step. It's a human checkpoint: the manager sees what was heard, can
// fix a misheard word or an odd line break themselves, and only then
// confirms or discards. Confirming still just fires the same `onText` the
// hook always called immediately; this component only changes *when* that
// happens, never what happens or who wrote it.
//
// Shared by NoteField (anchored at the field it owns) and DictationHotkey
// (anchored in its floating pill, since it types into fields it doesn't own)
// so both entry points behave identically instead of drifting into two
// different dictation experiences.
// ---------------------------------------------------------------------------
export default function DictationReview({ text, onChange, onConfirm, onDiscard }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Autofocus with the caret at the end, so fixing one word doesn't need a
  // click first. Mount-only: re-focusing on every keystroke would fight the
  // manager for the caret while they're editing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onConfirm();
    }
    // Escape is deliberately NOT handled here. NoteField and DictationHotkey
    // each already run a document-level, capture-phase Escape listener
    // while a mic interaction is live, so it can pre-empt the app shell's
    // own Escape-closes-the-Scribe-drawer handler. A local handler here
    // would either double-fire or lose that race depending on phase order.
  };

  return (
    <div className="w-full max-w-md rounded-lg border border-hairline bg-elevated p-2 shadow-lg">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={Math.min(6, Math.max(2, text.split("\n").length))}
        className="w-full resize-none rounded-md border border-hairline bg-surface p-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue-600/40"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-faint">⌘⏎ to insert · Esc to discard</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-sunken hover:text-ink"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!text.trim()}
            className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
