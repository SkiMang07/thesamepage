"use client";

// ---------------------------------------------------------------------------
// The meeting in progress, and its recorder. Mounted once in the app layout
// so it survives navigation: the manager can leave the meeting screen, look
// something up, and come back through the pill ("With Jordan · Return").
//
// What it owns:
//   - the active meeting (who, which 1:1 row, when it started, the
//     transcript if any), kept in localStorage so a reload keeps it;
//   - the recorder state the pill shows (transcribing / paused / off the
//     record / stopped and why), rebuilt from the server after a reload;
//   - the server lifecycle (start, pause, resume, end) through lib/api.ts.
//
// What it does not own: audio. That is the CaptureEngine's (types.ts). The
// stub ships now; session 2 swaps in the browser engine in createEngine().
//
// Timing: every at_ms is milliseconds since the transcript's started_at by
// the wall clock (build plan Part C), so a reload recomputes it from the
// server's started_at, never from zero.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  callTranscriptRefusal,
  endCallTranscript,
  getCallTranscript,
  getDirectReport,
  getOneOnOne,
  getRecordingCallTranscripts,
  pauseCallTranscript,
  resumeCallTranscript,
  startCallTranscript,
  type CallStopReason,
  type CallTranscript,
} from "@/lib/api";
import { createStubEngine } from "./stubEngine";
import type { AddTabResult, AutoStopReason, CaptureEngine } from "./types";

// Session 2: return the browser engine here.
function createEngine(): CaptureEngine {
  return createStubEngine();
}

const STORAGE_KEY = "tsp:active-meeting";
/** The server refuses a resume more than 30 minutes after a stop. */
export const RESUME_WINDOW_MS = 30 * 60 * 1000;
/** A notes-only meeting nobody came back to stops showing after this. */
const ABANDONED_MS = 12 * 60 * 60 * 1000;

export type ActiveMeeting = {
  oneOnOneId: string;
  personId: string;
  personName: string;
  /** Epoch ms the manager started the 1:1 (the pill's minute count). */
  startedAt: number;
  transcriptId: string | null;
  /** Epoch ms of the transcript's started_at: the origin of every at_ms. */
  transcriptStartedAt: number | null;
  /** "ending" while the wrap-up is open. */
  phase: "live" | "ending";
};

export type StopReason = "manual" | AutoStopReason | "ended";

export type RecState =
  | { kind: "none" }
  | { kind: "starting" }
  | { kind: "transcribing" }
  | { kind: "paused"; since: number }
  | { kind: "off_record"; since: number }
  | { kind: "stopped"; reason: StopReason; at: number };

export type StartResult =
  | { ok: true }
  | { ok: false; code: "already_recording"; transcriptId: string | null; meeting: ActiveMeeting | null }
  | { ok: false; code: "allowance_reached" | "unavailable" | "error"; message: string };

type StartOptions = {
  personId: string;
  personName: string;
  oneOnOneId: string;
  transcribe: boolean;
  consentConfirmed: boolean;
  /** From startCallTabInClick(), when "Ask for the call tab" is on. */
  tab?: Promise<AddTabResult> | null;
};

type RecorderContextValue = {
  meeting: ActiveMeeting | null;
  rec: RecState;
  /** The call tab's name while Jordan's side is being heard. */
  callTab: string | null;
  supportsCallTab: boolean;
  /** Ready once the stored meeting has been checked against the server. */
  hydrated: boolean;
  notice: string | null;
  clearNotice: () => void;
  startMeeting: (opts: StartOptions) => Promise<StartResult>;
  /** Call synchronously from a click: opens the browser's share dialog. */
  startCallTabInClick: () => Promise<AddTabResult>;
  addCallTab: () => Promise<AddTabResult>;
  dropCallTab: () => void;
  pause: () => Promise<void>;
  goOffRecord: () => Promise<void>;
  resume: () => Promise<boolean>;
  stopTranscribing: () => Promise<void>;
  /** Stops transcription and opens the wrap-up phase. */
  endMeeting: () => Promise<void>;
  /** From the wrap-up: back to the 1:1, transcription resumed if it can be. */
  backToMeeting: () => Promise<void>;
  /** After Save log: the meeting is over. */
  finishMeeting: () => void;
  /** Take over a call still running elsewhere (the 409 path). */
  adoptRunning: (transcriptId: string) => Promise<ActiveMeeting | null>;
  /** End a call still running elsewhere so a new one can start. */
  endRunning: (transcriptId: string) => Promise<void>;
  /** A notes-only meeting the manager walked into from a /meet link. */
  enterNotesOnly: (m: Pick<ActiveMeeting, "oneOnOneId" | "personId" | "personName">) => void;
  /** Resume is offered only within 30 minutes, and never after 2 hours. */
  canResumeAfterStop: (now: number) => boolean;
};

const RecorderContext = createContext<RecorderContextValue | null>(null);
const ClockContext = createContext<number>(0);

function readStored(): ActiveMeeting | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as ActiveMeeting;
    return m && typeof m.oneOnOneId === "string" && typeof m.personId === "string" ? m : null;
  } catch {
    return null;
  }
}

function writeStored(m: ActiveMeeting | null) {
  try {
    if (m) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: the meeting lasts for this page only */
  }
}

const toEpoch = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);

function stopReasonFromServer(reason: CallStopReason | null | undefined, phase: ActiveMeeting["phase"]): StopReason {
  if (reason === "silence" || reason === "max_length" || reason === "share_ended") return reason;
  return phase === "ending" ? "ended" : "manual";
}

export function RecorderProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const engineRef = useRef<CaptureEngine | null>(null);
  if (engineRef.current === null && typeof window !== "undefined") engineRef.current = createEngine();

  const [meeting, setMeetingState] = useState<ActiveMeeting | null>(null);
  const [rec, setRec] = useState<RecState>({ kind: "none" });
  const [callTab, setCallTab] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [supportsCallTab, setSupportsCallTab] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Handlers read the latest values without re-subscribing.
  const meetingRef = useRef(meeting);
  const recRef = useRef(rec);
  meetingRef.current = meeting;
  recRef.current = rec;

  const setMeeting = useCallback((m: ActiveMeeting | null) => {
    meetingRef.current = m;
    setMeetingState(m);
    writeStored(m);
  }, []);

  const atMs = useCallback(() => {
    const origin = meetingRef.current?.transcriptStartedAt;
    return origin ? Math.max(0, Date.now() - origin) : 0;
  }, []);

  useEffect(() => setSupportsCallTab(!!engineRef.current?.supportsCallTab()), []);

  // ── auto-stops from the engine ───────────────────────────────────────────
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.onAutoStop(async (reason) => {
      const m = meetingRef.current;
      if (!m?.transcriptId) return;
      const at = atMs();
      setRec({ kind: "stopped", reason, at: Date.now() });
      setCallTab(null);
      try {
        const seqs = await engine.stop();
        await endCallTranscript(m.transcriptId, { reason, at_ms: at, seqs_by_track: seqs });
      } catch {
        /* the server closes a silent row on its own; the pill already says stopped */
      }
    });
  }, [atMs]);

  // ── rebuild after a reload ───────────────────────────────────────────────
  const applyTranscript = useCallback(
    async (m: ActiveMeeting, t: CallTranscript & { gaps?: { start_ms: number; end_ms: number | null; kind?: string }[] }) => {
      const origin = toEpoch(t.started_at) ?? m.transcriptStartedAt ?? Date.now();
      const next = { ...m, transcriptStartedAt: origin };
      setMeeting(next);
      if (t.status === "recording") {
        const open = (t.gaps ?? []).find((g) => g.end_ms === null);
        if (open) {
          setRec({ kind: open.kind === "off_record" ? "off_record" : "paused", since: origin + open.start_ms });
        } else {
          setRec({ kind: "transcribing" });
          await engineRef.current?.reattach({ transcriptId: t.id, startedAtMs: origin }).catch(() => {});
        }
      } else {
        setRec({ kind: "stopped", reason: stopReasonFromServer(t.ended_reason, next.phase), at: toEpoch(t.ended_at) ?? Date.now() });
      }
    },
    [setMeeting],
  );

  const adoptRunning = useCallback(
    async (transcriptId: string): Promise<ActiveMeeting | null> => {
      try {
        const t = await getCallTranscript(transcriptId);
        if (!t.one_on_one_id) return null;
        const session = await getOneOnOne(t.one_on_one_id);
        const report = await getDirectReport(session.direct_report_id);
        const m: ActiveMeeting = {
          oneOnOneId: session.id,
          personId: report.id,
          personName: report.name,
          startedAt: toEpoch(t.started_at) ?? Date.now(),
          transcriptId: t.id,
          transcriptStartedAt: toEpoch(t.started_at),
          phase: "live",
        };
        await applyTranscript(m, t);
        return meetingRef.current;
      } catch {
        return null;
      }
    },
    [applyTranscript],
  );

  useEffect(() => {
    if (!enabled) {
      setHydrated(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const stored = readStored();
      try {
        if (stored?.transcriptId) {
          try {
            const t = await getCallTranscript(stored.transcriptId);
            if (!cancelled) await applyTranscript(stored, t);
          } catch {
            // Deleted, or not this account's: keep the meeting, drop the transcript.
            if (!cancelled) {
              setMeeting({ ...stored, transcriptId: null, transcriptStartedAt: null });
              setRec({ kind: "none" });
            }
          }
        } else if (stored && Date.now() - stored.startedAt < ABANDONED_MS) {
          if (!cancelled) setMeeting(stored);
        } else if (stored) {
          setMeeting(null);
        }
        // A call running with nothing stored here (another tab cleared it,
        // or storage was blocked): pick it up from the server.
        if (!cancelled && !meetingRef.current) {
          const { transcripts } = await getRecordingCallTranscripts();
          const running = transcripts.find((t) => t.one_on_one_id);
          if (running && !cancelled) await adoptRunning(running.id);
        }
      } catch {
        /* the pill stays away; nothing here blocks a page */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, applyTranscript, adoptRunning, setMeeting]);

  // ── the clock the pill reads ─────────────────────────────────────────────
  useEffect(() => {
    if (!meeting) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [meeting]);

  // ── actions ──────────────────────────────────────────────────────────────
  const startCallTabInClick = useCallback((): Promise<AddTabResult> => {
    const engine = engineRef.current;
    return engine ? engine.addCallTab() : Promise.resolve({ kind: "unsupported" as const });
  }, []);

  const startMeeting = useCallback(
    async (opts: StartOptions): Promise<StartResult> => {
      const current = meetingRef.current;
      const engine = engineRef.current;
      if (current && current.oneOnOneId === opts.oneOnOneId && current.phase === "live") {
        opts.tab?.then((r) => {
          if (r.kind === "added") setCallTab(r.label);
        });
        return { ok: true };
      }
      const r = recRef.current;
      if (current?.transcriptId && (r.kind === "transcribing" || r.kind === "paused" || r.kind === "off_record" || r.kind === "starting")) {
        engine?.dropCallTab();
        return { ok: false, code: "already_recording", transcriptId: current.transcriptId, meeting: current };
      }

      const base: ActiveMeeting = {
        oneOnOneId: opts.oneOnOneId,
        personId: opts.personId,
        personName: opts.personName,
        startedAt: Date.now(),
        transcriptId: null,
        transcriptStartedAt: null,
        phase: "live",
      };

      if (!opts.transcribe || !engine) {
        engine?.dropCallTab();
        setCallTab(null);
        setRec({ kind: "none" });
        setMeeting(base);
        return { ok: true };
      }

      setRec({ kind: "starting" });
      const tab = opts.tab ? await opts.tab : null;
      const tabAdded = tab?.kind === "added";
      try {
        const { transcript } = await startCallTranscript({
          one_on_one_id: opts.oneOnOneId,
          capture_mode: tabAdded ? "tab" : "mic_only",
          consent_confirmed: opts.consentConfirmed,
        });
        const origin = toEpoch(transcript.started_at) ?? Date.now();
        try {
          await engine.start({ transcriptId: transcript.id, startedAtMs: origin, vocabulary: opts.personName });
        } catch {
          engine.dropCallTab();
          await endCallTranscript(transcript.id, { reason: "manager", at_ms: 0, seqs_by_track: {} }).catch(() => {});
          setRec({ kind: "none" });
          setMeeting(base);
          // The 1:1 goes ahead without a transcript; the pill says why.
          setNotice("Your microphone isn't available, so this 1:1 isn't being transcribed. Your notes still work.");
          return { ok: true };
        }
        setMeeting({ ...base, startedAt: origin, transcriptId: transcript.id, transcriptStartedAt: origin });
        setCallTab(tabAdded ? tab.label : null);
        setRec({ kind: "transcribing" });
        if (tab && tab.kind === "no_audio") setNotice("That tab shared no sound, so only your mic is on. Add Jordan's side again from the pill and leave Also share tab audio on.");
        return { ok: true };
      } catch (err) {
        engine.dropCallTab();
        setRec({ kind: "none" });
        const refusal = callTranscriptRefusal(err);
        if (refusal?.code === "already_recording") {
          return { ok: false, code: "already_recording", transcriptId: refusal.id, meeting: null };
        }
        if (refusal?.code === "allowance_reached") {
          return { ok: false, code: "allowance_reached", message: refusal.message };
        }
        if (refusal?.status === 503) {
          return { ok: false, code: "unavailable", message: "Transcription isn't available right now." };
        }
        return { ok: false, code: "error", message: "Couldn't start transcribing. Try again, or start without it." };
      }
    },
    [setMeeting],
  );

  const enterNotesOnly = useCallback(
    (m: Pick<ActiveMeeting, "oneOnOneId" | "personId" | "personName">) => {
      if (meetingRef.current) return;
      setRec({ kind: "none" });
      setMeeting({ ...m, startedAt: Date.now(), transcriptId: null, transcriptStartedAt: null, phase: "live" });
    },
    [setMeeting],
  );

  const addCallTab = useCallback(async (): Promise<AddTabResult> => {
    const engine = engineRef.current;
    if (!engine) return { kind: "unsupported" };
    const result = await engine.addCallTab();
    if (result.kind === "added") setCallTab(result.label);
    return result;
  }, []);

  const dropCallTab = useCallback(() => {
    engineRef.current?.dropCallTab();
    setCallTab(null);
  }, []);

  const hold = useCallback(
    async (kind: "pause" | "off_record") => {
      const m = meetingRef.current;
      if (!m?.transcriptId || recRef.current.kind !== "transcribing") return;
      const at = atMs();
      setRec({ kind: kind === "pause" ? "paused" : "off_record", since: Date.now() });
      try {
        await engineRef.current?.hold();
        await pauseCallTranscript(m.transcriptId, { kind, at_ms: at });
      } catch {
        setNotice("Couldn't reach the server. Transcription may still be running — try again in a moment.");
        setRec({ kind: "transcribing" });
        engineRef.current?.release();
      }
    },
    [atMs],
  );

  const pause = useCallback(() => hold("pause"), [hold]);
  const goOffRecord = useCallback(() => hold("off_record"), [hold]);

  const canResumeAfterStop = useCallback((at: number) => {
    const r = recRef.current;
    if (r.kind !== "stopped" || !meetingRef.current?.transcriptId) return false;
    return r.reason !== "max_length" && at - r.at < RESUME_WINDOW_MS;
  }, []);

  const resume = useCallback(async (): Promise<boolean> => {
    const m = meetingRef.current;
    const r = recRef.current;
    if (!m?.transcriptId) return false;
    if (r.kind === "paused" || r.kind === "off_record") {
      setRec({ kind: "transcribing" });
      try {
        await resumeCallTranscript(m.transcriptId, atMs());
        engineRef.current?.release();
        return true;
      } catch {
        setRec(r);
        setNotice("Couldn't resume just now. Try again in a moment.");
        return false;
      }
    }
    if (r.kind === "stopped") {
      if (!canResumeAfterStop(Date.now())) return false;
      setRec({ kind: "starting" });
      try {
        await resumeCallTranscript(m.transcriptId, atMs());
        await engineRef.current?.reattach({ transcriptId: m.transcriptId, startedAtMs: m.transcriptStartedAt ?? Date.now() });
        setRec({ kind: "transcribing" });
        return true;
      } catch (err) {
        const refusal = callTranscriptRefusal(err);
        // Past the window: the server's clock wins. Only End 1:1 is left.
        setRec(refusal?.code === "resume_window_passed" ? { ...r, at: Date.now() - RESUME_WINDOW_MS } : r);
        setNotice(refusal?.message ?? "Couldn't resume just now. Try again in a moment.");
        return false;
      }
    }
    return false;
  }, [atMs, canResumeAfterStop]);

  const stopWith = useCallback(
    async (reason: "manual" | "ended") => {
      const m = meetingRef.current;
      const r = recRef.current;
      if (!m?.transcriptId || !(r.kind === "transcribing" || r.kind === "paused" || r.kind === "off_record")) return;
      const at = atMs();
      setRec({ kind: "stopped", reason, at: Date.now() });
      setCallTab(null);
      try {
        const seqs = (await engineRef.current?.stop()) ?? {};
        await endCallTranscript(m.transcriptId, { reason: "manager", at_ms: at, seqs_by_track: seqs });
      } catch {
        /* the server closes an idle row on its own; nothing more is being sent */
      }
    },
    [atMs],
  );

  const stopTranscribing = useCallback(() => stopWith("manual"), [stopWith]);

  const endMeeting = useCallback(async () => {
    const m = meetingRef.current;
    if (!m) return;
    // A call already stopped (by hand or by itself) stays as it is.
    await stopWith("ended");
    setMeeting({ ...m, phase: "ending" });
  }, [setMeeting, stopWith]);

  const backToMeeting = useCallback(async () => {
    const m = meetingRef.current;
    if (!m) return;
    setMeeting({ ...m, phase: "live" });
    const r = recRef.current;
    if (r.kind === "stopped" && r.reason === "ended") {
      const resumed = await resume();
      if (!resumed && recRef.current.kind === "stopped") {
        setRec({ ...(recRef.current as Extract<RecState, { kind: "stopped" }>), reason: "manual" });
      }
    }
  }, [resume, setMeeting]);

  const finishMeeting = useCallback(() => {
    engineRef.current?.dropCallTab();
    setCallTab(null);
    setRec({ kind: "none" });
    setMeeting(null);
  }, [setMeeting]);

  const endRunning = useCallback(
    async (transcriptId: string) => {
      const m = meetingRef.current;
      if (m?.transcriptId === transcriptId) {
        await stopWith("manual");
        finishMeeting();
        return;
      }
      await endCallTranscript(transcriptId, { reason: "manager", at_ms: 0, seqs_by_track: {} }).catch(() => {});
    },
    [finishMeeting, stopWith],
  );

  const value = useMemo<RecorderContextValue>(
    () => ({
      meeting,
      rec,
      callTab,
      supportsCallTab,
      hydrated,
      notice,
      clearNotice: () => setNotice(null),
      startMeeting,
      startCallTabInClick,
      addCallTab,
      dropCallTab,
      pause,
      goOffRecord,
      resume,
      stopTranscribing,
      endMeeting,
      backToMeeting,
      finishMeeting,
      adoptRunning,
      endRunning,
      enterNotesOnly,
      canResumeAfterStop,
    }),
    [meeting, rec, callTab, supportsCallTab, hydrated, notice, startMeeting, startCallTabInClick, addCallTab, dropCallTab, pause, goOffRecord, resume, stopTranscribing, endMeeting, backToMeeting, finishMeeting, adoptRunning, endRunning, enterNotesOnly, canResumeAfterStop],
  );

  return (
    <RecorderContext.Provider value={value}>
      <ClockContext.Provider value={now}>{children}</ClockContext.Provider>
    </RecorderContext.Provider>
  );
}

export function useRecorder() {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error("useRecorder must be inside RecorderProvider");
  return ctx;
}

/** Ticks once a second while a meeting is active. Only timers read it. */
export function useMeetingClock() {
  return useContext(ClockContext);
}

/** "12 min" for the meeting; "0:45" for a pause. */
export function minutesSince(from: number, now: number) {
  return Math.max(0, Math.floor((now - from) / 60000));
}

export function clockSince(from: number, now: number) {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
