"use client";

// From their role: what a person's role expects, shown as their starting
// goals (docs/systems/goals.md -> From their role; scoping in
// docs/GOAL_ATTRIBUTION_SCOPING.md Part B). Read live from the approved role,
// so a revision shows up at once and nothing is copied per person. These rows
// are not goal records: they can't be cancelled and don't roll up.
//
// Measured responsibilities and responsibilities come first; skills and
// values sit behind one disclosure so a long role doesn't bury the person's
// own goals. A reading is a value the manager enters for a period (or one a
// completed assessment recorded); the verdict beside it is a factual line,
// never a status. No AI anywhere here.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  addExpectationReading,
  deleteExpectationReading,
  getExpectationReadings,
  getRoleGoals,
  type ExpectationReading,
  type RoleGoals,
  type RoleMeasured,
  type RoleObserved,
} from "@/lib/api";
import type { GoalDraft } from "@/lib/goalDraft";
import { BTN_PRIMARY_SM, EYEBROW, INPUT, LABEL } from "@/lib/tokens";
import { formatMoment } from "@/lib/goals";
import { barUnit, defaultPeriod, draftFromExpectation, parseReading, readingText, verdictText } from "@/lib/roleGoals";

function first(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function errorText(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.detail || fallback;
  return fallback;
}

export default function FromTheirRole({
  reportId,
  reportName,
  compact = false,
  refreshKey = 0,
  onStartGoal,
  onOpenGoal,
  onReadingsChanged,
  onAssignRole,
}: {
  reportId: string;
  reportName: string;
  /** The person page's Work view: tighter, no per-item expectation wording. */
  compact?: boolean;
  refreshKey?: number;
  /** "Make it their own goal": open the New goal form from this draft. */
  onStartGoal: (draft: GoalDraft) => void;
  onOpenGoal?: (goalId: string) => void;
  /** A reading was added or removed, so goals linked to it changed too. */
  onReadingsChanged?: () => void;
  /** Where "add their role" goes. Defaults to the person page. */
  onAssignRole?: () => void;
}) {
  const [data, setData] = useState<RoleGoals | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const who = first(reportName);

  useEffect(() => {
    let live = true;
    setFailed(false);
    getRoleGoals(reportId)
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [reportId, refreshKey, version]);

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    onReadingsChanged?.();
  }, [onReadingsChanged]);

  const heading = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className={EYEBROW}>
        From their role{data?.role ? ` · ${data.role.job_role}` : ""}
      </h3>
      {data?.role && (
        <Link href={`/app/expectations/${data.role.id}`} className="text-xs text-brand hover:text-brand-hover">
          View the role →
        </Link>
      )}
    </div>
  );

  if (failed) {
    return (
      <section aria-label="From their role">
        {heading}
        <p className="mt-2 text-sm text-amber-700">
          What the role expects couldn&apos;t load.{" "}
          <button type="button" onClick={() => setVersion((v) => v + 1)} className="underline">
            Try again
          </button>
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section aria-label="From their role" aria-busy="true">
        {heading}
        <p className="mt-2 text-sm text-ink-muted">Loading what the role expects…</p>
      </section>
    );
  }
  if (!data.role) {
    return (
      <section aria-label="From their role">
        {heading}
        <p className="mt-2 text-sm text-ink-secondary">
          {onAssignRole ? (
            <button type="button" onClick={onAssignRole} className="text-brand underline hover:text-brand-hover">
              Add {who}&apos;s role
            </button>
          ) : (
            <Link href={`/app/reports/${reportId}`} className="text-brand underline hover:text-brand-hover">
              Add {who}&apos;s role
            </Link>
          )}{" "}
          to see what it expects. Its expectations become {who}&apos;s starting goals.
        </p>
      </section>
    );
  }

  const observedCount = data.skills.length + data.values.length;
  const empty = data.measured.length + data.responsibilities.length + observedCount === 0;
  const role = data.role.job_role;

  return (
    <section aria-label="From their role">
      {heading}
      <p className="mt-1 text-xs text-ink-muted">
        {who}&apos;s starting goals are what the role expects. They follow the role as it changes.
      </p>
      {empty ? (
        <p className="mt-3 text-sm text-ink-secondary">
          {role} has no expectations yet.{" "}
          <Link href={`/app/expectations/${data.role.id}`} className="text-brand underline hover:text-brand-hover">
            Define them in Roles &amp; expectations
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-divider border-y border-divider">
          {data.measured.map((item) => (
            <MeasuredRow
              key={item.id}
              item={item}
              reportId={reportId}
              who={who}
              compact={compact}
              onStart={() => onStartGoal(draftFromExpectation(item, role))}
              onOpenGoal={onOpenGoal}
              onChanged={changed}
            />
          ))}
          {data.responsibilities.map((item) => (
            <ObservedRow
              key={item.id}
              item={item}
              who={who}
              compact={compact}
              onStart={() => onStartGoal(draftFromExpectation(item, role))}
              onOpenGoal={onOpenGoal}
            />
          ))}
        </ul>
      )}
      {observedCount > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none py-1.5 text-xs text-ink-secondary hover:text-ink">
            {data.measured.length + data.responsibilities.length > 0 ? "And " : ""}
            {[
              data.skills.length ? `${data.skills.length} skill${data.skills.length === 1 ? "" : "s"}` : null,
              data.values.length ? `${data.values.length} value${data.values.length === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(" and ")}
          </summary>
          <ul className="mb-1 divide-y divide-divider">
            {data.skills.map((item) => (
              <ObservedRow
                key={item.id}
                item={item}
                who={who}
                compact={compact}
                onStart={() => onStartGoal(draftFromExpectation(item, role))}
                onOpenGoal={onOpenGoal}
              />
            ))}
            {data.values.map((v) => (
              <li key={v.id} className="py-2.5">
                <p className="text-sm text-ink">{v.name}</p>
                {!compact && v.expectation && <p className="mt-0.5 text-xs text-ink-muted">{v.expectation}</p>}
                <p className="mt-0.5 text-2xs text-ink-muted">{v.company_wide ? "Company value" : "Role value"}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.unlinked_goals.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-ink-secondary">Their own goals on expectations no longer in the role</p>
          <ul className="mt-1 space-y-1">
            {data.unlinked_goals.map((g) => (
              <li key={g.id} className="text-xs text-ink-muted">
                <GoalLink id={g.id} title={g.title} onOpenGoal={onOpenGoal} /> ·{" "}
                {g.reason === "retired"
                  ? `“${g.source_name ?? "its expectation"}” was retired`
                  : `“${g.source_name ?? "its expectation"}” is from an earlier role`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function GoalLink({ id, title, onOpenGoal }: { id: string; title: string; onOpenGoal?: (id: string) => void }) {
  if (onOpenGoal) {
    return (
      <button type="button" onClick={() => onOpenGoal(id)} className="text-brand underline-offset-2 hover:underline">
        {title}
      </button>
    );
  }
  return (
    <Link href={`/app/goals?goal=${id}`} className="text-brand underline-offset-2 hover:underline">
      {title}
    </Link>
  );
}

function OwnGoals({ goals, onOpenGoal }: { goals: RoleObserved["goals"]; onOpenGoal?: (id: string) => void }) {
  if (!goals.length) return null;
  return (
    <p className="mt-1 text-xs text-ink-secondary">
      Their own goal{goals.length === 1 ? "" : "s"} on this:{" "}
      {goals.map((g, i) => (
        <span key={g.id}>
          {i > 0 && ", "}
          <GoalLink id={g.id} title={g.title} onOpenGoal={onOpenGoal} />
        </span>
      ))}
    </p>
  );
}

function ObservedRow({
  item,
  who,
  compact,
  onStart,
  onOpenGoal,
}: {
  item: RoleObserved;
  who: string;
  compact: boolean;
  onStart: () => void;
  onOpenGoal?: (id: string) => void;
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-ink">{item.name}</p>
        <button type="button" onClick={onStart} className="shrink-0 text-xs text-brand hover:text-brand-hover">
          Make it {who}&apos;s goal
        </button>
      </div>
      {!compact && item.expectation && <p className="mt-0.5 text-xs text-ink-muted">Meets: {item.expectation}</p>}
      <p className="mt-0.5 text-2xs text-ink-muted">Judged by observation</p>
      <OwnGoals goals={item.goals} onOpenGoal={onOpenGoal} />
    </li>
  );
}

function MeasuredRow({
  item,
  reportId,
  who,
  compact,
  onStart,
  onOpenGoal,
  onChanged,
}: {
  item: RoleMeasured;
  reportId: string;
  who: string;
  compact: boolean;
  onStart: () => void;
  onOpenGoal?: (id: string) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ExpectationReading[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const fieldId = `reading-${item.id}`;

  const bar = item.target
    ? `Bar: ${item.target}`
    : item.target_status === "unresolved"
      ? "No target set yet, so a reading is never judged against a number."
      : item.expectation
        ? `Meets: ${item.expectation}`
        : null;
  const verdict = verdictText(item.verdict);

  function openForm() {
    setAdding(true);
    setValue("");
    setNote("");
    setError(null);
    setPeriod(defaultPeriod(item.measurement_period));
  }

  async function loadHistory() {
    try {
      setHistory(await getExpectationReadings(reportId, item.id));
    } catch {
      setHistory(null);
      setError("Readings couldn't load.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const parsed = parseReading(value);
    if (!parsed.ok) return setError(parsed.error);
    if (!period.trim()) return setError("Say which period the reading is for.");
    setSaving(true);
    setError(null);
    try {
      await addExpectationReading(reportId, { metric_config_id: item.id, value: parsed.value, period: period.trim(), notes: note.trim() || null });
      setAdding(false);
      if (showHistory) await loadHistory();
      onChanged();
    } catch (err) {
      setError(errorText(err, "The reading wasn't saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(entryId: string) {
    setError(null);
    try {
      await deleteExpectationReading(reportId, entryId);
      await loadHistory();
      onChanged();
    } catch (err) {
      setError(errorText(err, "The reading wasn't removed."));
    }
  }

  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-ink">{item.name}</p>
        <button type="button" onClick={onStart} className="shrink-0 text-xs text-brand hover:text-brand-hover">
          Make it {who}&apos;s goal
        </button>
      </div>
      {bar && !(compact && !item.target) && <p className="mt-0.5 text-xs text-ink-muted">{bar}</p>}
      <p className="mt-0.5 text-xs text-ink-body">
        {item.latest ? (
          <>
            Latest reading {readingText(item.latest.value, item.latest.period, barUnit(item.target))}
            <span className="text-ink-muted">
              {" "}
              · {item.latest.from_assessment ? "from an assessment" : `recorded ${formatMoment(item.latest.recorded_at)}`}
            </span>
          </>
        ) : (
          <span className="text-ink-muted">No reading yet</span>
        )}
      </p>
      {verdict && (
        <p className={`mt-0.5 text-xs ${item.verdict === "below" ? "text-amber-700" : "text-brand"}`}>{verdict}</p>
      )}
      <OwnGoals goals={item.goals} onOpenGoal={onOpenGoal} />
      {!adding && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={openForm} className="text-xs font-medium text-brand hover:text-brand-hover">
            + Add a reading
          </button>
          {item.reading_count > 0 && (
            <button
              type="button"
              aria-expanded={showHistory}
              onClick={() => {
                const next = !showHistory;
                setShowHistory(next);
                if (next) void loadHistory();
              }}
              className="text-xs text-ink-secondary hover:text-ink"
            >
              Readings · {item.reading_count}
            </button>
          )}
        </div>
      )}
      {adding && (
        <form noValidate onSubmit={save} className="mt-2 rounded-md bg-sunken/60 p-3" aria-label={`Add a reading for ${item.name}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${fieldId}-value`} className={LABEL}>Reading{barUnit(item.target) ? " (%)" : ""}</label>
              <input
                id={`${fieldId}-value`}
                type="number"
                inputMode="decimal"
                step="any"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={INPUT}
                placeholder={item.latest ? `Last: ${readingText(item.latest.value, null, barUnit(item.target))}` : "e.g. 7.2"}
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-period`} className={LABEL}>For the period</label>
              <input id={`${fieldId}-period`} value={period} maxLength={40} onChange={(e) => setPeriod(e.target.value)} className={INPUT} />
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor={`${fieldId}-note`} className={LABEL}>Note · optional</label>
            <input id={`${fieldId}-note`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={INPUT}
              placeholder={item.data_source ? `From ${item.data_source}` : "Where the number came from"} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="submit" disabled={saving} className={BTN_PRIMARY_SM}>
              {saving ? "Saving..." : "Save reading"}
            </button>
            <button type="button" disabled={saving} onClick={() => setAdding(false)} className="text-sm text-ink-secondary hover:text-ink">
              Cancel
            </button>
          </div>
        </form>
      )}
      <div role="alert" aria-live="assertive">
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
      {showHistory && history && (
        <table className="mt-2 text-xs">
          <thead>
            <tr className="text-ink-muted">
              <th scope="col" className="py-1 pr-6 text-left font-normal">Period</th>
              <th scope="col" className="py-1 pr-6 text-left font-normal">Reading</th>
              <th scope="col" className="py-1 pr-6 text-left font-normal">Recorded</th>
              <th scope="col" className="py-1 text-left font-normal"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody className="text-ink-body">
            {history.map((r) => (
              <tr key={r.id} className="border-t border-divider">
                <td className="py-1 pr-6">{r.period}</td>
                <td className="py-1 pr-6 tabular-nums">{r.value}</td>
                <td className="py-1 pr-6">{r.from_assessment ? "Assessment" : formatMoment(r.recorded_at)}</td>
                <td className="py-1">
                  {!r.from_assessment && (
                    <button type="button" onClick={() => void remove(r.id)} className="text-ink-muted hover:text-red-600"
                      aria-label={`Remove the ${r.period ?? ""} reading`}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
