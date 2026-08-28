"use client";

// Goals — its own top-level page, not folded into Settings (Session 10:
// goals get written to constantly — new ones per period, status changes
// throughout — unlike Settings' "configure once" sections). Full company/
// department/team/individual hierarchy per Andrew's call in that session,
// even though role-scoped views (manager/dept-head/individual) don't exist
// yet — company/department goals are usable today, they just don't have a
// distinct audience beyond you until that UI ships. See docs/SESSION_HISTORY.md
// Session 10 and the goals_scoping project memory note.
//
// Session 52 (2026-08-22) — visual rebuild to match Team (Session 24) and
// the Person page (Session 50): Option A from the published "Goals and
// Projects Redesign Options" design canvas. Widened to max-w-7xl, added a
// KpiStrip (tokens ported verbatim from frontend/app/app/team/page.tsx —
// same gradient-tile markup, same STATUS_BORDER/STATUS_STYLES hex values,
// same inline-SVG donut ring shape), and replaced the plain bordered-list
// cards with a responsive grid of border-l-4 accented cards each carrying
// their own progress ring. Level tabs are kept as a pill-style filter, not
// retired — that was the one explicit "don't change this" in the brief.
// Add/edit forms are untouched, just refit into the new shell.
//
// Session 56 white-space audit — this page was the worked example in the
// "White Space Audit" comparison canvas (128px of margin between the
// header and the KPI strip, three independent mt-8's stacked on PageShell's
// own old py-10). Now widened further to max-w-[1600px] (PageShell's new
// `8xl` tier — this is a wide card-grid page, one of the ones the audit
// flagged as most starved for width) and its section gaps use the shared
// SECTION_GAP token instead of ad hoc mt-8's; the card grid's own gap
// tightened gap-4 -> gap-3 to match.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CheckInPanel from "@/components/CheckInPanel";
import {
  CheckIn,
  DirectReport,
  Goal,
  GoalLevel,
  GoalStatus,
  OrgUnit,
  Project,
  createGoal,
  createGoalCheckIn,
  deleteGoal,
  getDirectReports,
  getGoalCheckIns,
  getGoals,
  getOrgUnits,
  getProjects,
  updateGoal,
  updateGoalStatus,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import { INPUT, LABEL, BTN_PRIMARY, HEX, TILE, TILE_TONE, TILE_VALUE, TILE_LABEL, TileTone } from "@/lib/tokens";

import NoteField from "@/components/NoteField";
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

// Ported verbatim from frontend/app/app/team/page.tsx — same status
// vocabulary as Team/Projects, same hex values. Do not reinvent.
const STATUS_STYLES: Record<GoalStatus, string> = {
  active: "bg-sunken text-ink-secondary",
  on_track: "bg-teal-50 text-teal-700",
  at_risk: "bg-amber-50 text-amber-700",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-sunken text-ink-muted",
};

// Left-border accent per status — same map Team's InitiativesCard/
// CommitmentsCard use for their border-l-4 accent. Applied here with no
// competing all-sides border class, so only the left edge (border-l-4)
// ever picks up a visible color — same technique as the source file.
const STATUS_BORDER: Record<GoalStatus, string> = {
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

type GoalFormValues = {
  title: string;
  description: string;
  successMetrics: string;
  level: GoalLevel;
  directReportId: string;
  // Session 11: which specific department/team a team/department-level goal
  // belongs to. Filtered to units matching `level` in the picker, so this
  // can't disagree with the level tab it's filed under.
  orgUnitId: string;
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

// Local (not UTC) YYYY-MM-DD date helpers — due_date is a date-only column;
// parsing via new Date(dateStr) treats it as UTC midnight, which reads as
// "yesterday" west of UTC. Ported from team/page.tsx's identical helpers
// (used there for the same "due this week" KPI math).
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

function toGoalPayload(input: GoalFormValues) {
  return {
    title: input.title.trim(),
    description: input.description.trim() || undefined,
    success_metrics: input.successMetrics.trim() || undefined,
    level: input.level,
    status: input.status,
    due_date: input.dueDate || undefined,
    direct_report_id: input.level === "individual" ? input.directReportId || undefined : undefined,
    org_unit_id: input.level === "team" || input.level === "department" ? input.orgUnitId || undefined : undefined,
    parent_goal_id: input.parentGoalId || undefined,
  };
}

export default function GoalsPage() {
  const [level, setLevel] = useState<GoalLevel>("individual");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  // Session 26: fetched so each goal card can show the initiatives serving
  // it ("goals = what, projects = how" made visible); Session 52 also uses
  // this to compute the "no initiative attached" KPI tile.
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getGoals(), getDirectReports(), getOrgUnits(), getProjects()])
      .then(([g, r, ou, p]) => {
        setGoals(g);
        setReports(r);
        setOrgUnits(ou);
        setProjects(p);
        // Data-trust fix (2026-08-12 review, spec section 8 #1): the page
        // always opened on the Individual tab, which reads as broken for
        // any manager who works mostly in department/team/company goals —
        // the first thing they see is an empty list. Land on the first tab
        // (in tab order) that actually has content; Individual stays the
        // fallback only when nothing has been added anywhere yet.
        const hasIndividual = g.some((goal) => goal.level === "individual");
        if (!hasIndividual) {
          const firstWithContent = LEVEL_TABS.find((t) => g.some((goal) => goal.level === t.id));
          if (firstWithContent) setLevel(firstWithContent.id);
        }
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

  // Session 26: a logged check-in write-throughs status server-side; mirror
  // that in list state, along with the derived progress/trend/freshness
  // fields, so the card updates without a refetch.
  function applyCheckIn(goalId: string, ci: CheckIn) {
    setGoals((gs) =>
      gs.map((g) => {
        if (g.id !== goalId) return g;
        const next = { ...g, status: ci.status, last_check_in_at: ci.created_at, last_check_in_note: ci.note };
        if (ci.progress != null) {
          const prev = g.progress;
          next.progress = ci.progress;
          next.trend = prev == null ? g.trend : ci.progress > prev ? "up" : ci.progress < prev ? "down" : "flat";
        }
        return next;
      })
    );
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
    onCheckedIn: applyCheckIn,
    reports,
    orgUnits,
    allGoals: goals,
    projects,
  };

  return (
    <PageShell maxWidth="8xl">
      <h1 className="text-2xl font-semibold">Goals</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        Company, department, team, and individual goals in one place.
      </p>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className={`${SECTION_GAP} text-ink-secondary`}>Loading...</p>
      ) : (
        <div className={SECTION_GAP}>
          <KpiStrip goals={levelGoals} projects={projects} />

          <div className={`${SECTION_GAP} flex items-center justify-between gap-4`}>
            <div className="flex flex-wrap rounded-md border border-hairline p-0.5">
              {LEVEL_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setLevel(t.id)}
                  className={`rounded px-3 py-1.5 text-sm ${
                    level === t.id ? "bg-brand text-on-brand" : "text-ink-secondary hover:text-ink"
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
          <p className="mt-2 text-xs text-ink-muted">
            {LEVEL_TABS.find((t) => t.id === level)?.blurb}
          </p>

          {showForm && (
            <GoalForm
              defaultLevel={level}
              reports={reports}
              orgUnits={orgUnits}
              allGoals={goals}
              onCancel={() => setShowForm(false)}
              onSubmit={addGoal}
              submitLabel="Add goal"
              savingLabel="Adding..."
            />
          )}

          {level === "individual" ? (
            <div className={SECTION_GAP}>
              {levelGoals.length === 0 ? (
                <p className="text-ink-secondary">
                  No individual goals yet. Add one above and link it to a direct report.
                </p>
              ) : (
                <div className="grid grid-cols-1 items-start gap-x-3 gap-y-8 lg:grid-cols-2 xl:grid-cols-3">
                  {(groupedIndividual ?? []).map((group) => (
                    <div key={group.name} className="min-w-0">
                      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        {group.name}
                      </h2>
                      <GoalGrid goals={group.goals} stacked {...goalListProps} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className={SECTION_GAP}>
              <GoalGrid goals={levelGoals} {...goalListProps} />
              {levelGoals.length === 0 && (
                <p className="text-ink-secondary">No {level} goals yet. Add the first one above.</p>
              )}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// KPI strip — 4 gradient tiles, same markup/structure as Team's KpiStrip.
// Scoped to the currently selected level tab so it moves with the tab, the
// same way Team's strip moves with the selected-team filter.
// ---------------------------------------------------------------------------

function KpiStrip({ goals, projects }: { goals: Goal[]; projects: Project[] }) {
  const scored = goals.filter((g) => g.status !== "cancelled");
  const onTrack = scored.filter((g) => g.status === "on_track").length;
  const onTrackLabel = scored.length > 0 ? `${onTrack}/${scored.length}` : "—";
  // Data-trust rule (same fix Team's KpiStrip carries): a fraction tile must
  // never render a fixed "success" color — "0/N on track" is not success.
  // Amber once there's real signal and nothing is on track yet; gray when
  // there's nothing to score at all.
  const onTrackTone =
    scored.length === 0
      ? "neutral"
      : onTrack === 0
        ? "attention"
        : "brand";

  const atRisk = scored.filter((g) => g.status === "at_risk").length;

  const today = localDateStr();
  const weekOut = addDaysStr(today, 7);
  const dueThisWeek = scored.filter(
    (g) => g.due_date && g.due_date >= today && g.due_date <= weekOut
  ).length;

  const goalIdsWithProjects = new Set(projects.map((p) => p.goal_id).filter((id): id is string => id != null));
  const noInitiative = scored.filter((g) => !goalIdsWithProjects.has(g.id)).length;

  const tiles: { value: string; label: string; tone: TileTone }[] = [
    { value: onTrackLabel, label: "Goals on track", tone: onTrackTone },
    { value: String(atRisk), label: "At risk", tone: atRisk > 0 ? "attention" : "neutral" },
    // "Due this week" was blue, which is Scribe's colour and not a status.
    // A count of upcoming work is neutral information until it is overdue.
    { value: String(dueThisWeek), label: "Due this week", tone: "neutral" },
    { value: String(noInitiative), label: "No initiative attached", tone: noInitiative > 0 ? "critical" : "neutral" },
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
// Progress ring — same inline-SVG donut shape as Team's GoalsCard ring
// (same path data, same stroke colors), scaled to a single goal's own
// `progress` rather than an aggregate. Only draws the colored arc when a
// real check-in exists; otherwise shows an honest em-dash — no fabricated
// progress.
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

function GoalGrid({
  goals,
  onSetStatus,
  onDelete,
  editingGoalId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onCheckedIn,
  reports,
  orgUnits,
  allGoals,
  projects,
  stacked = false,
}: {
  goals: Goal[];
  onSetStatus: (id: string, status: GoalStatus) => void;
  onDelete: (id: string) => void;
  editingGoalId: string | null;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, input: GoalFormValues) => Promise<void>;
  onCheckedIn: (goalId: string, ci: CheckIn) => void;
  reports: DirectReport[];
  orgUnits: OrgUnit[];
  allGoals: Goal[];
  projects: Project[];
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"}>
      {goals.map((g) =>
        g.id === editingGoalId ? (
          <div key={g.id} className={stacked ? undefined : "md:col-span-2 xl:col-span-3"}>
            <GoalForm
              defaultLevel={g.level}
              initialGoal={g}
              reports={reports}
              orgUnits={orgUnits}
              allGoals={allGoals.filter((x) => x.id !== g.id)}
              onCancel={onCancelEdit}
              onSubmit={(input) => onSaveEdit(g.id, input)}
              submitLabel="Save changes"
              savingLabel="Saving..."
            />
          </div>
        ) : (
          <div
            key={g.id}
            className={`rounded-lg border-l-4 bg-surface px-4 py-4 shadow-sm ${STATUS_BORDER[g.status]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ProgressRing progress={g.progress} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{g.title}</p>
                  {g.org_unit_name && (
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {g.level === "department" ? "Department" : "Team"}: {g.org_unit_name}
                    </p>
                  )}
                  {g.parent_goal_title && (
                    <p className="mt-0.5 text-xs text-ink-muted">Part of: {g.parent_goal_title}</p>
                  )}
                  {g.due_date && <p className="mt-0.5 text-xs text-ink-muted">Due {formatDate(g.due_date)}</p>}
                </div>
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
                  className="text-xs text-ink-muted hover:text-ink-body"
                  title="Edit goal"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(g.id)}
                  className="text-xs text-ink-muted hover:text-red-700"
                  title="Delete goal"
                >
                  Delete
                </button>
              </div>
            </div>

            {g.description && <p className="mt-2 text-sm text-ink-secondary">{g.description}</p>}
            {g.success_metrics && (
              <p className="mt-1 text-sm text-ink-secondary">
                <span className="text-ink-muted">Success metric: </span>
                {g.success_metrics}
              </p>
            )}
            {/* Session 26: initiatives serving this goal — "goals = what,
                projects = how" made visible on the goal itself. */}
            {(() => {
              const serving = projects.filter((p) => p.goal_id === g.id);
              if (serving.length === 0) return null;
              return (
                <p className="mt-1 text-xs text-ink-muted">
                  <Link href="/app/projects" className="hover:text-ink-secondary">
                    {serving.length} initiative{serving.length === 1 ? "" : "s"}
                  </Link>
                  {": "}
                  {serving.map((p) => p.title).join(", ")}
                </p>
              );
            })()}

            <CheckInPanel
              status={g.status}
              progress={g.progress}
              trend={g.trend}
              lastCheckInAt={g.last_check_in_at}
              fetchHistory={() => getGoalCheckIns(g.id)}
              submitCheckIn={(body) => createGoalCheckIn(g.id, body)}
              onCheckedIn={(ci) => onCheckedIn(g.id, ci)}
            />
          </div>
        )
      )}
    </div>
  );
}

function GoalForm({
  defaultLevel,
  initialGoal,
  reports,
  orgUnits,
  allGoals,
  onCancel,
  onSubmit,
  submitLabel,
  savingLabel,
}: {
  defaultLevel: GoalLevel;
  initialGoal?: Goal | null;
  reports: DirectReport[];
  orgUnits: OrgUnit[];
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
  const [orgUnitId, setOrgUnitId] = useState(initialGoal?.org_unit_id ?? "");
  const [parentGoalId, setParentGoalId] = useState(initialGoal?.parent_goal_id ?? "");
  const [status, setStatus] = useState<GoalStatus>(initialGoal?.status ?? "active");
  const [dueDate, setDueDate] = useState(initialGoal?.due_date ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!initialGoal;

  // Org units matching the picked level — "team" goals only offer teams,
  // "department" goals only offer departments, so level and org_unit_id
  // can never disagree (Session 11).
  const matchingOrgUnits = orgUnits.filter((ou) => ou.unit_type === goalLevel);

  function handleLevelChange(next: GoalLevel) {
    setGoalLevel(next);
    // Clear a picked unit that no longer matches — e.g. switching from
    // Team to Department drops a team selection rather than silently
    // keeping a mismatched org_unit_id.
    if (next !== "team" && next !== "department") setOrgUnitId("");
    else if (!orgUnits.some((ou) => ou.id === orgUnitId && ou.unit_type === next)) setOrgUnitId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ title, description, successMetrics, level: goalLevel, directReportId, orgUnitId, parentGoalId, status, dueDate });
      if (!isEdit) {
        setTitle("");
        setDescription("");
        setSuccessMetrics("");
        setDirectReportId("");
        setOrgUnitId("");
        setParentGoalId("");
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Grow NPS by 10 points" />
        </div>
        <div className="w-40">
          <label className={labelCls}>Level</label>
          <select value={goalLevel} onChange={(e) => handleLevelChange(e.target.value as GoalLevel)} className={inputCls}>
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
        {(goalLevel === "team" || goalLevel === "department") && (
          <div className="flex-1">
            <label className={labelCls}>{goalLevel === "team" ? "Team" : "Department"} (optional)</label>
            <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} className={inputCls}>
              <option value="">Not linked to a specific {goalLevel}</option>
              {matchingOrgUnits.map((ou) => (
                <option key={ou.id} value={ou.id}>
                  {ou.name}
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
        <NoteField
          value={description}
          onChange={setDescription}
          rows={2}
          baseClassName={inputCls}
          placeholder="What this goal is about, in a sentence or two"
        />
      </div>

      <div>
        <label className={labelCls}>Success metric (optional)</label>
        <NoteField
          value={successMetrics}
          onChange={setSuccessMetrics}
          rows={2}
          baseClassName={inputCls}
          placeholder="How you'll know it's done — e.g. NRR at or above 110%, churn under 5%"
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
