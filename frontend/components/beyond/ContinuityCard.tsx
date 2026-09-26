"use client";

// One relationship beyond the team, as option A's "pick up the
// conversation" card: where you left off (the latest REVIEWED outcome, with
// its source and date), what's between you now (commitments both ways with
// their real owners, carried topics, your saved thoughts), and the next
// conversation. Deeper history and prep live on the person page.
//
// Everything shown is a record. Missing things stay missing: no next
// conversation on record is said as that, never as "overdue".

import Link from "next/link";
import { BeyondOpenCommitment, BeyondPersonContinuity } from "@/lib/api";
import { BTN_PRIMARY_SM, BTN_SECONDARY, EYEBROW, META } from "@/lib/tokens";
import ThoughtBox from "./ThoughtBox";
import { RELATIONSHIP_LABEL, dayShort, dayWeekday, firstName, meetingTitle } from "@/app/app/beyond/shared";

export function commitmentOwner(c: BeyondOpenCommitment) {
  if (c.committed_by === "manager") return "You";
  if (c.committed_by === "direct_report") return `${c.owner_name ?? "Your report"} (your report)`;
  return firstName(c.owner_name) || "They";
}

export function CommitmentLine({ c, showSource = false }: { c: BeyondOpenCommitment; showSource?: boolean }) {
  const src = c.source_meeting;
  return (
    <li className="text-sm text-ink-body">
      <span className="text-ink">{commitmentOwner(c)}</span>
      <span className="text-ink-muted"> → </span>
      {c.description}
      {c.due_date && <span className="text-ink-secondary"> · {dayShort(c.due_date)}</span>}
      {showSource && src && (
        <Link href={`/app/beyond/meetings/${src.id}`} className="ml-1 text-xs text-ink-muted hover:text-brand">
          from {meetingTitle({ title: src.title, kind: src.kind, people: src.people })}
          {src.kind === "group" ? " (group)" : ""}
        </Link>
      )}
    </li>
  );
}

export default function ContinuityCard({
  person,
  prepItemsAvailable,
  onChanged,
  manager = false,
}: {
  person: BeyondPersonContinuity;
  prepItemsAvailable: boolean;
  onChanged: () => void;
  // My manager emphasis: team updates, asks and decisions.
  manager?: boolean;
}) {
  const first = firstName(person.name);
  const next = person.next_meeting;
  const outcome = person.latest_outcome;
  const cadence = person.cadence_weeks;
  const theirs = person.they_owe;
  const yours = person.you_owe;
  const nothingOpen = theirs.length === 0 && yours.length === 0;

  return (
    <article className="rounded-xl border border-hairline bg-surface px-5 py-5">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-serif text-[1.55rem] font-normal leading-tight tracking-[-0.02em] text-ink">
            <Link href={`/app/beyond/people/${person.id}`} className="hover:text-brand">
              {person.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-ink-muted">
            {RELATIONSHIP_LABEL[person.relationship]}
            {person.role_title && ` · ${person.role_title}`}
          </p>
        </div>
        <div className="text-right">
          {next ? (
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">
              {next.date ? dayWeekday(next.date) : "Next 1:1 · no date yet"}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">No next conversation on record</p>
          )}
          {cadence && <p className={META}>Repeats {cadence === 1 ? "weekly" : `every ${cadence} weeks`}</p>}
          {next && <p className={META}>{next.prepared ? "Prepared" : "Not prepared yet"}</p>}
        </div>
      </header>

      <div className="mt-4 grid gap-6 border-t border-divider pt-4 md:grid-cols-2">
        <div className="min-w-0">
          <p className={EYEBROW}>Where we left off</p>
          {outcome ? (
            <>
              <p className="mt-2 line-clamp-4 text-[0.95rem] leading-6 text-ink">{outcome.summary}</p>
              <Link href={`/app/beyond/meetings/${outcome.id}`} className="mt-2 inline-block text-sm text-brand hover:text-brand-hover">
                Reviewed {dayShort(outcome.date)} · {meetingTitle({ title: outcome.title, kind: outcome.kind, people: outcome.people })}
                {outcome.kind === "group" ? " (group meeting)" : ""} →
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-secondary">No reviewed conversation with {first} yet.</p>
          )}
          {person.draft && (
            <p className="mt-2 text-sm text-amber-700">
              {dayShort(person.draft.date)} {person.draft.has_notes ? "notes saved" : "1:1"} · outcome not reviewed yet.{" "}
              <Link href={`/app/beyond/meetings/${person.draft.id}`} className="underline underline-offset-2">
                Review notes
              </Link>
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className={EYEBROW}>{manager ? "Updates, asks and decisions" : "Between now and then"}</p>
          {nothingOpen ? (
            <p className="mt-2 text-sm text-ink-secondary">Nothing recorded as open between you.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {yours.length > 0 && (
                <div>
                  {manager && <p className={`${META} mb-0.5`}>You owe {first}</p>}
                  <ul className="space-y-1">
                    {yours.slice(0, 3).map((c) => (
                      <CommitmentLine key={c.id} c={c} />
                    ))}
                  </ul>
                </div>
              )}
              {theirs.length > 0 && (
                <div>
                  {manager && <p className={`${META} mb-0.5`}>Recorded as open from {first}</p>}
                  <ul className="space-y-1">
                    {theirs.slice(0, 3).map((c) => (
                      <CommitmentLine key={c.id} c={c} />
                    ))}
                  </ul>
                </div>
              )}
              {yours.length + theirs.length > 6 && (
                <Link href={`/app/beyond/people/${person.id}`} className={`${META} hover:text-brand`}>
                  {yours.length + theirs.length - 6} more on {first}&apos;s page
                </Link>
              )}
            </div>
          )}
          {next && next.carried.length > 0 && (
            <ul className="mt-3 space-y-1">
              {next.carried.slice(0, 3).map((t) => (
                <li key={t} className="text-sm text-ink-body">
                  <span className="text-ink-muted">Bring forward:</span> {t}
                </li>
              ))}
            </ul>
          )}
          {next && next.prep_items.length > 0 && (
            <ul className="mt-3 space-y-1">
              {next.prep_items.map((i) => (
                <li key={i.id} className="text-sm text-ink-body">
                  <span className="text-ink-muted">Your note:</span> “{i.text}”
                </li>
              ))}
              <li className={META}>Private · shown here and in prep, not agreed commitments</li>
            </ul>
          )}
        </div>
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {next && prepItemsAvailable && (
          <div className="mr-auto min-w-0 flex-1">
            <ThoughtBox meetingId={next.id} meetingDate={next.date} withLabel={first} onSaved={onChanged} />
          </div>
        )}
        <Link href={`/app/beyond/people/${person.id}`} className="text-sm text-ink-secondary hover:text-ink">
          History →
        </Link>
        {next ? (
          <Link href={`/app/beyond/meetings/${next.id}`} className={BTN_PRIMARY_SM}>
            {next.prepared ? "Open prep" : manager ? "Prepare your update" : "Prepare"}
          </Link>
        ) : (
          <Link href={`/app/beyond/meetings/new?person=${person.id}&plan=1`} className={BTN_SECONDARY}>
            Plan the next 1:1
          </Link>
        )}
      </footer>
    </article>
  );
}
