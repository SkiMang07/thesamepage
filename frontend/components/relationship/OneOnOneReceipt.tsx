"use client";

// The receipt after a reviewed 1:1 is logged: what the server confirms it
// saved, not what was submitted. Straight after saving it renders the log
// response (meeting, inserted commitments, confirmed carry-forward topics,
// resulting next occurrence). After a reload it renders what persisted
// records support — the meeting and its explicitly linked commitments — and
// says the carried topics aren't recorded against the meeting.
//
// It is feedback on one confirmed operation, not a new object: dismissing it
// removes it. The one write is Undo, offered for 30 minutes after the save
// (the server enforces the window and says when a log can't be undone).

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Commitment, OneOnOne } from "@/lib/api";
import PersonAvatar from "@/components/team/PersonAvatar";
import { mediumDate, shortDate } from "@/components/team/dates";
import { firstName, fullDate, ownerOf, recurrenceLabel, sessionDate } from "./desk";

export type ReceiptView = {
  meeting: OneOnOne;
  commitments: Commitment[];
  /** Confirmed outgoing topics from the save response; null after a reload. */
  carried: string[] | null;
  next: OneOnOne | null;
  /** The save's response was lost; the meeting was found already recorded. */
  reconciled: boolean;
  /** Until when Undo is offered; null when it isn't. */
  undoUntil?: string | null;
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export default function OneOnOneReceipt({
  receipt,
  personId,
  personName,
  refreshFailed,
  retrying,
  onRetryRefresh,
  onDismiss,
  onUndo,
  onViewConversation,
}: {
  receipt: ReceiptView;
  personId: string;
  personName: string;
  refreshFailed: boolean;
  retrying: boolean;
  onRetryRefresh: () => void;
  onDismiss: () => void;
  /** Throws when the server refuses; the message is shown here. */
  onUndo?: () => Promise<void>;
  onViewConversation: () => void;
}) {
  const [fullSummary, setFullSummary] = useState(false);
  const first = firstName(personName);
  const { meeting, commitments, carried, next, reconciled } = receipt;
  const date = sessionDate(meeting);
  const nextDate = next?.scheduled_at ? sessionDate(next) : null;
  const summary = meeting.summary ?? "";
  const long = summary.length > 320;
  const keptPrep = next?.status === "planned";

  // Undo hides itself when its window closes.
  const undoUntil = receipt.undoUntil ? Date.parse(receipt.undoUntil) : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!undoUntil) return;
    const left = undoUntil - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => setNow(Date.now()), Math.min(left + 50, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [undoUntil, now]);
  const canUndo = !!onUndo && undoUntil > now;
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  async function undo() {
    if (!onUndo || undoing) return;
    setUndoing(true);
    setUndoError(null);
    try {
      await onUndo();
    } catch (e) {
      setUndoError(undoMessage(e));
      setUndoing(false);
    }
  }

  const line = [
    "Logged",
    plural(commitments.length, "commitment"),
    ...(carried ? [`${plural(carried.length, "topic")} carried`] : []),
    ...(nextDate ? [`next 1:1 ${mediumDate(nextDate)}`] : []),
  ].join(" · ");

  return (
    <section
      aria-labelledby="receipt-heading"
      className="mb-6 animate-fade-in rounded-xl border border-brand/40 bg-brand-tint px-5 py-5 motion-reduce:animate-none sm:px-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-brand">
          <span aria-hidden="true">✓ </span>Saved
        </p>
        <div className="flex items-center gap-1">
          {canUndo && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={undoing}
              className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-surface hover:text-brand-hover disabled:opacity-50"
            >
              {undoing ? "Undoing…" : "Undo"}
            </button>
          )}
          <button type="button" onClick={onDismiss} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface hover:text-ink">
            Dismiss
          </button>
        </div>
      </div>
      <h2 id="receipt-heading" tabIndex={-1} className="mt-2 text-base font-semibold leading-snug text-ink focus:outline-none">
        {line}
      </h2>
      {undoError && (
        <p role="alert" className="mt-2 text-xs text-amber-700">
          {undoError}
        </p>
      )}
      {reconciled && (
        <p className="mt-2 text-xs text-ink-secondary">
          The save went through even though its confirmation didn&apos;t reach you, so it wasn&apos;t logged twice.
        </p>
      )}

      <p className={`mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-body ${fullSummary || !long ? "" : "line-clamp-3"}`}>{summary}</p>
      {long && (
        <button type="button" onClick={() => setFullSummary((v) => !v)} className="mt-1 text-xs text-brand hover:text-brand-hover">
          {fullSummary ? "Show less" : "Show the whole summary"}
        </button>
      )}
      <p className="mt-1 text-xs text-ink-muted">Reviewed summary · {date ? fullDate(date) : "Undated"} · Decisions live in this summary.</p>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-ink-body">
            Commitments <span className="font-sans tabular-nums text-ink-muted">· {commitments.length}</span>
          </p>
          {commitments.length === 0 ? (
            <p className="mt-1.5 text-xs text-ink-muted">No commitments were saved from this conversation.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {commitments.map((c) => {
                const mine = ownerOf(c) === "manager";
                return (
                  <li key={c.id} className="flex items-start gap-2.5">
                    <PersonAvatar id={mine ? null : personId} name={mine ? "You" : personName} size="xs" className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm text-ink-body">{c.description}</p>
                      <p className="text-xs text-ink-muted">
                        {mine ? "You" : first} · {c.due_date ? `Due ${shortDate(c.due_date)}` : "No due date"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-ink-body">
            Carried to the next 1:1
            {carried && <span className="font-sans tabular-nums text-ink-muted"> · {carried.length}</span>}
          </p>
          {carried === null ? (
            <p className="mt-1.5 text-xs text-ink-muted">Carried topics aren&apos;t recorded against a past meeting. They&apos;re waiting in the next conversation.</p>
          ) : carried.length === 0 ? (
            <p className="mt-1.5 text-xs text-ink-muted">Nothing was carried forward.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {carried.map((t) => (
                <li key={t} className="text-sm text-ink-body">
                  <span aria-hidden="true" className="mr-1.5 text-ink-muted">→</span>
                  {t}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-secondary">
            {!next ? (
              "The next conversation will show here once the page refreshes."
            ) : keptPrep ? (
              <>Your prepared {nextDate ? fullDate(nextDate) : "next"} conversation is still waiting, with its prep.</>
            ) : nextDate ? (
              <>
                Next conversation {fullDate(nextDate)}
                {recurrenceLabel(next.recurrence_weeks) ? ` · ${recurrenceLabel(next.recurrence_weeks)!.toLowerCase()}` : ""}
              </>
            ) : (
              <span className="text-amber-700">The next conversation needs a date.</span>
            )}
          </p>
        </div>
      </div>

      {refreshFailed && (
        <p className="mt-4 text-xs text-amber-700" role="status">
          Saved — but the rest of this page couldn&apos;t refresh, so some lists may be out of date. Don&apos;t log it again.{" "}
          <button type="button" onClick={onRetryRefresh} disabled={retrying} className="font-medium text-brand underline hover:text-brand-hover disabled:opacity-50">
            {retrying ? "Refreshing…" : "Refresh the page's records"}
          </button>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium">
        <button type="button" onClick={onViewConversation} className="text-brand hover:text-brand-hover">
          View recorded conversation <span aria-hidden="true">↗</span>
        </button>
        {next && (
          <Link
            href={`/app/reports/${personId}/prep${next.status === "planned" ? `?resume=${next.id}&edit=1` : ""}`}
            className="text-brand hover:text-brand-hover"
          >
            Review next conversation <span aria-hidden="true">↗</span>
          </Link>
        )}
        {next && !nextDate && !keptPrep && (
          <Link href={`/app/reports/${personId}/prep#schedule`} className="text-brand hover:text-brand-hover">
            Set a date <span aria-hidden="true">↗</span>
          </Link>
        )}
      </div>
    </section>
  );
}

function undoMessage(e: unknown): string {
  const fallback = "Couldn't undo this just now. Try again.";
  if (!(e instanceof Error)) return fallback;
  try {
    const body = JSON.parse(e.message.replace(/^API error \d+: /, ""));
    const msg = body?.detail?.message;
    return typeof msg === "string" ? msg : fallback;
  } catch {
    return fallback;
  }
}
