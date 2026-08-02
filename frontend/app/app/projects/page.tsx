"use client";

// Projects — its own top-level page, same reasoning as Goals (Session 10):
// projects get created and status-updated regularly, unlike Settings'
// "configure once" sections. Per PRODUCT_VISION.md, "goals = what, projects
// = how" — a project can stand alone, hang off a goal, and/or be assigned to
// a direct report. No level/org_unit_id of its own (see the projects_scoping
// project memory note and projects.py's docstring) — scope comes from
// whatever it's linked to. See docs/SESSION_HISTORY.md Session 13.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DirectReport,
  Goal,
  Project,
  ProjectStatus,
  createProject,
  deleteProject,
  getDirectReports,
  getGoals,
  getProjects,
  updateProject,
  updateProjectStatus,
} from "@/lib/api";

const STATUS_OPTIONS: { id: ProjectStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "on_track", label: "On track" },
  { id: "at_risk", label: "At risk" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: "bg-gray-100 text-gray-600",
  on_track: "bg-green-50 text-green-600",
  at_risk: "bg-amber-50 text-amber-600",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-gray-100 text-gray-400",
};

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-500";
const primaryBtnCls = "rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50";

type ProjectFormValues = {
  title: string;
  description: string;
  directReportId: string;
  goalId: string;
  status: ProjectStatus;
  dueDate: string;
};

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toProjectPayload(input: ProjectFormValues) {
  return {
    title: input.title.trim(),
    description: input.description.trim() || undefined,
    status: input.status,
    due_date: input.dueDate || undefined,
    direct_report_id: input.directReportId || undefined,
    goal_id: input.goalId || undefined,
  };
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getProjects(), getDirectReports(), getGoals()])
      .then(([p, r, g]) => {
        setProjects(p);
        setReports(r);
        setGoals(g);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function addProject(input: ProjectFormValues) {
    const created = await createProject(toProjectPayload(input));
    setProjects((ps) => [created, ...ps]);
    setError(null);
    setShowForm(false);
  }

  async function saveEdit(projectId: string, input: ProjectFormValues) {
    const updated = await updateProject(projectId, toProjectPayload(input));
    setProjects((ps) => ps.map((p) => (p.id === projectId ? updated : p)));
    setError(null);
    setEditingProjectId(null);
  }

  async function setStatus(projectId: string, status: ProjectStatus) {
    try {
      const updated = await updateProjectStatus(projectId, status);
      setProjects((ps) => ps.map((p) => (p.id === projectId ? { ...p, ...updated } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  async function removeProject(projectId: string) {
    try {
      await deleteProject(projectId);
      setProjects((ps) => ps.filter((p) => p.id !== projectId));
      setEditingProjectId((id) => (id === projectId ? null : id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    }
  }

  // Grouped by assignee so the list reads like Goals' individual grouping —
  // "Your initiatives" first, then one group per direct report that has any.
  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; projects: Project[] }>();
    groups.set("unassigned", { name: "Your initiatives", projects: [] });
    for (const p of projects) {
      const key = p.direct_report_id ?? "unassigned";
      const name = p.direct_report_name ?? "Your initiatives";
      if (!groups.has(key)) groups.set(key, { name, projects: [] });
      groups.get(key)!.projects.push(p);
    }
    return Array.from(groups.values())
      .filter((g) => g.projects.length > 0)
      .sort((a, b) => (a.name === "Your initiatives" ? -1 : b.name === "Your initiatives" ? 1 : a.name.localeCompare(b.name)));
  }, [projects]);

  const listProps = {
    onSetStatus: setStatus,
    onDelete: removeProject,
    editingProjectId,
    onStartEdit: (id: string) => setEditingProjectId(id),
    onCancelEdit: () => setEditingProjectId(null),
    onSaveEdit: saveEdit,
    reports,
    goals,
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        How your goals get done — standalone or linked to a goal, yours or a direct report&apos;s.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="mt-8 flex items-center justify-end">
        <button
          onClick={() => {
            setEditingProjectId(null);
            setShowForm((s) => !s);
          }}
          className={primaryBtnCls}
        >
          {showForm ? "Cancel" : "+ New project"}
        </button>
      </div>

      {showForm && (
        <ProjectForm
          reports={reports}
          goals={goals}
          onCancel={() => setShowForm(false)}
          onSubmit={addProject}
          submitLabel="Add project"
          savingLabel="Adding..."
        />
      )}

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : projects.length === 0 ? (
        <p className="mt-8 text-gray-500">No projects yet. Add the first one above.</p>
      ) : (
        <div className="mt-8 space-y-8">
          {grouped.map((group) => (
            <div key={group.name}>
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">{group.name}</h2>
              <ProjectList projects={group.projects} {...listProps} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function ProjectList({
  projects,
  onSetStatus,
  onDelete,
  editingProjectId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  reports,
  goals,
}: {
  projects: Project[];
  onSetStatus: (id: string, status: ProjectStatus) => void;
  onDelete: (id: string) => void;
  editingProjectId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, input: ProjectFormValues) => Promise<void>;
  reports: DirectReport[];
  goals: Goal[];
}) {
  return (
    <ul className="mt-3 space-y-2">
      {projects.map((p) =>
        p.id === editingProjectId ? (
          <li key={p.id}>
            <ProjectForm
              initialProject={p}
              reports={reports}
              goals={goals}
              onCancel={onCancelEdit}
              onSubmit={(input) => onSaveEdit(p.id, input)}
              submitLabel="Save changes"
              savingLabel="Saving..."
            />
          </li>
        ) : (
          <li key={p.id} className="rounded-lg border border-gray-200 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{p.title}</p>
                {p.goal_title && (
                  <p className="mt-0.5 text-xs text-gray-400">Supports goal: {p.goal_title}</p>
                )}
                {p.description && <p className="mt-1 text-sm text-gray-500">{p.description}</p>}
                {p.due_date && <p className="mt-1 text-xs text-gray-400">Due {formatDate(p.due_date)}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={p.status}
                  onChange={(e) => onSetStatus(p.id, e.target.value as ProjectStatus)}
                  className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[p.status]}`}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onStartEdit(p.id)}
                  className="text-xs text-gray-400 hover:text-gray-700"
                  title="Edit project"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  className="text-xs text-gray-400 hover:text-red-500"
                  title="Delete project"
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

function ProjectForm({
  initialProject,
  reports,
  goals,
  onCancel,
  onSubmit,
  submitLabel,
  savingLabel,
}: {
  initialProject?: Project | null;
  reports: DirectReport[];
  goals: Goal[];
  onCancel: () => void;
  onSubmit: (input: ProjectFormValues) => Promise<void>;
  submitLabel: string;
  savingLabel: string;
}) {
  const [title, setTitle] = useState(initialProject?.title ?? "");
  const [description, setDescription] = useState(initialProject?.description ?? "");
  const [directReportId, setDirectReportId] = useState(initialProject?.direct_report_id ?? "");
  const [goalId, setGoalId] = useState(initialProject?.goal_id ?? "");
  const [status, setStatus] = useState<ProjectStatus>(initialProject?.status ?? "active");
  const [dueDate, setDueDate] = useState(initialProject?.due_date ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!initialProject;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ title, description, directReportId, goalId, status, dueDate });
      if (!isEdit) {
        setTitle("");
        setDescription("");
        setDirectReportId("");
        setGoalId("");
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Migrate onboarding to new flow" />
        </div>
        <div className="w-36">
          <label className={labelCls}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className={inputCls}>
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

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Assigned to (optional)</label>
          <select value={directReportId} onChange={(e) => setDirectReportId(e.target.value)} className={inputCls}>
            <option value="">Your initiative</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className={labelCls}>Supports goal (optional)</label>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} className={inputCls}>
            <option value="">Standalone — no goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                [{g.level}] {g.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={inputCls}
          placeholder="What this project is and how it ties back to the goal"
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
