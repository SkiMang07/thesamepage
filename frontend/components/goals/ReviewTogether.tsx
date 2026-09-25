"use client";

// Review together — a local presentation mode for walking through goals with
// someone in the room. First the manager chooses goals from the CURRENT level
// and scope and sees exactly what will show; then a full-screen view shows
// titles, the exact success criteria, due dates and recorded measures.
// Status only if opted in. Never shown: update notes, descriptions, source
// links, other people's records or any manager control. Nothing is sent,
// shared or published — this is the manager's own screen.

import { useEffect, useState } from "react";
import type { Goal } from "@/lib/api";
import { BTN_PRIMARY, BTN_PRIMARY_SM, BTN_SECONDARY } from "@/lib/tokens";
import { dueLabel, formatMoment, scopeLabel, targetText } from "@/lib/goals";
import Dialog, { useFocusTrap } from "./Dialog";
import GoalMeasure from "./GoalMeasure";
import { StatusChip } from "./GoalSheet";

export function ReviewSetup({
  choices,
  scopeName,
  onStart,
  onCancel,
}: {
  choices: Goal[];
  scopeName: string;
  onStart: (ids: string[], showStatus: boolean) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(choices.map((g) => g.id)));
  const [showStatus, setShowStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Dialog title="Choose the goals for this review" onClose={onCancel} wide>
      <p className="text-sm text-ink-body">
        Only what you tick appears on screen: each goal&apos;s title, success criterion, due date and recorded values.
        Update notes, descriptions and your controls stay out.
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        A local presentation on this screen — not an invitation, a shared view or a message. Nothing is sent. From: {scopeName}.
      </p>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const ids = choices.filter((g) => picked.has(g.id)).map((g) => g.id);
          if (!ids.length) return setError("Choose at least one goal.");
          onStart(ids, showStatus);
        }}
      >
        <fieldset>
          <legend className="sr-only">Goals to show</legend>
          {choices.map((g) => (
            <label key={g.id} className="flex items-start gap-3 border-t border-divider py-3.5">
              <input type="checkbox" className="mt-1" checked={picked.has(g.id)} onChange={() => toggle(g.id)} />
              <span className="min-w-0">
                <b className="block text-sm font-medium text-ink">{g.title}</b>
                <small className="block text-xs text-ink-muted">
                  {g.success_metrics || "No written success criterion."}
                  {g.measure ? ` · ${g.measure.label}: ${targetText(g.measure).toLowerCase()}` : ""}
                  {` · ${scopeLabel(g)}`}
                </small>
                <small className="mt-0.5 block text-xs text-ink-muted">
                  {g.measure
                    ? g.latest_reading
                      ? `Shows the value recorded ${formatMoment(g.latest_reading.at)}`
                      : "No value recorded yet"
                    : g.progress != null
                      ? `Shows completion ${g.progress}%`
                      : "Shows the written criterion only"}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="mt-2 flex items-center gap-3 border-t border-divider pt-4 text-sm text-ink-body">
          <input type="checkbox" checked={showStatus} onChange={(e) => setShowStatus(e.target.checked)} />
          Include current status
        </label>
        <div role="alert">{error && <p className="mt-3 text-sm text-red-700">{error}</p>}</div>
        <div className="mt-5 flex items-center gap-3">
          <button type="submit" className={BTN_PRIMARY} data-autofocus>
            Start review
          </button>
          <button type="button" onClick={onCancel} className="text-sm text-ink-secondary hover:text-ink">
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ReviewPresentation({
  goals,
  showStatus,
  onExit,
}: {
  goals: Goal[];
  showStatus: boolean;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const ref = useFocusTrap(onExit);
  const g = goals[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => Math.min(goals.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [goals.length]);

  if (!g) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Goal review"
      className="fixed inset-0 z-[100] overflow-y-auto bg-canvas text-ink"
    >
      <div className="mx-auto flex min-h-[100dvh] max-w-[1350px] flex-col px-6 py-6 sm:px-14 sm:py-9">
        <div className="flex items-center justify-between gap-4 border-b border-hairline pb-5">
          <span className="text-2xs uppercase tracking-[0.14em] text-ink-muted">The Same Page · Goals</span>
          <button type="button" onClick={onExit} className={BTN_SECONDARY}>
            End review
          </button>
        </div>
        <div aria-live="polite" className="grid flex-1 grid-cols-1 items-center gap-6 py-8 lg:grid-cols-[1.2fr_1fr] lg:gap-16 lg:py-10">
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-[0.14em] text-ink-muted">
              {scopeLabel(g)} · {index + 1} of {goals.length}
            </p>
            <h2 className="mb-6 mt-4 break-words font-serif text-[2.4rem] font-normal leading-[1.09] tracking-[-0.03em] text-ink sm:text-[clamp(2.2rem,4vw,3.9rem)]">
              {g.title}
            </h2>
            {g.success_metrics && g.measure && (
              <p className="mb-6 max-w-[540px] whitespace-pre-wrap text-lg leading-relaxed text-ink-body">{g.success_metrics}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ink-muted">{dueLabel(g)}</span>
              {showStatus && <StatusChip status={g.status} />}
            </div>
          </div>
          <div className="min-w-0 py-4">
            <GoalMeasure goal={g} size="present" />
            {!g.measure && g.progress != null && (
              <p className="mt-6 text-sm text-ink-muted">
                Last recorded completion: {g.progress}%{g.progress_at ? ` · ${formatMoment(g.progress_at)}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-5">
          <div className="flex items-center gap-3">
            <button type="button" className={BTN_SECONDARY} disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              ← Previous
            </button>
            <button
              type="button"
              className={BTN_PRIMARY_SM}
              disabled={index === goals.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              Next goal →
            </button>
          </div>
          <span className="flex gap-1.5" aria-label={`Goal ${index + 1} of ${goals.length}`} role="img">
            {goals.map((x, i) => (
              <span key={x.id} className={`inline-block h-1 w-7 rounded ${i === index ? "bg-brand" : "bg-hairline"}`} />
            ))}
          </span>
          <span className="text-2xs text-ink-muted">Local presentation · Nothing is being sent · ← → to move, Esc to end</span>
        </div>
      </div>
    </div>
  );
}
