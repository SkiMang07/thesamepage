"use client";

// ---------------------------------------------------------------------------
// The recording pill — Direction A "Quiet" (build plan B1, B4, B5).
//
// One calm pill in the top bar, on every page while a 1:1 is running. No
// strip, no level meters, no waveform, no red, nothing pulsing: it must never
// look like recording software. Red is for errors only; amber (the app's one
// attention colour) is for a call that stopped by itself.
//
//   Transcribing        teal outline, steady dot, "Transcribing · 12 min" ▾
//   Both sides          "Transcribing you and Jordan · 12 min" ▾
//   Paused              grey, "Paused · 0:45 · Resume"         (click resumes)
//   Off the record      carbon, "Off the record · 1:40 · Resume" (click resumes)
//   Stopped by itself   amber, "Stopped · no sound for 10 min" ▾
//   Away from the 1:1   "With Jordan · 14 min · Return", plus its own ▾
//   Phone               "12 min"
//
// The menu: what is being listened to, Add Jordan's side… (or Stop listening
// to the call tab), Pause, Go off the record, Stop transcribing, and Back to
// the 1:1 when away. The first-meeting tip and our explainer (shown before
// the browser's own share dialog) live here because both anchor to the pill.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ELEVATED, SCRIM, BTN_PRIMARY, BTN_SECONDARY } from "@/lib/tokens";
import { clockSince, minutesSince, useMeetingClock, useRecorder, type RecState } from "@/lib/recorder/RecorderProvider";
import { getAskForTab, getTipSeen, setAskForTab, setTipSeen } from "@/lib/recorder/prefs";

const PILL = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none";
const PILL_LIVE = `${PILL} border border-brand/60 text-brand hover:bg-brand-tint`;
const PILL_PAUSED = `${PILL} border border-control bg-sunken text-ink-secondary hover:text-ink`;
const PILL_OFF = `${PILL} bg-carbon-900 text-on-carbon hover:bg-carbon-800`;
const PILL_STOPPED = `${PILL} bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-500/60 hover:bg-amber-100`;
const PILL_QUIET = `${PILL} border border-control text-ink-secondary hover:bg-sunken hover:text-ink`;

const MENU_ROW =
  "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-ink-body hover:bg-sunken hover:text-ink focus:bg-sunken focus:outline-none";

const MENU_ROW_BRAND =
  "flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-brand hover:bg-sunken hover:text-brand-hover focus:bg-sunken focus:outline-none";

const Chevron = () => (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const PauseGlyph = () => (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
const MicOffGlyph = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M3 3l18 18" />
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0011 5.5M19 11a7 7 0 01-.6 2.8" />
  </svg>
);
const Dot = () => <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand" />;

export function stoppedLabel(rec: Extract<RecState, { kind: "stopped" }>) {
  if (rec.reason === "silence") return "Stopped · no sound for 10 min";
  if (rec.reason === "max_length") return "Stopped at 2 hours";
  if (rec.reason === "share_ended") return "Stopped · call tab closed";
  return "Transcription stopped";
}

export default function RecordingPill() {
  const r = useRecorder();
  const { meeting, rec, callTab, supportsCallTab } = r;
  const now = useMeetingClock();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const onMeetPage = !!meeting && pathname === `/app/reports/${meeting.personId}/meet`;
  const first = meeting ? meeting.personName.split(" ")[0] : "";
  const transcriptLive = rec.kind === "transcribing" || rec.kind === "paused" || rec.kind === "off_record";

  // The one-time tip: first transcribed meeting on this device, mic only,
  // in a browser that can add the call tab. "Shown once" — marked seen the
  // moment it appears, so a reload doesn't bring it back.
  useEffect(() => {
    if (onMeetPage && rec.kind === "transcribing" && !callTab && supportsCallTab && meeting?.phase === "live" && !getTipSeen()) {
      setTipSeen();
      setTipOpen(true);
    }
  }, [onMeetPage, rec.kind, callTab, supportsCallTab, meeting?.phase]);
  useEffect(() => {
    if (rec.kind !== "transcribing" || callTab) setTipOpen(false);
  }, [rec.kind, callTab]);

  // Provider messages (a share without sound, a failed pause) surface here.
  useEffect(() => {
    if (r.notice) {
      setToast(r.notice);
      r.clearNotice();
    }
  }, [r.notice, r]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.length > 60 ? 9000 : 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const closeMenu = useCallback((refocus = true) => {
    setMenuOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Escape and click-outside close the menu, as the avatar menu does.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen, closeMenu]);

  if (!meeting) return null;

  function closeExplainer() {
    setExplainerOpen(false);
    // The menu item that opened it is gone; focus goes back to the pill.
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const minutes = minutesSince(meeting.startedAt, now);
  const canResume = rec.kind === "stopped" && r.canResumeAfterStop(now);

  async function chooseCallTab() {
    // Synchronously inside this click: the browser only opens its share
    // dialog from a fresh user gesture.
    const pending = r.addCallTab();
    closeExplainer();
    const result = await pending;
    if (result.kind === "added") setToast(`Now hearing you and ${first} separately`);
    else if (result.kind === "no_audio") setToast(`That tab shared no sound. Try again and leave Also share tab audio on.`);
    else if (result.kind === "unsupported") setToast("This browser can't add the call tab's sound. Your mic is still on.");
  }

  // ── the pill itself ──────────────────────────────────────────────────────
  let pill: React.ReactNode;
  if (!onMeetPage) {
    const state =
      rec.kind === "paused" ? "Paused" : rec.kind === "off_record" ? "Off the record" : rec.kind === "stopped" && rec.reason !== "manual" && rec.reason !== "ended" ? stoppedLabel(rec) : null;
    pill = (
      <div className="flex items-center gap-1">
        <Link
          href={`/app/reports/${meeting.personId}/meet`}
          className={rec.kind === "stopped" && state ? PILL_STOPPED : PILL_LIVE}
          aria-label={`Return to your 1:1 with ${first}`}
        >
          {rec.kind === "transcribing" && <Dot />}
          <span className="hidden sm:inline">With {first} · {state ?? `${minutes} min`} · Return</span>
          <span className="sm:hidden">{first} · {minutes} min</span>
        </Link>
        {(transcriptLive || canResume) && (
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-label="Transcription options"
            className={`${PILL_QUIET} px-2`}
          >
            <Chevron />
          </button>
        )}
      </div>
    );
  } else if (rec.kind === "none") {
    return null;
  } else if (rec.kind === "starting") {
    pill = <span className={PILL_QUIET} role="status">Starting…</span>;
  } else if (rec.kind === "transcribing") {
    pill = (
      <button ref={triggerRef} type="button" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} className={PILL_LIVE}>
        <Dot />
        <span className="hidden sm:inline">{callTab ? `Transcribing you and ${first}` : "Transcribing"} · {minutes} min</span>
        <span className="sm:hidden">{minutes} min</span>
        <span className="sr-only">, transcription options</span>
        <Chevron />
      </button>
    );
  } else if (rec.kind === "paused" || rec.kind === "off_record") {
    const off = rec.kind === "off_record";
    pill = (
      <button type="button" onClick={() => void r.resume()} className={off ? PILL_OFF : PILL_PAUSED} aria-label={`${off ? "Off the record" : "Paused"} for ${clockSince(rec.since, now)}. Resume transcribing`}>
        {off ? <MicOffGlyph /> : <PauseGlyph />}
        <span className="hidden sm:inline">{off ? "Off the record" : "Paused"} · {clockSince(rec.since, now)} · Resume</span>
        <span className="sm:hidden">{off ? "Off" : "Paused"} · Resume</span>
      </button>
    );
  } else if (rec.reason === "ended") {
    pill = <span className={PILL_QUIET}>Transcription stopped · {minutesSince(meeting.startedAt, rec.at)} min</span>;
  } else {
    const auto = rec.reason !== "manual";
    pill = (
      <button ref={triggerRef} type="button" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} className={auto ? PILL_STOPPED : PILL_QUIET}>
        {auto && <span aria-hidden>▲</span>}
        <span className="hidden sm:inline">{auto ? stoppedLabel(rec) : `Transcription stopped · ${minutesSince(meeting.startedAt, rec.at)} min`}</span>
        <span className="sm:hidden">Stopped</span>
        <Chevron />
      </button>
    );
  }

  return (
    <>
      <div className="relative" ref={wrapRef}>
        {pill}
        {menuOpen && (
          <PillMenu
            id={menuId}
            first={first}
            away={!onMeetPage}
            meetHref={`/app/reports/${meeting.personId}/meet`}
            rec={rec}
            callTab={callTab}
            supportsCallTab={supportsCallTab}
            canResume={canResume}
            onClose={closeMenu}
            onAddSide={() => {
              setMenuOpen(false);
              setExplainerOpen(true);
            }}
            onDropSide={() => {
              r.dropCallTab();
              closeMenu();
            }}
            onPause={() => {
              void r.pause();
              closeMenu();
            }}
            onOff={() => {
              void r.goOffRecord();
              closeMenu();
            }}
            onStop={() => {
              void r.stopTranscribing();
              closeMenu();
            }}
            onResume={() => {
              void r.resume();
              closeMenu();
            }}
          />
        )}
        {tipOpen && !menuOpen && (
          <div role="dialog" aria-labelledby="call-tip-title" className={`fixed inset-x-3 top-16 z-50 p-4 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-80 ${ELEVATED}`}>
            <span aria-hidden className="absolute -top-1.5 right-8 hidden h-3 w-3 rotate-45 border-l border-t border-hairline bg-elevated sm:block" />
            <p id="call-tip-title" className="text-sm font-semibold text-ink">On a video call with {first}?</p>
            <p className="mt-1.5 text-sm text-ink-secondary">
              Add their side of the call and every line knows who said it, so commitments land with the right person.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                autoFocus
                className={BTN_PRIMARY}
                onClick={() => {
                  setTipOpen(false);
                  setExplainerOpen(true);
                }}
              >
                Add {first}&apos;s side
              </button>
              <button type="button" className={BTN_SECONDARY} onClick={() => setTipOpen(false)}>
                We&apos;re meeting in person
              </button>
            </div>
            <p className="mt-2.5 text-2xs text-ink-muted">Shown once. It&apos;s always in this menu later.</p>
          </div>
        )}
      </div>

      {/* Portalled: the top bar's backdrop blur would otherwise become the
          containing block for these fixed layers and pin them inside it. */}
      {explainerOpen && createPortal(<AddSideExplainer first={first} onChoose={chooseCallTab} onClose={closeExplainer} />, document.querySelector(".theme-dark") ?? document.body)}

      {toast && createPortal((
        <div role="status" className="fixed left-1/2 top-16 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-start gap-2 rounded-lg border border-hairline bg-elevated px-4 py-2.5 text-sm text-ink shadow-lg">
          {toast.startsWith("Now hearing") && <span aria-hidden className="text-brand">✓</span>}
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="-mr-1 ml-1 rounded px-1 text-ink-muted hover:text-ink">
            ×
          </button>
        </div>
      ), document.querySelector(".theme-dark") ?? document.body)}
    </>
  );
}

// ── the menu ───────────────────────────────────────────────────────────────

function PillMenu({
  id,
  first,
  away,
  meetHref,
  rec,
  callTab,
  supportsCallTab,
  canResume,
  onClose,
  onAddSide,
  onDropSide,
  onPause,
  onOff,
  onStop,
  onResume,
}: {
  id: string;
  first: string;
  away: boolean;
  meetHref: string;
  rec: RecState;
  callTab: string | null;
  supportsCallTab: boolean;
  canResume: boolean;
  onClose: (refocus?: boolean) => void;
  onAddSide: () => void;
  onDropSide: () => void;
  onPause: () => void;
  onOff: () => void;
  onStop: () => void;
  onResume: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Focus the first item; arrow keys move between items (menu pattern).
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);
  function onKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      onClose(false);
    }
  }

  const stopped = rec.kind === "stopped";
  const live = rec.kind === "transcribing";

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label="Transcription"
      onKeyDown={onKeyDown}
      className={`fixed inset-x-3 top-16 z-50 p-1.5 sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[19rem] ${ELEVATED}`}
    >
      {!stopped && (
        <div className="px-3 pb-2 pt-2">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Listening to</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink">
            <span aria-hidden className="w-3.5 text-brand">✓</span>Your microphone
          </p>
          {callTab ? (
            <p className="mt-1.5 flex items-center gap-2 text-sm text-ink">
              <span aria-hidden className="w-3.5 text-brand">✓</span>
              {first}&apos;s side · {callTab}
            </p>
          ) : (
            <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-muted">
              <span aria-hidden className="w-3.5" />
              {first}&apos;s side of the call
            </p>
          )}
          {!callTab && (
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              Your mic may pick {first} up too, but it can&apos;t tell you apart.
              {supportsCallTab && " Add the call tab and every line knows who said it."}
            </p>
          )}
        </div>
      )}

      {!stopped && supportsCallTab && (
        callTab ? (
          <button type="button" role="menuitem" className={MENU_ROW} onClick={onDropSide}>
            Stop listening to the call tab
          </button>
        ) : (
          <button type="button" role="menuitem" className={MENU_ROW_BRAND} onClick={onAddSide}>
            Add {first}&apos;s side…
          </button>
        )
      )}

      {live && (
        <>
          <div className="my-1 h-px bg-divider" />
          <button type="button" role="menuitem" className={MENU_ROW} onClick={onPause}>
            Pause <span className="text-xs text-ink-muted">A knock at the door</span>
          </button>
          <button type="button" role="menuitem" className={MENU_ROW} onClick={onOff}>
            Go off the record <span className="text-xs text-ink-muted">Something private</span>
          </button>
          <button type="button" role="menuitem" className={MENU_ROW} onClick={onStop}>
            Stop transcribing <span className="text-xs text-ink-muted">Keep the meeting open</span>
          </button>
        </>
      )}
      {(rec.kind === "paused" || rec.kind === "off_record") && (
        <>
          <div className="my-1 h-px bg-divider" />
          <button type="button" role="menuitem" className={MENU_ROW} onClick={onResume}>
            Resume transcribing
          </button>
          <button type="button" role="menuitem" className={MENU_ROW} onClick={onStop}>
            Stop transcribing <span className="text-xs text-ink-muted">Keep the meeting open</span>
          </button>
        </>
      )}
      {stopped && (
        canResume ? (
          <button type="button" role="menuitem" className={MENU_ROW} onClick={onResume}>
            Resume transcribing
          </button>
        ) : (
          <p className="px-3 py-2.5 text-sm text-ink-secondary">
            {rec.kind === "stopped" && rec.reason === "max_length"
              ? "Calls are transcribed for up to 2 hours. Everything up to then is kept."
              : "Transcription can't resume now. Everything up to the stop is kept."}
          </p>
        )
      )}

      {away && (
        <>
          <div className="my-1 h-px bg-divider" />
          <Link href={meetHref} role="menuitem" className={MENU_ROW} onClick={() => onClose(false)}>
            Back to the 1:1
          </Link>
        </>
      )}
    </div>
  );
}

// ── our explainer, before the browser's own share dialog ───────────────────

function AddSideExplainer({ first, onChoose, onClose }: { first: string; onChoose: () => void; onClose: () => void }) {
  const [every, setEvery] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => setEvery(getAskForTab()), []);

  // Focus in, Escape out, and Tab stays inside while it's open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input"));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  return (
    <div className={`${SCRIM} flex items-center justify-center p-4`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`w-full max-w-md p-6 ${ELEVATED}`}>
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          Add {first}&apos;s side of the call
        </h2>
        <p className="mt-2 text-sm text-ink-body">
          Your browser will ask which tab to share. Pick the tab your call is in and leave <strong className="font-semibold text-ink">Also share tab audio</strong> on.
        </p>

        {/* A small picture of what to pick: the call's tab, with its sound. */}
        <div aria-hidden className="mt-4 rounded-lg border border-hairline bg-sunken p-3">
          <div className="flex gap-1.5">
            <span className="h-6 flex-1 rounded-t-md bg-surface/60" />
            <span className="flex h-6 flex-[1.4] items-center gap-1.5 rounded-t-md border border-b-0 border-brand/60 bg-surface px-2 text-2xs font-medium text-ink">
              <span className="h-2 w-2 rounded-full bg-brand" />
              Meet tab
              <svg viewBox="0 0 24 24" className="ml-auto h-3 w-3 text-ink-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M11 5L6 9H3v6h3l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 010 7" />
              </svg>
            </span>
            <span className="h-6 flex-1 rounded-t-md bg-surface/60" />
          </div>
          <div className="h-10 rounded-b-md rounded-tr-md bg-surface" />
        </div>
        <p className="mt-3 text-sm text-ink-secondary">
          It says &ldquo;share&rdquo;, but nothing is shown to anyone. We only listen to that tab&apos;s sound, then throw the audio away once it&apos;s transcribed.
        </p>

        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-ink-body">
          <input
            type="checkbox"
            checked={every}
            onChange={(e) => {
              setEvery(e.target.checked);
              setAskForTab(e.target.checked);
            }}
            className="h-4 w-4 rounded border-control accent-brand"
          />
          Ask for the call tab whenever I start a meeting
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" data-autofocus className={BTN_PRIMARY} onClick={onChoose}>
            Choose the call tab
          </button>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Not now
          </button>
        </div>
        <p className="mt-4 text-xs text-ink-muted">Zoom or Teams app on a Mac? This works best when the call is in a browser tab.</p>
      </div>
    </div>
  );
}
