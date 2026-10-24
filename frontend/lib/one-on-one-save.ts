// Saving a reviewed 1:1 log, shared by the wrap-up review (Log a 1:1, prep)
// and the meeting screen's in-place wrap-up.
//
// The server undoes a partially written log before it answers with an
// error, so a failure normally means nothing was saved. The exception is a
// save that succeeded but whose answer never arrived (a dropped connection).
// This checks for that before letting the manager retry, so a retry never
// logs the same conversation twice.

import { getOneOnOneHistory, logOneOnOne, type LogOneOnOneResult } from "@/lib/api";

type LogBody = Parameters<typeof logOneOnOne>[0];

export type SaveOutcome =
  | { kind: "saved"; result: LogOneOnOneResult }
  /** The answer was lost; the meeting was found already recorded. */
  | { kind: "reconciled"; meetingId: string };

export async function saveOneOnOneLog(body: LogBody): Promise<SaveOutcome> {
  const startedAt = Date.now();
  try {
    return { kind: "saved", result: await logOneOnOne(body) };
  } catch (e) {
    const recorded = await findRecordedMeeting(body.direct_report_id, body.summary, startedAt);
    if (recorded) return { kind: "reconciled", meetingId: recorded };
    throw e;
  }
}

// A completed meeting for this person with exactly this reviewed summary,
// logged since this save began. Its id, or null when there is none or the
// check itself could not run (then nothing is assumed saved).
async function findRecordedMeeting(directReportId: string, summary: string, startedAt: number): Promise<string | null> {
  try {
    const history = await getOneOnOneHistory(directReportId);
    const match = history.find(
      (session) =>
        session.status === "completed" &&
        (session.summary ?? "").trim() === summary &&
        session.logged_at != null &&
        new Date(session.logged_at).getTime() >= startedAt - 60_000,
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}
