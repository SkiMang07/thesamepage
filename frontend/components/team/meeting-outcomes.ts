// ---------------------------------------------------------------------------
// What a logged team meeting actually produced — the receipt.
//
// Built only from saved records: the meeting's reviewed summary, the
// commitments whose source is this meeting, and the agenda items that carry
// its lineage into a later meeting. Right after logging, the server's log
// response (TeamMeetingLogResult) is merged into the page's records first, so
// the receipt and every later view of the same meeting read the same thing.
// Nothing here counts a draft: an unticked or removed draft commitment, a
// discarded AI line or a proposed decision never reaches these records.
//
// Decisions are not a separate record in The Same Page. They live in the
// reviewed summary, and the receipt labels them that way.
// ---------------------------------------------------------------------------

import type { TeamCommitment, TeamMeeting, TeamMeetingLogResult } from "@/lib/api";

export type CarriedOutcome = { text: string; into: TeamMeeting | null };

export type MeetingOutcomes = {
  meeting: TeamMeeting;
  summary: string | null;
  commitments: TeamCommitment[];
  carried: CarriedOutcome[];
  /** The occurrence carried items landed on, or the series' next one. */
  next: TeamMeeting | null;
  /** True when carry-forward is known from the server's log response rather
   *  than reconstructed from lineage (free-text carries have no lineage). */
  carriedFromResponse: boolean;
};

export function deriveOutcomes(
  meeting: TeamMeeting,
  meetings: TeamMeeting[],
  commitments: TeamCommitment[],
  logResult: TeamMeetingLogResult | null = null
): MeetingOutcomes {
  const fromMeeting = commitments.filter(
    (c) => c.source_type === "team_meeting" && c.source_id === meeting.id
  );

  if (logResult && logResult.meeting.id === meeting.id) {
    const next = logResult.next_meeting
      ? meetings.find((m) => m.id === logResult.next_meeting!.id) ?? logResult.next_meeting
      : null;
    return {
      meeting,
      summary: meeting.summary,
      commitments: fromMeeting,
      carried: logResult.carried_forward.map((text) => ({ text, into: next })),
      next,
      carriedFromResponse: true,
    };
  }

  const ownIds = new Set(meeting.agenda_items.map((i) => i.id));
  const carried: CarriedOutcome[] = [];
  let next: TeamMeeting | null = null;
  for (const m of meetings) {
    if (m.id === meeting.id) continue;
    for (const item of m.agenda_items) {
      if (item.carried_from_item_id && ownIds.has(item.carried_from_item_id)) {
        carried.push({ text: item.item, into: m });
        next = next ?? m;
      }
    }
  }
  return {
    meeting,
    summary: meeting.summary,
    commitments: fromMeeting,
    carried,
    next,
    carriedFromResponse: false,
  };
}

// Merge a log response into the page's records: the logged meeting replaces
// its row, the next occurrence is added or refreshed, and the created
// commitments are added unless a refresh already brought them in.
export function mergeLogResult(
  meetings: TeamMeeting[],
  commitments: TeamCommitment[],
  result: TeamMeetingLogResult
): { meetings: TeamMeeting[]; commitments: TeamCommitment[] } {
  let nextMeetings = meetings.map((m) => (m.id === result.meeting.id ? result.meeting : m));
  if (result.next_meeting) {
    const n = result.next_meeting;
    nextMeetings = nextMeetings.some((m) => m.id === n.id)
      ? nextMeetings.map((m) => (m.id === n.id ? n : m))
      : [n, ...nextMeetings];
  }
  const known = new Set(commitments.map((c) => c.id));
  const added = (result.commitments ?? []).filter((c) => !known.has(c.id));
  return { meetings: nextMeetings, commitments: [...added, ...commitments] };
}
