// ---------------------------------------------------------------------------
// Which records belong to a team scope on /app/team — one implementation,
// shared by the Team page and the team meeting screen so the two can't
// disagree about what a meeting's team "has".
//
// These are the rules the page has shipped with (verified against the code
// 2026-09-25 — docs/systems/team.md → Team scope has the table). They are
// deliberately NOT the broader null-means-everywhere wording older docs used:
//
//   People       the caller's own direct reports, exact org_unit only
//   Projects     selected unit + its ancestors; null-team only under All teams
//   Goals        company goals always; otherwise unit + ancestors
//   Commitments  own org_unit_id, else the assignee's team; neither = All
//                teams only; a null assignee is "You", never "unassigned"
//   Meetings     exact unit, plus null-team (all-teams) meetings
//
// null selectedTeamId is "All teams": everything the manager owns.
// ---------------------------------------------------------------------------

import type {
  DirectReport,
  OrgUnit,
  Project,
  TeamCommitment,
  TeamGoal,
  TeamMeeting,
  TeamMember,
} from "@/lib/api";

// The set of org_unit ids "relevant to" a selected team — itself plus every
// ancestor walking up parent_unit_id, so a department's goal/project also
// shows on every team beneath it. Capped at 20 hops as a cycle guard:
// org_units.py only blocks a unit being its own DIRECT parent, not a deeper
// cycle, so an unguarded walk on bad data could loop forever.
export function ancestorChain(orgUnitId: string, orgUnits: OrgUnit[]): Set<string> {
  const byId = new Map(orgUnits.map((u) => [u.id, u]));
  const chain = new Set<string>();
  let current: string | null | undefined = orgUnitId;
  let hops = 0;
  while (current && !chain.has(current) && hops < 20) {
    chain.add(current);
    current = byId.get(current)?.parent_unit_id;
    hops++;
  }
  return chain;
}

export type TeamScope = {
  teamId: string | null;
  ancestors: Set<string> | null;
  reportTeam: (reportId: string | null | undefined) => string | null;
};

export function makeScope(
  teamId: string | null,
  orgUnits: OrgUnit[],
  directReports: Pick<DirectReport, "id" | "org_unit_id">[]
): TeamScope {
  const teamByReport = new Map(directReports.map((dr) => [dr.id, dr.org_unit_id ?? null]));
  return {
    teamId,
    ancestors: teamId ? ancestorChain(teamId, orgUnits) : null,
    reportTeam: (reportId) => (reportId ? teamByReport.get(reportId) ?? null : null),
  };
}

export function inScopeMember(scope: TeamScope, member: Pick<TeamMember, "id">): boolean {
  return scope.teamId === null || scope.reportTeam(member.id) === scope.teamId;
}

export function inScopeProject(scope: TeamScope, project: Pick<Project, "org_unit_id">): boolean {
  if (scope.teamId === null) return true;
  return project.org_unit_id != null && (scope.ancestors?.has(project.org_unit_id) ?? false);
}

export function inScopeGoal(scope: TeamScope, goal: Pick<TeamGoal, "level" | "org_unit_id">): boolean {
  if (scope.teamId === null) return true;
  return goal.level === "company" || (goal.org_unit_id != null && (scope.ancestors?.has(goal.org_unit_id) ?? false));
}

// The team a commitment belongs to: its own org_unit_id (the meeting it came
// from, or the team it was added under), else the assignee's team. A "You"
// commitment with neither shows only under All teams — it used to show under
// every team, which is how one team's list filled with every other team's work.
export function commitmentTeam(scope: TeamScope, c: Pick<TeamCommitment, "org_unit_id" | "direct_report_id">): string | null {
  return c.org_unit_id ?? scope.reportTeam(c.direct_report_id);
}

export function inScopeCommitment(scope: TeamScope, c: Pick<TeamCommitment, "org_unit_id" | "direct_report_id">): boolean {
  return scope.teamId === null || commitmentTeam(scope, c) === scope.teamId;
}

export function inScopeMeeting(scope: TeamScope, m: Pick<TeamMeeting, "org_unit_id">): boolean {
  return scope.teamId === null || m.org_unit_id === null || m.org_unit_id === scope.teamId;
}

// Inherited = visible under this team only because it belongs to an ancestor.
export function inheritedFrom(scope: TeamScope, orgUnitId: string | null): boolean {
  return scope.teamId !== null && orgUnitId !== null && orgUnitId !== scope.teamId;
}
