// ---------------------------------------------------------------------------
// The stub capture engine — session 3 of the call transcription build.
//
// The meeting screen and the pill are built against the CaptureEngine
// interface (types.ts), and this stands in until session 2's browser engine
// replaces it. It sends no audio: the transcript row starts, pauses, resumes
// and ends on the server for real, but stays empty.
//
// The call tab is real, though. "Add Jordan's side" opens the browser's
// actual share dialog, so cancelling it, sharing without sound and closing
// the tab all behave as they will once audio flows. The stream is held only
// to notice those events and is never recorded.
//
// For sandbox checks, window.__tspRecorderStub can fire the auto-stops that
// need real time to happen (10 minutes of silence, 2 hours).
// ---------------------------------------------------------------------------

import type { AddTabResult, AutoStopReason, CaptureContext, CaptureEngine, SeqsByTrack } from "./types";

type StubHooks = { autoStop: (reason: AutoStopReason) => void };

declare global {
  interface Window {
    __tspRecorderStub?: StubHooks;
  }
}

function isChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  if (brands?.length) return brands.some((b) => /Chromium/.test(b.brand));
  // Safari and Firefox share without tab audio: mic only (scoping §5).
  return /Chrome\//.test(navigator.userAgent);
}

function tabLabel(track: MediaStreamTrack): string {
  // Chromium names the shared surface in the track label ("web-contents-media-stream://…")
  // only loosely; the settings can say whether it was a tab. A friendly
  // generic name beats a raw id.
  const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  return surface === "browser" || !surface ? "the call tab" : "the shared window";
}

export function createStubEngine(): CaptureEngine {
  let stream: MediaStream | null = null;
  let label: string | null = null;
  let running = false;
  let autoStopListener: ((reason: AutoStopReason) => void) | null = null;

  function releaseStream() {
    stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    stream = null;
    label = null;
  }

  function fireAutoStop(reason: AutoStopReason) {
    if (!running) return;
    running = false;
    releaseStream();
    autoStopListener?.(reason);
  }

  if (typeof window !== "undefined") {
    window.__tspRecorderStub = { autoStop: fireAutoStop };
  }

  return {
    supportsCallTab() {
      return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && isChromium();
    },

    async start(_ctx: CaptureContext) {
      running = true;
    },

    async reattach(_ctx: CaptureContext) {
      running = true;
    },

    async addCallTab(): Promise<AddTabResult> {
      if (!this.supportsCallTab()) return { kind: "unsupported" };
      try {
        // Called synchronously from the click (see CaptureEngine.addCallTab).
        const shared = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          // Chromium options from scoping §5; unknown keys are ignored elsewhere.
          ...({ systemAudio: "include", selfBrowserSurface: "exclude", preferCurrentTab: false } as object),
        } as DisplayMediaStreamOptions);
        const audio = shared.getAudioTracks()[0];
        if (!audio) {
          shared.getTracks().forEach((t) => t.stop());
          return { kind: "no_audio" };
        }
        // Video is only there because the dialog requires it.
        shared.getVideoTracks().forEach((t) => t.stop());
        releaseStream();
        stream = shared;
        label = tabLabel(audio);
        audio.onended = () => fireAutoStop("share_ended");
        return { kind: "added", label };
      } catch {
        // NotAllowedError (cancelled) and AbortError look the same to the manager.
        return { kind: "cancelled" };
      }
    },

    dropCallTab() {
      releaseStream();
    },

    callTabLabel() {
      return label;
    },

    async hold() {
      /* nothing is being sent */
    },

    release() {
      /* nothing to resume */
    },

    async stop(): Promise<SeqsByTrack> {
      running = false;
      releaseStream();
      return {};
    },

    onAutoStop(listener) {
      autoStopListener = listener;
    },
  };
}
