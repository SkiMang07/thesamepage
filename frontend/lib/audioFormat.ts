// ---------------------------------------------------------------------------
// Speech recording format, shared by dictation (useDictation.ts) and the call
// recorder (lib/recorder/browserEngine.ts) so the two never drift apart.
//
//  - Safari below 18.4 cannot do webm at all; it gives audio/mp4 (AAC). Some
//    iOS builds report isTypeSupported() true and then throw from the
//    constructor anyway, so candidates are tried in order AND construction is
//    wrapped in a try/catch. Never UA-sniff.
//  - 32 kbps is the Xiph recommendation for speech: ~14 MB an hour, a quarter
//    of the browser default. Safari ignores the hint.
// ---------------------------------------------------------------------------

export const SPEECH_BITRATE = 32000;

export const MIME_CANDIDATES = [
  "audio/webm;codecs=opus", // Chrome, Edge, Firefox, Safari 18.4+
  "audio/webm",
  "audio/mp4", // Safari < 18.4
  "", // let the browser pick, and hope
];

/** The microphone settings both features ask for: mono speech, cleaned up. */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  channelCount: 1,
};

export function pickMimeType(): string {
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

/** A MediaRecorder at speech bitrate, or null if this browser can't record.
 *  `mimeType` is what was asked for; the recorder's own .mimeType is what it
 *  actually produces and is the one to label the blob with. */
export function createSpeechRecorder(stream: MediaStream): { recorder: MediaRecorder; mimeType: string } | null {
  const mimeType = pickMimeType();
  try {
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: SPEECH_BITRATE,
    });
    return { recorder, mimeType };
  } catch {
    try {
      return { recorder: new MediaRecorder(stream), mimeType }; // isTypeSupported lied; take the default
    } catch {
      return null;
    }
  }
}
