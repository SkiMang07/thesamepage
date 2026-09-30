"use client";

// "Still current?" (setup mode chunk C). A company or department goal is a
// snapshot of what someone else set. Once a quarter, or once its end date has
// passed, the manager is asked whether it still holds. One prompt for the whole
// page, listing the goals that are due. "Yes" stamps the date it was last
// confirmed (POST /api/onboarding/org-goals/{id}/confirm); "Edit" opens the goal.
// No AI, no modal. The server decides which goals are due (goals.needs_confirmation).

import { useState } from "react";
import { Goal, confirmOrgGoal } from "@/lib/api";
import { BTN_GHOST, BTN_SECONDARY, EYEBROW } from "@/lib/tokens";

export default function StillCurrent({
  goals,
  onConfirmed,
  onEdit,
}: {
  goals: Goal[];
  onConfirmed: (id: string, confirmedOn: string) => void;
  onEdit: (goal: Goal) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const due = goals.filter((g) => g.needs_confirmation);
  if (due.length === 0) return null;

  async function yes(g: Goal) {
    setBusy(g.id);
    setError(null);
    try {
      const r = await confirmOrgGoal(g.id);
      onConfirmed(g.id, r.confirmed_on);
    } catch {
      setError("That didn’t save. Try again.");
    }
    setBusy(null);
  }

  return (
    <section aria-labelledby="still-current-title" className="mt-5 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <p className={EYEBROW}>Still current?</p>
      <h2 id="still-current-title" className="mt-1 text-[15px] font-medium text-ink">
        {due.length === 1 ? "One company or department goal is due for a check." : `${due.length} company and department goals are due for a check.`}
      </h2>
      <p className="mt-1 text-[13px] text-ink-secondary">These were set by someone else and are asked about once a quarter, or after their end date.</p>
      <ul className="mt-3 divide-y divide-hairline">
        {due.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{g.title}</p>
              <p className="text-xs text-ink-muted">
                {[g.period_label, g.set_by && `set by ${g.set_by}`, g.due_date && `ends ${g.due_date.slice(0, 10)}`].filter(Boolean).join(" · ") ||
                  (g.level === "company" ? "Company goal" : "Department goal")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" disabled={busy === g.id} onClick={() => yes(g)} className={BTN_SECONDARY}>
                {busy === g.id ? "Saving…" : "Yes, still current"}
              </button>
              <button type="button" disabled={busy === g.id} onClick={() => onEdit(g)} className={BTN_GHOST}>
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
