// The words for call transcription usage, in one place so Settings and the
// recording pill's menu can never disagree. Numbers come from
// GET /api/call-transcripts/usage (routes/call_transcripts.py → allowance_for).
// Monthly allowances reset on the 1st, UTC; the trial's is for its whole life.

export type CallUsage = {
  tier: string;
  period: "month" | "total";
  used_seconds: number;
  allowed_seconds: number;
  allowed_hours: number;
  at_limit: boolean;
  resets_on: string | null;
};

/** The pill's note appears from this share of the allowance up. */
export const USAGE_NOTE_FROM = 0.8;

/** Hours as a manager reads them: "Under 1" below half an hour, one decimal
 *  below 10 ("2.5"), whole hours above ("12"). */
export function formatUsedHours(seconds: number): string {
  if (seconds <= 0) return "0";
  if (seconds < 1800) return "Under 1";
  const hours = seconds / 3600;
  if (hours < 10) return String(Math.round(hours * 10) / 10);
  return String(Math.round(hours));
}

function allowed(u: CallUsage): string {
  return String(u.allowed_hours);
}

/** "November", from the reset date; and the month that ends the day before it. */
function months(resetsOn: string): { resets: string; current: string } {
  const r = new Date(`${resetsOn}T00:00:00Z`);
  const prev = new Date(r.getTime() - 86_400_000);
  const name = (d: Date) => d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return { resets: name(r), current: name(prev) };
}

/** The Settings line. null means the block is hidden (an invited report). */
export function settingsUsageLine(u: CallUsage): string | null {
  if (u.tier === "ic") return null;
  if (u.allowed_seconds <= 0) {
    return u.tier === "read_only"
      ? "Call transcription is off while your account is read-only. You can still delete transcripts and clear consent."
      : "Call transcription isn't included on this account.";
  }
  if (u.period === "total") {
    return u.at_limit
      ? `You've used the ${allowed(u)} transcription hours in your trial. Call notes and dictation still work.`
      : `${formatUsedHours(u.used_seconds)} of ${allowed(u)} trial hours used.`;
  }
  const m = u.resets_on ? months(u.resets_on) : null;
  if (u.at_limit) {
    return m
      ? `You've used your ${allowed(u)} hours for ${m.current}. Resets ${m.resets} 1. Call notes and dictation still work.`
      : `You've used your ${allowed(u)} hours for this month. Call notes and dictation still work.`;
  }
  return m
    ? `${formatUsedHours(u.used_seconds)} of ${allowed(u)} hours used this month. Resets ${m.resets} 1.`
    : `${formatUsedHours(u.used_seconds)} of ${allowed(u)} hours used this month.`;
}

/** The pill menu's note: nothing below 80%, nobody needs a meter at 3 hours.
 *  At 100% the call still finishes (the allowance is checked at start only). */
export function pillUsageNote(u: CallUsage | null): string | null {
  if (!u || u.allowed_seconds <= 0) return null;
  if (u.used_seconds / u.allowed_seconds < USAGE_NOTE_FROM) return null;
  if (u.period === "total") {
    return u.at_limit
      ? `You've used your ${allowed(u)} trial hours. This 1:1 keeps transcribing.`
      : `${formatUsedHours(u.used_seconds)} of ${allowed(u)} trial hours used`;
  }
  if (u.at_limit) {
    const m = u.resets_on ? months(u.resets_on) : null;
    return m
      ? `You've reached ${allowed(u)} hours for ${m.current}. This 1:1 keeps transcribing; new ones can be transcribed again from ${m.resets} 1.`
      : `You've reached ${allowed(u)} hours this month. This 1:1 keeps transcribing.`;
  }
  return `${formatUsedHours(u.used_seconds)} of ${allowed(u)} hours used this month`;
}
