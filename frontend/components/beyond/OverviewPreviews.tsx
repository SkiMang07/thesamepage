"use client";

// "Across your conversations" — three compact previews under the brief:
// People, My manager, Group conversations. Each shows substance (the latest
// reviewed outcome, the next conversation, commitments both ways), not just
// counts, and opens its full view.

import Link from "next/link";
import { BeyondGroupConversation, BeyondOpenCommitment, BeyondPersonContinuity } from "@/lib/api";
import { META } from "@/lib/tokens";
import { dayShort, firstName, firstSentence, meetingTitle } from "@/app/app/beyond/shared";

export type BeyondView = "overview" | "people" | "my-manager" | "groups";

// Soonest next conversation first, then the most recently reviewed.
export function featuredPerson(people: BeyondPersonContinuity[]) {
  return [...people].sort((a, b) => {
    const an = a.next_meeting?.date ?? null;
    const bn = b.next_meeting?.date ?? null;
    if (an && bn) return an.localeCompare(bn);
    if (an) return -1;
    if (bn) return 1;
    return (b.last_met ?? "").localeCompare(a.last_met ?? "");
  })[0];
}

function short(text: string, max = 28) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function Between({ person }: { person: BeyondPersonContinuity }) {
  const mine = person.you_owe[0];
  const theirs = person.they_owe[0];
  if (!mine && !theirs) return <p className="mt-2 text-sm text-ink-muted">Nothing recorded as open between you.</p>;
  const part = (who: string, c: BeyondOpenCommitment) => `${who}: ${short(c.description)}`;
  return (
    <p className="mt-2 text-sm text-ink-body">
      {[mine && part(mine.committed_by === "direct_report" ? firstName(mine.owner_name) : "You", mine), theirs && part(firstName(person.name), theirs)]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

function PersonPreview({ person, label }: { person: BeyondPersonContinuity; label: string }) {
  const outcome = person.latest_outcome;
  const next = person.next_meeting;
  return (
    <>
      <p className="mt-3 text-base font-semibold text-ink">{person.name}</p>
      <p className="text-sm text-brand">
        {next ? `Next ${label} · ${next.date ? dayShort(next.date) : "no date yet"}` : <span className="text-ink-muted">No next conversation on record</span>}
      </p>
      {outcome ? (
        <>
          <p className="mt-3 line-clamp-3 text-[0.95rem] leading-6 text-ink">{firstSentence(outcome.summary)}</p>
          <p className={`${META} mt-2`}>
            Reviewed {dayShort(outcome.date)} · {meetingTitle({ title: outcome.title, kind: outcome.kind, people: outcome.people })}
            {outcome.kind === "group" ? " (group)" : ""}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-secondary">No reviewed conversation yet.</p>
      )}
      <Between person={person} />
    </>
  );
}

function Preview({
  title,
  children,
  cta,
  onOpen,
}: {
  title: string;
  children: React.ReactNode;
  cta: string;
  onOpen: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-hairline bg-surface px-5 py-5">
      <h3 className="font-serif text-[1.45rem] font-normal leading-tight tracking-[-0.02em] text-ink">{title}</h3>
      <div className="flex-1">{children}</div>
      <button type="button" onClick={onOpen} className="mt-4 self-start text-sm text-brand hover:text-brand-hover">
        {cta} →
      </button>
    </section>
  );
}

export default function OverviewPreviews({
  people,
  managers,
  groups,
  columns,
  onOpen,
}: {
  people: BeyondPersonContinuity[];
  managers: BeyondPersonContinuity[];
  groups: BeyondGroupConversation[];
  columns: 1 | 3;
  onOpen: (view: BeyondView) => void;
}) {
  const person = featuredPerson(people);
  const manager = featuredPerson(managers);
  // Coming up first, then not written up, then the latest written up — the
  // list arrives in that order.
  const group = groups[0];

  return (
    <div className={`grid gap-4 ${columns === 3 ? "grid-cols-3" : "grid-cols-1"}`}>
      <Preview title="People" cta="Open people" onOpen={() => onOpen("people")}>
        {person ? (
          <>
            <PersonPreview person={person} label="1:1" />
            {people.length > 1 && <p className={`${META} mt-2`}>+ {people.length - 1} more</p>}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">
            No peers, skip-levels or partners here yet. Add someone, or log a meeting and add people as you go.
          </p>
        )}
      </Preview>

      <Preview title="My manager" cta="Open my manager" onOpen={() => onOpen("my-manager")}>
        {manager ? (
          <>
            <PersonPreview person={manager} label="1:1" />
            {managers.length > 1 && (
              <p className={`${META} mt-2`}>{managers.length} people are marked as your manager.</p>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">
            No one is marked as your manager yet. Add them to keep your updates, asks and decisions in one place.
          </p>
        )}
      </Preview>

      <Preview title="Group conversations" cta="Open group conversations" onOpen={() => onOpen("groups")}>
        {group ? (
          <>
            <p className="mt-3 text-base font-semibold text-ink">{group.title || "Untitled group meeting"}</p>
            <p className={`text-sm ${group.status === "draft" ? "text-amber-700" : group.status === "upcoming" ? "text-brand" : "text-ink-muted"}`}>
              {group.status === "upcoming"
                ? `Next · ${group.date ? dayShort(group.date) : "no date yet"}`
                : group.status === "draft"
                  ? `${group.has_notes ? "Notes saved" : "Met"} ${dayShort(group.date)} · not written up`
                  : `Reviewed ${dayShort(group.date)}`}
            </p>
            <p className="mt-3 text-[0.95rem] text-ink">
              {group.people.length ? group.people.slice(0, 3).map((p) => firstName(p.name)).join(" + ") : "No attendees recorded"}
              {group.people.length > 3 ? ` + ${group.people.length - 3}` : ""}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-ink-secondary">
              {group.status === "logged" ? firstSentence(group.summary) : "Outcome not reviewed yet"}
            </p>
            {group.open_commitments.length > 0 && (
              <p className={`${META} mt-2`}>{group.open_commitments.length} recorded as open</p>
            )}
            {group.status === "draft" && (
              <Link href={`/app/beyond/meetings/${group.id}`} className="mt-2 inline-block text-sm text-amber-700 hover:text-amber-600">
                Review notes →
              </Link>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">No group meetings logged yet.</p>
        )}
      </Preview>
    </div>
  );
}
