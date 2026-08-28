"use client";

// This page is an Initiative Desk, not a project-management surface. Its job
// is to help a manager scan consequential work, focus on one initiative with
// its owner/outcome context intact, and record meaningful changes. Execution
// coordination — tasks, dependencies, workflow stages, comments, files, and
// scheduling machinery — remains deliberately out of scope.

import { useEffect, useMemo, useState } from "react";
import CheckInPanel, {
  ProgressBar,
  TrendArrow,
  freshnessLabel,
  isStale,
} from "@/components/CheckInPanel";
import {
  CheckIn,
  DirectReport,
  Goal,
  OrgUnit,
  Project,
  ProjectStatus,
  createProject,
  createProjectCheckIn,
  deleteProject,
  getDirectReports,
  getGoals,
  getOrgUnits,
  getProjectCheckIns,
  getProjects,
  updateProject,
  updateProjectStatus,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import { useDrawer } from "@/lib/drawer-context";
import NoteField from "@/components/NoteField";
import {
  BADGE,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  FEATURE_SURFACE,
  INPUT,
  LABEL,
  META,
  STATUS_BORDER,
  STATUS_GLYPH,
  STATUS_STYLES,
} from "@/lib/tokens";

const STATUS_OPTIONS: { id: ProjectStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "on_track", label: "On track" },
  { id: "at_risk", label: "At risk" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

// Local aliases so this file's existing call sites keep working; the value
// itself is the shared token, so restyling happens in one place.
const inputCls = INPUT;
const labelCls = LABEL;
const primaryBtnCls = BTN_PRIMARY;

type ProjectFormValues = {
  title: string;
  description: string;
  directReportId: string;
  goalId: string;
  orgUnitId: string;
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

// Local (not UTC) YYYY-MM-DD keeps overdue grouping aligned with the date the
// manager sees rather than letting UTC move an initiative a day early.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isOverdue(project: Project) {
  return !!project.due_date && project.due_date < localDateStr();
}

function compareProjects(a: Project, b: Project) {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date && !b.due_date) return -1;
  if (!a.due_date && b.due_date) return 1;
  return a.title.localeCompare(b.title);
}

function projectOwner(project: Project) {
  return project.direct_report_name ?? "You";
}

function attentionReasons(project: Project) {
  const reasons: string[] = [];
  if (project.status === "at_risk") reasons.push("At risk");
  if (isOverdue(project)) reasons.push(`Due ${formatDate(project.due_date!)}`);
  if (isStale(project.last_check_in_at)) reasons.push(freshnessLabel(project.last_check_in_at));
  return reasons;
}

function toProjectPayload(input: ProjectFormValues) {
  return {
    title: input.title.trim(),
    description: input.description.trim() || undefined,
    status: input.status,
    due_date: input.dueDate || undefined,
    direct_report_id: input.directReportId || undefined,
    goal_id: input.goalId || undefined,
    org_unit_id: input.orgUnitId || undefined,
  };
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { isOpen: scribeOpen, setPageContext } = useDrawer();

  useEffect(() => {
    Promise.all([getProjects(), getDirectReports(), getGoals(), getOrgUnits()])
      .then(([p, r, g, ou]) => {
        setProjects(p);
        setReports(r);
        setGoals(g);
        setOrgUnits(ou);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function addProject(input: ProjectFormValues) {
    const created = await createProject(toProjectPayload(input));
    setProjects((ps) => [created, ...ps]);
    setError(null);
    setShowForm(false);
    setSelectedProjectId(created.id);
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

  // Mirror a logged check-in's server-side write-through in portfolio state.
  function applyCheckIn(projectId: string, ci: CheckIn) {
    setProjects((ps) =>
      ps.map((p) => {
        if (p.id !== projectId) return p;
        const next = { ...p, status: ci.status, last_check_in_at: ci.created_at, last_check_in_note: ci.note };
        if (ci.progress != null) {
          const prev = p.progress;
          next.progress = ci.progress;
          next.trend = prev == null ? p.trend : ci.progress > prev ? "up" : ci.progress < prev ? "down" : "flat";
        }
        return next;
      })
    );
  }

  async function removeProject(projectId: string) {
    try {
      await deleteProject(projectId);
      setProjects((ps) => ps.filter((p) => p.id !== projectId));
      setEditingProjectId((id) => (id === projectId ? null : id));
      setSelectedProjectId((id) => (id === projectId ? null : id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    }
  }

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const portfolio = useMemo(() => {
    const open = projects.filter((project) => project.status !== "completed" && project.status !== "cancelled");
    const closed = projects
      .filter((project) => project.status === "completed" || project.status === "cancelled")
      .sort(compareProjects);
    const needsDecision = open
      .filter((project) => project.status === "at_risk" || isOverdue(project))
      .sort(compareProjects);
    const decisionIds = new Set(needsDecision.map((project) => project.id));
    const needsUpdate = open
      .filter((project) => !decisionIds.has(project.id) && isStale(project.last_check_in_at))
      .sort(compareProjects);
    const updateIds = new Set(needsUpdate.map((project) => project.id));
    const moving = open
      .filter((project) => !decisionIds.has(project.id) && !updateIds.has(project.id))
      .sort(compareProjects);
    return { needsDecision, needsUpdate, moving, closed };
  }, [projects]);

  useEffect(() => {
    setPageContext(
      selectedProject
        ? `Projects page — selected initiative: ${selectedProject.title}`
        : "Projects page — initiative portfolio"
    );
    return () => setPageContext(null);
  }, [selectedProject, setPageContext]);

  const deskGrid = scribeOpen
    ? "grid-cols-1 2xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.55fr)]"
    : "grid-cols-1 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.55fr)]";
  const portfolioVisibility = selectedProject
    ? scribeOpen
      ? "hidden 2xl:block"
      : "hidden xl:block"
    : "block";
  const detailEmptyVisibility = scribeOpen ? "hidden 2xl:flex" : "hidden xl:flex";
  const backVisibility = scribeOpen ? "2xl:hidden" : "xl:hidden";

  return (
    <PageShell maxWidth="8xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Keep the initiative portfolio in view while you focus, intervene, and follow through.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingProjectId(null);
            setShowForm((shown) => !shown);
          }}
          className={primaryBtnCls}
        >
          {showForm ? "Cancel" : "+ New project"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className={`${SECTION_GAP} text-ink-secondary`}>Loading...</p>
      ) : (
        <div className={SECTION_GAP}>
          {showForm && (
            <ProjectForm
              reports={reports}
              goals={goals}
              orgUnits={orgUnits}
              onCancel={() => setShowForm(false)}
              onSubmit={addProject}
              submitLabel="Add project"
              savingLabel="Adding..."
            />
          )}

          {projects.length === 0 ? (
            <div className={`${FEATURE_SURFACE} ${SECTION_GAP} p-8 text-center`}>
              <p className="font-semibold text-ink">No initiatives yet</p>
              <p className="mt-1 text-sm text-ink-secondary">
                Add the first consequential piece of work you want to keep in view.
              </p>
            </div>
          ) : (
            <div className={`grid items-start gap-5 ${showForm ? SECTION_GAP : ""} ${deskGrid}`}>
              <PortfolioIndex
                portfolio={portfolio}
                selectedProjectId={selectedProjectId}
                onSelect={(projectId) => {
                  setEditingProjectId(null);
                  setSelectedProjectId(projectId);
                }}
                className={portfolioVisibility}
              />

              {selectedProject ? (
                editingProjectId === selectedProject.id ? (
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setEditingProjectId(null)}
                      className={`${backVisibility} ${BTN_GHOST} mb-3`}
                    >
                      ← Back to initiative
                    </button>
                    <ProjectForm
                      initialProject={selectedProject}
                      reports={reports}
                      goals={goals}
                      orgUnits={orgUnits}
                      onCancel={() => setEditingProjectId(null)}
                      onSubmit={(input) => saveEdit(selectedProject.id, input)}
                      submitLabel="Save changes"
                      savingLabel="Saving..."
                      flush
                    />
                  </div>
                ) : (
                  <ProjectWorkspace
                    project={selectedProject}
                    backVisibility={backVisibility}
                    onBack={() => setSelectedProjectId(null)}
                    onSetStatus={setStatus}
                    onEdit={() => setEditingProjectId(selectedProject.id)}
                    onDelete={() => removeProject(selectedProject.id)}
                    onCheckedIn={(checkIn) => applyCheckIn(selectedProject.id, checkIn)}
                  />
                )
              ) : (
                <div className={`${FEATURE_SURFACE} ${detailEmptyVisibility} min-h-[30rem] items-center justify-center p-10 text-center`}>
                  <div className="max-w-sm">
                    <p className="text-sm font-semibold text-ink">Choose an initiative to focus</p>
                    <p className="mt-2 text-sm text-ink-secondary">
                      Its owner, outcome, latest change, and check-in history will stay together here.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

type Portfolio = {
  needsDecision: Project[];
  needsUpdate: Project[];
  moving: Project[];
  closed: Project[];
};

function PortfolioIndex({
  portfolio,
  selectedProjectId,
  onSelect,
  className,
}: {
  portfolio: Portfolio;
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  className: string;
}) {
  const sections = [
    { id: "decision", label: "Needs a decision", projects: portfolio.needsDecision },
    { id: "update", label: "Needs an update", projects: portfolio.needsUpdate },
    { id: "moving", label: "Moving", projects: portfolio.moving },
    { id: "closed", label: "Closed", projects: portfolio.closed },
  ];
  const total = sections.reduce((count, section) => count + section.projects.length, 0);

  return (
    <aside className={`${FEATURE_SURFACE} overflow-hidden ${className}`}>
      <div className="border-b border-divider px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Initiative portfolio</h2>
          <span className={META}>{total} total</span>
        </div>
        <p className="mt-1 text-xs text-ink-secondary">Grouped by the managerial response each initiative needs.</p>
      </div>

      <div className="divide-y divide-divider">
        {sections.map((section) =>
          section.projects.length > 0 ? (
            <section key={section.id} className="py-3">
              <div className="flex items-center justify-between px-4 pb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{section.label}</h3>
                <span className="text-xs text-ink-muted">{section.projects.length}</span>
              </div>
              <div className="space-y-1 px-2">
                {section.projects.map((project) => {
                  const reasons = section.id === "moving" || section.id === "closed" ? [] : attentionReasons(project);
                  const selected = project.id === selectedProjectId;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onSelect(project.id)}
                      className={`w-full rounded-lg border-l-4 px-3 py-3 text-left transition-colors ${STATUS_BORDER[project.status]} ${
                        selected ? "bg-brand-tint" : "hover:bg-canvas"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-sm font-medium text-ink">{project.title}</p>
                        <span className="shrink-0 text-xs text-ink-muted">{STATUS_GLYPH[project.status]}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {projectOwner(project)}
                        {project.org_unit_name ? ` · ${project.org_unit_name}` : ""}
                      </p>
                      <p className="mt-1 truncate text-xs text-ink-muted">
                        {project.goal_title ? `Goal: ${project.goal_title}` : "Standalone initiative"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {project.progress != null && (
                          <span className={`${BADGE} bg-sunken text-ink-secondary`}>{project.progress}%</span>
                        )}
                        <TrendArrow trend={project.trend} />
                        {reasons.map((reason) => (
                          <span key={reason} className={`${BADGE} bg-amber-50 text-amber-800`}>
                            {reason}
                          </span>
                        ))}
                        {reasons.length === 0 && project.due_date && (
                          <span className="text-xs text-ink-muted">Due {formatDate(project.due_date)}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null
        )}
      </div>
    </aside>
  );
}

function ProjectWorkspace({
  project,
  backVisibility,
  onBack,
  onSetStatus,
  onEdit,
  onDelete,
  onCheckedIn,
}: {
  project: Project;
  backVisibility: string;
  onBack: () => void;
  onSetStatus: (id: string, status: ProjectStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCheckedIn: (checkIn: CheckIn) => void;
}) {
  const stale = isStale(project.last_check_in_at);

  return (
    <div className="min-w-0">
      <button type="button" onClick={onBack} className={`${backVisibility} ${BTN_GHOST} mb-3`}>
        ← Portfolio
      </button>

      <article className={`${FEATURE_SURFACE} overflow-hidden`}>
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={META}>Focused initiative</p>
              <h2 className="mt-1 text-xl font-semibold text-ink sm:text-2xl">{project.title}</h2>
            </div>
            <select
              value={project.status}
              onChange={(event) => onSetStatus(project.id, event.target.value as ProjectStatus)}
              className={`${BADGE} border-0 ${STATUS_STYLES[project.status]}`}
              aria-label="Initiative status"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ContextField label="Owner" value={projectOwner(project)} />
            <ContextField label="Team" value={project.org_unit_name ?? "No team assigned"} />
            <ContextField label="Due" value={project.due_date ? formatDate(project.due_date) : "No due date"} />
            <ContextField
              label="Freshness"
              value={freshnessLabel(project.last_check_in_at)}
              attention={stale}
            />
          </div>
        </div>

        <div className="border-t border-divider bg-surface p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(230px,0.72fr)]">
            <div>
              <p className={META}>Purpose</p>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                {project.description || "No purpose statement has been added yet."}
              </p>
            </div>
            <div className={`rounded-lg border-l-4 p-4 ${project.goal_title ? "border-brand bg-brand-tint" : "border-control bg-sunken"}`}>
              <p className={META}>{project.goal_title ? "Supports goal" : "Goal connection"}</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {project.goal_title ?? "Standalone initiative"}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-divider bg-canvas p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-semibold text-ink">Current signal</p>
              <span className={`${BADGE} ${STATUS_STYLES[project.status]}`}>
                {STATUS_GLYPH[project.status]} {STATUS_OPTIONS.find((status) => status.id === project.status)?.label}
              </span>
              {project.progress == null && <span className="text-xs text-ink-muted">No progress asserted yet</span>}
            </div>
            {project.progress != null && (
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar progress={project.progress} status={project.status} />
                <TrendArrow trend={project.trend} />
              </div>
            )}
            {project.last_check_in_note && (
              <div className="mt-4 rounded-lg bg-sunken px-4 py-3">
                <p className={META}>Latest change</p>
                <p className="mt-1 text-sm text-ink-secondary">{project.last_check_in_note}</p>
              </div>
            )}
          </div>

          <div className="mt-5">
            <CheckInPanel
              status={project.status}
              progress={project.progress}
              trend={project.trend}
              lastCheckInAt={project.last_check_in_at}
              fetchHistory={() => getProjectCheckIns(project.id)}
              submitCheckIn={(body) => createProjectCheckIn(project.id, body)}
              onCheckedIn={onCheckedIn}
              actionLabel="Record what changed"
              formHeading="Record what changed"
              notePlaceholder="What changed, what is blocked, or what needs a decision?"
              submitLabel="Record change"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-divider pt-4">
            <button type="button" onClick={onEdit} className={BTN_SECONDARY}>
              Edit initiative
            </button>
            <button type="button" onClick={onDelete} className={`${BTN_GHOST} text-red-700 hover:text-red-700`}>
              Delete
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function ContextField({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return (
    <div>
      <p className={META}>{label}</p>
      <p className={`mt-1 text-sm font-medium ${attention ? "text-amber-800" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function ProjectForm({
  initialProject,
  reports,
  goals,
  orgUnits,
  onCancel,
  onSubmit,
  submitLabel,
  savingLabel,
  flush = false,
}: {
  initialProject?: Project | null;
  reports: DirectReport[];
  goals: Goal[];
  orgUnits: OrgUnit[];
  onCancel: () => void;
  onSubmit: (input: ProjectFormValues) => Promise<void>;
  submitLabel: string;
  savingLabel: string;
  flush?: boolean;
}) {
  const [title, setTitle] = useState(initialProject?.title ?? "");
  const [description, setDescription] = useState(initialProject?.description ?? "");
  const [directReportId, setDirectReportId] = useState(initialProject?.direct_report_id ?? "");
  const [goalId, setGoalId] = useState(initialProject?.goal_id ?? "");
  const [orgUnitId, setOrgUnitId] = useState(initialProject?.org_unit_id ?? "");
  const [status, setStatus] = useState<ProjectStatus>(initialProject?.status ?? "active");
  const [dueDate, setDueDate] = useState(initialProject?.due_date ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!initialProject;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ title, description, directReportId, goalId, orgUnitId, status, dueDate });
      if (!isEdit) {
        setTitle("");
        setDescription("");
        setDirectReportId("");
        setGoalId("");
        setOrgUnitId("");
        setStatus("active");
        setDueDate("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`${flush ? "" : "mt-4"} space-y-3 rounded-lg border border-dashed border-control p-4`}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_9rem_10rem]">
        <div className="min-w-0">
          <label className={labelCls}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Migrate onboarding to new flow" />
        </div>
        <div className="min-w-0">
          <label className={labelCls}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className={inputCls}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className={labelCls}>Due date (optional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
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
        <div className="min-w-0">
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
        <label className={labelCls}>Team (optional)</label>
        <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} className={inputCls}>
          <option value="">No team assigned</option>
          {orgUnits.map((ou) => (
            <option key={ou.id} value={ou.id}>
              {ou.name} ({ou.unit_type})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-muted">
          Drives which team page this shows up on under /app/team — a parent team&apos;s page also shows
          this project.
        </p>
      </div>

      <div>
        <label className={labelCls}>Description (optional)</label>
        <NoteField
          value={description}
          onChange={setDescription}
          rows={2}
          baseClassName={inputCls}
          placeholder="What this project is and how it ties back to the goal"
        />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={primaryBtnCls}>
          {saving ? savingLabel : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-ink-secondary hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
