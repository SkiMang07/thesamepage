"use client";

// ---------------------------------------------------------------------------
// Beyond the team (/app/beyond) — the manager's meetings outside their own
// team: their boss, skip-level, indirect reports, peers, peer managers' team
// meetings, cross-functional and project meetings.
//
// Organised by people as well as meetings: "Priya" opens to every meeting,
// open item and link between you. Only what these meetings PRODUCE reaches
// the rest of the app (commitments, check-ins, secondhand prep context);
// there is deliberately no Mission Control card. See docs/systems/beyond.md.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { BeyondOverview, OutsideRelationship, createOutsidePerson, getBeyondOverview } from "@/lib/api";
import {
  BADGE,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_PAD,
  ERROR_TEXT,
  EYEBROW,
  INPUT,
  META,
  SELECT,
} from "@/lib/tokens";
import { RELATIONSHIP_GROUP, RELATIONSHIP_LABEL, RELATIONSHIP_ORDER, meetingTitle, shortDate } from "./shared";

export default function BeyondPage() {
  const [data, setData] = useState<BeyondOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<OutsideRelationship>("manager");

  function load() {
    getBeyondOverview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }

  useEffect(load, []);

  async function addPerson() {
    if (!name.trim()) return;
    try {
      await createOutsidePerson({ name: name.trim(), relationship });
      setName("");
      setAdding(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add person");
    }
  }

  const people = data?.people ?? [];
  const meetings = data?.meetings ?? [];
  const drafts = meetings.filter((m) => m.status === "draft");
  // Soonest first; an undated next 1:1 (carried topics, no repeat) last.
  const upcoming = meetings
    .filter((m) => m.status === "upcoming")
    .sort((a, b) => (a.meeting_date ?? "9999").localeCompare(b.meeting_date ?? "9999"));
  const logged = meetings.filter((m) => m.status === "logged");

  return (
    <PageShell maxWidth="6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Beyond the team</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Your boss, skip-level, peers and project meetings. What comes out of them only reaches your team&apos;s
            goals, commitments and 1:1 prep when you confirm it.
          </p>
        </div>
        <Link href="/app/beyond/meetings/new" className={BTN_PRIMARY}>
          Log a meeting
        </Link>
      </div>
      {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}

      {!data && !error ? (
        <p className={`${META} mt-5`}>Loading...</p>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className={CARD_PAD}>
            <div className="flex items-center justify-between">
              <p className={EYEBROW}>People</p>
              {!adding && (
                <button type="button" onClick={() => setAdding(true)} className={BTN_GHOST}>
                  Add
                </button>
              )}
            </div>

            {adding && (
              <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-dashed border-control p-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPerson();
                    }
                  }}
                  className={`${INPUT} min-w-40 flex-1`}
                  placeholder="Name"
                  aria-label="Name"
                  autoFocus
                />
                <select
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value as OutsideRelationship)}
                  className={`${SELECT} !w-44`}
                  aria-label="Relationship"
                >
                  {RELATIONSHIP_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {RELATIONSHIP_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addPerson} className={BTN_SECONDARY}>
                  Add
                </button>
                <button type="button" onClick={() => setAdding(false)} className={BTN_GHOST}>
                  Cancel
                </button>
              </div>
            )}

            {people.length === 0 ? (
              <p className={`${META} mt-3`}>
                No one yet. Add your manager, or just log a meeting and add people as you go.
              </p>
            ) : (
              <div className="mt-2 space-y-4">
                {RELATIONSHIP_ORDER.map((rel) => {
                  const group = people.filter((p) => p.relationship === rel);
                  if (group.length === 0) return null;
                  return (
                    <div key={rel}>
                      <p className={`${META} mb-1`}>{RELATIONSHIP_GROUP[rel]}</p>
                      <ul className="divide-y divide-divider">
                        {group.map((p) => (
                          <li key={p.id}>
                            <Link
                              href={`/app/beyond/people/${p.id}`}
                              className="flex items-baseline justify-between gap-3 rounded-md px-1 py-2 hover:bg-sunken"
                            >
                              <span className="min-w-0 truncate text-sm font-medium text-ink">
                                {p.name}
                                {p.role_title && <span className="font-normal text-ink-muted"> · {p.role_title}</span>}
                              </span>
                              <span className={`${META} shrink-0`}>
                                {[
                                  p.they_owe > 0 && `owes you ${p.they_owe}`,
                                  p.you_owe > 0 && `you owe ${p.you_owe}`,
                                  p.next_meeting?.date
                                    ? `next ${shortDate(p.next_meeting.date)}`
                                    : p.last_met
                                      ? `met ${shortDate(p.last_met)}`
                                      : "not met yet",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            {upcoming.length > 0 && (
              <div className="mb-5">
                <p className={EYEBROW}>Coming up</p>
                <ul className="mt-2 space-y-2">
                  {upcoming.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/app/beyond/meetings/${m.id}`}
                        className={`${CARD_PAD} flex items-baseline justify-between gap-3 hover:bg-sunken`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{meetingTitle(m)}</span>
                          <span className={META}>
                            {[
                              m.recurrence_weeks &&
                                (m.recurrence_weeks === 1 ? "repeats weekly" : `every ${m.recurrence_weeks} weeks`),
                              m.carry_forward_items.length > 0 && `${m.carry_forward_items.length} carried`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {m.kind === "one_on_one" && (
                            <span className={`${BADGE} ${m.prep_guide ? "bg-teal-50 text-teal-700" : "bg-sunken text-ink-muted"}`}>
                              {m.prep_guide ? "Prepared" : "Not prepared"}
                            </span>
                          )}
                          <span className={META}>{m.meeting_date ? shortDate(m.meeting_date) : "No date yet"}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {drafts.length > 0 && (
              <div className="mb-5">
                <p className={EYEBROW}>Not written up yet</p>
                <ul className="mt-2 space-y-2">
                  {drafts.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/app/beyond/meetings/${m.id}`}
                        className={`${CARD_PAD} flex items-baseline justify-between gap-3 hover:bg-sunken`}
                      >
                        <span className="text-sm font-medium text-ink">{meetingTitle(m)}</span>
                        <span className={`${BADGE} bg-amber-50 text-amber-700`}>Finish · {shortDate(m.meeting_date)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className={EYEBROW}>Recent meetings</p>
            {logged.length === 0 ? (
              <p className={`${META} mt-2`}>
                Nothing logged yet. After your next 1:1 with your manager, log it here.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {logged.map((m) => (
                  <li key={m.id}>
                    <Link href={`/app/beyond/meetings/${m.id}`} className={`${CARD_PAD} block hover:bg-sunken`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium text-ink">{meetingTitle(m)}</p>
                        <span className={`${META} shrink-0`}>{shortDate(m.meeting_date)}</span>
                      </div>
                      {m.people.length > 0 && m.title && (
                        <p className={`${META} mt-0.5`}>{m.people.map((p) => p.name).join(", ")}</p>
                      )}
                      <p className="mt-1 line-clamp-2 text-sm text-ink-secondary">{m.summary}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
