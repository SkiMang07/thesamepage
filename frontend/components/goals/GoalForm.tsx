"use client";

// Create / edit a goal — the one form both paths use. Title, whose goal it is,
// what it supports, status, due date, description, the written success
// criterion, and an optional numeric measure.
//
// "Whose goal?" is one picker: Company, a department, a team or a person.
// Units are named by how they relate to the viewer ("Member Support (your
// team)", "Member Experience (your boss's group)") when they lead one; someone
// who leads nothing keeps the Departments / Teams / People groups. The
// level is derived from the pick, so level and link can no longer disagree or
// be left half-answered. A goal is unlinked only when nothing of that kind
// exists yet (no teams set up), or when an older goal was saved that way.
// "Supports" (parent_goal_id) only offers goals above this one, with the
// owner's own team and department first.
//
// The measure is one optional number per goal: what is counted, its format
// (count / number / percentage), a display unit, how a reading compares
// (at least / at most / below) and a target. Once a goal has recorded values,
// format and unit are locked here (and in the API and database) so a stored
// number never silently changes meaning; the wording and target stay
// editable, and every surface calls the target the "current" one.
//
// A new goal can start from a suggestion (the team-goals step in setup,
// lib/goalDraft.ts): the form opens filled in, says where it came from, and
// leaves the target for the manager to set beside the role's bar. Saving is
// still "Add goal" here.
//
// "This reads like an expectation": a team or individual goal with no due date
// that reads as ongoing, or repeats a role's expectation, is stopped once on
// save. The manager adds a date, opens the role instead, or saves it anyway.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import NoteField from "@/components/NoteField";
import { OTHER_UNITS_HEADING, type RelativeUnit, type UnitRelation } from "@/lib/unitRelation";
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
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/lib/tokens";
import { readsLikeExpectation, type ExpectationOverlap, type ExpectationRef, type GoalDraft } from "@/lib/goalDraft";
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

export type GoalFormDefaults = {
  level: GoalLevel;
  orgUnitId?: string;
  directReportId?: string;
  parentGoalId?: string;
  // A suggestion to start from (lib/goalDraft.ts). Nothing is saved until "Add goal".
  draft?: GoalDraft;
};

const LEVEL_RANK: Record<GoalLevel, number> = { individual: 0, team: 1, department: 2, company: 3 };

/** "team:<id>", "individual:<id>", "company:", or "team:" for a level with no link. */
function ownerKey(level: GoalLevel, directReportId: string, orgUnitId: string) {
  if (level === "company") return "company:";
  if (level === "individual") return `individual:${directReportId}`;
  return `${level}:${orgUnitId}`;
}

function parseOwner(key: string): { level: GoalLevel; id: string } {
  const i = key.indexOf(":");
  return { level: key.slice(0, i) as GoalLevel, id: key.slice(i + 1) };
}

function ancestorUnitIds(unitId: string | null | undefined, units: OrgUnit[]) {
  const out = new Set<string>();
  let cur = unitId ?? null;
  while (cur && !out.has(cur) && out.size < 50) {
    out.add(cur);
    cur = units.find((u) => u.id === cur)?.parent_unit_id ?? null;
  }
  return out;
}

function initialValues(goal: Goal | null | undefined, defaults: GoalFormDefaults, units: OrgUnit[]): Values {
  const m = goal?.measure;
  // A new team or department goal with only one unit of that kind: that's the one.
  const onlyUnit = (level: GoalLevel) => {
    const of = units.filter((u) => u.unit_type === level);
    return of.length === 1 ? of[0].id : "";
  };
  return {
    title: goal?.title ?? defaults.draft?.title ?? "",
    description: goal?.description ?? "",
    successMetrics: goal?.success_metrics ?? "",
    level: goal?.level ?? defaults.level,
    directReportId: goal ? goal.direct_report_id ?? "" : defaults.directReportId ?? "",
    orgUnitId: goal
      ? goal.org_unit_id ?? ""
      : defaults.orgUnitId ?? (defaults.level === "team" || defaults.level === "department" ? onlyUnit(defaults.level) : ""),
    parentGoalId: goal ? goal.parent_goal_id ?? "" : defaults.parentGoalId ?? "",
    status: goal?.status ?? "active",
    dueDate: goal?.due_date ?? (goal ? "" : defaults.draft?.dueDate ?? ""),
    measure: m || goal || !defaults.draft?.measure
      ? {
          on: !!m,
          label: m?.label ?? "",
          format: m?.format ?? "count",
          unit: m?.format === "percent" ? "" : m?.unit ?? "",
          target: m ? String(m.target) : "",
          direction: m?.direction ?? "at_least",
        }
      : {
          // From a suggestion: what is counted and how, with the target left blank.
          on: true,
          label: defaults.draft.measure.label,
          format: defaults.draft.measure.format,
          unit: "",
          target: "",
          direction: defaults.draft.measure.direction,
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
  relative = null,
  allGoals,
  onSubmit,
  onCancel,
  onDirtyChange,
  vocabulary,
  expectations = [],
}: {
  goal?: Goal | null;
  defaults: GoalFormDefaults;
  reports: DirectReport[];
  orgUnits: OrgUnit[];
  /** Units relative to the viewer (lib/unitRelation.ts); null keeps the type groups. */
  relative?: RelativeUnit[] | null;
  allGoals: Goal[];
  onSubmit: (body: GoalIn) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  vocabulary?: string;
  /** The roles' expectations, for the "reads like an expectation" check. */
  expectations?: ExpectationRef[];
}) {
  const start = useMemo(() => initialValues(goal, defaults, orgUnits), [goal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = useState<Values>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The overlap check asks once per form; "Save without a date" answers it.
  const [overlap, setOverlap] = useState<ExpectationOverlap | null>(null);
  const answered = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const draft = goal ? undefined : defaults.draft;
  const isEdit = !!goal;
  const locked = isEdit && !!goal?.measure && (goal?.reading_count ?? 0) > 0;
  // A goal linked to a measured expectation takes its values from the role's readings.
  const roleReadings = goal ? goal.readings_from === "role" : draft?.link?.kind === "metric";
  const dirty = JSON.stringify(v) !== JSON.stringify(start);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const set = (patch: Partial<Values>) => setV((cur) => ({ ...cur, ...patch }));
  const setMeasure = (patch: Partial<MeasureDraft>) => setV((cur) => ({ ...cur, measure: { ...cur.measure, ...patch } }));

  const departments = orgUnits.filter((ou) => ou.unit_type === "department");
  const teams = orgUnits.filter((ou) => ou.unit_type === "team");
  const owner = ownerKey(v.level, v.directReportId, v.orgUnitId);
  const relativeOptions = (relations: UnitRelation[]) =>
    (relative ?? [])
      .filter((r) => relations.includes(r.relation))
      .map((r) => (
        <option key={r.unit.id} value={`${r.unit.unit_type}:${r.unit.id}`}>{r.label}</option>
      ));
  // A level picked with no link: only offered when nothing of that kind exists
  // yet, or to keep an older unlinked goal representable.
  const unlinked = (level: GoalLevel) => {
    const exists = level === "team" ? teams.length > 0 : level === "department" ? departments.length > 0 : reports.length > 0;
    return !exists || owner === `${level}:`;
  };

  function changeOwner(key: string) {
    const { level, id } = parseOwner(key);
    const parent = allGoals.find((g) => g.id === v.parentGoalId);
    set({
      level,
      directReportId: level === "individual" ? id : "",
      orgUnitId: level === "team" || level === "department" ? id : "",
      // A parent at or below the new level no longer fits.
      parentGoalId: parent && LEVEL_RANK[parent.level] > LEVEL_RANK[level] ? v.parentGoalId : "",
    });
  }

  // What this goal can support: goals above it, never itself or its own
  // descendants. The owner's own chain (their team, its department) first.
  const blocked = goal ? descendantIds(goal.id, allGoals) : new Set<string>();
  const ownerUnit =
    v.level === "individual" ? reports.find((r) => r.id === v.directReportId)?.org_unit_id ?? null : v.orgUnitId || null;
  const chain = ancestorUnitIds(ownerUnit, orgUnits);
  const above = allGoals.filter(
    (g) =>
      g.id !== goal?.id &&
      !blocked.has(g.id) &&
      g.status !== "cancelled" &&
      (LEVEL_RANK[g.level] > LEVEL_RANK[v.level] || g.id === v.parentGoalId),
  );
  const isNear = (g: Goal) => g.level === "company" || (!!g.org_unit_id && chain.has(g.org_unit_id));
  const supportsChoices = [...above].sort(
    (a, b) => Number(isNear(b)) - Number(isNear(a)) || LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.title.localeCompare(b.title),
  );
  const supportLabel = (g: Goal) =>
    g.level === "company" ? `Company · ${g.title}` : `${g.org_unit_name ?? g.direct_report_name ?? LEVELS.find((l) => l.id === g.level)?.label} · ${g.title}`;

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
    if (v.level === "individual" && !v.directReportId) return setError("Pick the person this goal is for.");
    if (v.level === "team" && !v.orgUnitId && teams.length) return setError("Pick the team this goal is for.");
    if (v.level === "department" && !v.orgUnitId && departments.length) return setError("Pick the department this goal is for.");
    const measure = buildMeasure();
    if (!measure.ok) return setError(measure.error);
    // A goal deliberately started from this person's expectation is linked to it, not a duplicate.
    const linked = !!draft?.link && v.level === "individual";
    if (!answered.current && !linked && (v.level === "team" || v.level === "individual")) {
      const hit = readsLikeExpectation(v.title, v.dueDate, expectations);
      if (hit) {
        setError(null);
        return setOverlap(hit);
      }
    }
    setOverlap(null);
    const body: GoalIn = {
      title: v.title.trim(),
      description: v.description.trim() || null,
      success_metrics: v.successMetrics.trim() || null,
      level: v.level,
      status: v.status,
      due_date: v.dueDate || null,
      direct_report_id: v.level === "individual" ? v.directReportId || null : null,
      org_unit_id: v.level === "team" || v.level === "department" ? v.orgUnitId || null : null,
      parent_goal_id: v.level === "company" ? null : v.parentGoalId || null,
    };
    // From their role: keep the link to the expectation, for the person it was started for.
    if (linked && draft?.link && v.directReportId === defaults.directReportId) {
      if (draft.link.kind === "metric") body.source_metric_config_id = draft.link.id;
      else body.source_skill_config_id = draft.link.id;
    }
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
    <form ref={formRef} noValidate onSubmit={handleSubmit} className="space-y-5" aria-label={isEdit ? "Edit goal" : "New goal"}>
      {draft && (
        <p className="rounded-md bg-sunken px-3 py-2 text-xs text-ink-secondary">
          Started from{" "}
          {draft.source.kind === "goal"
            ? `a goal above you${draft.source.where ? ` (${draft.source.where})` : ""}`
            : `${draft.source.role ? `the ${draft.source.role} role’s` : "an"} expectation`}
          : <span className="text-ink">{draft.source.label}</span>.{" "}
          {draft.link
            ? "It stays linked to that expectation. Edit anything. Nothing is saved until you add it."
            : "Edit anything. Nothing is saved until you add it."}
        </p>
      )}
      <div>
        <label htmlFor="goal-title" className={LABEL}>Title</label>
        <input id="goal-title" value={v.title} onChange={(e) => set({ title: e.target.value })} className={INPUT} placeholder="e.g. Make customer handoffs consistent" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="goal-owner" className={LABEL}>Whose goal?</label>
          <select id="goal-owner" value={owner} onChange={(e) => changeOwner(e.target.value)} className={INPUT}>
            {v.level === "individual" && !v.directReportId && <option value="individual:">Pick a person</option>}
            {relative ? (
              <>
                {relativeOptions(["yours", "above"])}
                <option value="company:">The company</option>
                {relativeOptions(["under"])}
                {/* Only an older unlinked goal, or a level picked from a scope with no unit, lands here. */}
                {owner === "department:" && <option value="department:">{isEdit ? "Not linked to a department" : "Pick a department"}</option>}
                {owner === "team:" && <option value="team:">{isEdit ? "Not linked to a team" : "Pick a team"}</option>}
                {reports.length > 0 && (
                  <optgroup label="Your people">
                    {reports.map((r) => (
                      <option key={r.id} value={`individual:${r.id}`}>{r.name}</option>
                    ))}
                  </optgroup>
                )}
                {relative.some((r) => r.relation === "other") && (
                  <optgroup label={OTHER_UNITS_HEADING}>{relativeOptions(["other"])}</optgroup>
                )}
              </>
            ) : (
              <>
                <option value="company:">The company</option>
                {(departments.length > 0 || unlinked("department")) && (
                  <optgroup label="Departments">
                    {departments.map((ou) => (
                      <option key={ou.id} value={`department:${ou.id}`}>{ou.name}</option>
                    ))}
                    {unlinked("department") && (
                      <option value="department:">{departments.length ? (isEdit ? "Not linked to a department" : "Pick a department") : "A department (none set up yet)"}</option>
                    )}
                  </optgroup>
                )}
                {(teams.length > 0 || unlinked("team")) && (
                  <optgroup label="Teams">
                    {teams.map((ou) => (
                      <option key={ou.id} value={`team:${ou.id}`}>{ou.name}</option>
                    ))}
                    {unlinked("team") && (
                      <option value="team:">{teams.length ? (isEdit ? "Not linked to a team" : "Pick a team") : "A team (none set up yet)"}</option>
                    )}
                  </optgroup>
                )}
                {reports.length > 0 && (
                  <optgroup label="People">
                    {reports.map((r) => (
                      <option key={r.id} value={`individual:${r.id}`}>{r.name}</option>
                    ))}
                  </optgroup>
                )}
              </>
            )}
          </select>
          {owner === "team:" && teams.length > 0 && <p className="mt-1 text-xs text-amber-700">Pick the team. Without one, it won&apos;t show on the Team page.</p>}
          {owner === "department:" && departments.length > 0 && <p className="mt-1 text-xs text-amber-700">Pick the department. Without one, it won&apos;t show on its teams&apos; pages.</p>}
          {v.level === "individual" && !v.directReportId && <p className="mt-1 text-xs text-amber-700">Pick the person this goal is for.</p>}
        </div>
        {v.level !== "company" && (
          <div>
            <label htmlFor="goal-parent" className={LABEL}>Supports (optional)</label>
            <select id="goal-parent" value={v.parentGoalId} onChange={(e) => set({ parentGoalId: e.target.value })} className={`${INPUT} truncate`}>
              <option value="">{supportsChoices.length ? "Nothing above it" : "No goals above this one yet"}</option>
              {supportsChoices.map((g) => (
                <option key={g.id} value={g.id}>{supportLabel(g)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              {roleReadings
                ? "One measured value with a target. Its values are the role’s readings, added under From their role on this person’s goals; nothing is calculated for you."
                : "One measured value with a target. You record the value when you add an update; nothing is calculated for you."}
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
              {draft?.targetHint && !isEdit && (
                <p className="mt-1 text-xs text-ink-muted">The role’s bar is {draft.targetHint}. Set the target this goal pushes to.</p>
              )}
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

      {overlap && (
        <div aria-live="polite" className="space-y-2 rounded-lg border border-amber-500 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-ink">This reads like an expectation</p>
          <p className="text-[13px] text-ink-body">
            {overlap.match
              ? `It has no due date and repeats what ${overlap.match.role ? `the ${overlap.match.role} role` : "a role"} already expects: ${overlap.match.name}.`
              : "It has no due date and reads as ongoing."}{" "}
            Expectations are the standard every period. A goal changes something by a date.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => {
                setOverlap(null);
                document.getElementById("goal-due")?.focus();
              }}
            >
              Add a due date
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-secondary hover:bg-sunken hover:text-ink"
              onClick={() => {
                answered.current = true;
                formRef.current?.requestSubmit();
              }}
            >
              Save it as a goal anyway
            </button>
            <Link
              href={overlap.match?.roleLevelId ? `/app/expectations/${overlap.match.roleLevelId}` : "/app/expectations"}
              className="text-sm font-medium text-brand hover:text-brand-hover"
            >
              It’s the role’s standard: open the role instead
            </Link>
          </div>
        </div>
      )}

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
