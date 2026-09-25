"use client";

// Create / edit a goal — the one form both paths use. Title, level and its
// association, parent, status, due date, description, the written success
// criterion, and an optional numeric measure.
//
// The measure is one optional number per goal: what is counted, its format
// (count / number / percentage), a display unit, how a reading compares
// (at least / at most / below) and a target. Once a goal has recorded values,
// format and unit are locked here (and in the API and database) so a stored
// number never silently changes meaning; the wording and target stay
// editable, and every surface calls the target the "current" one.

import { useEffect, useMemo, useState } from "react";
import NoteField from "@/components/NoteField";
import type {
  DirectReport,
  Goal,
  GoalIn,
  GoalLevel,
  GoalMeasure,
  GoalMeasureDirection,
  GoalMeasureFormat,
  GoalStatus,
  OrgUnit,
} from "@/lib/api";
import { BTN_PRIMARY, INPUT, LABEL } from "@/lib/tokens";
import {
  DIRECTION_LABEL,
  FORMAT_LABEL,
  LEVELS,
  STATUS_LABEL,
  STATUS_ORDER,
  parseMeasuredValue,
} from "@/lib/goals";

type MeasureDraft = {
  on: boolean;
  label: string;
  format: GoalMeasureFormat;
  unit: string;
  target: string;
  direction: GoalMeasureDirection;
};

type Values = {
  title: string;
  description: string;
  successMetrics: string;
  level: GoalLevel;
  directReportId: string;
  orgUnitId: string;
  parentGoalId: string;
  status: GoalStatus;
  dueDate: string;
  measure: MeasureDraft;
};

function initialValues(goal: Goal | null | undefined, defaults: { level: GoalLevel; orgUnitId?: string; directReportId?: string }): Values {
  const m = goal?.measure;
  return {
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    successMetrics: goal?.success_metrics ?? "",
    level: goal?.level ?? defaults.level,
    directReportId: goal ? goal.direct_report_id ?? "" : defaults.directReportId ?? "",
    orgUnitId: goal ? goal.org_unit_id ?? "" : defaults.orgUnitId ?? "",
    parentGoalId: goal?.parent_goal_id ?? "",
    status: goal?.status ?? "active",
    dueDate: goal?.due_date ?? "",
    measure: {
      on: !!m,
      label: m?.label ?? "",
      format: m?.format ?? "count",
      unit: m?.format === "percent" ? "" : m?.unit ?? "",
      target: m ? String(m.target) : "",
      direction: m?.direction ?? "at_least",
    },
  };
}

function descendantIds(goalId: string, goals: Goal[]) {
  const out = new Set<string>();
  const stack = [goalId];
  while (stack.length && out.size < 500) {
    const id = stack.pop()!;
    for (const g of goals) {
      if (g.parent_goal_id === id && !out.has(g.id)) {
        out.add(g.id);
        stack.push(g.id);
      }
    }
  }
  return out;
}

export default function GoalForm({
  goal,
  defaults,
  reports,
  orgUnits,
  allGoals,
  onSubmit,
  onCancel,
  onDirtyChange,
  vocabulary,
}: {
  goal?: Goal | null;
  defaults: { level: GoalLevel; orgUnitId?: string; directReportId?: string };
  reports: DirectReport[];
  orgUnits: OrgUnit[];
  allGoals: Goal[];
  onSubmit: (body: GoalIn) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  vocabulary?: string;
}) {
  const start = useMemo(() => initialValues(goal, defaults), [goal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = useState<Values>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!goal;
  const locked = isEdit && !!goal?.measure && (goal?.reading_count ?? 0) > 0;
  const dirty = JSON.stringify(v) !== JSON.stringify(start);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const set = (patch: Partial<Values>) => setV((cur) => ({ ...cur, ...patch }));
  const setMeasure = (patch: Partial<MeasureDraft>) => setV((cur) => ({ ...cur, measure: { ...cur.measure, ...patch } }));

  const matchingUnits = orgUnits.filter((ou) => ou.unit_type === v.level);
  const blocked = goal ? descendantIds(goal.id, allGoals) : new Set<string>();
  const parentChoices = allGoals.filter((g) => g.id !== goal?.id && !blocked.has(g.id));

  function changeLevel(level: GoalLevel) {
    set({
      level,
      directReportId: level === "individual" ? v.directReportId : "",
      orgUnitId: orgUnits.some((ou) => ou.id === v.orgUnitId && ou.unit_type === level) ? v.orgUnitId : "",
    });
  }

  function buildMeasure(): { ok: true; measure: GoalMeasure | null } | { ok: false; error: string } {
    const md = v.measure;
    if (!md.on) return { ok: true, measure: null };
    if (!md.label.trim()) return { ok: false, error: "Describe what the number counts, e.g. “customer calls led independently”." };
    if (md.target.trim() === "") return { ok: false, error: "Add a target for the measure." };
    const parsed = parseMeasuredValue(md.target, md.format);
    if (!parsed.ok || parsed.value == null) return { ok: false, error: parsed.ok ? "Add a target for the measure." : parsed.error.replace("A count", "A count target") };
    return {
      ok: true,
      measure: {
        label: md.label.trim(),
        format: md.format,
        unit: md.format === "percent" ? "%" : md.unit.trim() || null,
        target: parsed.value,
        direction: md.direction,
      },
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!v.title.trim()) return setError("Give the goal a title.");
    const measure = buildMeasure();
    if (!measure.ok) return setError(measure.error);
    const body: GoalIn = {
      title: v.title.trim(),
      description: v.description.trim() || null,
      success_metrics: v.successMetrics.trim() || null,
      level: v.level,
      status: v.status,
      due_date: v.dueDate || null,
      direct_report_id: v.level === "individual" ? v.directReportId || null : null,
      org_unit_id: v.level === "team" || v.level === "department" ? v.orgUnitId || null : null,
      parent_goal_id: v.parentGoalId || null,
    };
    // Only send the measure when it changed, so an edit that never touched
    // it can't collide with the lock.
    const before = start.measure;
    const measureChanged = JSON.stringify(v.measure) !== JSON.stringify(before);
    if (!isEdit || measureChanged) body.measure = measure.measure;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The goal wasn't saved.");
    } finally {
      setSaving(false);
    }
  }

  const md = v.measure;
  const targetChanged = isEdit && goal?.measure && md.on && md.target.trim() !== String(goal.measure.target);

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5" aria-label={isEdit ? "Edit goal" : "New goal"}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_11rem]">
        <div>
          <label htmlFor="goal-title" className={LABEL}>Title</label>
          <input id="goal-title" value={v.title} onChange={(e) => set({ title: e.target.value })} className={INPUT} placeholder="e.g. Make customer handoffs consistent" />
        </div>
        <div>
          <label htmlFor="goal-level" className={LABEL}>Level</label>
          <select id="goal-level" value={v.level} onChange={(e) => changeLevel(e.target.value as GoalLevel)} className={INPUT}>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {v.level === "individual" && (
          <div>
            <label htmlFor="goal-report" className={LABEL}>Direct report</label>
            <select id="goal-report" value={v.directReportId} onChange={(e) => set({ directReportId: e.target.value })} className={INPUT}>
              <option value="">Not linked to a report</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
        {(v.level === "team" || v.level === "department") && (
          <div>
            <label htmlFor="goal-unit" className={LABEL}>{v.level === "team" ? "Team" : "Department"} (optional)</label>
            <select id="goal-unit" value={v.orgUnitId} onChange={(e) => set({ orgUnitId: e.target.value })} className={INPUT}>
              <option value="">Not linked to a specific {v.level}</option>
              {matchingUnits.map((ou) => (
                <option key={ou.id} value={ou.id}>{ou.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="goal-parent" className={LABEL}>Parent goal (optional)</label>
          <select id="goal-parent" value={v.parentGoalId} onChange={(e) => set({ parentGoalId: e.target.value })} className={`${INPUT} truncate`}>
            <option value="">No parent</option>
            {parentChoices.map((g) => (
              <option key={g.id} value={g.id}>[{g.level}] {g.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="goal-status" className={LABEL}>Status</label>
          <select id="goal-status" value={v.status} onChange={(e) => set({ status: e.target.value as GoalStatus })} className={INPUT}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="goal-due" className={LABEL}>Due date (optional)</label>
          <input id="goal-due" type="date" value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={INPUT} />
        </div>
      </div>

      <div>
        <label htmlFor="goal-description" className={LABEL}>Description (optional)</label>
        <NoteField id="goal-description" value={v.description} onChange={(description) => set({ description })} rows={2} baseClassName={INPUT} vocabulary={vocabulary} placeholder="What this goal is about, in a sentence or two" />
      </div>

      <div>
        <label htmlFor="goal-success" className={LABEL}>Success criterion (optional)</label>
        <NoteField id="goal-success" value={v.successMetrics} onChange={(successMetrics) => set({ successMetrics })} rows={2} baseClassName={INPUT} vocabulary={vocabulary} placeholder="How you'll know it's done, in your own words" />
      </div>

      <fieldset className="rounded-lg bg-sunken/60 p-4 sm:p-5">
        <legend className="sr-only">Numeric measure</legend>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={md.on}
            disabled={locked}
            onChange={(e) => setMeasure({ on: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-semibold text-ink">Track a number · optional</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              One measured value with a target. You record the value when you add an update; nothing is calculated for you.
            </span>
          </span>
        </label>
        {md.on && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="measure-label" className={LABEL}>What is counted</label>
              <input id="measure-label" value={md.label} onChange={(e) => setMeasure({ label: e.target.value })} className={INPUT} placeholder="e.g. customer calls led independently" />
            </div>
            <div>
              <label htmlFor="measure-format" className={LABEL}>Format</label>
              <select id="measure-format" value={md.format} disabled={locked} onChange={(e) => setMeasure({ format: e.target.value as GoalMeasureFormat })} className={INPUT}>
                {(Object.keys(FORMAT_LABEL) as GoalMeasureFormat[]).map((f) => (
                  <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
                ))}
              </select>
            </div>
            {md.format !== "percent" ? (
              <div>
                <label htmlFor="measure-unit" className={LABEL}>Unit (optional)</label>
                <input id="measure-unit" value={md.unit} disabled={locked} onChange={(e) => setMeasure({ unit: e.target.value })} className={INPUT} placeholder="e.g. calls" />
              </div>
            ) : (
              <div className="text-xs text-ink-muted sm:pt-6">Shown as a percentage. Values above 100% are allowed.</div>
            )}
            <div>
              <label htmlFor="measure-direction" className={LABEL}>Target is met when the value is</label>
              <select id="measure-direction" value={md.direction} onChange={(e) => setMeasure({ direction: e.target.value as GoalMeasureDirection })} className={INPUT}>
                {(Object.keys(DIRECTION_LABEL) as GoalMeasureDirection[]).map((d) => (
                  <option key={d} value={d}>{DIRECTION_LABEL[d]} the target</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="measure-target" className={LABEL}>Target{md.format === "percent" ? " (%)" : ""}</label>
              <input
                id="measure-target"
                type="number"
                inputMode="decimal"
                step={md.format === "count" ? 1 : "any"}
                min={md.format === "count" ? 0 : undefined}
                value={md.target}
                onChange={(e) => setMeasure({ target: e.target.value })}
                className={INPUT}
              />
            </div>
            {locked && (
              <p className="text-xs text-ink-muted sm:col-span-2">
                Values are already recorded against this measure, so its format and unit are fixed. You can clarify the wording or change the target. For a different measure, start a new goal.
              </p>
            )}
            {targetChanged && (
              <p className="text-xs text-amber-700 sm:col-span-2">
                Earlier values are not re-judged. Charts show this as the current target, not the target at the time.
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div role="alert">{error && <p className="text-sm text-red-700">{error}</p>}</div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={BTN_PRIMARY}>
          {saving ? "Saving..." : isEdit ? "Save changes" : "Add goal"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-ink-secondary hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
