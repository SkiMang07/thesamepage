// ---------------------------------------------------------------------------
// The recorder's two halves (docs/systems/call-transcription.md).
//
// RecorderProvider (app layout) owns everything the manager sees and the
// server lifecycle: start, pause, resume and end go through lib/api.ts, the
// pill's state lives there, and a reload rebuilds it from the server.
//
// A CaptureEngine owns audio and nothing else. browserEngine.ts records the
// mic and the call tab in 3-minute segments per track and queues them on the
// device (queue.ts) until the server has them. stubEngine.ts sends nothing and
// is kept for design work.
//
// Rules the engine keeps (CALL_TRANSCRIPTION_BUILD_SCOPING.md, Part C):
//   - Every offset is milliseconds since the transcript's started_at, by the
//     wall clock, across reloads, pauses and resumes. `ctx.startedAtMs` is
//     that origin.
//   - hold() cuts the current segment at the moment of Pause / Go off the
//     record, so nothing said after it is ever sent.
//   - The mic's track is `mixed` while it is the only track and `self` once
//     the call tab is added; the tab is `other`.
//   - Rotation is driven by recorder events, never setTimeout.
// ---------------------------------------------------------------------------

import type { CallTrack } from "@/lib/api";

export type SeqsByTrack = Partial<Record<CallTrack, number[]>>;

export type CaptureContext = {
  transcriptId: string;
  /** Epoch ms of the transcript's started_at: the origin of every offset. */
  startedAtMs: number;
  /** Names to bias spelling (the person's name, team vocabulary). */
  vocabulary?: string;
};

export type AutoStopReason = "silence" | "max_length" | "share_ended";

export type AddTabResult =
  | { kind: "added"; label: string }
  | { kind: "cancelled" }
  /** Shared, but without sound: "Also share tab audio" was off. */
  | { kind: "no_audio" }
  | { kind: "unsupported" };

export interface CaptureEngine {
  /** Can this browser add the call tab's sound at all? (Chromium only.) */
  supportsCallTab(): boolean;
  /** Start capturing the mic for a transcript that has just started. Rejects
   *  with Error("mic_denied") or Error("unsupported"). */
  start(ctx: CaptureContext): Promise<void>;
  /** After a reload or a resume-after-stop: pick up a running transcript
   *  (flush the queue, open the mic again). */
  reattach(ctx: CaptureContext): Promise<void>;
  /** MUST be called synchronously inside the click that asked for it:
   *  getDisplayMedia needs a fresh user gesture. Safe to call before a
   *  transcript exists (the Meet click with "Ask for the call tab" on). */
  addCallTab(): Promise<AddTabResult>;
  dropCallTab(): void;
  callTabLabel(): string | null;
  /** Close the current segment now and stop sending (Pause, Off the record). */
  hold(): Promise<void>;
  /** Start sending again after hold(). */
  release(): void;
  /** Stop everything. Resolves with every seq sent, per track, for End. */
  stop(): Promise<SeqsByTrack>;
  /** The provider registers one listener: 10 minutes of silence on every
   *  track, 2 hours, or the shared call tab closing. The engine has already
   *  stopped capturing when it fires. */
  onAutoStop(listener: (reason: AutoStopReason) => void): void;
}
