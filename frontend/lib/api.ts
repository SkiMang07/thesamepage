// All calls to the FastAPI backend go through here — same convention as
// Prism Tree's frontend/src/lib/api.ts. Add new backend calls to this file
// rather than calling fetch() ad hoc from components.
import { createClient } from "./supabase";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
/**
 * A non-2xx response from the backend.
 *
 * `new Error("API error 503: ...")` threw away the one thing a caller needs to
 * behave differently: a 503 means the server is missing configuration and
 * retrying will never work, while a 502 means a vendor blipped and retrying
 * probably will. Both used to arrive as an identical string, so every catch
 * block in the app was forced into a single catch-all message. `message` is
 * unchanged from what it always was, so anything reading it still works.
 */
export class ApiError extends Error {
  readonly status: number;
  /** FastAPI's `detail`, when the body was JSON. Otherwise the raw body,
   *  truncated — a gateway timeout returns an HTML page, not our schema. */
  readonly detail: string;

  constructor(status: number, body: string) {
    super(`API error ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = parseDetail(body);
  }
}

function parseDetail(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    /* not JSON — a proxy, a gateway error page, or an empty body */
  }
  return body.slice(0, 200);
}

export const RECORDS_CHANGED_EVENT = "tsp:records-changed";
export const RECORDS_CHANGED_STORAGE_KEY = "tsp:records-changed-at";

function announceRecordChange(path: string, method: string) {
  if (typeof window === "undefined" || method === "GET") return;
  // Recommendation analytics and assistant conversation turns are not source
  // record changes. Confirmed Scribe drafts use the normal source endpoints and
  // are announced there.
  if (path.startsWith("/api/dashboard/") || path.startsWith("/api/assistant/")) return;
  window.dispatchEvent(new Event(RECORDS_CHANGED_EVENT));
  window.localStorage.setItem(RECORDS_CHANGED_STORAGE_KEY, String(Date.now()));
}

async function authedFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) throw new ApiError(res.status, await res.text());
  const data = await res.json();
  announceRecordChange(path, (options.method || "GET").toUpperCase());
  return data;
}

// Session 28 (Context Engine upload) — the first multipart/form-data call
// in the app. authedFetch always forces Content-Type: application/json,
// which would corrupt a multipart body (the browser must set that header
// itself, boundary included). Same auth handling, different body/headers.
async function authedFormFetch(path: string, formData: FormData) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: {
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: formData,
  });

  if (!res.ok) throw new ApiError(res.status, await res.text());
  const data = await res.json();
  announceRecordChange(path, "POST");
  return data;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DirectReport = {
  id: string;
  name: string;
  // Not on the shared PUT model (DirectReportIn has no email field — see
  // DirectReportCreateIn's backend docstring) so assignReportRole/
  // assignReportOrgUnit/assignReportCadence never round-trip it. Edited via
  // updateDirectReportProfile() only.
  email?: string | null;
  role_title: string | null;
  notes: string | null;
  role_level_id?: string | null;
  // Session 11: which team/department this report structurally sits in.
  // Separate from role_level_id (their job/comp band). Resolve the display
  // name client-side against a loaded OrgUnit[] list, same pattern as
  // role_level_id -> RoleLevel in Settings.
  org_unit_id?: string | null;
  // 1:1 cadence override, in days (nav rework pass 2, Session 38) — null
  // means inherit the org default (Profile.one_on_one_cadence_days), which
  // itself falls back to 21. See resolve_cadence_days() in backend/utils.py
  // and getOneOnOnesOverview() below for the resolved value.
  one_on_one_cadence_days?: number | null;
  // Archive, not delete (Session 43, Polish Pass A — see
  // docs/TEAM_SETUP_UX_REVIEW.md §7.3, finding P1). Set once archived; every
  // listing endpoint excludes archived people by default (GET
  // /api/direct-reports only returns them with ?archived=true).
  archived_at?: string | null;
  // Present on GET /api/direct-reports/{id} only: the assigned role's
  // configured expectations. null when no role is assigned.
  expectations?: RoleExpectations | null;
};

// What GET /api/direct-reports/{id} returns under `expectations` — the DR's
// assigned role_level plus its metric/skill/value configs (Settings > Expectations).
export type RoleExpectations = {
  role_level: Pick<RoleLevel, "id" | "job_role" | "job_level" | "functional_team" | "job_responsibilities">;
  metrics: Expectation[];
  skills: Expectation[];
  values: Expectation[];
};

// A session's status is derived server-side from which columns are filled —
// never set directly. gathering: the undated next-meeting workspace exists;
// scheduled: date exists but prep has not been generated; planned: prep_guide
// set, summary null; completed: summary set.
export type SessionStatus = "gathering" | "scheduled" | "planned" | "completed";

export type PrepGuide = {
  situation_summary: string;
  agenda_items: AgendaItem[];
  open_commitments_to_check: Pick<Commitment, "id" | "description" | "due_date" | "committed_by">[];
  source_notes?: string;
};

export type OneOnOne = {
  id: string;
  direct_report_id: string;
  summary: string | null;
  notes?: string | null;
  prep_guide?: PrepGuide | null;
  scheduled_at: string | null;
  series_id?: string | null;
  recurrence_weeks?: 1 | 2 | 3 | 4 | null;
  recurrence_timezone?: string | null;
  carry_forward_items: string[];
  created_at: string;
  // When the write-up was saved. Bookkeeping only — never a meeting date.
  logged_at?: string | null;
  status: SessionStatus;
  // When the conversation actually happened, server-derived. scheduled_at
  // is the meeting date; created_at is a legacy fallback for rows the
  // 2026-08-28 backfill could not reach. Render this, never the columns.
  meeting_date: string | null;
  // completed -> summary; planned -> the prep sheet's situation_summary.
  // What the DR detail page's session list actually renders per row.
  display_summary: string;
};

// Who owes a commitment — both sides of a 1:1 can make them (Session 8).
export type CommittedBy = "manager" | "direct_report";

export type Commitment = {
  id: string;
  description: string;
  due_date: string | null;
  status: "open" | "done" | "dropped";
  committed_by?: CommittedBy;
  created_at: string;
  completed_at: string | null;
  direct_report_id: string;
  direct_report_name?: string | null;
};

export type AgendaItem = {
  title: string;
  rationale: string;
  suggested_questions: string[];
};

export type PrepResponse = {
  // The one_on_ones row this prep sheet was saved to (the "planned"
  // session) — pass back as one_on_one_id when logging, and use it to
  // resume this sheet later via getOneOnOne().
  id: string;
  situation_summary: string;
  agenda_items: AgendaItem[];
  // The id preserves the link to the live commitment; prep never copies it.
  open_commitments_to_check: Pick<Commitment, "id" | "description" | "due_date" | "committed_by">[];
  scheduled_at: string | null;
  recurrence_weeks: 1 | 2 | 3 | 4 | null;
  carry_forward_items: string[];
};

// AI-drafted wrap-up of a 1:1 — reviewed and edited by the manager before
// anything is saved via logOneOnOne.
export type WrapUpCommitment = {
  description: string;
  committed_by: CommittedBy;
  due_date: string | null;
};

export type WrapUpDraft = {
  summary: string;
  commitments: WrapUpCommitment[];
  follow_up_items: string[];
};

// ---------------------------------------------------------------------------
// Direct reports
// ---------------------------------------------------------------------------

export const getDirectReports = (): Promise<DirectReport[]> =>
  authedFetch("/api/direct-reports");

// Archived people (Session 43, Polish Pass A) — a separate list, not a
// filter flag on getDirectReports(), so the People section's "Show archived
// (N)" toggle can fetch them on demand rather than always paying for a
// combined query. See docs/TEAM_SETUP_UX_REVIEW.md §7.3, finding P1.
export const getArchivedDirectReports = (): Promise<DirectReport[]> =>
  authedFetch("/api/direct-reports?archived=true");

export const archiveDirectReport = (id: string): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${id}/archive`, { method: "POST" });

export const unarchiveDirectReport = (id: string): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${id}/unarchive`, { method: "POST" });

// Edit name/email from the People row's ⋯ menu — its own small PATCH, not
// routed through assignReportRole's PUT pattern, since DirectReportIn (the
// PUT body) deliberately has no email field.
export const updateDirectReportProfile = (
  id: string,
  body: { name: string; email?: string | null }
): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${id}/profile`, { method: "PATCH", body: JSON.stringify(body) });

export type TeamOverviewItem = {
  id: string;
  name: string;
  role_title: string | null;
  last_one_on_one_at: string | null;
  open_commitment_count: number;
};

export const getTeamOverview = (): Promise<TeamOverviewItem[]> =>
  authedFetch("/api/direct-reports/overview");

export const getDirectReport = (id: string): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${id}`);

// role_level_id/org_unit_id (Session 41, Plan S1) — the backend's
// DirectReportIn already accepted these; the client type just didn't expose
// them, so every create path (Quick add, the new People add-person row) can
// wire a person straight to a role/team at creation time instead of a
// separate assign step. role_title deliberately still accepted (not
// removed) so nothing breaks if a caller still sends it, but Plan S1 stops
// every UI path from writing it — see roleTitleHint() in settings/page.tsx.
export const createDirectReport = (body: {
  name: string;
  email?: string;
  role_title?: string;
  notes?: string;
  role_level_id?: string | null;
  org_unit_id?: string | null;
}): Promise<DirectReport> => authedFetch("/api/direct-reports", { method: "POST", body: JSON.stringify(body) });

// Assigns a direct report to a team/department, preserving their other
// fields — same "read, tweak one field, PUT the whole record" pattern as
// assignReportRole further down.
export const assignReportOrgUnit = (reportId: string, report: DirectReport, orgUnitId: string | null): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${reportId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: report.name,
      role_title: report.role_title,
      notes: report.notes,
      role_level_id: report.role_level_id,
      org_unit_id: orgUnitId,
      one_on_one_cadence_days: report.one_on_one_cadence_days,
    }),
  });

// Sets (or clears, via null) this report's 1:1 cadence override — same
// "read, tweak one field, PUT the whole record" pattern as
// assignReportRole/assignReportOrgUnit, so the other fields on the record
// survive the round trip.
export const assignReportCadence = (
  reportId: string,
  report: DirectReport,
  cadenceDays: number | null
): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${reportId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: report.name,
      role_title: report.role_title,
      notes: report.notes,
      role_level_id: report.role_level_id,
      org_unit_id: report.org_unit_id,
      one_on_one_cadence_days: cadenceDays,
    }),
  });

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

export const getCommitments = (params?: { directReportId?: string; status?: "open" | "done" | "dropped" }): Promise<Commitment[]> => {
  const q = new URLSearchParams();
  if (params?.directReportId) q.set("direct_report_id", params.directReportId);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return authedFetch(`/api/commitments${qs ? `?${qs}` : ""}`);
};

export const updateCommitment = (id: string, status: "open" | "done" | "dropped"): Promise<Commitment> =>
  authedFetch(`/api/commitments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });

// Standalone commitment creation — Session 32 (Scribe confirm handler).
// Uses POST /api/commitments, separate from 1:1 log and team commitments paths.
export const createCommitment = (body: {
  description: string;
  direct_report_id: string;
  committed_by?: "direct_report" | "manager";
  due_date?: string | null;
  is_team_commitment?: boolean;
}): Promise<Commitment> =>
  authedFetch("/api/commitments", { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Goals (Session 10) — full company/department/team/individual hierarchy.
// Own top-level page (/app/goals), not Settings — see docs/SESSION_HISTORY.md.
// `projects` activated in Session 13; no rollup/status calculation yet
// (status is manually set).
// ---------------------------------------------------------------------------

export type GoalLevel = "company" | "department" | "team" | "individual";
export type GoalStatus = "active" | "on_track" | "at_risk" | "completed" | "cancelled";

export type Goal = {
  id: string;
  title: string;
  description: string | null;
  // Free text, deliberately unstructured — the SMART-framework "Measurable"
  // anchor. Meant to be read by AI/agents, not parsed or scored.
  success_metrics: string | null;
  level: GoalLevel;
  status: GoalStatus;
  due_date: string | null;
  direct_report_id: string | null;
  direct_report_name?: string | null;
  parent_goal_id: string | null;
  // Only populated when the parent goal is present in the same fetched
  // result set — see goals.py's _shape_rows.
  parent_goal_title?: string | null;
  // Session 11: which specific department/team this goal belongs to. Null
  // for company/individual-level goals. org_unit_name comes from goals.py's
  // org_units(name,unit_type) join.
  org_unit_id: string | null;
  org_unit_name?: string | null;
  created_at: string;
} & CheckInDerived;

// Session 26 — fields derived from the check_ins temporal layer, attached by
// the backend's enrich_with_check_ins() on every goals/projects list call.
// `progress` is the latest non-null % asserted in a check-in (manual, 0-100);
// `trend` compares the latest two non-null %s; the last_check_in_* pair
// drives staleness badges ("no check-in in N days").
export type CheckInTrend = "up" | "down" | "flat";

export type CheckInDerived = {
  progress?: number | null;
  trend?: CheckInTrend | null;
  last_check_in_at?: string | null;
  last_check_in_note?: string | null;
};

export type CheckIn = {
  id: string;
  goal_id: string | null;
  project_id: string | null;
  status: GoalStatus;
  progress: number | null;
  note: string | null;
  created_at: string;
};

export type CheckInIn = {
  status: GoalStatus;
  progress?: number | null;
  note?: string | null;
};

export const getGoalCheckIns = (goalId: string): Promise<CheckIn[]> =>
  authedFetch(`/api/goals/${goalId}/check-ins`);

export const createGoalCheckIn = (goalId: string, body: CheckInIn): Promise<CheckIn> =>
  authedFetch(`/api/goals/${goalId}/check-ins`, { method: "POST", body: JSON.stringify(body) });

export const getProjectCheckIns = (projectId: string): Promise<CheckIn[]> =>
  authedFetch(`/api/projects/${projectId}/check-ins`);

export const createProjectCheckIn = (projectId: string, body: CheckInIn): Promise<CheckIn> =>
  authedFetch(`/api/projects/${projectId}/check-ins`, { method: "POST", body: JSON.stringify(body) });

export type GoalIn = {
  title: string;
  description?: string | null;
  success_metrics?: string | null;
  level: GoalLevel;
  status?: GoalStatus;
  due_date?: string | null;
  direct_report_id?: string | null;
  parent_goal_id?: string | null;
  org_unit_id?: string | null;
};

export const getGoals = (params?: { level?: GoalLevel; directReportId?: string; orgUnitId?: string; status?: GoalStatus }): Promise<Goal[]> => {
  const q = new URLSearchParams();
  if (params?.level) q.set("level", params.level);
  if (params?.directReportId) q.set("direct_report_id", params.directReportId);
  if (params?.orgUnitId) q.set("org_unit_id", params.orgUnitId);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return authedFetch(`/api/goals${qs ? `?${qs}` : ""}`);
};

export const createGoal = (body: GoalIn): Promise<Goal> =>
  authedFetch("/api/goals", { method: "POST", body: JSON.stringify(body) });

export const updateGoal = (id: string, body: GoalIn): Promise<Goal> =>
  authedFetch(`/api/goals/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const updateGoalStatus = (id: string, status: GoalStatus): Promise<Goal> =>
  authedFetch(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });

export const deleteGoal = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/goals/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Projects (Session 13) — "goals = what, projects = how" (PRODUCT_VISION.md).
// Own top-level page (/app/projects), same "written to regularly" reasoning
// as Goals. Optionally linked to a goal (goal_id) and/or a direct report
// (direct_report_id) — both nullable, a project can be standalone. No
// level/org_unit_id of its own: scope is derived from whatever it's linked
// to rather than duplicating goals' hierarchy fields. Commitments -> project
// linking (source_type='project', already in schema) stays deferred.
//
// org_unit_id (Session 46, team_project_goal_hierarchy project memory note):
// reverses the "no independent scope" call above — Andrew wanted a project
// attachable to a team/department directly, same mechanism goals already
// had, so /app/team's Initiatives card can filter by team instead of
// proxying through the assignee's own org_unit_id. Unlike goals, projects
// have no level enum — org_unit_id can point at either a team or a
// department org_unit.
// ---------------------------------------------------------------------------

export type ProjectStatus = GoalStatus; // same enum shape (active/on_track/at_risk/completed/cancelled)

export type Project = {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  due_date: string | null;
  direct_report_id: string | null;
  direct_report_name?: string | null;
  goal_id: string | null;
  // Only populated when goals.py's join resolves it — see projects.py's
  // _shape_rows.
  goal_title?: string | null;
  // Session 46: which team/department this project belongs to. Null means
  // no team assigned. org_unit_name only populated when projects.py's join
  // resolves it, same pattern as goal_title above.
  org_unit_id: string | null;
  org_unit_name?: string | null;
  created_at: string;
} & CheckInDerived;

export type ProjectIn = {
  title: string;
  description?: string | null;
  status?: ProjectStatus;
  due_date?: string | null;
  direct_report_id?: string | null;
  goal_id?: string | null;
  org_unit_id?: string | null;
};

export const getProjects = (params?: { directReportId?: string; goalId?: string; orgUnitId?: string; status?: ProjectStatus }): Promise<Project[]> => {
  const q = new URLSearchParams();
  if (params?.directReportId) q.set("direct_report_id", params.directReportId);
  if (params?.goalId) q.set("goal_id", params.goalId);
  if (params?.orgUnitId) q.set("org_unit_id", params.orgUnitId);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return authedFetch(`/api/projects${qs ? `?${qs}` : ""}`);
};

export const createProject = (body: ProjectIn): Promise<Project> =>
  authedFetch("/api/projects", { method: "POST", body: JSON.stringify(body) });

export const updateProject = (id: string, body: ProjectIn): Promise<Project> =>
  authedFetch(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const updateProjectStatus = (id: string, status: ProjectStatus): Promise<Project> =>
  authedFetch(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });

export const deleteProject = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/projects/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Org units (Session 11) — team/department entities with parent/child
// relationships. Own top-level page (/app/org). "Company" is NOT a unit_type
// here — it's the existing organizations row (Profile & Company in
// Settings), shown as the chart's root; a department with parent_unit_id
// null sits directly under it. See docs/SESSION_HISTORY.md and the
// org_hierarchy_scoping project memory note.
// ---------------------------------------------------------------------------

export type OrgUnitType = "department" | "team";

export type OrgUnit = {
  id: string;
  name: string;
  unit_type: OrgUnitType;
  parent_unit_id: string | null;
  // Session 15: who leads this unit — drives role-scoped rollup views
  // (People/Goals/Projects/Capacity). Null = no leader assigned yet, so this
  // unit contributes nothing to anyone's rollup.
  leader_user_id: string | null;
};

export type OrgUnitIn = {
  name: string;
  unit_type: OrgUnitType;
  parent_unit_id?: string | null;
  leader_user_id?: string | null;
};

export const getOrgUnits = (): Promise<OrgUnit[]> => authedFetch("/api/org-units");

export const createOrgUnit = (body: OrgUnitIn): Promise<OrgUnit> =>
  authedFetch("/api/org-units", { method: "POST", body: JSON.stringify(body) });

export const updateOrgUnit = (id: string, body: OrgUnitIn): Promise<OrgUnit> =>
  authedFetch(`/api/org-units/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const deleteOrgUnit = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/org-units/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Role-scoped views (Session 15) — org-unit leader assignment + aggregate
// rollups across the units a manager leads (own unit + every descendant).
// Aggregate-only outside your own team, same precedent as Capacity's rollup
// (Session 14). See docs/SESSION_HISTORY.md and the role_scoped_views
// project memory note for the scoping conversation.
// ---------------------------------------------------------------------------

export type OrgMember = {
  id: string;
  full_name: string;
  email: string;
};

export const getOrgMembers = (): Promise<OrgMember[]> => authedFetch("/api/org-units/members");

// Units the caller DIRECTLY leads (not the full descendant scope the
// backend computes for rollups) — used to know which subtrees to render a
// rollup for, and to show an empty state when the caller leads nothing yet.
export const getLedOrgUnits = (): Promise<OrgUnit[]> => authedFetch("/api/org-units/led");

export type GoalsRollupItem = {
  org_unit_id: string;
  org_unit_name: string | null;
  unit_type: OrgUnitType | null;
  status: GoalStatus;
  goal_count: number;
};

// Department/team-level goals only (org_unit_id set directly) — individual
// goals aren't rolled up here, see goals.py's get_goals_rollup comment.
export const getGoalsRollup = (): Promise<GoalsRollupItem[]> => authedFetch("/api/goals/rollup");

export type ProjectsRollupItem = {
  org_unit_id: string;
  org_unit_name: string | null;
  unit_type: OrgUnitType | null;
  status: ProjectStatus;
  project_count: number;
};

export const getProjectsRollup = (): Promise<ProjectsRollupItem[]> => authedFetch("/api/projects/rollup");

export type PeopleRollupItem = {
  org_unit_id: string;
  org_unit_name: string | null;
  unit_type: OrgUnitType | null;
  direct_report_count: number;
  role_breakdown: { job_role: string; count: number }[];
};

export const getPeopleRollup = (): Promise<PeopleRollupItem[]> => authedFetch("/api/direct-reports/rollup");

// ---------------------------------------------------------------------------
// Capacity (Session 14) — how much bandwidth each person/team/department
// has. v1 is supply only (no allocation/demand tracking against Projects or
// Goals yet). Hours are the shared currency; work_unit_configs is an
// optional per-role-level display translation on top (tickets/points/
// campaigns). Own top-level page (/app/capacity); org-wide defaults + work
// unit setup live in Settings > Operating defaults ("configured once"); per-person
// overrides + time off logging live on the DR detail page (used regularly).
// See docs/SESSION_HISTORY.md and the capacity_scoping project memory note.
// ---------------------------------------------------------------------------

export type CapacitySettings = {
  default_hours_per_week: number;
  default_target_utilization_pct: number;
  // Separate from target_utilization_pct — whole days off (vacation/sick/
  // holiday) per year, not within-day overhead. Default 21 (15 vacation +
  // 6 sick). Prorated into the period math when a report has no actual
  // time_off_entries logged for that period — see CapacityOverviewItem's
  // off_hours_source.
  default_off_days_per_year: number;
};

export const getCapacitySettings = (): Promise<CapacitySettings> => authedFetch("/api/capacity/settings");

export const updateCapacitySettings = (body: CapacitySettings): Promise<CapacitySettings> =>
  authedFetch("/api/capacity/settings", { method: "PUT", body: JSON.stringify(body) });

export type WorkUnitConfig = {
  id: string;
  role_level_id: string;
  unit_name: string;
  hours_per_unit: number;
};

export const getWorkUnitConfigs = (): Promise<WorkUnitConfig[]> => authedFetch("/api/capacity/work-units");

export const upsertWorkUnitConfig = (body: { role_level_id: string; unit_name: string; hours_per_unit: number }): Promise<WorkUnitConfig> =>
  authedFetch("/api/capacity/work-units", { method: "POST", body: JSON.stringify(body) });

export const deleteWorkUnitConfig = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/capacity/work-units/${id}`, { method: "DELETE" });

export type CapacityProfileFields = {
  contracted_hours_per_week: number | null;
  target_utilization_pct: number | null;
  off_days_per_year: number | null;
};

// null fields = inherit the org default (capacity_settings).
export const getCapacityProfile = (directReportId: string): Promise<CapacityProfileFields> =>
  authedFetch(`/api/capacity/profiles/${directReportId}`);

// null = inherit the org default (capacity_settings) for that field.
export const setCapacityProfile = (directReportId: string, body: CapacityProfileFields): Promise<CapacityProfileFields> =>
  authedFetch(`/api/capacity/profiles/${directReportId}`, { method: "PUT", body: JSON.stringify(body) });

export type TimeOffType = "pto" | "sick" | "holiday" | "other";

export type TimeOffEntry = {
  id: string;
  direct_report_id: string;
  start_date: string;
  end_date: string;
  type: TimeOffType;
  hours_per_day: number | null;
  notes: string | null;
};

export const getTimeOff = (directReportId?: string): Promise<TimeOffEntry[]> =>
  authedFetch(`/api/capacity/time-off${directReportId ? `?direct_report_id=${directReportId}` : ""}`);

export const createTimeOff = (body: {
  direct_report_id: string;
  start_date: string;
  end_date: string;
  type: TimeOffType;
  hours_per_day?: number | null;
  notes?: string | null;
}): Promise<TimeOffEntry> => authedFetch("/api/capacity/time-off", { method: "POST", body: JSON.stringify(body) });

export const deleteTimeOff = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/capacity/time-off/${id}`, { method: "DELETE" });

// A resolved available-hours figure for one direct report over a period —
// contracted hours/utilization already have profile overrides and org
// defaults applied server-side. off_hours is whichever source won for this
// period: real logged time_off_entries ("logged") if any overlap it,
// otherwise a prorated share of off_days_per_year ("assumed") — never both,
// to avoid double-counting. See backend/routes/capacity.py's
// _effective_off_hours().
export type CapacityOverviewItem = {
  direct_report_id: string;
  name: string;
  role_title: string | null;
  role_level_id: string | null;
  org_unit_id: string | null;
  contracted_hours_per_week: number;
  target_utilization_pct: number;
  off_days_per_year: number;
  off_hours: number;
  off_hours_source: "logged" | "assumed";
  available_hours: number;
};

export const getCapacityOverview = (periodStart: string, periodEnd: string): Promise<CapacityOverviewItem[]> =>
  authedFetch(`/api/capacity/overview?period_start=${periodStart}&period_end=${periodEnd}`);

// Aggregate-only rollup per org unit — never a named individual outside
// your own team. As of Session 15, only returns units within the caller's
// led scope (org_unit_leaders) — empty when the caller leads nothing yet.
// The frontend walks each led unit's subtree and sums bottom-up, same
// pattern as the Org page's chart, just anchored at led roots instead of
// the company root.
export type CapacityRollupItem = {
  org_unit_id: string;
  name: string;
  unit_type: OrgUnitType;
  parent_unit_id: string | null;
  direct_report_count: number;
  available_hours: number;
};

export const getCapacityRollup = (periodStart: string, periodEnd: string): Promise<CapacityRollupItem[]> =>
  authedFetch(`/api/capacity/rollup?period_start=${periodStart}&period_end=${periodEnd}`);

// ---------------------------------------------------------------------------
// Away (Session 2026-09-01) — a manager declares "I'll be out from X to Y"
// and every upcoming 1:1, team meeting, and self-owned commitment/goal/
// project due date in that window shifts forward by however many days long
// the window is, so nothing sits as false delinquency while they're gone.
// v1 is manager-only; a direct report's own out-of-office is a separate
// follow-up. See backend/routes/away.py and docs/systems/away.md.
// ---------------------------------------------------------------------------

export type AwayEntityType = "one_on_one" | "team_meeting" | "commitment" | "goal" | "project";

export type AwaySweepItem = {
  entity_type: AwayEntityType;
  entity_id: string;
  label: string;
  old_date: string;
  new_date: string;
};

export type AwaySweepResult = {
  window_days: number;
  items: AwaySweepItem[];
};

export type AwayPeriodIn = {
  start_date: string;
  end_date: string;
  reason?: string;
};

// Computes what would move without persisting anything.
export const previewAwayPeriod = (body: AwayPeriodIn): Promise<AwaySweepResult> =>
  authedFetch("/api/away/preview", { method: "POST", body: JSON.stringify(body) });

// Recomputed fresh server-side (never trusts a stale client-held preview),
// then actually applied.
export const applyAwayPeriod = (body: AwayPeriodIn): Promise<AwaySweepResult & { id: string }> =>
  authedFetch("/api/away", { method: "POST", body: JSON.stringify(body) });

export type AwayPeriod = {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  applied_at: string;
  created_at: string;
  shift_count: number;
};

export const getAwayPeriods = (): Promise<AwayPeriod[]> => authedFetch("/api/away");

// ---------------------------------------------------------------------------
// Dashboard (Session 19) — Mission Control's AI insight banner. One optional
// insight per load; all-null fields mean nothing crossed the noteworthy bar
// today — a valid, expected, and common response, not an error state (see
// backend/routes/dashboard.py).
// ---------------------------------------------------------------------------

export type DashboardInsight = {
  insight: string | null;
  cta_label: string | null;
  cta_direct_report_id: string | null;
};

export const getDashboardInsight = (): Promise<DashboardInsight> =>
  authedFetch("/api/dashboard/insight");

// Action-first Mission Control. Ranking and evidence are deterministic on the
// backend; AI can only add an optional explanation after selection.
export type MissionControlCoverage = Record<
  "conversations" | "commitments" | "goals" | "projects" | "check_ins" | "capacity" | "expectations" | "feedback",
  "ok" | "partial" | "unavailable"
>;

export type MissionControlEvidence = {
  code: string;
  label: string;
  source: string;
  observed_at: string | null;
  freshness: string;
};

export type MissionControlCandidate = {
  candidate_key: string;
  evidence_fingerprint: string;
  candidate_type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  explanation: string;
  action: { label: string; href: string };
  score: number;
  rank: number;
  rank_basis: { code: string; label: string; points: number }[];
  evidence: MissionControlEvidence[];
  target_ids: string[];
  boundaries: string[];
};

export type MissionControlBrief = {
  variant: "action_first";
  brief_id: string;
  mode: "normal" | "busy" | "early_use" | "empty" | "all_clear" | "partial";
  generated_at: string;
  stale_after: string;
  timezone: string;
  primary: MissionControlCandidate | null;
  secondary: MissionControlCandidate[];
  truth_signal: { kind: "progress" | "all_clear" | "limited" | "factual"; title: string; detail: string };
  supporting: {
    conversations: { id: string; title: string; meta: string; href: string }[];
    changes: { id: string; title: string; meta: string; freshness: string }[];
  };
  coverage: MissionControlCoverage;
  optional_context: {
    candidate_key: string;
    evidence_fingerprint: string;
    title: string;
    detail: string;
    href: string;
  } | null;
  eligible_count: number;
};

export type MissionControlVariant = MissionControlBrief | { variant: "legacy" };

function browserLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const getMissionControlBrief = (): Promise<MissionControlVariant> => {
  const query = new URLSearchParams({
    local_date: browserLocalDate(),
    timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  return authedFetch(`/api/dashboard/brief?${query}`);
};

export type MissionControlEventInput = {
  brief_id: string;
  event_type:
    | "impression"
    | "why_opened"
    | "cta_clicked"
    | "addressed"
    | "snoozed"
    | "not_relevant"
    | "setup_dismissed_today"
    | "ai_explanation_succeeded"
    | "ai_explanation_failed";
  candidate_key: string;
  evidence_fingerprint: string;
  candidate_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  rank?: number | null;
  score?: number | null;
  snoozed_until?: string | null;
  parent_event_id?: string | null;
  metadata?: Record<string, unknown>;
};

export const recordMissionControlEvents = (
  events: MissionControlEventInput[]
): Promise<{ events: { id: string; event_type: string }[] }> =>
  authedFetch("/api/dashboard/events", { method: "POST", body: JSON.stringify({ events }) });

export const reconcileMissionControlOutcomes = (): Promise<{ completed: number }> =>
  authedFetch("/api/dashboard/reconcile", { method: "POST" });

export const explainMissionControlCandidate = (
  candidate: Pick<MissionControlCandidate, "candidate_key" | "evidence_fingerprint">
): Promise<{ status: "ok" | "failed" | "unavailable"; explanation: string | null }> =>
  authedFetch("/api/dashboard/explain", {
    method: "POST",
    body: JSON.stringify({
      ...candidate,
      local_date: browserLocalDate(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    }),
  });

// ---------------------------------------------------------------------------
// Team View (Session 21) — the "team space" surface Andrew floated
// 2026-08-03: a single home for "my team" as a unit (who's on it, what
// they're working on), distinct from role-scoped views (who can see what as
// the org grows). Own top-level page (/app/team). v1 scope: own direct
// reports only. Roster/projects/priorities are assembled read-only from
// data that already exists; messaging is the new piece — a free-text update
// per report, STORE-ONLY (no delivery mechanism, IC login isn't built).
// See docs/SESSION_HISTORY.md and the team_space_brainstorm project memory
// note.
// ---------------------------------------------------------------------------

// A project or individual-level goal, as shown on Team View — Team View
// only ever fetches the active/on_track/at_risk subset server-side (see
// team.py's _ACTIVE_STATUSES), so this is a lighter shape than Project/Goal.
export type TeamWorkItem = {
  id: string;
  title: string;
  status: ProjectStatus;
  due_date: string | null;
};

export type TeamMessage = {
  id: string;
  message: string;
  created_at: string;
};

export type TeamMember = {
  id: string;
  name: string;
  role_title: string | null;
  // Session 22: drive the Invite action on the roster card. email is null
  // until a manager invites this report (see inviteDirectReport below);
  // user_id is set once they've claimed an account — no further invite
  // possible after that.
  email: string | null;
  user_id: string | null;
  projects: TeamWorkItem[];
  priorities: TeamWorkItem[];
  latest_message: TeamMessage | null;
};

export const getTeam = (): Promise<TeamMember[]> => authedFetch("/api/team");

export const getTeamMessages = (reportId: string): Promise<TeamMessage[]> =>
  authedFetch(`/api/team/${reportId}/messages`);

// STORE-ONLY — see this section's header comment. Nothing is delivered
// anywhere; this just adds a row to team_messages.
export const sendTeamMessage = (reportId: string, message: string): Promise<TeamMessage> =>
  authedFetch(`/api/team/${reportId}/messages`, { method: "POST", body: JSON.stringify({ message }) });

// ---------------------------------------------------------------------------
// Team Mission Control (Session 22, 2026-08-08) — expands Team View into a
// 3-column surface: the roster above (left), company/team goal progress
// (middle), and a standalone meeting-notes log (right), plus the
// direct-report invite flow (an "auth primitives now, IC view later" scope
// call — an IC can now create an account and claim direct_reports.user_id,
// but the IC-facing view itself is a follow-up session). "Key updates" (a
// manager-authored broadcast feed) was scoped and then explicitly deferred.
// See docs/SESSION_HISTORY.md and the team_mission_control project memory
// note for the scoping conversation.
// ---------------------------------------------------------------------------

// Company/team goal progress only — see team.py's get_team_goals docstring
// for why department/individual are excluded here. Carries CheckInDerived
// (progress/trend/last_check_in_at) as of the 2026-08-12 data-trust fix —
// same enrich_with_check_ins() call every other goal-listing endpoint uses,
// so /app/team's progress ring and Mission Control's Goals card agree.
export type TeamGoal = {
  id: string;
  title: string;
  level: GoalLevel;
  status: GoalStatus;
  due_date: string | null;
  org_unit_id: string | null;
  org_unit_name: string | null;
} & CheckInDerived;

export const getTeamGoals = (): Promise<TeamGoal[]> => authedFetch("/api/team/goals");

// Team meetings (2026-08-24) — replaces the old TeamNote/getTeamNotes pair.
// A meeting is one row plus its agenda items, not two loose notes; status is
// derived from `summary` on the backend and arrives as `status` here:
//   open      — not logged yet, dated today or later (or not dated at all)
//   needs_log — not logged yet, the date has passed
//   logged    — written up, whatever the date says
// org_unit_id null still means "all teams", same convention as callouts.
export type TeamAgendaItem = {
  id: string;
  meeting_id: string;
  position: number;
  item: string;
  covered: boolean;
  notes: string | null;
  carried_from_item_id: string | null;
};

export type TeamMeeting = {
  id: string;
  scheduled_at: string | null;
  summary: string | null;
  raw_notes: string | null;
  agenda_note: string | null;
  logged_at: string | null;
  org_unit_id: string | null;
  series_id: string | null;
  created_at: string;
  status: "open" | "needs_log" | "logged";
  agenda_items: TeamAgendaItem[];
  // 1-4 when this meeting belongs to an active series; null for a one-off.
  recurrence_weeks: number | null;
};

export type TeamMeetingDraftCommitment = {
  description: string;
  direct_report_id: string | null; // null = the manager owns it
  due_date: string | null;
};

export type TeamMeetingWrapUpDraft = {
  summary: string;
  commitments: TeamMeetingDraftCommitment[];
  carry_forward_items: string[];
};

export const getTeamMeetings = (): Promise<TeamMeeting[]> => authedFetch("/api/team/meetings");

export const createTeamMeeting = (body: {
  scheduledAt: string | null;
  agendaItems: string[];
  orgUnitId?: string | null;
  recurrenceWeeks?: number | null;
}): Promise<TeamMeeting> =>
  authedFetch("/api/team/meetings", {
    method: "POST",
    body: JSON.stringify({
      scheduled_at: body.scheduledAt,
      agenda_items: body.agendaItems,
      org_unit_id: body.orgUnitId ?? null,
      recurrence_weeks: body.recurrenceWeeks ?? null,
    }),
  });

// clearRecurrence is explicit because "leave the repeat rule alone" and "stop
// repeating" are different intentions that null can't tell apart.
export const updateTeamMeeting = (
  id: string,
  body: {
    scheduledAt?: string | null;
    agendaItems?: string[];
    recurrenceWeeks?: number | null;
    clearRecurrence?: boolean;
  }
): Promise<TeamMeeting> =>
  authedFetch(`/api/team/meetings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      scheduled_at: body.scheduledAt,
      agenda_items: body.agendaItems,
      recurrence_weeks: body.recurrenceWeeks ?? null,
      clear_recurrence: body.clearRecurrence ?? false,
    }),
  });

// Planned meetings only — the backend refuses to delete a logged one, since
// that is history and commitments point at it through source_id.
export const deleteTeamMeeting = (id: string): Promise<{ ok: boolean }> =>
  authedFetch(`/api/team/meetings/${id}`, { method: "DELETE" });

// The one edit a LOGGED meeting accepts: fixing the wording of the write-up.
// Sends summary alone so the shared PATCH body's nulls don't read as "clear
// the date and the repeat rule" — the backend rejects those on a logged
// meeting rather than silently destroying per-item notes.
export const updateTeamMeetingSummary = (id: string, summary: string): Promise<TeamMeeting> =>
  authedFetch(`/api/team/meetings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ summary }),
  });

// Draft only — nothing is written until logTeamMeeting confirms it.
export const wrapUpTeamMeeting = (
  id: string,
  rawNotes: string
): Promise<TeamMeetingWrapUpDraft> =>
  authedFetch(`/api/team/meetings/${id}/wrapup`, {
    method: "POST",
    body: JSON.stringify({ raw_notes: rawNotes }),
  });

export const logTeamMeeting = (
  id: string,
  body: {
    summary: string;
    rawNotes?: string | null;
    agendaOutcomes: { id: string; covered: boolean; notes: string | null }[];
    commitments: TeamMeetingDraftCommitment[];
    carryForwardItems: string[];
  }
): Promise<{ meeting: TeamMeeting; next_meeting: TeamMeeting | null }> =>
  authedFetch(`/api/team/meetings/${id}/log`, {
    method: "POST",
    body: JSON.stringify({
      summary: body.summary,
      raw_notes: body.rawNotes ?? null,
      agenda_outcomes: body.agendaOutcomes,
      commitments: body.commitments,
      carry_forward_items: body.carryForwardItems,
    }),
  });

// Team-level commitments (Session 23) — same Commitment shape as the
// Commitments section above; is_team_commitment is what puts a row on this
// list, not a different table. Marking one done/dropped reuses
// updateCommitment above — the flag doesn't change how a commitment
// resolves, only where it's visible.
export type TeamCommitment = Commitment;

export const getTeamCommitments = (): Promise<TeamCommitment[]> => authedFetch("/api/team/commitments");

// directReportId is nullable (2026-08-24): a team meeting routinely produces
// work the manager owns, and there's no direct_reports row for the manager.
export const createTeamCommitment = (body: {
  directReportId: string | null;
  description: string;
  dueDate?: string | null;
}): Promise<TeamCommitment> =>
  authedFetch("/api/team/commitments", {
    method: "POST",
    body: JSON.stringify({
      direct_report_id: body.directReportId,
      description: body.description,
      due_date: body.dueDate ?? null,
    }),
  });

// Team callouts (Session 24, 2026-08-09) — the "key updates" concept scoped
// and deferred twice (Sessions 22/23), revived here in a deliberately small
// form: one manager-authored text block, overwritten in place rather than a
// dated history log (unlike team_meetings). Each line the manager
// writes renders as its own bullet on the page. See team.py's
// get_team_callout/update_team_callout and the team_page_redesign_options
// project memory note.
//
// org_unit_id (Session 45, team dropdown): which led team this callout is
// for; null means "all teams". getTeamCallout() now returns every row for
// the manager (one per team that's ever had a callout, plus at most one
// org_unit_id-null row) instead of a single object, so the frontend picks
// the row matching whichever team is selected. See the
// team_dropdown_scoping project memory note.
export type TeamCallout = {
  message: string;
  updated_at: string | null;
  org_unit_id: string | null;
};

export const getTeamCallout = (): Promise<TeamCallout[]> => authedFetch("/api/team/callout");

export const updateTeamCallout = (message: string, orgUnitId: string | null): Promise<TeamCallout> =>
  authedFetch("/api/team/callout", {
    method: "PUT",
    body: JSON.stringify({ message, org_unit_id: orgUnitId }),
  });

// Team dev focus (Session 47, 2026-08-20) — the team-level half of
// Development: a lightweight "this month's training focus" pinned note per
// (manager, org_unit). Deliberately mirrors TeamCallout's shape exactly
// (see team.py's get_team_dev_focus/update_team_dev_focus) — a separate
// type/table so it doesn't collide with Critical Callouts' "key updates"
// concept in the same panel.
export type TeamDevFocus = {
  message: string;
  updated_at: string | null;
  org_unit_id: string | null;
};

export const getTeamDevFocus = (): Promise<TeamDevFocus[]> => authedFetch("/api/team/dev-focus");

export const updateTeamDevFocus = (message: string, orgUnitId: string | null): Promise<TeamDevFocus> =>
  authedFetch("/api/team/dev-focus", {
    method: "PUT",
    body: JSON.stringify({ message, org_unit_id: orgUnitId }),
  });

// Returns a link the manager copies and sends themselves — no email is sent
// from the backend (same manual-delivery posture Session 21 chose for
// team_messages).
export const inviteDirectReport = (
  reportId: string,
  email: string
): Promise<{ invite_url: string; expires_at: string }> =>
  authedFetch(`/api/direct-reports/${reportId}/invite`, { method: "POST", body: JSON.stringify({ email }) });

export type InvitePreview = {
  report_name: string;
  invited_email: string;
  manager_name: string | null;
  expires_at: string;
};

// Unauthenticated — the visitor hasn't logged in yet on /invite/[token], so
// there's no session for authedFetch to attach. Hits the same backend, just
// without an Authorization header.
export const getInvitePreview = (token: string): Promise<InvitePreview> =>
  fetch(`${BACKEND_URL}/api/invites/${token}`).then((res) => {
    if (!res.ok) throw new Error("This invite link is invalid or has expired");
    return res.json();
  });

export const acceptInvite = (token: string): Promise<{ direct_report_id: string }> =>
  authedFetch(`/api/invites/${token}/accept`, { method: "POST" });

// ---------------------------------------------------------------------------
// 1:1s
// ---------------------------------------------------------------------------

export const getOneOnOneHistory = (directReportId: string): Promise<OneOnOne[]> =>
  authedFetch(`/api/one-on-ones/${directReportId}/history`);

// A single session by id — used to resume a planned prep sheet without
// regenerating it.
export const getOneOnOne = (id: string): Promise<OneOnOne> =>
  authedFetch(`/api/one-on-ones/session/${id}`);

// The current unfinished occurrence for a person — either date-only
// scheduled or already prepped. Used when entering prep without ?resume=.
export const getOpenOneOnOne = (directReportId: string): Promise<OneOnOne | null> =>
  authedFetch(`/api/one-on-ones/open/${directReportId}`);

// Dismiss an unfinished occurrence. If it belongs to an active series, this
// also stops recurrence. Completed history is never deleted here.
export const deleteOneOnOne = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/one-on-ones/session/${id}`, { method: "DELETE" });

export const prepOneOnOne = (body: {
  direct_report_id: string;
  raw_notes: string;
  one_on_one_id?: string;
  scheduled_at?: string | null;
  recurrence_weeks?: 1 | 2 | 3 | 4 | null;
  timezone?: string;
  carry_forward_items?: string[];
  suggested_topics?: string[];
  excluded_commitment_ids?: string[];
}): Promise<PrepResponse> =>
  authedFetch("/api/one-on-ones/prep", { method: "POST", body: JSON.stringify(body) });

export const updateOneOnOneSchedule = (
  id: string,
  body: {
    scheduled_at: string | null;
    recurrence_weeks: 1 | 2 | 3 | 4 | null;
    timezone: string;
  }
): Promise<OneOnOne> =>
  authedFetch(`/api/one-on-ones/session/${id}/schedule`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

// Raw call notes → AI-drafted summary + commitments (both sides). Draft only —
// nothing is saved until logOneOnOne.
export const wrapUpOneOnOne = (body: { direct_report_id: string; raw_notes: string }): Promise<WrapUpDraft> =>
  authedFetch("/api/one-on-ones/wrapup", { method: "POST", body: JSON.stringify(body) });

export const logOneOnOne = (body: {
  direct_report_id: string;
  summary: string;
  notes?: string;
  new_commitments?: WrapUpCommitment[];
  carry_forward_items?: string[];
  // Set when this meeting was opened from its workspace. When omitted, the
  // backend completes the person's current unfinished occurrence unless it
  // has prep saved on it.
  one_on_one_id?: string;
  // YYYY-MM-DD — the day the conversation happened, confirmed on the review
  // screen. Encoded at noon UTC onto scheduled_at, which is the meeting date.
  meeting_date?: string | null;
  // "A different conversation from the one I have prep saved for." Logs its
  // own occurrence and leaves the prepped workspace untouched.
  separate_occurrence?: boolean;
}): Promise<{ meeting: OneOnOne; next_session: OneOnOne }> =>
  authedFetch("/api/one-on-ones", { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Capture notes (Session 50, 2026-08-21) — the Person Page cockpit's
// between-sessions capture box. A quick-jot inbox that /prep's frontend
// (prep/page.tsx) folds into the raw-notes box and clears once a sheet is
// generated. See backend/routes/one_on_ones.py's capture endpoints and
// database/migrations/2026-08-21_dr_capture_notes.sql for why this is a
// separate small table rather than a column on one_on_ones.
// ---------------------------------------------------------------------------

export type CaptureNote = {
  id: string;
  direct_report_id: string;
  content: string;
  created_at: string;
};

export const getCaptureNotes = (directReportId: string): Promise<CaptureNote[]> =>
  authedFetch(`/api/one-on-ones/${directReportId}/captures`);

export const createCaptureNote = (directReportId: string, content: string): Promise<CaptureNote> =>
  authedFetch(`/api/one-on-ones/${directReportId}/captures`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });

export const deleteCaptureNote = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/one-on-ones/captures/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// 1:1s overview (nav rework pass 2, Session 38, 2026-08-16) — the front door
// for the 1:1 loop, /app/1-1s. See docs/ONE_ON_ONES_PAGE_SPEC.md section 5.
// Single canonical "who's due" computation — Mission Control's Individual
// Performance card and the zone map's 1:1s door count both read is_due from
// here rather than computing staleness client-side (that's the specific
// failure this endpoint exists to prevent — see the backend's
// resolve_cadence_days()).
// ---------------------------------------------------------------------------

// Which source resolved this person's cadence — surfaced so the UI can be
// honest about where the number came from, same convention Capacity uses
// for logged-vs-assumed hours (off_hours_source).
export type CadenceSource = "custom" | "org" | "default";

export type LastCompletedSession = {
  id: string;
  date: string;
  commitment_count: number;
};

export type OneOnOneOverviewItem = {
  direct_report_id: string;
  name: string;
  role_title: string | null;
  org_unit: string | null;
  last_one_on_one_at: string | null;
  days_since_last: number | null;
  cadence_days: number;
  cadence_source: CadenceSource;
  is_due: boolean;
  planned_session: OneOnOne | null;
  last_completed: LastCompletedSession | null;
};

export const getOneOnOnesOverview = (): Promise<OneOnOneOverviewItem[]> =>
  authedFetch("/api/one-on-ones/overview");

// ---------------------------------------------------------------------------
// Settings — workspace identity, people, roles, operating defaults, account
// ---------------------------------------------------------------------------

export type Profile = {
  email: string;
  full_name: string;
  company_name: string;
  org_ready: boolean;
  // Org-wide default 1:1 cadence, in days (nav rework pass 2, Session 38) —
  // a per-person override on DirectReport.one_on_one_cadence_days takes
  // precedence over this; this in turn falls back to 21 for a manager with
  // no organization row yet. See resolve_cadence_days() in backend/utils.py.
  one_on_one_cadence_days: number;
};

// Role families (Session 40, Plan S2): group role_levels rows into ladders.
// See routes/role_families.py and the team_setup_ux_review project memory
// note for the scoping conversation.
export type RoleFamily = {
  id: string;
  name: string;
  created_at?: string;
};

export type RoleFamilyIn = {
  name: string;
};

export const getRoleFamilies = (): Promise<RoleFamily[]> => authedFetch("/api/role-families");

export const createRoleFamily = (body: RoleFamilyIn): Promise<RoleFamily> =>
  authedFetch("/api/role-families", { method: "POST", body: JSON.stringify(body) });

export const updateRoleFamily = (id: string, body: RoleFamilyIn): Promise<RoleFamily> =>
  authedFetch(`/api/role-families/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const deleteRoleFamily = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/role-families/${id}`, { method: "DELETE" });

export type RoleLevel = {
  id: string;
  job_role: string;
  job_level: number;
  functional_team: string | null;
  job_responsibilities: string | null;
  // Session 40: which ladder this level belongs to. null = "Ungrouped".
  role_family_id: string | null;
  // Embedded by GET /api/settings/role-levels (role_families(id, name)) so
  // callers get the ladder name without a second round-trip. null when
  // role_family_id is null, or when it points at a family this org's RLS
  // can no longer see (shouldn't happen in practice — role_family_id is
  // validated server-side on write).
  role_families: { id: string; name: string } | null;
};

export type ExpectationKind = "metrics" | "skills" | "values";

export type Expectation = {
  id: string;
  role_level_id: string | null;
  order_type: "primary" | "secondary" | "tertiary" | null;
  description: string | null;
  expectation?: string | null; // metrics + skills
  measurement_period?: string | null; // metrics only
  value_type?: "team" | "company" | "department" | null; // values only
  metric_name?: string;
  skill_name?: string;
  value_name?: string;
};

// The backend stores the name under metric_name / skill_name / value_name.
export const expectationName = (e: Expectation): string =>
  e.metric_name ?? e.skill_name ?? e.value_name ?? "";

export const getProfile = (): Promise<Profile> => authedFetch("/api/settings/profile");

export const updateProfile = (body: {
  full_name: string;
  company_name: string;
  one_on_one_cadence_days: number;
}): Promise<Profile> => authedFetch("/api/settings/profile", { method: "PUT", body: JSON.stringify(body) });

export const getRoleLevels = (): Promise<RoleLevel[]> => authedFetch("/api/settings/role-levels");

export type RoleLevelIn = {
  job_role: string;
  job_level?: number;
  functional_team?: string;
  job_responsibilities?: string;
  role_family_id?: string | null;
};

export const createRoleLevel = (body: RoleLevelIn): Promise<RoleLevel> =>
  authedFetch("/api/settings/role-levels", { method: "POST", body: JSON.stringify(body) });

export const updateRoleLevel = (id: string, body: RoleLevelIn): Promise<RoleLevel> =>
  authedFetch(`/api/settings/role-levels/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const deleteRoleLevel = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/settings/role-levels/${id}`, { method: "DELETE" });

export const getExpectations = (kind: ExpectationKind, roleLevelId?: string): Promise<Expectation[]> =>
  authedFetch(`/api/settings/expectations/${kind}${roleLevelId ? `?role_level_id=${roleLevelId}` : ""}`);

export type ExpectationIn = {
  name: string;
  role_level_id?: string | null;
  order_type?: string;
  description?: string;
  expectation?: string;
  measurement_period?: string;
  value_type?: string;
};

export const createExpectation = (kind: ExpectationKind, body: ExpectationIn): Promise<Expectation> =>
  authedFetch(`/api/settings/expectations/${kind}`, { method: "POST", body: JSON.stringify(body) });

export const deleteExpectation = (kind: ExpectationKind, id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/settings/expectations/${kind}/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Expectations coverage + AI draft (Plan S3, Session 1 — see
// docs/TEAM_SETUP_UX_REVIEW.md §6). Separate /api/expectations prefix from
// the /api/settings/expectations CRUD above — this is a read-only rollup
// (coverage) plus a draft-then-review flow (draft + batch), not more CRUD.
// ---------------------------------------------------------------------------

export type ExpectationsCoverageRow = {
  role_level_id: string;
  job_role: string;
  job_level: number;
  metrics_count: number;
  skills_count: number;
  values_count: number;
};

export type ExpectationsCoverage = {
  roles: ExpectationsCoverageRow[];
  org_wide_values_count: number;
};

export const getExpectationsCoverage = (): Promise<ExpectationsCoverage> =>
  authedFetch("/api/expectations/coverage");

// ---------------------------------------------------------------------------
// Setup status (Session 41, Plan S1 — see docs/TEAM_SETUP_UX_REVIEW.md §6).
// Feeds the People section's progress header + roster badges, and the
// Foundation door's "not finished" state in ZoneMap.tsx. Reuses the same
// coverage computation as getExpectationsCoverage() above (backend-side).
// ---------------------------------------------------------------------------

export type SetupStatusPerson = {
  id: string;
  name: string;
  has_role: boolean;
  has_team: boolean;
  // null when has_role is false — "no role" and "role has zero configured
  // expectations" are different states the roster chip needs to tell apart.
  role_has_expectations: boolean | null;
};

export type SetupStatus = {
  people_count: number;
  // Total org units (teams + departments) — kept for the "does at least one
  // unit exist" checks (ZoneMap.tsx's Foundation door). team_units_count/
  // department_units_count (Session 43, Polish Pass A, finding P2) are the
  // ones the People tile actually displays ("6 teams · 2 departments"
  // instead of one ambiguous "8 Teams" number).
  teams_count: number;
  team_units_count: number;
  department_units_count: number;
  roles_count: number;
  roles_with_expectations_count: number;
  people_without_role_count: number;
  people_without_team_count: number;
  // Session 43 — feeds the People section's "Show archived (N)" toggle.
  archived_people_count: number;
  people: SetupStatusPerson[];
};

export const getSetupStatus = (): Promise<SetupStatus> => authedFetch("/api/setup-status");

export type DraftMetricItem = {
  name: string;
  order_type: "primary" | "secondary" | "tertiary" | null;
  expectation: string | null;
  measurement_period: string | null;
};

export type DraftSkillItem = {
  name: string;
  order_type: "primary" | "secondary" | "tertiary" | null;
  expectation: string | null;
};

export type DraftValueItem = {
  name: string;
  order_type: "primary" | "secondary" | "tertiary" | null;
  description: string | null;
  value_type: "team" | "company" | "department" | null;
};

export type ExpectationsDraft = {
  metrics: DraftMetricItem[];
  skills: DraftSkillItem[];
  values: DraftValueItem[];
};

// AI-drafts metrics/skills/values from the role's job_responsibilities text
// (falls back to role title + level when there's no JD text). Nothing is
// saved — review in the UI, then commit via batchCreateExpectations. Can
// throw (rate limit, AI failure) — callers must degrade to the manual forms
// on error, never block them (draft-then-review rule, same as assessments).
export const draftExpectations = (roleLevelId: string): Promise<ExpectationsDraft> =>
  authedFetch("/api/expectations/draft", {
    method: "POST",
    body: JSON.stringify({ role_level_id: roleLevelId }),
  });

// Org-wide values draft (Session 43, Polish Pass B — see
// docs/TEAM_SETUP_UX_REVIEW.md §7.3, item 8). Drafts from the company
// name/context, not a job description — there is no role here. Same
// ExpectationsDraft shape (metrics/skills always empty) so the review row
// UI can be reused; commit via batchCreateExpectations("values", null, ...).
export const draftOrgValues = (): Promise<ExpectationsDraft> =>
  authedFetch("/api/expectations/draft-org-values", { method: "POST" });

export type ExpectationBatchItem = {
  name: string;
  order_type?: string | null;
  description?: string | null;
  expectation?: string | null;
  measurement_period?: string | null;
  value_type?: string | null;
};

// Commits a reviewed draft (or any hand-assembled batch) in one insert.
// roleLevelId null => org-wide (values only — value_configs.role_level_id
// IS NULL convention, Plan S3).
export const batchCreateExpectations = (
  kind: ExpectationKind,
  roleLevelId: string | null,
  items: ExpectationBatchItem[]
): Promise<Expectation[]> =>
  authedFetch(`/api/expectations/${kind}/batch`, {
    method: "POST",
    body: JSON.stringify({ role_level_id: roleLevelId, items }),
  });

// ---------------------------------------------------------------------------
// Role JD import (Session 44 — see docs/ROLE_JD_IMPORT_SCOPING.md). One AI
// call turns a pasted/uploaded job description into a role identity + a
// match proposal against existing ladders + an expectations draft. NOTHING
// is saved by this call: RoleImportPanel commits what the manager keeps
// through createRoleFamily / createRoleLevel / updateRoleLevel and the
// batchCreateExpectations calls above — no import-specific write endpoint
// exists on purpose (the AI drafts, the client confirms via the same
// endpoints the manual forms use).
// ---------------------------------------------------------------------------

export type RoleImportAction = "attach" | "create_new" | "exists";

export type ImportedRole = {
  job_role: string;
  job_level: number;
  functional_team: string | null;
  job_responsibilities: string | null;
};

export type RoleImportMatch = {
  suggested_action: RoleImportAction;
  // Server-validated against the caller's own ladders before it ships — a
  // non-null id here always resolves to a real RoleFamily.
  role_family_id: string | null;
  role_family_name: string | null;
  // Set only when suggested_action is "exists" (that exact role+level is
  // already configured) — the panel then runs in backfill mode.
  existing_role_level_id: string | null;
  confidence: "high" | "medium";
  rationale: string | null;
};

export type RoleImportDraft = {
  // false => honest refusal (not a JD). `reason` is the one line to show;
  // role/match are null and expectations are empty.
  is_job_description: boolean;
  reason: string | null;
  // Multi-role documents: v1 extracts the primary role only and says so.
  other_roles_note: string | null;
  role: ImportedRole | null;
  match: RoleImportMatch | null;
  expectations: ExpectationsDraft;
};

// Exactly one of file/text — the backend 422s on both or neither. Can throw
// (rate limit, LibreOffice failure, AI failure); the panel keeps the pasted
// text and shows the error rather than losing the input.
export const draftRoleImport = (input: { file?: File; text?: string }): Promise<RoleImportDraft> => {
  const formData = new FormData();
  if (input.file) formData.append("file", input.file);
  if (input.text) formData.append("text", input.text);
  return authedFormFetch("/api/roles/import/draft", formData);
};

export const assignReportRole = (reportId: string, report: DirectReport, roleLevelId: string | null): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${reportId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: report.name,
      role_title: report.role_title,
      notes: report.notes,
      role_level_id: roleLevelId,
      // PUT replaces the whole record — preserve the report's org unit and
      // cadence override or reassigning a role would silently clear them
      // (Session 11 / Session 38).
      org_unit_id: report.org_unit_id,
      one_on_one_cadence_days: report.one_on_one_cadence_days,
    }),
  });

// ---------------------------------------------------------------------------
// Assessments (Session 16, 2026-08-04) — the ratings/status layer
// PRODUCT_VISION.md calls the load-bearing piece of "Mission Control":
// scoring a direct report against their role's configured expectations
// (Settings > Expectations), not just having them on record.
//
// v1 is the ROLLING assessment (not performance_reviews, which stays
// dormant): an overall level_ordinal snapshot (assessments, scored against
// org-configured assessment_levels) plus per-item scores against every
// configured metric/skill/value. AI can draft scores from recent 1:1s/
// commitments/goals — draft-then-review, same rule as the wrap-up flow
// (Session 8): nothing saves until the manager reviews it. Own top-level
// page (/app/assessments) + a summary on DR detail.
// ---------------------------------------------------------------------------

export type AssessmentLevel = {
  id: string;
  ordinal: number;
  label: string;
};

export const getAssessmentLevels = (): Promise<AssessmentLevel[]> =>
  authedFetch("/api/assessments/levels");

export const renameAssessmentLevel = (ordinal: number, label: string): Promise<AssessmentLevel> =>
  authedFetch(`/api/assessments/levels/${ordinal}`, { method: "PUT", body: JSON.stringify({ label }) });

export type TeamAssessmentItem = {
  id: string;
  name: string;
  role_title: string | null;
  latest_level_ordinal: number | null;
  latest_level_label: string | null;
  assessed_at: string | null;
};

export const getTeamAssessments = (): Promise<TeamAssessmentItem[]> => authedFetch("/api/assessments");

export type ScaleDefinition = {
  evaluation_point: number;
  evaluation_name: string | null;
  description: string | null;
  quantitative_output: string | null;
  qualitative_output: string | null;
};

// Shape of the latest recorded score for a skill/value config.
export type LatestSkillValueScore = {
  evaluation_point: number;
  notes: string | null;
  assessed_at: string;
};

// Shape of the latest recorded entry for a metric config.
export type LatestMetricEntry = {
  value: number;
  period: string | null;
  recorded_at: string;
};

export type ScoredItem = {
  config_id: string;
  name: string;
  order_type: "primary" | "secondary" | "tertiary" | null;
  description: string | null;
  expectation: string | null; // skills/metrics
  measurement_period: string | null; // metrics only
  value_type: "team" | "company" | "department" | null; // values only
  scale_min: number;
  scale_max: number;
  scale_definitions: ScaleDefinition[];
  // null for metrics (no prior entry), or a skill/value score, or a metric
  // entry — narrow on which array this item came from to know the shape.
  latest: (LatestSkillValueScore | LatestMetricEntry) | null;
};

export type OverallAssessment = {
  id: string;
  level_ordinal: number;
  notes: string | null;
  created_at: string;
};

export type Scorecard = {
  direct_report: { id: string; name: string; role_title: string | null; role_level_id: string | null };
  role: Pick<RoleLevel, "id" | "job_role" | "job_level" | "functional_team" | "job_responsibilities"> | null;
  skills: ScoredItem[];
  values: ScoredItem[];
  metrics: ScoredItem[];
  overall: OverallAssessment | null;
  levels: AssessmentLevel[];
};

export const getScorecard = (directReportId: string): Promise<Scorecard> =>
  authedFetch(`/api/assessments/${directReportId}`);

// ---------------------------------------------------------------------------
// Single-project GET — added Session 32 for the Scribe confirm handler
// (link_project_goal draft needs to fetch then PUT with goal_id).
// ---------------------------------------------------------------------------

export const getProject = (id: string): Promise<Project> =>
  authedFetch(`/api/projects/${id}`);

// ---------------------------------------------------------------------------
// Scribe (The Same Page conversational agent) — Sessions 32–33 (S3)
// POST /api/assistant/message: one conversational turn → {text, drafts}
//   Thread is now server-managed (stored in assistant_messages table);
//   the client no longer passes the full thread.
// GET  /api/assistant/thread: load stored thread for drawer hydration
// ---------------------------------------------------------------------------

export type DraftEntityType =
  | "project"
  | "goal"
  | "link_project_goal"
  | "check_in"
  | "commitment"
  | "direct_report";

export type DraftEntity = {
  entity_type: DraftEntityType;
  payload: Record<string, unknown>;
  display?: Record<string, string>;
  draft_id?: string;
  status?: "pending" | "confirming" | "confirmed" | "discarded" | "superseded" | "undone";
  replaces_draft_id?: string;
  receipt_entity_id?: string;
  receipt_entity_type?: DraftEntityType;
  receipt_label?: string;
  receipt_href?: string;
};

export type AssistantResponse = {
  text: string;
  drafts: DraftEntity[];
};

export type AssistantPageContext = {
  label: string;
  entity_type?: "direct_report" | "project";
  entity_id?: string;
};

// Shape returned by GET /api/assistant/thread
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  drafts: DraftEntity[] | null;
  created_at: string;
};

export const getAssistantThread = (): Promise<StoredMessage[]> =>
  authedFetch("/api/assistant/thread");

export const clearAssistantThread = (): Promise<{ ok: boolean }> =>
  authedFetch("/api/assistant/thread", { method: "DELETE" });

export const updateAssistantDraft = (
  draftId: string,
  update: {
    status: "pending" | "confirming" | "confirmed" | "discarded" | "undone";
    receipt_entity_id?: string;
    receipt_entity_type?: DraftEntityType;
    receipt_label?: string;
    receipt_href?: string;
  },
): Promise<DraftEntity> =>
  authedFetch(`/api/assistant/drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });

// pageContext: human-readable label for the page the drawer is currently on
// (e.g. "Jordan's direct report page"). Injected into the agent system prompt
// ephemerally so pronouns resolve correctly. Not stored in the DB.
export const sendAssistantMessage = (
  message: string,
  pageContext?: AssistantPageContext,
): Promise<AssistantResponse> =>
  authedFetch("/api/assistant/message", {
    method: "POST",
    body: JSON.stringify({
      message,
      page_context: pageContext?.label ?? null,
      page_context_entity_type: pageContext?.entity_type ?? null,
      page_context_entity_id: pageContext?.entity_id ?? null,
    }),
  });

// AI-drafted scores — reviewed/edited by the manager before saveAssessment.
// Sparse by design: the AI only includes items the evidence supports.
export type AssessmentDraft = {
  overall: { level_ordinal: number; notes: string } | null;
  skills: { config_id: string; evaluation_point: number; notes: string }[];
  values: { config_id: string; evaluation_point: number; notes: string }[];
  metrics: { config_id: string; value: number; period: string | null; notes: string }[];
};

export const draftAssessment = (directReportId: string): Promise<AssessmentDraft> =>
  authedFetch(`/api/assessments/${directReportId}/draft`, { method: "POST" });

export type SaveAssessmentBody = {
  overall?: { level_ordinal: number; notes?: string | null } | null;
  skills?: { config_id: string; evaluation_point: number; notes?: string | null }[];
  values?: { config_id: string; evaluation_point: number; notes?: string | null }[];
  metrics?: { config_id: string; value: number; period?: string | null }[];
};

export const saveAssessment = (directReportId: string, body: SaveAssessmentBody): Promise<unknown> =>
  authedFetch(`/api/assessments/${directReportId}`, { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Development plans (Session 47, 2026-08-20) — see the development_scoping
// project memory note. Individual plans only here (team-level "training
// focus" is TeamDevFocus above); placement is a section on the direct
// report detail page, no dedicated top-level page. Activates the dormant
// development_plans/dev_plan_* tables — see backend/routes/development.py's
// docstring for the full scoping context.
// ---------------------------------------------------------------------------

export type DevelopmentPlan = {
  id: string;
  direct_report_id: string;
  status: "active" | "completed" | "archived";
  // Freeform plan narrative (Session 49) — the primary, always-writable
  // surface for building the plan itself. Distinct from DevManagerNote
  // below, which is a separate, append-only, private log.
  plan_text: string | null;
  created_at: string;
  updated_at: string;
};

export type Aspiration = {
  id: string;
  development_plan_id: string;
  desired_role: string | null;
  timeline: string | null;
  notes: string | null;
  updated_at: string;
};

export type OpportunityType = "skill" | "knowledge";

export type Opportunity = {
  id: string;
  development_plan_id: string;
  type: OpportunityType;
  description: string;
  // Trace back to the assessment item that prompted this (Andrew's
  // "connect to assessment scores" scoping decision) — null for manually
  // added opportunities.
  source_kind: "skill" | "value" | null;
  source_config_id: string | null;
  created_at: string;
};

export type TrainingItem = {
  id: string;
  development_plan_id: string;
  description: string;
  completion_date: string | null;
  projected_cost: number | null;
  created_at: string;
};

export type DevManagerNote = {
  id: string;
  development_plan_id: string;
  content: string;
  created_at: string;
};

// A skill/value from this person's role expectations whose latest recorded
// assessment score sits at or below the midpoint of its own scale — the
// evidence base for "suggested from assessment" prompts in the UI and for
// the AI draft below. See development.py's _fetch_low_scoring_items.
export type LowScoringItem = {
  kind: "skill" | "value";
  config_id: string;
  name: string;
  description: string | null;
  evaluation_point: number;
  scale_min: number;
  scale_max: number;
};

export type DevelopmentBundle = {
  development_plan: DevelopmentPlan;
  aspiration: Aspiration | null;
  opportunities: Opportunity[];
  training: TrainingItem[];
  manager_notes: DevManagerNote[];
  low_scoring_items: LowScoringItem[];
};

export const getDevelopmentPlan = (directReportId: string): Promise<DevelopmentBundle> =>
  authedFetch(`/api/development/${directReportId}`);

// Session 49: the plan's freeform narrative — upserted in place, unlike
// createDevManagerNote's append-only log below.
export const updateDevPlanText = (directReportId: string, text: string | null): Promise<{ plan_text: string | null }> =>
  authedFetch(`/api/development/${directReportId}/plan`, { method: "PUT", body: JSON.stringify({ text }) });

export const upsertAspiration = (
  directReportId: string,
  body: { desired_role?: string | null; timeline?: string | null; notes?: string | null }
): Promise<Aspiration> =>
  authedFetch(`/api/development/${directReportId}/aspiration`, { method: "PUT", body: JSON.stringify(body) });

export const createOpportunity = (
  directReportId: string,
  body: { type: OpportunityType; description: string; source_kind?: "skill" | "value" | null; source_config_id?: string | null }
): Promise<Opportunity> =>
  authedFetch(`/api/development/${directReportId}/opportunities`, { method: "POST", body: JSON.stringify(body) });

export const deleteOpportunity = (opportunityId: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/development/opportunities/${opportunityId}`, { method: "DELETE" });

export const createTraining = (
  directReportId: string,
  body: { description: string; completion_date?: string | null; projected_cost?: number | null }
): Promise<TrainingItem> =>
  authedFetch(`/api/development/${directReportId}/training`, { method: "POST", body: JSON.stringify(body) });

export const updateTraining = (
  trainingId: string,
  body: { description?: string; completion_date?: string | null; projected_cost?: number | null }
): Promise<TrainingItem> =>
  authedFetch(`/api/development/training/${trainingId}`, { method: "PATCH", body: JSON.stringify(body) });

export const deleteTraining = (trainingId: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/development/training/${trainingId}`, { method: "DELETE" });

export const createDevManagerNote = (directReportId: string, content: string): Promise<DevManagerNote> =>
  authedFetch(`/api/development/${directReportId}/notes`, { method: "POST", body: JSON.stringify({ content }) });

// AI-drafted opportunities + a synthesis note — reviewed by the manager
// before createOpportunity/updateDevPlanText persist whatever survives
// review. Sparse by design, same restraint as AssessmentDraft. plan_note
// (Session 49, was manager_note) targets the plan-text box, not manager
// notes — those are a separate, unrelated concept.
export type DevelopmentDraft = {
  opportunities: {
    type: OpportunityType;
    description: string;
    source_kind: "skill" | "value" | null;
    source_config_id: string | null;
  }[];
  plan_note: string | null;
};

export const draftDevelopment = (directReportId: string): Promise<DevelopmentDraft> =>
  authedFetch(`/api/development/${directReportId}/draft`, { method: "POST" });

// Follow-up (Session 48): draftDevelopment() is evidence-gated by design
// and can come back empty — Andrew hit that dead end immediately with a
// report that had no assessment/1:1 history yet. reviseDevText is the
// always-answerable counterpart: takes text the manager already wrote
// (either the plan-text box or a manager note — the backend doesn't care
// which) and returns an improved/expanded version, grounded in evidence
// when it exists but never blocked by its absence.
export const reviseDevText = (directReportId: string, text: string): Promise<{ note: string }> =>
  authedFetch(`/api/development/${directReportId}/notes/revise`, { method: "POST", body: JSON.stringify({ text }) });

// ---------------------------------------------------------------------------
// Context Engine (Session 28 upload/extraction, Session III confirm-card) —
// see docs/CONTEXT_ENGINE.md (framework) and docs/CONTEXT_ENGINE_BUILD_PLAN.md
// (build plan). Own top-level page (/app/context, "the Space"). The
// Librarian proposes category/freshness/effective_date/summary_card/
// novelty on upload; scope + any corrections are confirmed by the user
// here, per the framework doc's "scope is user-confirmed, not an AI-only
// proposal" rule.
// ---------------------------------------------------------------------------

export type DocumentCategory =
  | "where_we_are_going"
  | "who_we_are_and_how_we_operate"
  | "who_we_serve"
  | "what_we_offer"
  | "how_people_grow_here";

export type DocumentFreshnessClass = "evergreen" | "dated" | "stream_instance";
export type DocumentStatus = "processing" | "pending_review" | "confirmed" | "failed";
export type DocumentFileType = "pptx" | "pdf" | "text";

export type DocumentScope = {
  id?: string;
  document_id?: string;
  // null = company-wide (org_units has no "company" row — see org_units.py).
  org_unit_id: string | null;
};

export type Document = {
  id: string;
  title: string;
  file_type: DocumentFileType;
  status: DocumentStatus;
  category: DocumentCategory | null;
  freshness_class: DocumentFreshnessClass | null;
  effective_date: string | null;
  summary_card: string | null;
  novelty_score: number | null;
  series_id: string | null;
  confirmed_at: string | null;
  // Only present on rows fetched after a confirm — captured as a future
  // training signal (docs/CONTEXT_ENGINE.md), not read by anything yet.
  confirmed_as_is?: boolean | null;
  correction_log?: Record<string, { proposed: unknown; confirmed: unknown }> | null;
  created_at: string;
  // Only present on POST /confirm's response, not the list endpoint.
  scopes?: DocumentScope[];
};

export const getDocuments = (params?: { status?: DocumentStatus }): Promise<Document[]> => {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return authedFetch(`/api/documents${qs ? `?${qs}` : ""}`);
};

export const uploadDocument = (file: File, title?: string): Promise<Document> => {
  const formData = new FormData();
  formData.append("file", file);
  if (title?.trim()) formData.append("title", title.trim());
  return authedFormFetch("/api/documents/upload", formData);
};

export type DocumentConfirmIn = {
  category: DocumentCategory;
  freshness_class: DocumentFreshnessClass;
  effective_date?: string | null;
  // At least one entry required — null means company-wide. See
  // backend/routes/documents.py's confirm_document for why an empty list
  // is rejected (a scopeless confirmed doc would be invisible to Session
  // IV's retrieval cascade).
  org_unit_ids: (string | null)[];
};

export const confirmDocument = (id: string, body: DocumentConfirmIn): Promise<Document> =>
  authedFetch(`/api/documents/${id}/confirm`, { method: "PUT", body: JSON.stringify(body) });

export const deleteDocument = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/documents/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Context Engine — the Brain (Session V) + staleness/precedence surfacing
// (Session VI, docs/CONTEXT_ENGINE_BUILD_PLAN.md). One coverage-map entry
// per category — fill (decay-weighted novelty of the best confirmed doc,
// never count-weighted), the confirmed docs behind it for the click-through,
// a static first-person gap question, recent citation credit flow-back, and
// (Session VI) a proactive staleness prompt when the fill-driving doc has
// aged past a threshold — plus a top-level list of cross-doc scope
// conflicts (same category, overlapping scope, disagreeing effective
// dates — flagged, never auto-resolved). See backend/context_engine.py's
// compute_category_coverage() / find_scope_conflicts() for the scoring.
//
// Response shape changed in Session VI: was a bare CategoryCoverage[]
// (Session V), now { categories, conflicts } — conflicts span category
// pairs so they don't nest under any single category.
// ---------------------------------------------------------------------------

export type CoverageDocument = {
  id: string;
  title: string;
  freshness_class: DocumentFreshnessClass | null;
  effective_date: string | null;
  summary_card: string | null;
  novelty_score: number | null;
  // Decay-weighted novelty_score as of "now" — what actually drove
  // fill_score / this doc's position in the list, not the raw novelty
  // score the Librarian originally proposed.
  decayed_score: number;
  citations_this_week: number;
};

export type CategoryCoverage = {
  category: DocumentCategory;
  label: string;
  fill_score: number; // 0-100
  doc_count: number;
  citations_this_week: number;
  gap_question: string;
  // Session VI — null unless the category's fill-driving doc has decayed
  // past the staleness threshold. A proactive Librarian nudge, not an error
  // state; render it, don't treat its presence as something broken.
  staleness_prompt: string | null;
  documents: CoverageDocument[];
};

// Session VI — one entry per conflicting PAIR of confirmed docs (same
// category, overlapping scope, disagreeing effective_date). `message` is
// pre-formatted Librarian-voice copy, ready to render as-is.
export type CoverageConflict = {
  category: DocumentCategory;
  category_label: string;
  doc_a: { id: string; title: string; effective_date: string };
  doc_b: { id: string; title: string; effective_date: string };
  more_recent_id: string;
  more_specific_id: string | null;
  // True when the MORE SPECIFIC doc is also the OLDER one — the framework
  // doc's own "your strategy doc predates the pivot" tension, where the two
  // precedence rules (specificity wins vs. recency wins) point different
  // directions.
  specificity_disagrees_with_recency: boolean;
  message: string;
};

export type ContextCoverage = {
  categories: CategoryCoverage[];
  conflicts: CoverageConflict[];
};

export const getContextCoverage = (): Promise<ContextCoverage> => authedFetch("/api/documents/coverage");

// --- dictation --------------------------------------------------------------
// Talk-to-text. A single recorded blob in, the manager's own words out.
// Nothing is saved by this call: the transcript goes back into whatever field
// the mic was used in, and that field's normal save endpoint is still the only
// thing that writes. See components/NoteField.tsx and docs/systems/dictation.md.
export const transcribeAudio = (blob: Blob, vocabulary = ""): Promise<{ text: string }> => {
  const form = new FormData();
  // The filename extension is cosmetic — the backend derives the real format
  // from the blob's MIME type, because Safari and Chrome disagree about both.
  form.append("file", blob, "dictation");
  if (vocabulary) form.append("vocabulary", vocabulary);
  return authedFormFetch("/api/transcribe", form);
};
