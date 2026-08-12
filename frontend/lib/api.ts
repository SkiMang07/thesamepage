// All calls to the FastAPI backend go through here — same convention as
// Prism Tree's frontend/src/lib/api.ts. Add new backend calls to this file
// rather than calling fetch() ad hoc from components.
import { createClient } from "./supabase";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

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

  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
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

  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DirectReport = {
  id: string;
  name: string;
  role_title: string | null;
  notes: string | null;
  role_level_id?: string | null;
  // Session 11: which team/department this report structurally sits in.
  // Separate from role_level_id (their job/comp band). Resolve the display
  // name client-side against a loaded OrgUnit[] list, same pattern as
  // role_level_id -> RoleLevel in Settings.
  org_unit_id?: string | null;
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
// never set directly. planned: prepped, meeting hasn't happened yet
// (prep_guide set, summary null). completed: logged (summary set).
export type SessionStatus = "planned" | "completed";

export type PrepGuide = {
  situation_summary: string;
  agenda_items: AgendaItem[];
  open_commitments_to_check: Pick<Commitment, "description" | "due_date" | "committed_by">[];
};

export type OneOnOne = {
  id: string;
  direct_report_id: string;
  summary: string | null;
  notes?: string | null;
  prep_guide?: PrepGuide | null;
  created_at: string;
  status: SessionStatus;
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
  // The prep endpoint returns only these fields per commitment.
  open_commitments_to_check: Pick<Commitment, "description" | "due_date" | "committed_by">[];
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
};

// ---------------------------------------------------------------------------
// Direct reports
// ---------------------------------------------------------------------------

export const getDirectReports = (): Promise<DirectReport[]> =>
  authedFetch("/api/direct-reports");

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

export const createDirectReport = (body: { name: string; role_title?: string; notes?: string }): Promise<DirectReport> =>
  authedFetch("/api/direct-reports", { method: "POST", body: JSON.stringify(body) });

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
  created_at: string;
} & CheckInDerived;

export type ProjectIn = {
  title: string;
  description?: string | null;
  status?: ProjectStatus;
  due_date?: string | null;
  direct_report_id?: string | null;
  goal_id?: string | null;
};

export const getProjects = (params?: { directReportId?: string; goalId?: string; status?: ProjectStatus }): Promise<Project[]> => {
  const q = new URLSearchParams();
  if (params?.directReportId) q.set("direct_report_id", params.directReportId);
  if (params?.goalId) q.set("goal_id", params.goalId);
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
// unit setup live in Settings > Capacity ("configured once"); per-person
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
// for why department/individual are excluded here.
export type TeamGoal = {
  id: string;
  title: string;
  level: GoalLevel;
  status: GoalStatus;
  due_date: string | null;
  org_unit_id: string | null;
  org_unit_name: string | null;
};

export const getTeamGoals = (): Promise<TeamGoal[]> => authedFetch("/api/team/goals");

// meeting_date (Session 23) is optional/nullable — set to today-or-later to
// make this note the surfaced "next meeting's agenda"; null means it's a
// logged past meeting. Derived client-side, not a stored status field.
export type TeamNote = {
  id: string;
  note: string;
  meeting_date: string | null;
  created_at: string;
};

export const getTeamNotes = (): Promise<TeamNote[]> => authedFetch("/api/team/notes");

export const createTeamNote = (note: string, meetingDate?: string | null): Promise<TeamNote> =>
  authedFetch("/api/team/notes", {
    method: "POST",
    body: JSON.stringify({ note, meeting_date: meetingDate ?? null }),
  });

// Team-level commitments (Session 23) — same Commitment shape as the
// Commitments section above; is_team_commitment is what puts a row on this
// list, not a different table. Marking one done/dropped reuses
// updateCommitment above — the flag doesn't change how a commitment
// resolves, only where it's visible.
export type TeamCommitment = Commitment;

export const getTeamCommitments = (): Promise<TeamCommitment[]> => authedFetch("/api/team/commitments");

export const createTeamCommitment = (body: {
  directReportId: string;
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
// dated history log (unlike team_meeting_notes). Each line the manager
// writes renders as its own bullet on the page. See team.py's
// get_team_callout/update_team_callout and the team_page_redesign_options
// project memory note.
export type TeamCallout = {
  message: string;
  updated_at: string | null;
};

export const getTeamCallout = (): Promise<TeamCallout> => authedFetch("/api/team/callout");

export const updateTeamCallout = (message: string): Promise<TeamCallout> =>
  authedFetch("/api/team/callout", { method: "PUT", body: JSON.stringify({ message }) });

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

// Dismiss a planned session that isn't going to happen. Refuses (400) on a
// completed session — that's real history, not a stub to clean up.
export const deleteOneOnOne = (id: string): Promise<{ deleted: boolean }> =>
  authedFetch(`/api/one-on-ones/session/${id}`, { method: "DELETE" });

export const prepOneOnOne = (body: { direct_report_id: string; raw_notes: string }): Promise<PrepResponse> =>
  authedFetch("/api/one-on-ones/prep", { method: "POST", body: JSON.stringify(body) });

// Raw call notes → AI-drafted summary + commitments (both sides). Draft only —
// nothing is saved until logOneOnOne.
export const wrapUpOneOnOne = (body: { direct_report_id: string; raw_notes: string }): Promise<WrapUpDraft> =>
  authedFetch("/api/one-on-ones/wrapup", { method: "POST", body: JSON.stringify(body) });

export const logOneOnOne = (body: {
  direct_report_id: string;
  summary: string;
  notes?: string;
  new_commitments?: WrapUpCommitment[];
  // Set when this meeting was prepped: fills in the existing planned row
  // instead of creating a second one. Omitted for ad-hoc logs.
  one_on_one_id?: string;
}): Promise<OneOnOne> =>
  authedFetch("/api/one-on-ones", { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Settings (Session 6) — Profile & Company, Roles & Levels, Expectations
// ---------------------------------------------------------------------------

export type Profile = {
  email: string;
  full_name: string;
  company_name: string;
  org_ready: boolean;
};

export type RoleLevel = {
  id: string;
  job_role: string;
  job_level: number;
  functional_team: string | null;
  job_responsibilities: string | null;
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

export const updateProfile = (body: { full_name: string; company_name: string }): Promise<Profile> =>
  authedFetch("/api/settings/profile", { method: "PUT", body: JSON.stringify(body) });

export const getRoleLevels = (): Promise<RoleLevel[]> => authedFetch("/api/settings/role-levels");

export type RoleLevelIn = {
  job_role: string;
  job_level?: number;
  functional_team?: string;
  job_responsibilities?: string;
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

export const assignReportRole = (reportId: string, report: DirectReport, roleLevelId: string | null): Promise<DirectReport> =>
  authedFetch(`/api/direct-reports/${reportId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: report.name,
      role_title: report.role_title,
      notes: report.notes,
      role_level_id: roleLevelId,
      // PUT replaces the whole record — preserve the report's org unit or
      // reassigning a role would silently clear their team (Session 11).
      org_unit_id: report.org_unit_id,
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
