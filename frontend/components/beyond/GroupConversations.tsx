"use client";

// Group conversations — meetings beyond the team with more than one person.
//
// Each row is ONE meeting record. Recurring group conversations aren't
// supported yet, and meetings that share a title or attendees are never
// joined into an inferred series. A group meeting stays a group meeting
// even when your manager is in it; its commitments also show on each
// person's own view (the same records, not copies).

import Link from "next/link";
import { BeyondGroupConversation } from "@/lib/api";
import { BADGE, EYEBROW, META } from "@/lib/tokens";
import ThoughtBox from "./ThoughtBox";
import { CommitmentLine } from "./ContinuityCard";
import { dayShort, dayWeekday } from "@/app/app/beyond/shared";

function GroupCard({
  g,
  prepItemsAvailable,
  onChanged,
}: {
  g: BeyondGroupConversation;
  prepItemsAvailable: boolean;
  onChanged: () => void;
}) {
  const title = g.title || "Untitled group meeting";
  return (
    <article className="rounded-xl border border-hairline bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold text-ink">
          <Link href={`/app/beyond/meetings/${g.id}`} className="hover:text-brand">
            {title}
          </Link>
        </h3>
        <span className="flex items-center gap-2">
          {g.status === "draft" && <span className={`${BADGE} bg-amber-50 text-amber-700`}>Not written up</span>}
          {g.status === "upcoming" && <span className={`${BADGE} bg-brand-tint text-brand`}>Coming up</span>}
          <span className={META}>
            {g.date ? (g.status === "upcoming" ? dayWeekday(g.date) : dayShort(g.date)) : "No date yet"}
          </span>
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">
        {g.people.length ? (
          g.people.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={`/app/beyond/people/${p.id}`} className="hover:text-brand">
                {p.name}
              </Link>
            </span>
          ))
        ) : (
          <span className="text-ink-muted">No attendees recorded</span>
        )}
      </p>

      {g.status === "logged" ? (
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-body">{g.summary}</p>
      ) : g.status === "draft" ? (
        <p className="mt-2 text-sm text-amber-700">
          {g.has_notes ? "Notes saved" : "Nothing written yet"} · outcome not reviewed yet.{" "}
          <Link href={`/app/beyond/meetings/${g.id}`} className="underline underline-offset-2">
            Review notes
          </Link>
        </p>
      ) : null}

      {g.open_commitments.length > 0 && (
        <div className="mt-3">
          <p className={EYEBROW}>Recorded as open</p>
          <ul className="mt-1 space-y-1">
            {g.open_commitments.map((c) => (
              <CommitmentLine key={c.id} c={c} />
            ))}
          </ul>
        </div>
      )}

      {g.status === "upcoming" && g.prep_items.length > 0 && (
        <ul className="mt-3 space-y-1">
          {g.prep_items.map((i) => (
            <li key={i.id} className="text-sm text-ink-body">
              <span className="text-ink-muted">Your note:</span> “{i.text}”
            </li>
          ))}
        </ul>
      )}
      {g.status === "upcoming" && prepItemsAvailable && (
        <div className="mt-3">
          <ThoughtBox meetingId={g.id} meetingDate={g.date} withLabel={title} onSaved={onChanged} />
        </div>
      )}
    </article>
  );
}

export default function GroupConversations({
  groups,
  prepItemsAvailable,
  onChanged,
}: {
  groups: BeyondGroupConversation[];
  prepItemsAvailable: boolean;
  onChanged: () => void;
}) {
  const upcoming = groups.filter((g) => g.status === "upcoming");
  const drafts = groups.filter((g) => g.status === "draft");
  const logged = groups.filter((g) => g.status === "logged");

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-secondary">
          Each group meeting is its own record. Recurring group conversations aren&apos;t supported yet, so meetings
          with the same title or people are not combined into a series.
        </p>
        <Link href="/app/beyond/meetings/new?kind=group" className="text-sm text-brand hover:text-brand-hover">
          Log a group meeting →
        </Link>
      </div>

      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-ink-secondary">
          No group conversations yet. Log a meeting with more than one person and choose “Group” to see it here.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {[
            ["Coming up", upcoming],
            ["Not written up yet", drafts],
            ["Written up", logged],
          ].map(([label, rows]) =>
            (rows as BeyondGroupConversation[]).length ? (
              <section key={label as string}>
                <p className={EYEBROW}>{label as string}</p>
                <div className={`mt-2 grid gap-3 ${(rows as BeyondGroupConversation[]).length > 1 ? "xl:grid-cols-2" : "max-w-4xl"}`}>
                  {(rows as BeyondGroupConversation[]).map((g) => (
                    <GroupCard key={g.id} g={g} prepItemsAvailable={prepItemsAvailable} onChanged={onChanged} />
                  ))}
                </div>
              </section>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
