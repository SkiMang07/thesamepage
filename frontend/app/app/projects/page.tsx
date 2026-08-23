"use client";

// Projects — its own top-level page, same reasoning as Goals (Session 10):
// projects get created and status-updated regularly, unlike Settings'
// "configure once" sections. Per PRODUCT_VISION.md, "goals = what, projects
// = how" — a project can stand alone, hang off a goal, and/or be assigned to
// a direct report. See docs/SESSION_HISTORY.md Session 13.
//
// Session 46 (team_project_goal_hierarchy project memory note): projects
// gain org_unit_id — a direct team/department attachment, the same picker
// pattern Goals already had (Session 11). Unlike Goals, there's no level
// enum here, so the picker offers every org_unit regardless of unit_type.
//
// Session 52 (2026-08-22) — visual rebuild to match Team (Session 24) and
// the Person page (Session 50): Option A from the published "Goals and
// Projects Redesign Options" design canvas. Widened to max-w-7xl, added a
// KpiStrip (same ported tokens as goals/page.tsx — gradient tiles, the
// STATUS_BORDER/STATUS_STYLES hex values, the inline-SVG donut ring shape),
// and replaced the plain bordered-list cards with a responsive grid of
// border-l-4 accented cards each carrying their own progress ring. Projects
// has no level tabs (flat list, grouped by assignee same as before) — same
// card treatment otherwise. Add/edit forms are untouched, just refit.
//
// Session 56 white-space audit — same fix as goals/page.tsx (its ported
// twin): widened to max-w-[1600px] (PageShell's new `8xl` tier) and its
// section gaps now use the shared SECTION_GAP token instead of ad hoc
// mt-8's; the card grid's own gap tightened gap-4 -> gap-3 to match.

import { useEffect, useMemo, useState } from "react";
import CheckInPanel from "@/components/CheckInPanel";
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
import { INPUT, LABEL, BTN_PRIMARY, HEX, TILE, TILE_TONE, TILE_VALUE, TILE_LABEL, TileTone } from "@/lib/tokens";

const STATUS_OPTIONS: { id: ProjectStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "on_track", label: "On track" },
  { id: "at_risk", label: "At risk" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

// Ported verbatim from frontend/app/app/team/page.tsx — same hex values as
// Goals/Team. Do not reinvent.
const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: "bg-sunken text-ink-secondary",
  on_track: "bg-teal-50 text-teal-700",
  at_risk: "bg-amber-50 text-amber-700",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-sunken text-ink-muted",
};

// Left-border accent per status — same map/technique as Team and Goals: a
// border-l-4 with no competing all-sides border class, so only the left
// edge picks up a visible color.
const STATUS_BORDER: Record<ProjectStatus, string> = {
  active: "border-control",
  on_track: "border-brand",
  at_risk: "border-amber-500",
  completed: "border-blue-300",
  cancelled: "border-hairline",
};

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

// Local (not UTC) YYYY-MM-DD date helpers — same as goals/page.tsx and
// team/page.tsx, needed for the "due this week" KPI tile.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysStr(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateStr(dt);
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

  // Session 26: mirror a logged check-in's server-side write-through in list
  // state (status + derived progress/trend/freshness), same as Goals.
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
    onCheckedIn: applyCheckIn,
    reports,
    goals,
    orgUnits,
  };

  return (
    <PageShell maxWidth="8xl">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        How your goals get done — standalone or linked to a goal, yours or a direct report&apos;s.
      </p>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className={`${SECTION_GAP} text-ink-secondary`}>Loading...</p>
      ) : (
        <div className={SECTION_GAP}>
          <KpiStrip projects={projects} />

          <div className={`${SECTION_GAP} flex items-center justify-end`}>
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
              orgUnits={orgUnits}
              onCancel={() => setShowForm(false)}
              onSubmit={addProject}
              submitLabel="Add project"
              savingLabel="Adding..."
            />
          )}

          {projects.length === 0 ? (
            <p className={`${SECTION_GAP} text-ink-secondary`}>No projects yet. Add the first one above.</p>
          ) : (
            <div className={`${SECTION_GAP} space-y-8`}>
              {grouped.map((group) => (
                <div key={group.name}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
                    {group.name}
                  </h2>
                  <ProjectGrid projects={group.projects} {...listProps} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// KPI strip — same gradient-tile markup/structure as Team's/Goals' KpiStrip.
// The 4th tile mirrors Goals' "no initiative attached" from the other
// direction: how many of your own projects support no goal at all.
// ---------------------------------------------------------------------------

function KpiStrip({ projects }: { projects: Project[] }) {
  const scored = projects.filter((p) => p.status !== "cancelled");
  const onTrack = scored.filter((p) => p.status === "on_track").length;
  const onTrackLabel = scored.length > 0 ? `${onTrack}/${scored.length}` : "—";
  // Same data-trust rule as Goals' KpiStrip: never a fixed "success" color
  // for a fraction tile — "0/N on track" is not success.
  const onTrackTone =
    scored.length === 0
      ? "neutral"
      : onTrack === 0
        ? "attention"
        : "brand";

  const atRisk = scored.filter((p) => p.status === "at_risk").length;

  const today = localDateStr();
  const weekOut = addDaysStr(today, 7);
  const dueThisWeek = scored.filter(
    (p) => p.due_date && p.due_date >= today && p.due_date <= weekOut
  ).length;

  const noGoal = scored.filter((p) => p.goal_id == null).length;

  const tiles: { value: string; label: string; tone: TileTone }[] = [
    { value: onTrackLabel, label: "Projects on track", tone: onTrackTone },
    { value: String(atRisk), label: "At risk", tone: atRisk > 0 ? "attention" : "neutral" },
    { value: String(dueThisWeek), label: "Due this week", tone: "neutral" },
    { value: String(noGoal), label: "No goal attached", tone: noGoal > 0 ? "critical" : "neutral" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={TILE}>
          <p className={`${TILE_VALUE} ${TILE_TONE[t.tone]}`}>{t.value}</p>
          <p className={TILE_LABEL}>{t.label}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress ring — same inline-SVG donut shape as Goals'/Team's ring. Only
// draws the colored arc when a real check-in exists; otherwise an honest
// em-dash — no fabricated progress.
// ---------------------------------------------------------------------------

function ProgressRing({ progress }: { progress: number | null | undefined }) {
  const pct = progress ?? 0;
  const dash = `${pct}, 100`;
  return (
    <svg width="48" height="48" viewBox="0 0 36 36" className="shrink-0">
      <path
        d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
        fill="none"
        stroke={HEX.track}
        strokeWidth="3"
      />
      {progress != null && (
        <path
          d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
          fill="none"
          stroke={HEX.brand}
          strokeWidth="3"
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      )}
      <text x="18" y="21" textAnchor="middle" fontSize="9" fill={HEX.ink} fontWeight="600">
        {progress != null ? `${pct}%` : "–"}
      </text>
    </svg>
  );
}

function ProjectGrid({
  projects,
  onSetStatus,
  onDelete,
  editingProjectId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onCheckedIn,
  reports,
  goals,
  orgUnits,
}: {
  projects: Project[];
  onSetStatus: (id: string, status: ProjectStatus) => void;
  onDelete: (id: string) => void;
  editingProjectId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, input: ProjectFormValues) => Promise<void>;
  onCheckedIn: (projectId: string, ci: CheckIn) => void;
  reports: DirectReport[];
  goals: Goal[];
  orgUnits: OrgUnit[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) =>
        p.id === editingProjectId ? (
          <div key={p.id} className="md:col-span-2 xl:col-span-3">
            <ProjectForm
              initialProject={p}
              reports={reports}
              goals={goals}
              orgUnits={orgUnits}
              onCancel={onCancelEdit}
              onSubmit={(input) => onSaveEdit(p.id, input)}
              submitLabel="Save changes"
              savingLabel="Saving..."
            />
          </div>
        ) : (
          <div
            key={p.id}
            className={`rounded-lg border-l-4 bg-surface px-4 py-4 shadow-sm ${STATUS_BORDER[p.status]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ProgressRing progress={p.progress} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{p.title}</p>
                  {p.org_unit_name && (
                    <p className="mt-0.5 text-xs text-ink-muted">Team: {p.org_unit_name}</p>
                  )}
                  {p.goal_title && (
                    <p className="mt-0.5 text-xs text-ink-muted">Supports goal: {p.goal_title}</p>
                  )}
                  {p.due_date && <p className="mt-0.5 text-xs text-ink-muted">Due {formatDate(p.due_date)}</p>}
                </div>
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
                  className="text-xs text-ink-muted hover:text-ink-body"
                  title="Edit project"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  className="text-xs text-ink-muted hover:text-red-700"
                  title="Delete project"
                >
                  Delete
                </button>
              </div>
            </div>

            {p.description && <p className="mt-2 text-sm text-ink-secondary">{p.description}</p>}

            <CheckInPanel
              status={p.status}
              progress={p.progress}
              trend={p.trend}
              lastCheckInAt={p.last_check_in_at}
              fetchHistory={() => getProjectCheckIns(p.id)}
              submitCheckIn={(body) => createProjectCheckIn(p.id, body)}
              onCheckedIn={(ci) => onCheckedIn(p.id, ci)}
            />
          </div>
        )
      )}
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
}: {
  initialProject?: Project | null;
  reports: DirectReport[];
  goals: Goal[];
  orgUnits: OrgUnit[];
  onCancel: () => void;
  onSubmit: (input: ProjectFormValues) => Promise<void>;
  submitLabel: string;
  savingLabel: string;
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
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-dashed border-control p-4">
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
        <button type="button" onClick={onCancel} className="text-sm text-ink-secondary hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
