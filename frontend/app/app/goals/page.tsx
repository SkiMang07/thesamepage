"use client";

// Goals — its own top-level page, not folded into Settings (Session 10:
// goals get written to constantly — new ones per period, status changes
// throughout — unlike Settings' "configure once" sections). Full company/
// department/team/individual hierarchy per Andrew's call in that session,
// even though role-scoped views (manager/dept-head/individual) don't exist
// yet — company/department goals are usable today, they just don't have a
// distinct audience beyond you until that UI ships. See docs/SESSION_HISTORY.md
// Session 10 and the goals_scoping project memory note.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DirectReport,
  Goal,
  GoalLevel,
  GoalStatus,
  createGoal,
  deleteGoal,
  getDirectReports,
  getGoals,
  updateGoal,
  updateGoalStatus,
} from "@/lib/api";

const LEVEL_TABS: { id: GoalLevel; label: string; blurb: string }[] = [
  { id: "individual", label: "Individual", blurb: "Goals for one direct report" },
  { id: "team", label: "Team", blurb: "Goals for your whole team" },
  { id: "department", label: "Department", blurb: "Rolled up one level" },
  { id: "company", label: "Company", blurb: "Organization-wide" },
];

const STATUS_OPTIONS: { id: GoalStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "on_track", label: "On track" },
  { id: "at_risk", label: "At risk" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const STATUS_STYLES: Record<GoalStatus, string> = {
  active: "bg-gray-100 text-gray-600",
  on_track: "bg-green-50 text-green-600",
  at_risk: "bg-amber-50 text-amber-600",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-gray-100 text-gray-400",
};

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-500";
const primaryBtnCls = "rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50";

type GoalFormValues = {
  title: string;
  description: string;
  successMetrics: string;
  level: GoalLevel;
  directReportId: string;
  parentGoalId: string;
  status: GoalStatus;
  dueDate: string;
};

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toGoalPayload(input: GoalFormValues) {
  return {
    title: input.title.trim(),
    description: input.description.trim() || undefined,
    success_metrics: input.successMetrics.trim() || undefined,
    level: input.level,
    status: input.status,
    due_date: input.dueDate || undefined,
    direct_report_id: input.level === "individual" ? input.directReportId || undefined : undefined,
    parent_goal_id: input.parentGoalId || undefined,
  };
}

export default function GoalsPage() {
  const [level, setLevel] = useState<GoalLevel>("individual");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getGoals(), getDirectReports()])
      .then(([g, r]) => {
        setGoals(g);
        setReports(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function addGoal(input: GoalFormValues) {
    const created = await createGoal(toGoalPayload(input));
    setGoals((gs) => [created, ...gs]);
    setError(null);
    setShowForm(false);
  }

  async function saveEdit(goalId: string, input: GoalFormValues) {
    const updated = await updateGoal(goalId, toGoalPayload(input));
    setGoals((gs) => gs.map((g) => (g.id === goalId ? updated : g)));
    setError(null);
    setEditingGoalId(null);
  }

  async function setStatus(goalId: string, status: GoalStatus) {
    try {
      const updated = await updateGoalStatus(goalId, status);
      setGoals((gs) => gs.map((g) => (g.id === goalId ? { ...g, ...updated } : g)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  async function removeGoal(goalId: string) {
    try {
      await deleteGoal(goalId);
      setGoals((gs) => gs.filter((g) => g.id !== goalId));
      setEditingGoalId((id) => (id === goalId ? null : id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete goal");
    }
  }

  const levelGoals = useMemo(() => goals.filter((g) => g.level === level), [goals, level]);

  // Individual goals get grouped by direct report so the list doesn't turn
  // into one long flat wall — matches PRODUCT_VISION's "Individual
  // Performance: name + status per direct report" card.
  const groupedIndividual = useMemo(() => {
    if (level !== "individual") return null;
    const groups = new Map<string, { name: string; goals: Goal[] }>();
    for (const g of levelGoals) {
      const key = g.direct_report_id ?? "unassigned";
      const name = g.direct_report_name ?? "Not linked to a report";
      if (!groups.has(key)) groups.set(key, { name, goals: [] });
      groups.get(key)!.goals.push(g);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [levelGoals, level]);

  const goalListProps = {
    onSetStatus: setStatus,
    onDelete: removeGoal,
    editingGoalId,
    onStartEdit: (id: string) => setEditingGoalId(id),
    onCancelEdit: () => setEditingGoalId(null),
    onSaveEdit: saveEdit,
    reports,
    allGoals: goals,
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Goals</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Company, department, team, and individual goals in one place.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="mt-8 flex items-center justify-between gap-4">
        <div className="flex flex-wrap rounded-md border border-gray-200 p-0.5">
          {LEVEL_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setLevel(t.id)}
              className={`rounded px-3 py-1.5 text-sm ${
                level === t.id ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            setEditingGoalId(null);
            setShowForm((s) => !s);
          }}
          className={primaryBtnCls}
        >
          {showForm ? "Cancel" : "+ New goal"}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        {LEVEL_TABS.find((t) => t.id === level)?.blurb}
      </p>

      {showForm && (
        <GoalForm
          defaultLevel={level}
          reports={reports}
          allGoals={goals}
          onCancel={() => setShowForm(false)}
          onSubmit={addGoal}
          submitLabel="Add goal"
          savingLabel="Adding..."
        />
      )}

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : level === "individual" ? (
        <div className="mt-8 space-y-8">
          {(groupedIndividual ?? []).map((group) => (
            <div key={group.name}>
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">{group.name}</h2>
              <GoalList goals={group.goals} {...goalListProps} />
            </div>
          ))}
          {levelGoals.length === 0 && (
            <p className="text-gray-500">
              No individual goals yet. Add one above and link it to a direct report.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-8">
          <GoalList goals={levelGoals} {...goalListProps} />
          {levelGoals.length === 0 && (
            <p className="text-gray-500">No {level} goals yet. Add the first one above.</p>
          )}
        </div>
      )}
    </main>
  );
}

function GoalList({
  goals,
  onSetStatus,
  onDelete,
  editingGoalId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  reports,
  allGoals,
}: {
  goals: Goal[];
  onSetStatus: (id: string, status: GoalStatus) => void;
  onDelete: (id: string) => void;
  editingGoalId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, input: GoalFormValues) => Promise<void>;
  reports: DirectReport[];
  allGoals: Goal[];
}) {
  return (
    <ul className="mt-3 space-y-2">
      {goals.map((g) =>
        g.id === editingGoalId ? (
          <li key={g.id}>
            <GoalForm
              defaultLevel={g.level}
              initialGoal={g}
              reports={reports}
              allGoals={allGoals.filter((x) => x.id !== g.id)}
              onCancel={onCancelEdit}
              onSubmit={(input) => onSaveEdit(g.id, input)}
              submitLabel="Save changes"
              savingLabel="Saving..."
            />
          </li>
        ) : (
          <li key={g.id} className="rounded-lg border border-gray-200 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{g.title}</p>
                {g.parent_goal_title && (
                  <p className="mt-0.5 text-xs text-gray-400">Part of: {g.parent_goal_title}</p>
                )}
                {g.description && <p className="mt-1 text-sm text-gray-500">{g.description}</p>}
                {g.success_metrics && (
                  <p className="mt-1 text-sm text-gray-500">
                    <span className="text-gray-400">Success metric: </span>
                    {g.success_metrics}
                  </p>
                )}
                {g.due_date && <p className="mt-1 text-xs text-gray-400">Due {formatDate(g.due_date)}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={g.status}
                  onChange={(e) => onSetStatus(g.id, e.target.value as GoalStatus)}
                  className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[g.status]}`}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onStartEdit(g.id)}
                  className="text-xs text-gray-400 hover:text-gray-700"
                  title="Edit goal"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(g.id)}
                  className="text-xs text-gray-400 hover:text-red-500"
                  title="Delete goal"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        )
      )}
    </ul>
  );
}

function GoalForm({
  defaultLevel,
  initialGoal,
  reports,
  allGoals,
  onCancel,
  onSubmit,
  submitLabel,
  savingLabel,
}: {
  defaultLevel: GoalLevel;
  initialGoal?: Goal | null;
  reports: DirectReport[];
  allGoals: Goal[];
  onCancel: () => void;
  onSubmit: (input: GoalFormValues) => Promise<void>;
  submitLabel: string;
  savingLabel: string;
}) {
  const [title, setTitle] = useState(initialGoal?.title ?? "");
  const [description, setDescription] = useState(initialGoal?.description ?? "");
  const [successMetrics, setSuccessMetrics] = useState(initialGoal?.success_metrics ?? "");
  const [goalLevel, setGoalLevel] = useState<GoalLevel>(initialGoal?.level ?? defaultLevel);
  const [directReportId, setDirectReportId] = useState(initialGoal?.direct_report_id ?? "");
  const [parentGoalId, setParentGoalId] = useState(initialGoal?.parent_goal_id ?? "");
  const [status, setStatus] = useState<GoalStatus>(initialGoal?.status ?? "active");
  const [dueDate, setDueDate] = useState(initialGoal?.due_date ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!initialGoal;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ title, description, successMetrics, level: goalLevel, directReportId, parentGoalId, status, dueDate });
      if (!isEdit) {
        setTitle("");
        setDescription("");
        setSuccessMetrics("");
        setDirectReportId("");
        setParentGoalId("");
        setStatus("active");
        setDueDate("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Grow NPS by 10 points" />
        </div>
        <div className="w-40">
          <label className={labelCls}>Level</label>
          <select value={goalLevel} onChange={(e) => setGoalLevel(e.target.value as GoalLevel)} className={inputCls}>
            {LEVEL_TABS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-3">
        {goalLevel === "individual" && (
          <div className="flex-1">
            <label className={labelCls}>Direct report</label>
            <select value={directReportId} onChange={(e) => setDirectReportId(e.target.value)} className={inputCls}>
              <option value="">Not linked to a report</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1">
          <label className={labelCls}>Parent goal (optional)</label>
          <select value={parentGoalId} onChange={(e) => setParentGoalId(e.target.value)} className={inputCls}>
            <option value="">No parent</option>
            {allGoals.map((g) => (
              <option key={g.id} value={g.id}>
                [{g.level}] {g.title}
              </option>
            ))}
          </select>
        </div>
        <div className="w-36">
          <label className={labelCls}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)} className={inputCls}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className={labelCls}>Due date (optional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={inputCls}
          placeholder="What this goal is about, in a sentence or two"
        />
      </div>

      <div>
        <label className={labelCls}>Success metric (optional)</label>
        <textarea
          value={successMetrics}
          onChange={(e) => setSuccessMetrics(e.target.value)}
          rows={2}
          className={inputCls}
          placeholder="How you'll know it's done — e.g. NRR at or above 110%, churn under 5%"
        />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={primaryBtnCls}>
          {saving ? savingLabel : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-900">
          Cancel
        </button>
      </div>
    </form>
  );
}
