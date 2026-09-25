"use client";

// Details — a deliberate, focused view of one goal with a clear way back.
// Everything the old goal card carried lives here: status-only change, the
// full description and success criterion, the measure with every recorded
// value, the latest update with its source, the full check-in history, and
// explicit parent / child / project connections. Edit and Delete reuse the
// board's write paths.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BeyondLinkHistoryItem,
  CheckIn,
  Goal,
  GoalStatus,
  Project,
  getBeyondLinks,
  getGoalCheckIns,
} from "@/lib/api";
import { BTN_PRIMARY_SM, INPUT } from "@/lib/tokens";
import {
  LEVELS,
  STATUS_LABEL,
  STATUS_ORDER,
  checkInFacts,
  dueLabel,
  formatMoment,
  scopeLabel,
  sourceHref,
} from "@/lib/goals";
import GoalMeasure, { ReadingsTable } from "./GoalMeasure";

const SUMMARY = "cursor-pointer select-none py-3 text-sm text-ink-body hover:text-ink";

export default function GoalDetail({
  goal,
  allGoals,
  projects,
  historyVersion,
  onBack,
  onSetStatus,
  onOpenGoal,
  onEdit,
  onDelete,
  updateForm,
  onAddUpdate,
  updateButtonRef,
}: {
  goal: Goal;
  allGoals: Goal[];
  projects: Project[];
  historyVersion: number;
  onBack: () => void;
  onSetStatus: (status: GoalStatus) => Promise<void>;
  onOpenGoal: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  updateForm: ReactNode | null;
  onAddUpdate: () => void;
  updateButtonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const [history, setHistory] = useState<CheckIn[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [meetings, setMeetings] = useState<BeyondLinkHistoryItem[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [goal.id]);

  useEffect(() => {
    let live = true;
    setHistoryError(false);
    getGoalCheckIns(goal.id)
      .then((rows) => live && setHistory(rows))
      .catch(() => live && (setHistory(null), setHistoryError(true)));
    // Meeting titles for source links; history renders without them.
    getBeyondLinks({ goalId: goal.id })
      .then((rows) => live && setMeetings(rows))
      .catch(() => live && setMeetings([]));
    return () => {
      live = false;
    };
  }, [goal.id, historyVersion]);

  const parent = goal.parent_goal_id ? allGoals.find((g) => g.id === goal.parent_goal_id) : undefined;
  const children = allGoals.filter((g) => g.parent_goal_id === goal.id);
  const serving = projects.filter((p) => p.goal_id === goal.id);
  const latest = history?.[0];
  const readings = (history ?? [])
    .filter((ci) => ci.measured_value != null)
    .map((ci) => ({ check_in_id: ci.id, value: ci.measured_value as number, at: ci.created_at }));
  const meetingTitle = (ci: CheckIn) =>
    meetings.find((m) => m.meeting_id === ci.source_id)?.meeting_title || "Meeting beyond the team";

  async function changeStatus(next: GoalStatus) {
    setStatusError(null);
    try {
      await onSetStatus(next);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Status wasn't changed.");
    }
  }

  const source = (ci: CheckIn) => {
    const href = sourceHref(ci);
    return href ? (
      <Link href={href} className="mt-1.5 block text-xs text-brand hover:text-brand-hover">
        {formatMoment(ci.created_at)} · {meetingTitle(ci)} ↗
      </Link>
    ) : null;
  };

  return (
    <section aria-labelledby="goal-detail-title" className="mx-auto w-full max-w-[900px] rounded-xl bg-surface p-5 sm:p-7">
      <button type="button" onClick={onBack} className="text-sm text-brand hover:text-brand-hover">
        ← Back to goals
      </button>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-2xs uppercase tracking-[0.14em] text-ink-muted">
          {LEVELS.find((l) => l.id === goal.level)?.label} goal
        </span>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Status
          <select
            value={goal.status}
            onChange={(e) => changeStatus(e.target.value as GoalStatus)}
            className={`${INPUT} w-36 py-1.5`}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>
      {statusError && <p role="alert" className="mt-2 text-sm text-red-700">{statusError}</p>}

      <h2
        id="goal-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 break-words font-serif text-[2rem] font-normal leading-[1.15] tracking-[-0.02em] text-ink focus:outline-none"
      >
        {goal.title}
      </h2>
      <p className="mt-2 text-xs text-ink-muted">
        {scopeLabel(goal)} · {dueLabel(goal)}
      </p>

      <div className="mt-6">
        <p className="text-2xs uppercase tracking-[0.14em] text-ink-muted">Success criterion</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-base text-ink">
          {goal.success_metrics || <span className="text-ink-muted">No written success criterion.</span>}
        </p>
      </div>

      {goal.measure && (
        <div className="mt-6 rounded-lg border border-hairline p-5">
          <GoalMeasure goal={goal} size="detail" />
          <details className="mt-4">
            <summary className={SUMMARY}>
              Recorded values · {history ? readings.length : goal.reading_count ?? 0}
            </summary>
            {history ? (
              <ReadingsTable readings={readings} measure={goal.measure} />
            ) : (
              <p className="text-xs text-ink-muted">{historyError ? "Couldn't load the recorded values." : "Loading..."}</p>
            )}
          </details>
        </div>
      )}

      <div className="mt-6 border-t border-hairline pt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-ink">Latest update</h3>
          <span className="text-xs text-ink-muted">
            {goal.last_check_in_at ? formatMoment(goal.last_check_in_at) : "No check-ins yet"}
          </span>
        </div>
        {historyError ? (
          <p className="mt-3 text-sm text-red-700">Couldn&apos;t load this goal&apos;s updates. The goal itself is unchanged.</p>
        ) : latest ? (
          <div className="mt-3 border-l-2 border-control pl-4">
            <p className="whitespace-pre-wrap break-words text-sm text-ink-body">{latest.note || "No note recorded for this update."}</p>
            <p className="mt-2 text-xs text-ink-muted">{checkInFacts(latest, goal).join(" · ")}</p>
            {source(latest)}
          </div>
        ) : history ? (
          <p className="mt-3 text-sm text-ink-muted">No update has been recorded for this goal.</p>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">Loading...</p>
        )}
        {!goal.measure && goal.progress != null && (
          <p className="mt-3 text-xs text-ink-muted">
            Last recorded completion: <span className="text-ink-body">{goal.progress}%</span>
            {goal.progress_at && ` · ${formatMoment(goal.progress_at)}`}
            {goal.progress_at && goal.last_check_in_at && goal.progress_at !== goal.last_check_in_at &&
              " · the latest update did not change this percentage"}
          </p>
        )}
        <div className="mt-5">
          {updateForm ?? (
            <button type="button" ref={updateButtonRef} onClick={onAddUpdate} className={BTN_PRIMARY_SM}>
              Add an update
            </button>
          )}
        </div>
      </div>

      <details className="mt-6 border-t border-hairline">
        <summary className={SUMMARY}>Update history{history ? ` · ${history.length}` : ""}</summary>
        {history === null ? (
          <p className="pb-3 text-xs text-ink-muted">{historyError ? "Couldn't load the history." : "Loading..."}</p>
        ) : history.length === 0 ? (
          <p className="pb-3 text-xs text-ink-muted">No check-ins yet.</p>
        ) : (
          <ol className="pb-3">
            {history.map((ci) => (
              <li key={ci.id} className="border-t border-divider py-3">
                <p className="text-xs text-ink-muted">
                  {formatMoment(ci.created_at)} · {checkInFacts(ci, goal).join(" · ")}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-body">{ci.note || "No note recorded."}</p>
                {source(ci)}
              </li>
            ))}
          </ol>
        )}
      </details>

      <details className="border-t border-hairline">
        <summary className={SUMMARY}>Connections · {(parent || goal.parent_goal_id ? 1 : 0) + children.length + serving.length}</summary>
        <div className="space-y-3 pb-4 text-sm">
          {goal.parent_goal_id ? (
            <Connection kind="Parent goal">
              {parent ? (
                <button type="button" onClick={() => onOpenGoal(parent.id)} className="text-left text-brand hover:text-brand-hover">
                  {parent.title} →
                </button>
              ) : (
                <span className="text-ink-muted">{goal.parent_goal_title ?? "A parent goal that isn't in this list"}</span>
              )}
            </Connection>
          ) : (
            <p className="text-xs text-ink-muted">No parent goal linked.</p>
          )}
          {children.map((c) => (
            <Connection key={c.id} kind={`Child ${LEVELS.find((l) => l.id === c.level)?.label.toLowerCase()} goal`}>
              <button type="button" onClick={() => onOpenGoal(c.id)} className="text-left text-brand hover:text-brand-hover">
                {c.title} →
              </button>
              <span className="ml-2 text-xs text-ink-muted">{STATUS_LABEL[c.status]}</span>
            </Connection>
          ))}
          {serving.map((p) => (
            <Connection key={p.id} kind="Linked project">
              <Link href="/app/projects" className="text-brand hover:text-brand-hover">{p.title} ↗</Link>
            </Connection>
          ))}
          {serving.length === 0 && <p className="text-xs text-ink-muted">No projects linked.</p>}
          <p className="text-xs text-ink-muted">Each goal keeps its own recorded status and progress.</p>
        </div>
      </details>

      <details className="border-t border-hairline">
        <summary className={SUMMARY}>Goal description</summary>
        <p className="whitespace-pre-wrap break-words pb-4 text-sm text-ink-body">
          {goal.description || <span className="text-ink-muted">No description recorded.</span>}
        </p>
      </details>

      <div className="mt-2 flex items-center border-t border-hairline pt-5">
        <button type="button" onClick={onEdit} className="text-sm text-brand hover:text-brand-hover">
          Edit goal
        </button>
        <button type="button" onClick={onDelete} className="ml-auto text-xs text-ink-muted hover:text-red-700">
          Delete goal
        </button>
      </div>
    </section>
  );
}

function Connection({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-[0.12em] text-ink-muted">{kind}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
