"use client";

// Create / edit a project in place. Owner, team, goal and due date are all
// optional: a standalone project with no date is a complete project. Saving
// edits current fields only — it never adds a dated update to the record.

import { useEffect, useMemo, useRef, useState } from "react";
import NoteField from "@/components/NoteField";
import type { DirectReport, Goal, OrgUnit, Project, ProjectIn, ProjectStatus } from "@/lib/api";
import { BTN_PRIMARY_SM, INPUT, LABEL } from "@/lib/tokens";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_ORDER } from "@/lib/projects";

type Values = {
  title: string;
  description: string;
  directReportId: string;
  goalId: string;
  orgUnitId: string;
  status: ProjectStatus;
  dueDate: string;
};

function initial(p?: Project | null): Values {
  return {
    title: p?.title ?? "",
    description: p?.description ?? "",
    directReportId: p?.direct_report_id ?? "",
    goalId: p?.goal_id ?? "",
    orgUnitId: p?.org_unit_id ?? "",
    status: p?.status ?? "active",
    dueDate: p?.due_date ?? "",
  };
}

export default function ProjectForm({
  project,
  reports,
  goals,
  orgUnits,
  vocabulary,
  onSubmit,
  onCancel,
  onDirtyChange,
}: {
  project?: Project | null;
  reports: DirectReport[];
  goals: Goal[];
  orgUnits: OrgUnit[];
  vocabulary?: string;
  onSubmit: (body: ProjectIn) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const start = useMemo(() => initial(project), [project]);
  const [v, setV] = useState<Values>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const id = project ? `project-${project.id}-form` : "project-new-form";

  const dirty = (Object.keys(v) as (keyof Values)[]).some((k) => v[k] !== start[k]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);

  const set = (patch: Partial<Values>) => setV((cur) => ({ ...cur, ...patch }));

  // Keep a link visible even if its record isn't in the loaded list (an
  // archived report, a goal filtered out) so editing never silently drops it.
  const reportMissing = v.directReportId && !reports.some((r) => r.id === v.directReportId);
  const goalMissing = v.goalId && !goals.some((g) => g.id === v.goalId);
  const unitMissing = v.orgUnitId && !orgUnits.some((u) => u.id === v.orgUnitId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!v.title.trim()) {
      setError("Give the project a name.");
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: v.title.trim(),
        description: v.description.trim() || null,
        status: v.status,
        due_date: v.dueDate || null,
        direct_report_id: v.directReportId || null,
        goal_id: v.goalId || null,
        org_unit_id: v.orgUnitId || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The project wasn't saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving && !(e.target instanceof HTMLTextAreaElement)) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div>
        <label htmlFor={`${id}-title`} className={LABEL}>
          Project name
        </label>
        <input
          id={`${id}-title`}
          ref={titleRef}
          value={v.title}
          onChange={(e) => set({ title: e.target.value })}
          className={INPUT}
          placeholder="e.g. A clearer handoff from Sales"
        />
      </div>
      <div className="mt-4">
        <label htmlFor={`${id}-description`} className={LABEL}>
          Purpose · optional
        </label>
        <NoteField
          id={`${id}-description`}
          value={v.description}
          onChange={(description) => set({ description })}
          rows={3}
          vocabulary={vocabulary}
          placeholder="What this project is for, in a sentence or two"
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-owner`} className={LABEL}>
            Project owner
          </label>
          <select id={`${id}-owner`} value={v.directReportId} onChange={(e) => set({ directReportId: e.target.value })} className={INPUT}>
            <option value="">You</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            {reportMissing && <option value={v.directReportId}>{project?.direct_report_name ?? "Current owner"}</option>}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-team`} className={LABEL}>
            Team or department · optional
          </label>
          <select id={`${id}-team`} value={v.orgUnitId} onChange={(e) => set({ orgUnitId: e.target.value })} className={INPUT}>
            <option value="">No team assigned</option>
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.unit_type})
              </option>
            ))}
            {unitMissing && <option value={v.orgUnitId}>{project?.org_unit_name ?? "Current team"}</option>}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-goal`} className={LABEL}>
            Goal connection · optional
          </label>
          <select id={`${id}-goal`} value={v.goalId} onChange={(e) => set({ goalId: e.target.value })} className={INPUT}>
            <option value="">Standalone — no goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
            {goalMissing && <option value={v.goalId}>{project?.goal_title ?? "Current goal"}</option>}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-status`} className={LABEL}>
            Status
          </label>
          <select id={`${id}-status`} value={v.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })} className={INPUT}>
            {PROJECT_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-due`} className={LABEL}>
            Due date · optional
          </label>
          <div className="flex gap-2">
            <input id={`${id}-due`} type="date" value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={INPUT} />
            {v.dueDate && (
              <button type="button" onClick={() => set({ dueDate: "" })} className="shrink-0 text-xs text-ink-secondary hover:text-ink">
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        {project
          ? "Saving changes these details. It doesn’t add a dated update to the record."
          : "The team decides which team page shows this project. A goal connection is optional."}
      </p>
      <div role="alert" aria-live="assertive">
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={saving} className={BTN_PRIMARY_SM}>
          {saving ? "Saving..." : project ? "Save changes" : "Create project"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="text-sm text-ink-secondary hover:text-ink">
          {project ? "Cancel" : "Discard"}
        </button>
      </div>
    </form>
  );
}
