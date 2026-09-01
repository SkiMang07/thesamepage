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
// THE UNDO WINDOW. Same idea as NoteField (see useDictation.ts for why this
// replaced an explicit review card): a stopped recording inserts immediately,
// and this pill tracks the field's pre-insert value and caret in
// `justDictated` so Escape can put it back — through the same native-setter
// path insertAtCaret used to put it in, since this component doesn't own the
// field's React state either. A native `input` listener on the target field
// (attached only after our own insert has already dispatched its event, so it
// never catches its own write) clears the tint the moment the manager types
// into it themselves; a `blur` listener clears it if they click away instead.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import DictationLevelMeter from "@/components/DictationLevelMeter";
import {
  formatDictationClock,
  insertAtCaret,
  isDictationSupported,
  setNativeFieldValue,
  useDictation,
} from "@/lib/useDictation";

type Target = HTMLTextAreaElement | HTMLInputElement;

const DICTATABLE_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", ""]);

/** What a target field held right before a transcript landed in it, so
 *  Escape can write it back exactly, caret included. */
type JustDictated = { el: Target; prevValue: string; prevCaret: number };

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
  // comes back a second or two later.
  const targetRef = useRef<Target | null>(null);
  const [justDictated, setJustDictated] = useState<JustDictated | null>(null);

  useEffect(() => setSupported(isDictationSupported()), []);

  const onText = useCallback((text: string) => {
    const el = targetRef.current;
    targetRef.current = null;
    if (!el || !el.isConnected) {
      setHint("That field is gone — nothing was inserted.");
      return;
    }
    el.focus();
    const prevValue = el.value;
    const prevCaret = el.selectionStart ?? prevValue.length;
    insertAtCaret(el, text);
    setJustDictated({ el, prevValue, prevCaret });
    setHint("Inserted — Esc to undo.");
  }, []);

  const { state, seconds, level, error, clearError, start, stop, cancel } = useDictation({
    onText,
  });

  const recording = state === "recording";
  const transcribing = state === "transcribing";

  // The pill is the only place a global-dictation error can appear, and it
  // has no dismiss affordance by design (it must not steal a click from the
  // field underneath). So it clears itself.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => clearError(), 5000);
    return () => window.clearTimeout(t);
  }, [error, clearError]);

  // While a transcript is sitting tinted in its field, watch that field for
  // the manager's own next move: type into it and the undo window is gone
  // (it's their edit now), click away and the same thing happens. Attached
  // in an effect, which runs after insertAtCaret's own dispatched `input`
  // event has already fired, so it never clears itself the instant it lands.
  useEffect(() => {
    if (!justDictated) return;
    const { el } = justDictated;
    const clear = () => {
      setJustDictated(null);
      setHint(null);
    };
    el.addEventListener("input", clear);
    el.addEventListener("blur", clear);
    return () => {
      el.removeEventListener("input", clear);
      el.removeEventListener("blur", clear);
    };
  }, [justDictated]);

  useEffect(() => {
    if (!supported) return;

    const onKey = (e: KeyboardEvent) => {
      // Escape while recording discards the take; while a transcript is
      // still tinted it undoes the insert instead. Either way it must not
      // also reach the app shell (which closes the Scribe drawer on Escape).
      if (e.key === "Escape" && (recording || justDictated)) {
        e.preventDefault();
        e.stopPropagation();
        if (recording) {
          cancel();
        } else if (justDictated) {
          setNativeFieldValue(justDictated.el, justDictated.prevValue, justDictated.prevCaret);
          justDictated.el.focus();
          setJustDictated(null);
          setHint(null);
        }
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
      // A new take forfeits any still-open undo window from the last one.
      if (justDictated) setJustDictated(null);
      setHint(null);
      targetRef.current = target;
      void start();
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [supported, state, recording, justDictated, start, stop, cancel, clearError]);

  const message = error || hint;
  if (!supported || (state === "idle" && !message)) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
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
    </div>
  );
}
