"use client";

// Prepare a review — a local presentation for talking projects through with
// someone in the room. The manager picks projects from what is visible right
// now (none ticked to start), sees exactly what will show, and may write one
// question per project for this presentation only. Shown: title, purpose,
// owner, goal connection, the written question; status and due date only if
// opted in. Never shown: update notes, private next moves, meeting links or
// any control. Questions are not saved anywhere. Nothing is sent or shared.

import { useState } from "react";
import type { Project } from "@/lib/api";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT } from "@/lib/tokens";
import { formatDay, ownerName } from "@/lib/projects";
import Dialog, { useFocusTrap } from "@/components/goals/Dialog";
import { StatusChip } from "./StatusChip";

export type ReviewPlan = { ids: string[]; questions: Record<string, string>; showStatus: boolean; showDue: boolean };

const goalLine = (p: Project) => (p.goal_id ? `Supports goal · ${p.goal_title ?? "a goal you can’t see here"}` : "Standalone project");

export function ReviewSetup({
  choices,
  scopeName,
  onStart,
  onCancel,
}: {
  choices: Project[];
  scopeName: string;
  onStart: (plan: ReviewPlan) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [showStatus, setShowStatus] = useState(false);
  const [showDue, setShowDue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog title="Choose what to put in the room" onClose={onCancel} wide>
      <p className="text-sm text-ink-body">
        Only the projects you tick appear: title, purpose, owner and goal connection, plus any question you write here.
        Update notes, your private next moves and your controls stay out.
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        A local presentation on this screen — not shared, sent or saved. From: {scopeName}.
      </p>
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const ids = choices.filter((p) => picked.has(p.id)).map((p) => p.id);
          if (!ids.length) return setError("Choose at least one project.");
          onStart({ ids, questions, showStatus, showDue });
        }}
      >
        <fieldset>
          <legend className="sr-only">Projects to show</legend>
          {choices.map((p) => {
            const on = picked.has(p.id);
            return (
              <div key={p.id} className="border-t border-divider py-3">
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={on} onChange={() => toggle(p.id)} />
                  <span className="min-w-0">
                    <b className="block text-sm font-medium text-ink">{p.title}</b>
                    <small className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-ink-secondary">
                      {p.description || "No purpose written yet."}
                    </small>
                    <small className="mt-0.5 block text-xs text-ink-muted">
                      Owner: {ownerName(p)} · {goalLine(p)}
                    </small>
                  </span>
                </label>
                {on && (
                  <div className="mt-2 pl-7">
                    <label htmlFor={`review-q-${p.id}`} className="mb-1 block text-xs text-ink-secondary">
                      Question to discuss · optional, for this presentation only
                    </label>
                    <input
                      id={`review-q-${p.id}`}
                      value={questions[p.id] ?? ""}
                      onChange={(e) => setQuestions((q) => ({ ...q, [p.id]: e.target.value }))}
                      className={INPUT}
                      placeholder="e.g. Who should own the first customer call?"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-divider pt-3 text-sm text-ink-body">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showStatus} onChange={(e) => setShowStatus(e.target.checked)} />
            Include current status
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showDue} onChange={(e) => setShowDue(e.target.checked)} />
            Include due dates
          </label>
        </div>
        <div role="alert">{error && <p className="mt-3 text-sm text-red-700">{error}</p>}</div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" className={BTN_PRIMARY}>
            Show {picked.size ? `${picked.size} selected` : "selected"}
          </button>
          <button type="button" onClick={onCancel} className="text-sm text-ink-secondary hover:text-ink">
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ReviewPresentation({ projects, plan, onExit }: { projects: Project[]; plan: ReviewPlan; onExit: () => void }) {
  const ref = useFocusTrap(onExit);
  const shown = plan.ids.map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => !!p);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Project review" className="fixed inset-0 z-[100] overflow-y-auto bg-canvas text-ink">
      <div className="mx-auto max-w-[1050px] px-6 py-7 sm:px-10">
        <div className="flex items-center justify-between gap-4 border-b border-hairline pb-4">
          <span className="text-2xs uppercase tracking-[0.14em] text-ink-muted">
            The Same Page · Projects · local display, not shared
          </span>
          <button type="button" onClick={onExit} className={BTN_SECONDARY} data-autofocus>
            Exit review
          </button>
        </div>
        <h2 className="mt-8 font-serif text-[2.3rem] font-normal leading-tight tracking-[-0.02em] sm:text-[3rem]">
          What we’re moving forward.
        </h2>
        {shown.map((p) => {
          const q = plan.questions[p.id]?.trim();
          return (
            <article key={p.id} className="border-t border-hairline py-7">
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-secondary">
                <span>{ownerName(p)}</span>
                {plan.showStatus && <StatusChip status={p.status} />}
              </div>
              <h3 className="mt-2 break-words font-serif text-[1.8rem] font-normal leading-snug sm:text-[2.1rem]">{p.title}</h3>
              <p className="mt-3 max-w-[760px] whitespace-pre-wrap break-words text-lg leading-relaxed text-ink-body">
                {p.description || "No purpose written yet."}
              </p>
              <p className="mt-3 text-sm text-ink-muted">
                {goalLine(p)}
                {plan.showDue ? ` · ${p.due_date ? `Due ${formatDay(p.due_date)}` : "No due date"}` : ""}
              </p>
              {q && (
                <div className="mt-5 border-l-2 border-brand bg-brand-tint px-5 py-4">
                  <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-brand">For discussion</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-lg text-ink">{q}</p>
                </div>
              )}
            </article>
          );
        })}
        <p className="border-t border-hairline pt-4 text-2xs text-ink-muted">Esc or Exit review returns to Projects. Nothing was sent.</p>
      </div>
    </div>
  );
}
