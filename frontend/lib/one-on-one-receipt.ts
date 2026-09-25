// The hand-off between a confirmed 1:1 wrap-up and the Relationship Desk's
// receipt. Deliberately in-memory: a receipt is feedback on one confirmed
// operation, not a new record, so it lives only for the client-side
// navigation from the review screen back to the person page. A reload loses
// it and the page rebuilds what persisted records support instead (the
// meeting, its linked commitments, the next occurrence).
//
// Scope: keyed by person + meeting. The page only shows a stashed receipt
// when the meeting id is also present in the history it fetched for the
// signed-in manager, so a stale or foreign entry never renders. Reading it
// removes it.

import type { LogOneOnOneResult } from "@/lib/api";

export type OneOnOneReceiptStash = LogOneOnOneResult & {
  personId: string;
  /** The save's response never arrived, and the page found the meeting
   *  already recorded when it checked before letting the manager retry. */
  reconciled?: boolean;
};

let stash: OneOnOneReceiptStash | null = null;

export function stashOneOnOneReceipt(receipt: OneOnOneReceiptStash) {
  stash = receipt;
}

export function takeOneOnOneReceipt(personId: string, meetingId: string): OneOnOneReceiptStash | null {
  const current = stash;
  if (!current) return null;
  // Anything else is incompatible with where we landed: drop it.
  stash = null;
  return current.personId === personId && current.meeting.id === meetingId ? current : null;
}

export function clearOneOnOneReceipt() {
  stash = null;
}
