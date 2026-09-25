"use client";

// The receipt for a logged team meeting: what was actually saved. Rendered
// right after confirming a wrap-up (from the server's response merged into
// the page's records) and on the logged meeting's record later (from the
// same records). See meeting-outcomes.ts.

import { useState } from "react";
import Link from "next/link";
import { dueLabel, dueState, longDate, mediumDate, meetingDateStr } from "./dates";
import type { MeetingOutcomes } from "./meeting-outcomes";
import PersonAvatar from "./PersonAvatar";

export default function MeetingReceipt({
  outcomes,
  title = "Meeting logged",
  note,
  recordHref,
  commitmentsHref,
  onDismiss,
  hideSummary = false,
}: {
  outcomes: MeetingOutcomes;
  title?: string;
  /** e.g. why this is showing instead of a fresh save (a retry that found the
   *  meeting already logged). */
  note?: string;
  recordHref?: string;
  commitmentsHref?: string;
  onDismiss?: () => void;
  /** For a page that already shows the (editable) summary right below. */
  hideSummary?: boolean;
}) {
  const { meeting, summary, commitments, carried, next, carriedFromResponse } = outcomes;
  const [fullSummary, setFullSummary] = useState(false);
  const date = meetingDateStr(meeting.scheduled_at);
  const longSummary = (summary ?? "").length > 280;

  return (
    <section
      aria-label="What this meeting saved"
      className="animate-fade-in rounded-xl border border-teal-800/50 bg-surface px-5 py-4 motion-reduce:animate-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-brand">
            {title === "Meeting logged" && <span aria-hidden="true">✓ </span>}
            {title}
          </p>
          <h3 className="mt-1 font-serif text-xl font-normal leading-tight text-ink">
            {date ? longDate(date) : "Undated meeting"}
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {recordHref && (
            <Link href={recordHref} className="text-brand hover:text-brand-hover">
              Open meeting record →
            </Link>
          )}
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="rounded px-2 py-1 text-ink-secondary hover:bg-sunken hover:text-ink">
              Done
            </button>
          )}
        </div>
      </div>
      {note && <p className="mt-2 text-xs text-ink-secondary">{note}</p>}

      <div className={`mt-4 grid gap-5 ${hideSummary ? "sm:grid-cols-2" : "md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"}`}>
        {!hideSummary && (
        <div>
          <p className="text-xs font-medium text-ink-body">Reviewed summary</p>
          <p className="mt-0.5 text-2xs text-ink-muted">Decisions are recorded here, in the summary you confirmed.</p>
          <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary ${fullSummary || !longSummary ? "" : "line-clamp-4"}`}>
            {summary}
          </p>
          {longSummary && (
            <button type="button" onClick={() => setFullSummary((v) => !v)} className="mt-1 text-xs text-brand hover:text-brand-hover">
              {fullSummary ? "Show less" : "Show the whole summary"}
            </button>
          )}
        </div>
        )}

        <div className={hideSummary ? "contents" : "space-y-4"}>
          <div>
            <p className="text-xs font-medium text-ink-body">
              Commitments <span className="font-sans tabular-nums text-ink-muted">· {commitments.length}</span>
            </p>
            {commitments.length === 0 ? (
              <p className="mt-1.5 text-xs text-ink-muted">No commitments were saved from this meeting.</p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {commitments.map((c) => {
                  const state = c.status === "open" ? dueState(c.due_date) : "none";
                  return (
                    <li key={c.id} className="flex items-start gap-2.5">
                      <PersonAvatar id={c.direct_report_id ?? null} name={c.direct_report_name ?? "You"} size="xs" className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm text-ink-body">{c.description}</p>
                        <p className="text-xs text-ink-muted">
                          {c.direct_report_name ?? "You"} ·{" "}
                          {c.status === "open" ? (
                            <span className={state === "overdue" ? "text-amber-700" : undefined}>{dueLabel(c.due_date)}</span>
                          ) : c.status === "done" ? (
                            "Done"
                          ) : (
                            "Dropped"
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {commitments.length > 0 && commitmentsHref && (
              <a href={commitmentsHref} className="mt-1.5 inline-block text-xs text-brand hover:text-brand-hover">
                See them with the team&apos;s commitments →
              </a>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-ink-body">
              Carried forward <span className="font-sans tabular-nums text-ink-muted">· {carried.length}</span>
            </p>
            {carried.length === 0 ? (
              <p className="mt-1.5 text-xs text-ink-muted">
                {carriedFromResponse ? "Nothing was carried forward." : "Nothing carried forward is linked to this meeting."}
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {carried.map((c) => (
                  <li key={c.text} className="text-sm text-ink-body">
                    <span className="mr-1.5 text-ink-muted" aria-hidden="true">→</span>
                    {c.text}
                  </li>
                ))}
              </ul>
            )}
            <NextLine next={next} carriedCount={carried.length} fromResponse={carriedFromResponse} />
          </div>
        </div>
      </div>
    </section>
  );
}

function NextLine({
  next,
  carriedCount,
  fromResponse,
}: {
  next: MeetingOutcomes["next"];
  carriedCount: number;
  fromResponse: boolean;
}) {
  if (!next) {
    if (!fromResponse) return null;
    return (
      <p className="mt-2 text-xs text-ink-muted">
        No follow-up meeting was created — nothing was carried forward and this meeting doesn&apos;t repeat.
      </p>
    );
  }
  const date = meetingDateStr(next.scheduled_at);
  return (
    <p className="mt-2 text-xs text-ink-secondary">
      {date ? (
        <>
          {carriedCount > 0 ? "Added to " : "Next meeting: "}
          <Link href={`/app/team/meetings/${next.id}`} className="text-brand hover:text-brand-hover">
            {carriedCount > 0 ? `the ${mediumDate(date)} meeting` : mediumDate(date)} →
          </Link>
          {next.recurrence_weeks ? ` · ${next.recurrence_weeks === 1 ? "repeats weekly" : `repeats every ${next.recurrence_weeks} weeks`}` : ""}
        </>
      ) : (
        <>
          <span className="text-amber-700">Waiting on a meeting that still needs a date.</span>{" "}
          <Link href={`/app/team/meetings/${next.id}`} className="text-brand hover:text-brand-hover">
            Set the date →
          </Link>
        </>
      )}
    </p>
  );
}
