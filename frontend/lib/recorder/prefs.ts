// Per-device recorder preferences, in localStorage like dictation's
// first-use notice (NoteField.tsx). No migration: per device is acceptable,
// and every read and write is wrapped because storage can be blocked
// (private windows, cleared site data) or throw outright.

const KEYS = {
  askForTab: "tsp:call-ask-for-tab",
  tipSeen: "tsp:call-tab-tip-seen",
  transcribe: "tsp:meet-transcribe",
} as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

/** "Ask for the call tab whenever I start a meeting". Off by default. */
export const getAskForTab = () => read(KEYS.askForTab) === "1";
export const setAskForTab = (on: boolean) => write(KEYS.askForTab, on ? "1" : "0");

/** The one-time "On a video call with Jordan?" tip. */
export const getTipSeen = () => read(KEYS.tipSeen) === "1";
export const setTipSeen = () => write(KEYS.tipSeen, "1");

/** The picker's Transcribe toggle remembers the last choice. On by default. */
export const getTranscribeDefault = () => read(KEYS.transcribe) !== "0";
export const setTranscribeDefault = (on: boolean) => write(KEYS.transcribe, on ? "1" : "0");
