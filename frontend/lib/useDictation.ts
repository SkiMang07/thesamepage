"use client";

// ---------------------------------------------------------------------------
// Dictation — the browser half of talk-to-text.
//
// Records with MediaRecorder, stops, uploads once, and inserts the transcript
// straight into the field. Batch, not streaming: a manager taps stop and
// waits a second or two, and OpenAI's realtime endpoint costs 3.8x the batch
// one for a latency win nobody asked for in a text box.
//
// AN UNDO WINDOW, NOT A REVIEW STEP. A prior pass gated insertion behind an
// explicit confirm/discard card — a second, editable `<textarea>` in its own
// bordered panel that the transcript had to sit in before it was allowed
// into the real field. It worked, but it read as a form appearing to approve
// text for another form. None of the products this app took cues from does
// that (see the research note in docs/systems/dictation.md): macOS, iOS and
// Gboard stream straight into the cursor with no stop moment at all; Wispr
// Flow is batch, same tradeoff as here, and still inserts directly with zero
// visible intermediate state. Even ChatGPT's old show-it-before-sending
// behaviour — the closest any reference product came to a gate — put the
// editable text in the SAME box it was about to send from, never a second
// one bolted on top of it.
//
// So this hook is back to firing `onText` once, immediately, the moment a
// transcript comes back — exactly like the first thing this feature ever
// shipped. The human checkpoint didn't go away; it moved from "a card you
// must dismiss" to "a few seconds where the just-inserted text is tinted and
// Escape undoes it," and that logic now lives with each caller (NoteField,
// DictationHotkey) rather than in this hook, because "undo" means something
// different for a field this component controls (`onChange` back to the
// prior value) than for a field it doesn't (writing the prior value back
// through the native setter, via `setNativeFieldValue` below).
//
// THE LEVEL METER. Not a partial transcript — that stays off the table for
// the same cost reason as streaming. It's a cheap Web Audio AnalyserNode
// read off the live MediaStream, entirely client-side, that answers one
// question while you're mid-sentence with no other feedback: is the mic
// actually hearing me. No network call, no cost, nothing that touches the
// "audio is transcribed and discarded" promise this feature makes.
//
// THE BROWSER GOTCHAS THIS FILE EXISTS TO ABSORB:
//
//  1. Safari below 18.4 cannot do webm at all — it gives audio/mp4 (AAC).
//     Worse, iOS has shipped builds where isTypeSupported() returns true and
//     then start() throws NotSupportedError anyway. So the mime type is chosen
//     by trying candidates in order AND the constructor sits in a try/catch.
//     Never UA-sniff; feature-detect and be ready for the detection to lie.
//
//  2. The default bitrate is ~128kbps, which makes an hour ~57MB. We ask for
//     32kbps mono, the Xiph recommendation for speech, which is ~14MB/hour and
//     stays far inside every upload limit. Safari ignores the hint, hence the
//     generous server-side ceiling rather than a tight one.
//
//  3. getUserMedia needs HTTPS and a user gesture. It is called on click, never
//     on mount, and the resulting tracks are stopped explicitly on every exit
//     path — a live track leaves the browser's recording indicator lit, which
//     in a product about private notes is exactly the wrong thing to leave on.
//
//  4. iOS suspends audio capture when Safari backgrounds or the screen locks.
//     For dictation (seconds, screen on, thumb on the button) that is tolerable
//     where it would not be for call recording; a hard cap plus the fact that
//     the blob is only uploaded on an explicit stop keeps the failure honest.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, transcribeAudio } from "./api";

export type DictationState = "idle" | "starting" | "recording" | "transcribing";

/** Hard stop. Matches the backend's 5-minute ceiling. A dictation is a person
 *  talking into a text box; anything longer is a recording, which is a
 *  different product decision entirely (see docs/systems/dictation.md). */
export const MAX_DICTATION_SECONDS = 300;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus", // Chrome, Edge, Firefox, Safari 18.4+
  "audio/webm",
  "audio/mp4", // Safari < 18.4
  "", // let the browser pick, and hope
];

const NO_SPEECH_MESSAGE = "Didn't catch anything.";

export function isDictationSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function pickMimeType(): string {
  for (const type of MIME_CANDIDATES) {
    if (!type) return "";
    try {
      if (window.MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* isTypeSupported itself can throw on old WebKit */
    }
  }
  return "";
}

type Options = {
  /** Called with the transcript, once, immediately when transcription
   *  finishes. Never called with an empty string, and never called on
   *  failure. */
  onText: (text: string) => void;
  /** Comma-separated names/nouns to bias spelling (direct reports, products). */
  vocabulary?: string;
};

export function useDictation({ onText, vocabulary = "" }: Options) {
  const [state, setState] = useState<DictationState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);
  const elapsedRef = useRef(0);
  // onText can be an inline closure; keep the latest without re-binding the
  // recorder's onstop handler mid-recording.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const vocabRef = useRef(vocabulary);
  vocabRef.current = vocabulary;

  // The level meter's own plumbing: an AudioContext + an rAF loop, kept
  // separate from the MediaRecorder refs above since it has its own
  // lifecycle and must not be confused with the recorder's.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelRafRef = useRef<number | null>(null);

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    analyserRef.current = null;
    levelDataRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {
        /* already closed, or the browser refused — nothing to do about it */
      });
      audioCtxRef.current = null;
    }
    setLevel(0);
  }, []);

  // Best-effort. A manager should never lose dictation because their browser
  // doesn't like AnalyserNode — the meter is cosmetic, recording is not.
  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtxCtor) return;
      const audioCtx = new AudioCtxCtor();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      levelDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        const a = analyserRef.current;
        const data = levelDataRef.current;
        if (!a || !data) return;
        a.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        // Speech RMS sits low relative to the 0-1 range this loop produces;
        // 4x brings a normal speaking voice to a legible height without
        // clipping shouted or close-mic'd input at 1.
        setLevel(Math.min(1, rms * 4));
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* no AnalyserNode support, or a locked-down environment; skip the meter */
    }
  }, []);

  const teardown = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    stopLevelMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    elapsedRef.current = 0;
    setSeconds(0);
  }, [stopLevelMeter]);

  // Stop the microphone if the field unmounts mid-recording. Without this the
  // browser's recording indicator stays lit after navigating away.
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setError(null);

    if (!isDictationSupported()) {
      setError("This browser can't record audio.");
      return;
    }

    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (e) {
      setState("idle");
      const name = (e as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in your browser's site settings."
          : name === "NotFoundError"
            ? "No microphone found."
            : "Couldn't start the microphone.",
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    discardRef.current = false;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      // Bitrate is a hint. Safari ignores it; everyone else honours it and the
      // blob comes back roughly a quarter the size for no audible loss on speech.
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32000,
      });
    } catch {
      try {
        recorder = new MediaRecorder(stream); // isTypeSupported lied; take the default
      } catch {
        teardown();
        setState("idle");
        setError("This browser can't record audio.");
        return;
      }
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const discarded = discardRef.current;
      teardown();

      if (discarded) {
        setState("idle");
        return;
      }

      if (blob.size < 1200) {
        // Under ~1.2KB is a mis-tap, not speech. Say so rather than doing
        // nothing — a silent no-op looks identical to the feature being
        // broken.
        setState("idle");
        setError(NO_SPEECH_MESSAGE);
        return;
      }

      setState("transcribing");
      try {
        const { text } = await transcribeAudio(blob, vocabRef.current);
        const trimmed = (text || "").trim();
        if (trimmed) {
          onTextRef.current(trimmed);
          setState("idle");
        } else {
          setState("idle");
          setError(NO_SPEECH_MESSAGE);
        }
      } catch (e) {
        setState("idle");
        setError(dictationErrorMessage(e));
      }
    };

    recorder.start();
    recorderRef.current = recorder;
    setState("recording");
    setSeconds(0);
    startLevelMeter(stream);
    // The elapsed count is kept outside React state as well as in it. React 18
    // may invoke a state updater twice (StrictMode), so the ceiling check must
    // not live inside one — doing that double-counts the clock and calls
    // recorder.stop() twice.
    elapsedRef.current = 0;
    tickRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setSeconds(elapsedRef.current);
      if (elapsedRef.current >= MAX_DICTATION_SECONDS) {
        // Hit the ceiling: stop and keep what was said, rather than dropping it.
        try {
          recorderRef.current?.stop();
        } catch {
          /* already stopped */
        }
      }
    }, 1000);
  }, [state, teardown, startLevelMeter]);

  const stop = useCallback(() => {
    if (state !== "recording") return;
    discardRef.current = false;
    try {
      recorderRef.current?.stop();
    } catch {
      teardown();
      setState("idle");
    }
  }, [state, teardown]);

  /** Throw the recording away without transcribing it. Bound to Escape while
   *  recording. */
  const cancel = useCallback(() => {
    if (state !== "recording") return;
    discardRef.current = true;
    try {
      recorderRef.current?.stop();
    } catch {
      teardown();
      setState("idle");
    }
  }, [state, teardown]);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") start();
  }, [state, start, stop]);

  return {
    state,
    seconds,
    level,
    error,
    clearError: useCallback(() => setError(null), []),
    start,
    stop,
    cancel,
    toggle,
    isBusy: state !== "idle",
  };
}

/**
 * Turn a failed transcribe call into something a manager can act on.
 *
 * The first version of this caught every failure as "Couldn't transcribe that.
 * Try again?" — which is the one thing you must not do to an error you will
 * later have to debug from a screenshot. It rendered a 503 (the server has no
 * transcription key; retrying will never work) identically to a 502 (the
 * vendor blipped; retrying probably will) and to a dead connection. The status
 * is on ApiError; use it, and print the number in the cases where the words
 * alone do not tell you which one you got.
 */
export function dictationErrorMessage(e: unknown): string {
  // Not an ApiError means fetch() itself rejected: offline, DNS, CORS, or the
  // backend not answering at all. There is no status to report.
  if (!(e instanceof ApiError)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  switch (e.status) {
    case 401:
    case 403:
      return "Your session expired. Reload the page and try again.";
    case 413:
      return "That recording was too long to send.";
    case 415:
      return "This browser recorded audio in a format we can't transcribe (415).";
    case 422:
      return NO_SPEECH_MESSAGE;
    case 429:
      return "That's a lot of dictating. Give it a moment and try again.";
    case 503:
      // Configuration, not the manager. Says so, so nobody retries for a minute.
      return "Dictation isn't set up on this server yet (503).";
    default:
      return `Couldn't transcribe that (${e.status}). Try again?`;
  }
}

/** mm:ss for the recording timer. */
export function formatDictationClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Set a <textarea>/<input>'s value via its native setter and dispatch a
 * bubbling `input` event, so a React-controlled field notices the change as
 * if the manager had typed or undone it themselves.
 *
 * Assigning `el.value` directly is invisible to React: React caches the last
 * value it rendered on the node, sees no change, and the next render puts
 * the old string back. The prototype's native setter plus a dispatched
 * `input` event is what makes React's onChange fire for real.
 *
 * Shared by `insertAtCaret` (writing a transcript in) and by
 * DictationHotkey's undo (writing the pre-dictation value back) — anywhere
 * this app needs to change a field it does not itself control the React
 * state of. `caret`, when given, is applied after the value so the field
 * ends up focused where the caller wants it, not wherever the browser
 * defaults to after a value change.
 */
export function setNativeFieldValue(
  el: HTMLTextAreaElement | HTMLInputElement,
  value: string,
  caret?: number,
) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

  if (setter) setter.call(el, value);
  else el.value = value;

  if (caret !== undefined) el.setSelectionRange?.(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Insert text into an uncontrolled-from-our-side <textarea>/<input> at the
 * caret. Only used by the global ⌘⇧Space path, which types into fields it
 * does not own; NoteField controls its own value and just calls onChange.
 */
export function insertAtCaret(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const current = el.value ?? "";
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;

  const before = current.slice(0, start);
  const after = current.slice(end);
  const joiner = before && !/\s$/.test(before) ? " " : "";
  const next = before + joiner + text + after;
  const caret = (before + joiner + text).length;

  setNativeFieldValue(el, next, caret);
}
