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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DirectReport = {
  id: string;
  name: string;
  role_title: string | null;
  notes: string | null;
  role_level_id?: string | null;
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
// `projects` stays dormant; no rollup/status calculation yet (status is
// manually set).
// ---------------------------------------------------------------------------

export type GoalLevel = "company" | "department" | "team" | "individual";
export type GoalStatus = "active" | "on_track" | "at_risk" | "completed" | "cancelled";

export type Goal = {
  id: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  due_date: string | null;
  direct_report_id: string | null;
  direct_report_name?: string | null;
  parent_goal_id: string | null;
  // Only populated when the parent goal is present in the same fetched
  // result set — see goals.py's _shape_rows.
  parent_goal_title?: string | null;
  created_at: string;
};

export type GoalIn = {
  title: string;
  description?: string | null;
  level: GoalLevel;
  status?: GoalStatus;
  due_date?: string | null;
  direct_report_id?: string | null;
  parent_goal_id?: string | null;
};

export const getGoals = (params?: { level?: GoalLevel; directReportId?: string; status?: GoalStatus }): Promise<Goal[]> => {
  const q = new URLSearchParams();
  if (params?.level) q.set("level", params.level);
  if (params?.directReportId) q.set("direct_report_id", params.directReportId);
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
    }),
  });
