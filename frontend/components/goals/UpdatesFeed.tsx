"use client";

// The Updates view: existing check-ins in the selected level and scope,
// newest first. Each row says only what that check-in recorded — a note-only
// row never repeats an older reading. Not a new journal: these are the same
// rows the goal's history shows.

import Link from "next/link";
import type { CheckIn, Goal } from "@/lib/api";
import { checkInFacts, formatMoment, scopeLabel, sourceHref } from "@/lib/goals";

export default function UpdatesFeed({
  rows,
  goalsById,
  onOpenGoal,
  closed,
}: {
  rows: CheckIn[];
  goalsById: Map<string, Goal>;
  onOpenGoal: (id: string) => void;
  closed: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="max-w-[870px] border-t border-hairline py-10">
        <h3 className="font-serif text-2xl text-ink">No updates in this view.</h3>
        <p className="mt-2 text-sm text-ink-secondary">
          {closed ? "Closed goals in this scope have no recorded updates." : "Use “+ Add an update” on a goal to record the first one."}
        </p>
      </div>
    );
  }
  return (
    <ol className="max-w-[870px]">
      {rows.map((ci) => {
        const goal = ci.goal_id ? goalsById.get(ci.goal_id) : undefined;
        const href = sourceHref(ci);
        return (
          <li key={ci.id} className="grid grid-cols-1 gap-1.5 border-t border-hairline py-6 sm:grid-cols-[85px_1fr] sm:gap-5">
            <time dateTime={ci.created_at} className="pt-1 text-xs text-ink-muted">
              {formatMoment(ci.created_at)}
            </time>
            <div className="min-w-0">
              {goal ? (
                <button
                  type="button"
                  onClick={() => onOpenGoal(goal.id)}
                  className="flex items-baseline gap-2.5 text-left text-lg leading-snug text-ink hover:text-brand"
                >
                  <span className="relative top-[-2px] inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-brand" aria-hidden />
                  <span className="break-words">{goal.title}</span>
                </button>
              ) : (
                <p className="text-lg text-ink-muted">A goal no longer in this view</p>
              )}
              <p className="mt-2 text-xs text-ink-muted">
                {[goal ? scopeLabel(goal) : null, ...checkInFacts(ci, goal)].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-2.5 whitespace-pre-wrap break-words text-sm text-ink-body">{ci.note || "No note recorded."}</p>
              {href && (
                <Link href={href} className="mt-2 inline-block text-xs text-brand hover:text-brand-hover">
                  From a meeting beyond the team ↗
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
