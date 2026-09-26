"use client";

// One goal on the board: scope + status, the editorial title, the success
// measure, the latest update, any review reasons, and two doors — "+ Add an
// update" (opens the form in place), "Ask about this goal" (opens Scribe with
// the goal in context) and "Details". Visual reference:
// docs/design-proposals/2026-09-25-goals-in-view/prototype-v2.html (.goal-sheet).

import type { ReactNode } from "react";
import type { AssistantPageContext, Goal } from "@/lib/api";
import AskAboutButton from "@/components/AskAboutButton";
import { BADGE, STATUS_BAR, STATUS_GLYPH, STATUS_STYLES } from "@/lib/tokens";
import { STATUS_LABEL, dueLabel, formatMoment, isOpen, reviewReasons, scopeLabel } from "@/lib/goals";
import GoalMeasure from "./GoalMeasure";

export const SHEET_X = "px-6";
export const SHEET_MX = "mx-6";

// Shared with GoalDetail. The context is display-only (the server verifies
// only people and projects); Scribe finds the goal itself with list_goals.
export const goalPrompt = (title: string) => `How is "${title}" going, and what's getting in its way?`;
export const goalContext = (goal: Goal): AssistantPageContext => ({
  label: `Goals page — goal: ${goal.title}`,
  entity_type: "goal",
  entity_id: goal.id,
  subject: goal.title,
});

export function StatusChip({ status }: { status: Goal["status"] }) {
  return (
    <span className={`${BADGE} ${STATUS_STYLES[status]} inline-flex shrink-0 items-center gap-1`}>
      <span aria-hidden>{STATUS_GLYPH[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function GoalSheet({
  goal,
  connections,
  editing,
  justSaved,
  onOpen,
  onAddUpdate,
  updateButtonRef,
  form,
}: {
  goal: Goal;
  connections: number;
  editing: boolean;
  justSaved: boolean;
  onOpen: () => void;
  onAddUpdate: () => void;
  updateButtonRef?: (el: HTMLButtonElement | null) => void;
  form?: ReactNode;
}) {
  const reasons = reviewReasons(goal);
  const unmeasuredProgress = !goal.measure && goal.progress != null;
  return (
    <article
      aria-labelledby={`goal-${goal.id}-title`}
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border bg-surface transition duration-200 motion-reduce:transition-none ${
        editing
          ? "border-brand"
          : "border-transparent hover:-translate-y-0.5 hover:border-control motion-reduce:hover:translate-y-0"
      } ${justSaved ? "animate-save-glow motion-reduce:animate-none" : ""}`}
    >
      <div className={`${SHEET_X} pt-5`}>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-2xs uppercase tracking-[0.12em] text-ink-muted">{scopeLabel(goal)}</span>
          <StatusChip status={goal.status} />
        </div>
        <h3 id={`goal-${goal.id}-title`} className="mb-2.5 mt-3">
          <button
            type="button"
            onClick={onOpen}
            className="w-full break-words text-left font-serif text-[1.5rem] font-normal leading-[1.2] tracking-[-0.02em] text-ink hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50 sm:min-h-[3.6rem] [overflow-wrap:anywhere]"
          >
            {goal.title}
          </button>
        </h3>
        <p className="text-2xs text-ink-muted">{dueLabel(goal)}</p>
      </div>

      <div className={`${SHEET_X} flex min-h-[150px] flex-col justify-center pb-4 pt-5 sm:min-h-[170px]`}>
        <GoalMeasure goal={goal} />
      </div>

      <div className={`${SHEET_MX} flex-1 border-t border-hairline py-3.5`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-2xs text-ink-muted">
            {goal.last_check_in_at ? `Latest update · ${formatMoment(goal.last_check_in_at)}` : "No check-in yet"}
          </span>
          {connections > 0 && (
            <span className="text-2xs text-ink-muted">
              {connections} connection{connections === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-body sm:line-clamp-2">
          {goal.last_check_in_at
            ? goal.last_check_in_note || "No note recorded for this update."
            : isOpen(goal)
              ? "The first update will appear here."
              : "This goal is closed."}
        </p>
        {unmeasuredProgress && (
          <>
            <div className="mt-3 flex items-center gap-3">
              <b className="text-xl font-medium tabular-nums text-ink">{goal.progress}%</b>
              <div className="h-1.5 w-full max-w-[130px] overflow-hidden rounded-full bg-sunken" aria-hidden>
                <div className={`h-full rounded-full ${STATUS_BAR[goal.status]}`} style={{ width: `${goal.progress}%` }} />
              </div>
              <span className="text-2xs text-ink-muted">recorded completion</span>
            </div>
            {goal.progress_at && (
              <p className="mt-1 text-2xs text-ink-muted">Percentage recorded {formatMoment(goal.progress_at)}.</p>
            )}
          </>
        )}
        {reasons.length > 0 && <p className="mt-2.5 text-2xs font-medium text-amber-700">{reasons.join(" · ")}</p>}
      </div>

      {editing && form ? (
        <div className={`${SHEET_X} pb-6`}>{form}</div>
      ) : (
        <div className={`${SHEET_MX} flex items-center gap-3 border-t border-divider py-2.5`}>
          <button
            type="button"
            ref={updateButtonRef}
            onClick={onAddUpdate}
            className="py-1.5 text-xs font-medium text-brand hover:text-brand-hover"
          >
            + Add an update
          </button>
          <AskAboutButton
            label="Ask about this goal"
            prompt={goalPrompt(goal.title)}
            context={goalContext(goal)}
            className="inline-flex items-center gap-1 py-1.5 text-xs font-medium text-ink-secondary hover:text-brand"
          />
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Details for ${goal.title}`}
            className="ml-auto py-1.5 text-2xs text-ink-muted hover:text-ink"
          >
            Details ↗
          </button>
        </div>
      )}
    </article>
  );
}
