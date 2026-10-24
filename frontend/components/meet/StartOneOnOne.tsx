"use client";

// Start 1:1 — the Relationship Desk's header action, and the Start buttons
// on the Last → next card and Mission Control's today items (build plan B2).
// A small popover with the Transcribe switch, the consent line and Start;
// a first-time person is asked once whether they know calls are transcribed.
// While a 1:1 with this person is already running, it returns to it.

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { getDirectReport } from "@/lib/api";
import { BTN_PRIMARY, BTN_PRIMARY_SM, ELEVATED } from "@/lib/tokens";
import { getTranscribeDefault, setTranscribeDefault } from "@/lib/recorder/prefs";
import { useRecorder } from "@/lib/recorder/RecorderProvider";
import { StartProblem, useStartMeeting } from "./useStartMeeting";
import { TranscribeToggle, consentLine } from "./TranscribeToggle";
import { ConsentAsk } from "./MeetPicker";

export default function StartOneOnOne({
  person,
  size = "md",
  label = "Start 1:1",
  align = "right",
}: {
  /** consented undefined: looked up when the popover opens. */
  person: { id: string; name: string; consented?: boolean };
  size?: "md" | "sm";
  label?: string;
  align?: "left" | "right";
}) {
  const { meeting } = useRecorder();
  const start = useStartMeeting();
  const [open, setOpen] = useState(false);
  const [transcribe, setTranscribe] = useState(true);
  const [asking, setAsking] = useState(false);
  const [lookedUp, setLookedUp] = useState<boolean | null>(null);
  const consented = person.consented ?? lookedUp ?? false;
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const first = person.name.split(" ")[0];
  const cls = size === "sm" ? BTN_PRIMARY_SM : BTN_PRIMARY;

  useEffect(() => setTranscribe(getTranscribeDefault()), []);
  useEffect(() => {
    if (!open || person.consented !== undefined || lookedUp !== null) return;
    getDirectReport(person.id)
      .then((dr) => setLookedUp(!!dr.transcription_consent_at))
      .catch(() => setLookedUp(false));
  }, [open, person.consented, person.id, lookedUp]);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Already in this 1:1: go back to it rather than start another.
  if (meeting?.personId === person.id) {
    return (
      <Link href={`/app/reports/${person.id}/meet`} className={`${cls} inline-flex items-center gap-1.5 whitespace-nowrap`}>
        Back to the 1:1
      </Link>
    );
  }

  function go() {
    if (transcribe && !consented) {
      setAsking(true);
      return;
    }
    void start.begin(person, { transcribe, consentConfirmed: transcribe });
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setAsking(false);
          start.clearProblem();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        className={`${cls} inline-flex items-center gap-1.5 whitespace-nowrap`}
      >
        {label}
      </button>
      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={`Start 1:1 with ${first}`}
          className={`absolute top-full z-40 mt-2 w-[min(19rem,calc(100vw-2rem))] p-4 ${align === "right" ? "right-0" : "left-0"} ${ELEVATED}`}
        >
          {asking ? (
            <ConsentAsk
              first={first}
              pending={start.pending}
              onYes={() => void start.begin(person, { transcribe: true, consentConfirmed: true })}
              onWithout={() => void start.begin(person, { transcribe: false, consentConfirmed: false })}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">Transcribe</span>
                <TranscribeToggle
                  on={transcribe}
                  onChange={(on) => {
                    setTranscribe(on);
                    setTranscribeDefault(on);
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-muted">{consentLine(transcribe, first, consented)}</p>
              <button type="button" autoFocus onClick={go} disabled={start.pending} className={`mt-4 w-full ${BTN_PRIMARY}`}>
                {start.pending ? "Starting…" : "Start"}
              </button>
            </>
          )}
          <StartProblem start={start} />
        </div>
      )}
    </div>
  );
}
