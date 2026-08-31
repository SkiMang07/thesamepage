"use client";

// ---------------------------------------------------------------------------
// Global dictation — ⌘⇧Space (Ctrl+Shift+Space) dictates into whatever text
// field is focused, anywhere in the app.
//
// This is the half of talk-to-text that makes it an INPUT METHOD rather than a
// button on some fields. NoteField's mic is the discoverable affordance; this
// is the one that works in the fields NoteField hasn't reached, in the fields
// it deliberately never will (a role title, a goal name), and for anyone who
// would rather not move their hands off the keyboard mid-thought.
//
// WHY THIS KEY. ⌘J already summons the Scribe, so dictation stays in the same
// single-modifier family. ⌘⇧D and ⌘⇧M were the obvious picks and both are
// taken at the BROWSER level on at least one major platform (bookmark-all-tabs,
// switch-profile) where preventDefault cannot reach them. ⌘⇧Space is unbound in
// Chrome, Firefox and Safari on every platform, and unbound in stock macOS
// (Cmd+Space is Spotlight, Ctrl+Space is input source — neither is this).
//
// It writes through insertAtCaret(), which drives the field's native value
// setter and dispatches a bubbling `input` event, so a React-controlled field
// updates its own state exactly as if the manager had typed. That means this
// works uniformly on NoteFields and on plain <textarea>s that know nothing
// about dictation.
//
// THE REVIEW STEP. Same `useDictation` hook as NoteField, so a stopped
// recording lands in `state === "reviewing"` here too instead of inserting
// immediately. But this path types into a field it doesn't own — it can't
// assume there's room for a review card next to whatever's focused (could be
// a one-line title input). So the review happens right here in this pill:
// the floating status readout becomes an editable DictationReview card, and
// `insertAtCaret` only runs once the manager confirms it.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import DictationLevelMeter from "@/components/DictationLevelMeter";
import DictationReview from "@/components/DictationReview";
import {
  formatDictationClock,
  insertAtCaret,
  isDictationSupported,
  useDictation,
} from "@/lib/useDictation";

type Target = HTMLTextAreaElement | HTMLInputElement;

const DICTATABLE_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", ""]);

function focusedTextField(): Target | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  if (el instanceof HTMLTextAreaElement) return el.disabled || el.readOnly ? null : el;
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (!DICTATABLE_INPUT_TYPES.has(type)) return null;
    return el.disabled || el.readOnly ? null : el;
  }
  return null;
}

export default function DictationHotkey() {
  const [supported, setSupported] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // The field that was focused when recording started. Captured up front
  // because focus can move (or be lost to the button) before the transcript
  // comes back a second or two later — or before the manager finishes
  // reviewing it.
  const targetRef = useRef<Target | null>(null);

  useEffect(() => setSupported(isDictationSupported()), []);

  const onText = useCallback((text: string) => {
    const el = targetRef.current;
    targetRef.current = null;
    if (!el || !el.isConnected) {
      setHint("That field is gone — nothing was inserted.");
      return;
    }
    el.focus();
    insertAtCaret(el, text);
  }, []);

  const {
    state,
    seconds,
    level,
    pendingText,
    setPendingText,
    error,
    clearError,
    start,
    stop,
    cancel,
    confirmReview,
    discardReview,
  } = useDictation({ onText });

  const recording = state === "recording";
  const transcribing = state === "transcribing";
  const reviewing = state === "reviewing";

  // The pill is the only place a global-dictation error can appear, and it
  // has no dismiss affordance by design (it must not steal a click from the
  // field underneath). So it clears itself.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => clearError(), 5000);
    return () => window.clearTimeout(t);
  }, [error, clearError]);

  useEffect(() => {
    if (!supported) return;

    const onKey = (e: KeyboardEvent) => {
      // Escape while recording discards the recording; while reviewing it
      // discards the pending transcript instead. Either way it must not also
      // reach the app shell (which closes the Scribe drawer on Escape).
      if (e.key === "Escape" && (recording || reviewing)) {
        e.preventDefault();
        e.stopPropagation();
        if (recording) cancel();
        else discardReview();
        return;
      }

      const combo = (e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === "Space" || e.key === " ");
      if (!combo) return;
      e.preventDefault();

      if (recording) {
        stop();
        return;
      }
      if (state !== "idle") return;

      const target = focusedTextField();
      if (!target) {
        setHint("Click into a text box first, then try again.");
        window.setTimeout(() => setHint(null), 3000);
        return;
      }
      clearError();
      setHint(null);
      targetRef.current = target;
      void start();
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [supported, state, recording, reviewing, start, stop, cancel, discardReview, clearError]);

  const message = error || hint;
  if (!supported || (state === "idle" && !message)) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      {reviewing ? (
        <div className="pointer-events-auto w-full max-w-md">
          <DictationReview
            text={pendingText}
            onChange={setPendingText}
            onConfirm={confirmReview}
            onDiscard={discardReview}
          />
        </div>
      ) : (
        <div
          className={
            "pointer-events-auto flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm shadow-lg " +
            (error
              ? "border-hairline bg-elevated text-red-700"
              : recording
                ? "border-brand bg-elevated text-ink"
                : "border-hairline bg-elevated text-ink-body")
          }
        >
          {recording && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
            </span>
          )}

          {message ? (
            <span>{message}</span>
          ) : recording ? (
            <>
              <DictationLevelMeter level={level} />
              <span className="tabular-nums">{formatDictationClock(seconds)}</span>
              <span className="text-ink-muted">Listening</span>
              <button
                type="button"
                onClick={stop}
                className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-on-brand hover:bg-brand-hover"
              >
                Stop
              </button>
              <span className="text-xs text-ink-faint">Esc to discard</span>
            </>
          ) : transcribing ? (
            <span className="text-ink-muted">Transcribing…</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
