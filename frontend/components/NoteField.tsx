"use client";

// ---------------------------------------------------------------------------
// NoteField — the app's textarea, with dictation built in.
//
// WHY THIS EXISTS AT ALL. Before this component there were 33 raw <textarea>
// elements across 15 files, each carrying its own copy-pasted class string —
// the same disease lib/tokens.ts was created to cure for buttons and inputs
// (see that file's header: inputCls was pasted verbatim into 8 files). Adding
// a microphone to "many boxes" meant there was nothing to add it TO. So the
// feature and the missing component are one change: reach for <NoteField>
// wherever a manager writes prose, and dictation comes with it for free.
//
// WHAT DICTATION DOES NOT DO. It does not save, and it does not rewrite. A
// stopped recording is transcribed and inserted verbatim at the caret — no
// model tidies it, summarises it or turns it into bullets, and the field's
// existing Save button is still the only thing that writes to the database.
// That keeps dictation entirely outside the draft-then-review boundary
// instead of punching a new hole in it. Every other AI write in this app is
// reviewed because a model produced text the manager did not say. Here the
// manager said it.
//
// THE UNDO WINDOW. Inserting straight in, with no pause, means the first
// sign of a misheard word used to be finding it later, mixed in with typed
// text. A prior pass fixed that with an explicit confirm/discard card — a
// second textarea the transcript had to sit in first — which read as a form
// appearing to approve text for another form (see useDictation.ts and
// docs/systems/dictation.md for the research that led here). What this does
// instead: the transcript lands in the real field immediately, tinted, with
// `justDictated` holding the value and caret from just before the insert.
// The tint and the "Esc to undo" caption clear on the manager's first
// keystroke or on blur — the moment they've moved on, it's just their text,
// same as anything they typed. Until then, Escape reverts the field to
// exactly what it held before, caret included.
//
// Insert, never replace: a confirmed transcript adds to what's already in
// the field, at the caret it had when recording stopped. Losing typed words
// to a mis-tapped mic would be the one unforgivable bug in this feature.
// ---------------------------------------------------------------------------
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { TEXTAREA } from "@/lib/tokens";
import DictationLevelMeter from "@/components/DictationLevelMeter";
import {
  formatDictationClock,
  isDictationSupported,
  useDictation,
} from "@/lib/useDictation";

const NOTICE_KEY = "tsp:dictation-notice-seen";

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  /** Turn the mic off for a field where talking makes no sense — a paste
   *  target for a job description, say. Defaults on. */
  dictate?: boolean;
  /** Comma-separated names and nouns to bias spelling: direct reports on this
   *  page, product names, team vocabulary. This is what stops "Priya" coming
   *  back as "Prea". Optional and cheap; pass it where the page knows them. */
  vocabulary?: string;
  /** The field's base look, before `className`. Defaults to the TEXTAREA token,
   *  which is what almost every field should use.
   *
   *  It exists because Tailwind resolves conflicts by stylesheet order, not by
   *  the order classes appear in a string — so a caller passing `px-3` in
   *  `className` would still lose to the token's `px-4`. Fields that are
   *  deliberately not the standard field (the Scribe composer sits flush on the
   *  drawer's own surface; the older pages carry a local `inputCls`) pass their
   *  own base here and are unchanged by this component. */
  baseClassName?: string;
};

/** What the field held right before a transcript landed, so Escape can put
 *  it back exactly, caret included. Cleared on the manager's first keystroke
 *  or on blur — see the header comment. */
type JustDictated = { prevValue: string; prevCaret: number };

const MicIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </svg>
);

const StopIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
  </svg>
);

const Spinner = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const NoteField = forwardRef<HTMLTextAreaElement, Props>(function NoteField(
  {
    value,
    onChange,
    dictate = true,
    vocabulary = "",
    className = "",
    baseClassName = TEXTAREA,
    disabled,
    ...rest
  },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, []);

  // Feature detection has to run after mount: MediaRecorder does not exist
  // during SSR, and branching on it during render would hydrate mismatched.
  const [supported, setSupported] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  useEffect(() => setSupported(isDictationSupported()), []);

  const [justDictated, setJustDictated] = useState<JustDictated | null>(null);

  const insert = useCallback(
    (text: string) => {
      const el = innerRef.current;
      const prevValue = value;
      const prevCaret = el ? (el.selectionStart ?? value.length) : value.length;

      if (!el) {
        onChange(value ? `${value.replace(/\s+$/, "")} ${text}` : text);
        setJustDictated({ prevValue, prevCaret });
        return;
      }
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const before = value.slice(0, start);
      const after = value.slice(end);
      // Join with a space unless we're at a clean break already. Dictating into
      // a bulleted list mid-line should not glue words together.
      const joiner = before && !/\s$/.test(before) ? " " : "";
      const next = before + joiner + text + after;
      onChange(next);
      const caret = (before + joiner + text).length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
      setJustDictated({ prevValue, prevCaret: start });
    },
    [value, onChange],
  );

  /** Escape while the tint is still up: put the field back exactly how it
   *  was, caret included, and drop the undo window. */
  const undoDictation = useCallback(() => {
    if (!justDictated) return;
    const { prevValue, prevCaret } = justDictated;
    setJustDictated(null);
    onChange(prevValue);
    const el = innerRef.current;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(prevCaret, prevCaret);
    });
  }, [justDictated, onChange]);

  const {
    state,
    seconds,
    level,
    error,
    clearError,
    toggle,
    cancel,
  } = useDictation({
    onText: insert,
    vocabulary,
  });

  const recording = state === "recording";
  const transcribing = state === "transcribing";
  const starting = state === "starting";

  // Escape cancels a live recording, or undoes a just-landed transcript, and
  // must not bubble — the app shell closes the Scribe drawer on Escape, and a
  // manager hitting Esc to back out of a dictation should not also lose the
  // drawer.
  useEffect(() => {
    if (!recording && !justDictated) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (recording) cancel();
        else undoDictation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [recording, justDictated, cancel, undoDictation]);

  const handleToggle = () => {
    clearError();
    // Starting a new take forfeits any still-open undo window from the last
    // one — one Escape can't sensibly undo two dictations.
    if (justDictated) setJustDictated(null);
    if (state === "idle" && typeof window !== "undefined") {
      try {
        if (!window.localStorage.getItem(NOTICE_KEY)) {
          window.localStorage.setItem(NOTICE_KEY, "1");
          setShowNotice(true);
        }
      } catch {
        /* private mode; the notice is a courtesy, not a gate */
      }
    }
    toggle();
  };

  const micVisible = dictate && supported && !disabled;

  return (
    <div>
      <div className="relative">
        <textarea
          {...rest}
          ref={innerRef}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            // A real keystroke, not our own insert — the field is the
            // manager's again.
            if (justDictated) setJustDictated(null);
          }}
          onBlur={() => setJustDictated(null)}
          style={justDictated ? { backgroundColor: "rgb(var(--c-brand-tint))" } : undefined}
          className={`${baseClassName} ${className} ${micVisible ? "pr-12" : ""} transition-colors duration-300`}
        />

        {micVisible && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {recording && (
              <>
                <DictationLevelMeter level={level} />
                <span
                  className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium tabular-nums text-brand"
                  aria-live="off"
                >
                  {formatDictationClock(seconds)}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={handleToggle}
              disabled={transcribing || starting}
              aria-label={recording ? "Stop dictating" : "Dictate"}
              aria-pressed={recording}
              title={recording ? "Stop (Esc to discard)" : "Dictate"}
              className={
                "relative flex h-8 w-8 items-center justify-center rounded-full transition-colors " +
                "focus:outline-none focus:ring-2 focus:ring-blue-600/40 disabled:cursor-wait " +
                (recording
                  ? "bg-brand text-on-brand hover:bg-brand-hover"
                  : "text-ink-muted hover:bg-sunken hover:text-ink")
              }
            >
              {recording && (
                <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-40 motion-reduce:animate-none" />
              )}
              {transcribing || starting ? (
                <Spinner className="relative h-4 w-4" />
              ) : recording ? (
                <StopIcon className="relative h-4 w-4" />
              ) : (
                <MicIcon className="relative h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>

      {recording && (
        <p className="mt-1 text-xs text-ink-muted">Listening — click to stop, Esc to discard.</p>
      )}
      {transcribing && <p className="mt-1 text-xs text-ink-muted">Transcribing…</p>}
      {justDictated && !error && (
        <p className="mt-1 text-xs text-ink-muted">Inserted — Esc to undo.</p>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {showNotice && !error && (
        <p className="mt-1 text-xs text-ink-muted">
          Your audio is transcribed and discarded. Nothing is recorded or stored, and nothing
          saves until you save it.{" "}
          <button
            type="button"
            onClick={() => setShowNotice(false)}
            className="underline underline-offset-2 hover:text-ink"
          >
            Got it
          </button>
        </p>
      )}
    </div>
  );
});

export default NoteField;
