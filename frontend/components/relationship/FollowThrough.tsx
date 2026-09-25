"use client";

// Follow-through: live commitments grouped by who owes them — You, then the
// person — so the manager's own promises are never buried in the report's.
// Three rows per owner to start, then a count-accurate expansion. Order is
// deterministic (earliest due first, undated last). Each row opens its real
// source; done / drop / reopen are the existing status writes.

import { useRef, useState } from "react";
import type { Commitment, OneOnOne } from "@/lib/api";
import PersonAvatar from "@/components/team/PersonAvatar";
import { dueState, instantDate, shortDate } from "@/components/team/dates";
import {
  commitmentSource,
  firstName,
  ownerOf,
  sortOpenCommitments,
  sortResolvedCommitments,
  type Owner,
} from "./desk";

const INITIAL_ROWS = 3;

export default function FollowThrough({
  personId,
  personName,
  commitments,
  completedSessions,
  failed,
  historyFailed,
  updatingId,
  error,
  onSetStatus,
  onOpenConversation,
}: {
  personId: string;
  personName: string;
  commitments: Commitment[];
  completedSessions: OneOnOne[];
  failed: boolean;
  historyFailed: boolean;
  updatingId: string | null;
  error: string | null;
  onSetStatus: (id: string, status: Commitment["status"]) => Promise<boolean>;
  onOpenConversation: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<Owner>>(new Set());
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const groupRefs = useRef<Record<Owner, HTMLHeadingElement | null>>({ manager: null, direct_report: null });

  const first = firstName(personName);
  const open = sortOpenCommitments(commitments.filter((c) => c.status === "open"));
  const resolved = sortResolvedCommitments(commitments.filter((c) => c.status !== "open"));

  const groups: { owner: Owner; label: string; avatarId: string | null; rows: Commitment[] }[] = [
    { owner: "manager", label: "You", avatarId: null, rows: open.filter((c) => ownerOf(c) === "manager") },
    { owner: "direct_report", label: first, avatarId: personId, rows: open.filter((c) => ownerOf(c) === "direct_report") },
  ];

  async function change(c: Commitment, status: Commitment["status"]) {
    const ok = await onSetStatus(c.id, status);
    if (ok && status !== "open") {
      // The row leaves the list; keep keyboard focus on its group.
      setOpenDetail(null);
      groupRefs.current[ownerOf(c)]?.focus();
    }
  }

  return (
    <section id="follow-through" aria-labelledby="follow-through-heading" className="scroll-mt-24">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="follow-through-heading" tabIndex={-1} className="font-serif text-[1.85rem] font-normal leading-tight tracking-[-0.01em] text-ink focus:outline-none">
          Follow-through
        </h2>
        {!failed && <span className="font-sans text-xs tabular-nums text-ink-muted">{open.length} open</span>}
      </div>
      <p className="mt-1.5 text-xs text-ink-secondary">What you and {first} have committed to, until it&apos;s done or dropped.</p>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}

      {failed ? (
        <p className="mt-4 text-sm text-amber-700">Commitments couldn&apos;t load. This isn&apos;t an all-clear — refresh to try again.</p>
      ) : (
        <>
          {groups.map((group) => {
            const isExpanded = expanded.has(group.owner);
            const shown = isExpanded ? group.rows : group.rows.slice(0, INITIAL_ROWS);
            return (
              <div key={group.owner} className="mt-5">
                <div className="flex items-center gap-2.5 border-b border-hairline pb-2.5">
                  <PersonAvatar id={group.avatarId} name={group.avatarId ? personName : "You"} size="sm" />
                  <h3
                    ref={(el) => {
                      groupRefs.current[group.owner] = el;
                    }}
                    tabIndex={-1}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-ink focus:outline-none focus-visible:underline"
                  >
                    {group.label}
                  </h3>
                  <span className="font-sans text-xs tabular-nums text-ink-muted">{group.rows.length} open</span>
                </div>

                {group.rows.length === 0 ? (
                  <p className="py-3 text-xs text-ink-muted">
                    {group.owner === "manager" ? "Nothing open for you." : `Nothing open for ${first}.`}
                  </p>
                ) : (
                  <ul>
                    {shown.map((c) => {
                      const state = dueState(c.due_date);
                      const detailOpen = openDetail === c.id;
                      const source = commitmentSource(c, completedSessions);
                      const busy = updatingId === c.id;
                      return (
                        <li key={c.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 border-b border-hairline py-3.5">
                          <input
                            type="checkbox"
                            checked={false}
                            disabled={busy}
                            onChange={() => change(c, "done")}
                            aria-label={`Mark done: ${c.description}`}
                            className="mt-1 h-4 w-4 cursor-pointer rounded border-control accent-brand"
                          />
                          <div className="min-w-0">
                            <button
                              type="button"
                              aria-expanded={detailOpen}
                              aria-controls={`commitment-${c.id}`}
                              onClick={() => setOpenDetail(detailOpen ? null : c.id)}
                              className="block w-full text-left text-sm leading-6 text-ink-body hover:text-ink focus-visible:underline"
                            >
                              {c.description}
                            </button>
                            <p className={`mt-0.5 text-xs ${state === "overdue" ? "text-amber-700" : "text-ink-muted"}`}>
                              {c.due_date
                                ? state === "overdue"
                                  ? `Overdue · ${shortDate(c.due_date)}`
                                  : `Due ${shortDate(c.due_date)}`
                                : "No due date"}
                            </p>
                            {detailOpen && (
                              <div id={`commitment-${c.id}`} className="mt-2.5 rounded-lg bg-sunken px-3 py-2.5 text-xs text-ink-secondary">
                                <SourceLine source={source} historyFailed={historyFailed} onOpenConversation={onOpenConversation} />
                                <p className="mt-1 text-ink-muted">Added {instantDate(c.created_at)}</p>
                                <div className="mt-2 flex gap-4">
                                  <button type="button" disabled={busy} onClick={() => change(c, "done")} className="font-medium text-brand hover:text-brand-hover disabled:opacity-50">
                                    Mark done
                                  </button>
                                  <button type="button" disabled={busy} onClick={() => change(c, "dropped")} className="text-ink-secondary hover:text-ink disabled:opacity-50" title="No longer relevant">
                                    Drop
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {group.rows.length > INITIAL_ROWS && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((cur) => {
                        const nextSet = new Set(cur);
                        if (nextSet.has(group.owner)) nextSet.delete(group.owner);
                        else nextSet.add(group.owner);
                        return nextSet;
                      })
                    }
                    className="mt-2.5 text-xs font-medium text-brand hover:text-brand-hover"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "Show fewer" : `View all ${group.rows.length} commitments`}
                  </button>
                )}
              </div>
            );
          })}

          <details className="group mt-5">
            <summary className="cursor-pointer list-none text-xs text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="mr-1.5 inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">▸</span>
              Resolved commitments · <span className="font-sans tabular-nums">{resolved.length}</span>
            </summary>
            {resolved.length === 0 ? (
              <p className="mt-2 text-xs text-ink-muted">Nothing resolved yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {resolved.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg bg-sunken px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-ink-secondary">{c.description}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {ownerOf(c) === "manager" ? "You" : first} · {c.status === "done" ? "Done" : "Dropped"}
                        {c.status === "done" && c.completed_at ? ` ${instantDate(c.completed_at)}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => change(c, "open")}
                      disabled={updatingId === c.id}
                      className="shrink-0 text-xs font-medium text-brand hover:text-brand-hover disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </section>
  );
}

function SourceLine({
  source,
  historyFailed,
  onOpenConversation,
}: {
  source: ReturnType<typeof commitmentSource>;
  historyFailed: boolean;
  onOpenConversation: (id: string) => void;
}) {
  if (source.kind === "conversation") {
    return (
      <button type="button" onClick={() => onOpenConversation(source.session.id)} className="font-medium text-brand hover:text-brand-hover">
        From your 1:1{source.date ? ` on ${shortDate(source.date)}` : ""} <span aria-hidden="true">↗</span>
      </button>
    );
  }
  if (source.kind === "conversation-unavailable") {
    return (
      <p>
        {historyFailed
          ? "From a 1:1 — past conversations couldn't load, so it can't be opened right now."
          : "From a 1:1 that's no longer available here."}
      </p>
    );
  }
  if (source.kind === "other") return <p>{source.label}</p>;
  return <p>Where this was made wasn&apos;t recorded.</p>;
}
