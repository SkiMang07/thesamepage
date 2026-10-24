// ---------------------------------------------------------------------------
// The browser capture engine — session 2 of the call transcription build.
//
// Owns audio and nothing else (types.ts). It records the manager's mic and,
// when added, the call tab, in 3-minute segments per track, and hands each
// finished segment to the on-device queue (queue.ts), which posts it.
//
// ROTATION. Every recorder runs with a 1-second timeslice, and each 1-second
// data event is the engine's clock: once a segment is 3 minutes old it is
// closed and the next one opened. No setTimeout anywhere on that path, because
// The Same Page is usually a background tab behind the video call, where
// timers are throttled but recorder events keep coming.
//
// ONE SEQ PER WINDOW. All tracks open and close together and share a seq. The
// server bills by seq position, so an hour with Jordan's side added is an
// hour of allowance, not two. Adding or dropping Jordan's side closes the
// window too: that is how the mic's track switches between `mixed` and
// `self` cleanly. seq = max(last + 1, whole seconds since started_at), so it
// stays unique after a reload even if storage was lost.
//
// THE TIMELINE. offset_ms is the wall-clock time since the transcript's
// started_at when the segment opened; duration_ms is wall time until it
// closed. Same origin across reloads, pauses and resumes (build plan Part C).
//
// HOLD. Pause and Off the record close the window at that moment: what was
// said up to then is queued, nothing after it is recorded. The streams stay
// open so Resume is instant; nothing is captured while held.
//
// SILENCE. An AudioWorklet (public/recorder/level-worklet.js) measures each
// track's loudness on the audio thread, unthrottled in a background tab. Ten
// minutes with no track above the threshold stops transcription. A window in
// which no track heard anything is not uploaded at all: it costs money and
// whisper invents text on silence. If the meter can't run (no AudioWorklet,
// or a reloaded page that hasn't been clicked yet), the silence clock doesn't
// advance and every segment is sent: it fails safe, never stopping early.
// ---------------------------------------------------------------------------

import type { CallTrack } from "@/lib/api";
import { MIC_CONSTRAINTS, createSpeechRecorder } from "@/lib/audioFormat";
import { bootQueue, claimLive, closeSegment, flush, onMaxLength, putChunk, readMeta, recoverChunks, seqsFor } from "./queue";
import type { AddTabResult, AutoStopReason, CaptureContext, CaptureEngine, SeqsByTrack } from "./types";

type Timings = { segmentMs: number; silenceMs: number; maxMs: number };

const DEFAULT_TIMINGS: Timings = {
  segmentMs: 3 * 60_000,
  silenceMs: 10 * 60_000,
  maxMs: 2 * 60 * 60_000,
};

/** Only a local test build sets this ("segmentMs,silenceMs,maxMs"), to see
 *  rotation and the auto-stops without waiting hours. Unset in every deploy. */
function timings(): Timings {
  const raw = process.env.NEXT_PUBLIC_RECORDER_TEST_TIMINGS;
  if (!raw) return DEFAULT_TIMINGS;
  const [segmentMs, silenceMs, maxMs] = raw.split(",").map((n) => Number(n));
  return {
    segmentMs: segmentMs > 0 ? segmentMs : DEFAULT_TIMINGS.segmentMs,
    silenceMs: silenceMs > 0 ? silenceMs : DEFAULT_TIMINGS.silenceMs,
    maxMs: maxMs > 0 ? maxMs : DEFAULT_TIMINGS.maxMs,
  };
}

/** RMS above this counts as someone talking (about −44 dBFS). Noise
 *  suppression keeps a quiet room well under it. */
const VOICE_RMS = 0.006;
/** Shorter than this isn't worth a transcription call (and the vendor refuses
 *  clips under a tenth of a second). */
const MIN_SEGMENT_MS = 1000;
const TIMESLICE_MS = 1000;
const WORKLET_URL = "/recorder/level-worklet.js";

type Source = "mic" | "tab";

type Rec = {
  source: Source;
  track: CallTrack;
  seq: number;
  recorder: MediaRecorder;
  mime: string;
  offsetMs: number;
  openedAt: number;
  chunks: Blob[];
  /** IndexedDB writes for this segment, in order. */
  writes: Promise<void>;
  stopped: Promise<void>;
};

type Window_ = {
  seq: number;
  openedAt: number;
  recs: Rec[];
  /** Did any track hear speech, or was the meter unable to tell? */
  heard: boolean;
};

function isChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  if (brands?.length) return brands.some((b) => /Chromium/.test(b.brand));
  // Safari and Firefox share without tab audio: mic only (scoping §5).
  return /Chrome\//.test(navigator.userAgent);
}

function tabLabel(track: MediaStreamTrack): string {
  const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  return surface === "browser" || !surface ? "the call tab" : "the shared window";
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => {
    t.onended = null;
    t.stop();
  });
}

export function createBrowserEngine(): CaptureEngine {
  const T = timings();

  let ctx: CaptureContext | null = null;
  let mic: MediaStream | null = null;
  let tab: MediaStream | null = null;
  let label: string | null = null;

  /** Capturing for a transcript (false before start and after any stop). */
  let running = false;
  let held = false;
  let win: Window_ | null = null;
  let lastSeq = -1;
  /** Recorder-open time for this transcript before the current window. */
  let capturedBefore = 0;
  let releaseLive: (() => void) | null = null;
  let autoStopListener: ((reason: AutoStopReason) => void) | null = null;

  // Every window change runs through one chain, so a rotation, a hold and a
  // stop can never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  let rotating = false;
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  // ── level meter ────────────────────────────────────────────────────────
  let audioCtx: AudioContext | null = null;
  let workletReady: Promise<boolean> | null = null;
  const meterNodes = new Map<Source, { src: MediaStreamAudioSourceNode; node: AudioWorkletNode; sink: GainNode }>();
  let lastVoiceAt = 0;
  let gestureHooked = false;

  const meterLive = () => !!audioCtx && audioCtx.state === "running" && meterNodes.size > 0;

  function ensureAudio(): Promise<boolean> {
    if (workletReady) return workletReady;
    workletReady = (async () => {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC || typeof AudioWorkletNode === "undefined") return false;
        audioCtx = new AC();
        await audioCtx.audioWorklet.addModule(WORKLET_URL);
        if (audioCtx.state !== "running") {
          await audioCtx.resume().catch(() => {});
          // A reloaded page has no user gesture yet; the first click or key
          // starts the meter. Until then the silence clock stands still.
          if ((audioCtx.state as AudioContextState) !== "running" && !gestureHooked) {
            gestureHooked = true;
            const wake = () => {
              void audioCtx?.resume().then(() => {
                if (audioCtx?.state === "running") {
                  lastVoiceAt = Date.now();
                  window.removeEventListener("pointerdown", wake, true);
                  window.removeEventListener("keydown", wake, true);
                  gestureHooked = false;
                }
              });
            };
            window.addEventListener("pointerdown", wake, true);
            window.addEventListener("keydown", wake, true);
          }
        }
        return true;
      } catch {
        audioCtx = null;
        return false;
      }
    })();
    return workletReady;
  }

  async function meter(source: Source, stream: MediaStream | null) {
    detachMeter(source);
    if (!stream || !(await ensureAudio()) || !audioCtx) return;
    try {
      const src = audioCtx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(audioCtx, "tsp-level", { numberOfOutputs: 1 });
      // A silent path to the destination keeps the node being processed.
      const sink = audioCtx.createGain();
      sink.gain.value = 0;
      src.connect(node);
      node.connect(sink);
      sink.connect(audioCtx.destination);
      node.port.onmessage = (e: MessageEvent<number>) => {
        if (typeof e.data === "number" && e.data > VOICE_RMS) {
          lastVoiceAt = Date.now();
          if (win) win.heard = true;
        }
      };
      meterNodes.set(source, { src, node, sink });
    } catch {
      /* no meter for this track: segments still send, silence can't stop it */
    }
  }

  function detachMeter(source: Source) {
    const m = meterNodes.get(source);
    if (!m) return;
    m.node.port.onmessage = null;
    try {
      m.src.disconnect();
      m.node.disconnect();
      m.sink.disconnect();
    } catch {
      /* already gone */
    }
    meterNodes.delete(source);
  }

  function stopMeter() {
    detachMeter("mic");
    detachMeter("tab");
  }

  // ── windows ────────────────────────────────────────────────────────────
  const offsetNow = () => (ctx ? Math.max(0, Date.now() - ctx.startedAtMs) : 0);

  function nextSeq(offsetMs: number) {
    lastSeq = Math.max(lastSeq + 1, Math.floor(offsetMs / 1000));
    return lastSeq;
  }

  function capturedNow(now = Date.now()) {
    return capturedBefore + (win ? now - win.openedAt : 0);
  }

  function openWindow() {
    if (!ctx || !mic) return;
    const transcriptId = ctx.transcriptId;
    const vocabulary = ctx.vocabulary ?? "";
    const offsetMs = offsetNow();
    const seq = nextSeq(offsetMs);
    const openedAt = Date.now();
    const sources: { source: Source; stream: MediaStream; track: CallTrack }[] = [
      { source: "mic", stream: mic, track: tab ? "self" : "mixed" },
    ];
    if (tab) sources.push({ source: "tab", stream: new MediaStream(tab.getAudioTracks()), track: "other" });

    const recs: Rec[] = [];
    for (const s of sources) {
      const made = createSpeechRecorder(s.stream);
      if (!made) continue;
      const { recorder } = made;
      const rec: Rec = {
        source: s.source,
        track: s.track,
        seq,
        recorder,
        mime: "",
        offsetMs,
        openedAt,
        chunks: [],
        writes: Promise.resolve(),
        stopped: new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.addEventListener("error", () => resolve(), { once: true });
        }),
      };
      let idx = 0;
      recorder.ondataavailable = (e: BlobEvent) => {
        rec.mime = recorder.mimeType || made.mimeType || "audio/webm";
        if (e.data && e.data.size > 0) {
          rec.chunks.push(e.data);
          const row = {
            transcriptId,
            track: rec.track,
            seq,
            idx: idx++,
            offsetMs,
            endMs: offsetNow(),
            writtenAt: Date.now(),
            mime: rec.mime,
            vocabulary,
            blob: e.data,
          };
          rec.writes = rec.writes.then(() => putChunk(row));
        }
        tick();
      };
      try {
        recorder.start(TIMESLICE_MS);
        recs.push(rec);
      } catch {
        /* this track can't record; the others still do */
      }
    }
    // With no meter there is no way to know a window was silent: send it.
    win = { seq, openedAt, recs, heard: !meterLive() };
  }

  /** Close the current window: every track's segment is queued (or skipped
   *  if nobody spoke). Resolves once the queue has it. */
  async function closeWindow(w: Window_ | null) {
    if (!w || !ctx) return;
    const transcriptId = ctx.transcriptId;
    const closedAt = Date.now();
    capturedBefore += closedAt - w.openedAt;
    const heard = w.heard || !meterLive();
    for (const r of w.recs) {
      try {
        if (r.recorder.state !== "inactive") r.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    await Promise.all(w.recs.map((r) => r.stopped));
    for (const r of w.recs) {
      await r.writes;
      const durationMs = closedAt - r.openedAt;
      const blob = new Blob(r.chunks, { type: r.mime || "audio/webm" });
      const keep = heard && blob.size > 0 && durationMs >= MIN_SEGMENT_MS;
      await closeSegment({
        transcriptId,
        track: r.track,
        seq: r.seq,
        chunkCount: r.chunks.length,
        capturedMs: capturedBefore,
        segment: keep
          ? { transcriptId, track: r.track, seq: r.seq, offsetMs: r.offsetMs, durationMs, mime: r.mime || "audio/webm", vocabulary: ctx?.vocabulary ?? "", blob }
          : null,
      }).catch(() => {});
    }
    void flush();
  }

  function detach(): Window_ | null {
    const w = win;
    win = null;
    return w;
  }

  /** Close this window and open the next one straight away. */
  function rotate(): Promise<void> {
    return serial(async () => {
      if (!running || held) return;
      // Open the next window before closing this one so no word falls between.
      const old = win;
      openWindow();
      await closeWindow(old);
    });
  }

  /** Every recorder data event lands here: about once a second per track. */
  function tick() {
    if (!running || held || !win) return;
    const now = Date.now();
    // Belt and braces for the share ending: if the tab's track is over but
    // its ended event never reached us, treat it exactly like the event.
    if (tab && tab.getAudioTracks()[0]?.readyState === "ended") return void autoStop("share_ended");
    if (!meterLive()) lastVoiceAt = now; // can't hear, so never call it silence
    if (now - lastVoiceAt >= T.silenceMs) return void autoStop("silence");
    if (capturedNow(now) >= T.maxMs) return void autoStop("max_length");
    if (now - win.openedAt >= T.segmentMs && !rotating) {
      rotating = true;
      void rotate().finally(() => {
        rotating = false;
      });
    }
  }

  function releaseStreams() {
    stopMeter();
    stopStream(mic);
    stopStream(tab);
    mic = null;
    tab = null;
    label = null;
  }

  function autoStop(reason: AutoStopReason) {
    if (!running) return;
    running = false;
    void serial(async () => {
      await closeWindow(detach());
      releaseStreams();
      releaseLive?.();
      releaseLive = null;
    }).then(() => autoStopListener?.(reason));
  }

  onMaxLength((transcriptId) => {
    if (running && ctx?.transcriptId === transcriptId) autoStop("max_length");
  });

  async function openMic(): Promise<MediaStream> {
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("unsupported");
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch {
      throw new Error("mic_denied");
    }
  }

  function watchMic(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    // The mic went away (unplugged, another app took it). Try once to get it
    // back; if that fails, the silence stop ends the call in ten minutes.
    track.onended = () => {
      if (!running) return;
      void serial(async () => {
        await closeWindow(detach());
        stopStream(mic);
        mic = null;
        try {
          mic = await openMic();
          watchMic(mic);
          void meter("mic", mic);
        } catch {
          return;
        }
        if (running && !held) openWindow();
      });
    };
  }

  function watchTab(stream: MediaStream) {
    const audio = stream.getAudioTracks()[0];
    if (!audio) return;
    audio.onended = () => {
      if (running) autoStop("share_ended");
      else {
        stopStream(tab);
        tab = null;
        label = null;
        detachMeter("tab");
      }
    };
  }

  async function begin(c: CaptureContext, fresh: boolean) {
    ctx = c;
    const meta = await readMeta(c.transcriptId);
    lastSeq = Math.max(meta.lastSeq, -1);
    capturedBefore = fresh ? 0 : meta.capturedMs;
    held = false;
    win = null;
    lastVoiceAt = Date.now();
    void meter("mic", mic);
    if (tab) void meter("tab", tab);
    running = true;
    openWindow();
    if (!win || !(win as Window_).recs.length) {
      running = false;
      win = null;
      releaseStreams();
      releaseLive?.();
      releaseLive = null;
      throw new Error("unsupported");
    }
  }

  if (typeof window !== "undefined") void bootQueue();

  return {
    supportsCallTab() {
      return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && isChromium();
    },

    async start(c: CaptureContext) {
      if (running) await this.stop();
      const release = await claimLive(c.transcriptId);
      try {
        mic = await openMic();
      } catch (err) {
        release?.();
        throw err;
      }
      releaseLive = release;
      watchMic(mic);
      await begin(c, true);
    },

    async reattach(c: CaptureContext) {
      if (running && ctx?.transcriptId === c.transcriptId) return;
      if (running) await this.stop();
      // Whatever the page before the reload was recording is on disk as chunks.
      await recoverChunks(c.transcriptId);
      void flush({ now: true });
      const release = await claimLive(c.transcriptId);
      if (!release) {
        // Another tab is already recording this call. It sends; this one
        // only shows the pill.
        ctx = c;
        return;
      }
      try {
        mic = await openMic();
      } catch (err) {
        release();
        throw err;
      }
      releaseLive = release;
      watchMic(mic);
      await begin(c, false);
    },

    addCallTab(): Promise<AddTabResult> {
      if (!this.supportsCallTab()) return Promise.resolve({ kind: "unsupported" });
      let request: Promise<MediaStream>;
      try {
        // The first thing this click does: getDisplayMedia needs the gesture.
        request = navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          // Chromium options from scoping §5; unknown keys are ignored elsewhere.
          ...({ systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "include", preferCurrentTab: false } as object),
        } as DisplayMediaStreamOptions);
      } catch {
        return Promise.resolve({ kind: "cancelled" });
      }
      return request.then(
        (shared): AddTabResult => {
          const audio = shared.getAudioTracks()[0];
          if (!audio) {
            stopStream(shared);
            return { kind: "no_audio" };
          }
          // Video is only there because the dialog requires it.
          shared.getVideoTracks().forEach((t) => t.stop());
          stopStream(tab);
          tab = shared;
          label = tabLabel(audio);
          watchTab(shared);
          void meter("tab", shared);
          // Mid-call: close the window so the mic becomes `self` from here on.
          if (running && !held) void rotate();
          return { kind: "added", label };
        },
        // NotAllowedError (cancelled) and AbortError look the same to the manager.
        (): AddTabResult => ({ kind: "cancelled" }),
      );
    },

    dropCallTab() {
      if (!tab) return;
      stopStream(tab);
      tab = null;
      label = null;
      detachMeter("tab");
      // Back to mic only: the mic is `mixed` again from the next window.
      if (running && !held) void rotate();
    },

    callTabLabel() {
      return label;
    },

    hold() {
      return serial(async () => {
        if (!running || held) return;
        held = true;
        await closeWindow(detach());
      });
    },

    release() {
      void serial(async () => {
        if (!running || !held) return;
        held = false;
        lastVoiceAt = Date.now();
        openWindow();
      });
    },

    async stop(): Promise<SeqsByTrack> {
      const c = ctx;
      running = false;
      await serial(async () => {
        held = false;
        await closeWindow(detach());
        releaseStreams();
        releaseLive?.();
        releaseLive = null;
      });
      return c ? seqsFor(c.transcriptId) : {};
    },

    onAutoStop(listener) {
      autoStopListener = listener;
    },
  };
}
