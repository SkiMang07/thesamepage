"use client";

// Past conversations: a compact dated timeline of completed 1:1s. Each entry
// shows the reviewed summary's opening words and how many commitments are
// explicitly linked to it; opening it shows the full reviewed summary and
// those commitments. Search filters the summaries already on the page — it
// never reads private notes, raw call notes, or the unfinished next occurrence.

import { useState } from "react";
import type { Commitment, OneOnOne } from "@/lib/api";
import { shortDate } from "@/components/team/dates";
import { commitmentsFromSession, excerpt, firstName, ownerOf, sessionDate } from "./desk";

const INITIAL_ENTRIES = 6;

export default function PastConversations({
  sessions,
  commitments,
  commitmentsFailed,
  personName,
  openId,
  onToggle,
  failed,
}: {
  sessions: OneOnOne[];
  commitments: Commitment[];
  commitmentsFailed: boolean;
  personName: string;
  openId: string | null;
  onToggle: (id: string | null) => void;
  failed: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const first = firstName(personName);

  const q = query.trim().toLowerCase();
  const matches = q ? sessions.filter((s) => (s.summary ?? "").toLowerCase().includes(q)) : sessions;
  // An entry opened from elsewhere on the page (a receipt, a commitment's
  // source) is always reachable, even if it sits past the initial cut.
  const openIndex = openId ? matches.findIndex((s) => s.id === openId) : -1;
  const limit = showAll || q ? matches.length : Math.max(INITIAL_ENTRIES, openIndex + 1);
  const shown = matches.slice(0, limit);

  return (
    <section aria-labelledby="past-conversations-heading" className="border-t border-hairline pt-8">
      <h2 id="past-conversations-heading" className="font-serif text-[1.85rem] font-normal leading-tight tracking-[-0.01em] text-ink">
        Past conversations
      </h2>

      {failed ? (
        <p className="mt-4 text-sm text-amber-700">Past conversations couldn&apos;t load. Refresh to try again.</p>
      ) : sessions.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">
          No logged 1:1s with {first} yet. Each reviewed summary will be kept here, newest first.
        </p>
      ) : (
        <>
          <label htmlFor="conversation-search" className="sr-only">Search reviewed summaries</label>
          <input
            id="conversation-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find something you discussed…"
            className="mt-4 w-full rounded-md border border-control bg-sunken px-3 py-2.5 text-sm text-ink placeholder-ink-faint focus:border-brand focus:outline-none"
          />
          <p className="mt-2 text-xs text-ink-muted" aria-live="polite">
            {q
              ? `${matches.length} of ${sessions.length} reviewed summar${sessions.length === 1 ? "y" : "ies"} mention “${query.trim()}”`
              : "Reviewed summaries · Open a conversation for the full record."}
          </p>

          {matches.length === 0 ? (
            <p className="mt-5 text-sm text-ink-secondary">No reviewed summary mentions that. Private notes aren&apos;t searched.</p>
          ) : (
            <ol className="mt-5">
              {shown.map((session) => {
                const date = sessionDate(session);
                const linked = commitmentsFromSession(commitments, session.id);
                const isOpen = openId === session.id;
                return (
                  <li key={session.id} id={`conversation-${session.id}`} className="grid scroll-mt-24 grid-cols-[3.75rem_minmax(0,1fr)] gap-2 sm:grid-cols-[5.75rem_minmax(0,1fr)] sm:gap-3.5">
                    <p className="pt-px text-xs text-ink-secondary">
                      {date ? (
                        <>
                          {shortDate(date)}
                          <br />
                          <span className="text-ink-muted">{date.slice(0, 4)}</span>
                        </>
                      ) : (
                        "Undated"
                      )}
                    </p>
                    <div className="relative border-l border-hairline pb-6 pl-4 sm:pl-5">
                      <span aria-hidden="true" className="absolute -left-[4px] top-[7px] h-[7px] w-[7px] rounded-full bg-ink-muted" />
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`conversation-body-${session.id}`}
                        onClick={() => onToggle(isOpen ? null : session.id)}
                        className="block w-full text-left focus-visible:underline"
                      >
                        <span className="text-[15px] leading-6 text-ink">
                          {excerpt(session.summary, 140)}
                          <span aria-hidden="true" className="ml-1 text-brand">{isOpen ? "−" : "+"}</span>
                        </span>
                        <span className="mt-1 block text-xs text-ink-muted">
                          Reviewed summary ·{" "}
                          {commitmentsFailed
                            ? "commitments unavailable"
                            : `${linked.length} commitment${linked.length === 1 ? "" : "s"}`}
                        </span>
                      </button>
                      {isOpen && (
                        <div id={`conversation-body-${session.id}`} className="mt-3 max-w-3xl">
                          <p className="whitespace-pre-wrap text-sm leading-6 text-ink-body">{session.summary}</p>
                          {linked.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs text-ink-muted">Commitments made in this conversation</p>
                              <ul className="mt-1.5 space-y-1">
                                {linked.map((c) => (
                                  <li key={c.id} className="text-sm text-ink-secondary">
                                    <span className="text-ink-muted">{ownerOf(c) === "manager" ? "You" : first} · </span>
                                    {c.description}
                                    <span className="text-ink-muted">
                                      {" · "}
                                      {c.status === "open" ? (c.due_date ? `Due ${shortDate(c.due_date)}` : "Open") : c.status === "done" ? "Done" : "Dropped"}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <p className="mt-3 text-2xs text-ink-muted">The summary you confirmed at wrap-up. Raw call notes aren&apos;t shown here.</p>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {!q && matches.length > shown.length && (
            <button type="button" onClick={() => setShowAll(true)} className="text-xs font-medium text-brand hover:text-brand-hover">
              Show {matches.length - shown.length} earlier conversation{matches.length - shown.length === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
