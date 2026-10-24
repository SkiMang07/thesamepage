// How the report's read-only transcript reads (app/app/ic/transcripts/[id]).
// Pure, so the rules are testable without a page: labels turned round for
// the reader, and every gap one neutral line whatever caused it.

import type { CallTranscriptDetail } from "@/lib/api";

export type ReportTranscriptItem =
  | { type: "line"; t: number; clock: string; speaker: string; text: string }
  | { type: "gap"; t: number; label: string };

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function gapLabel(ms: number) {
  const m = Math.round(ms / 60_000);
  return `Not transcribed · ${m < 1 ? "under a minute" : `${m} min`}`;
}

export function buildReportTranscript(t: CallTranscriptDetail, managerName: string): { items: ReportTranscriptItem[]; note: string | null } {
  const lastLine = t.lines.length ? t.lines[t.lines.length - 1].t_ms : 0;
  const span = t.ended_at ? Math.max(lastLine, Date.parse(t.ended_at) - Date.parse(t.started_at)) : lastLine;
  const items: ReportTranscriptItem[] = t.lines.map((l) => ({
    type: "line",
    t: l.t_ms,
    clock: clock(l.t_ms),
    speaker: l.speaker === "other" ? "You" : l.speaker === "self" ? managerName : "",
    text: l.text,
  }));
  for (const g of t.gaps) {
    // Built from start and end only. Whatever else a gap object carries is
    // never read here.
    const end = g.end_ms ?? span;
    items.push({ type: "gap", t: g.start_ms, label: gapLabel(Math.max(0, end - g.start_ms)) });
  }
  items.sort((a, b) => a.t - b.t || (a.type === "gap" ? -1 : 1));
  const mixed = t.lines.filter((l) => l.speaker === "mixed").length;
  const note =
    mixed === 0
      ? null
      : mixed === t.lines.length
        ? `Only ${managerName === "Your manager" ? "your manager" : managerName}'s microphone was on, so lines aren't split by who was speaking.`
        : `Where only ${managerName === "Your manager" ? "your manager" : managerName}'s microphone was on, lines aren't split by who was speaking.`;
  return { items, note };
}
