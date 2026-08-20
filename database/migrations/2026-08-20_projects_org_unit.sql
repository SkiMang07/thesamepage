-- Projects gain an explicit team (Session 46, 2026-08-20) — see the
-- team_project_goal_hierarchy project memory note for the scoping
-- conversation.
--
-- projects.py's original docstring (Session 13) deliberately left projects
-- without their own org_unit_id: "if a project needs independent scope
-- later ... org_unit_id/level can be added then." This is that later.
-- Andrew wants to attach a project directly to a team/department, same
-- mechanism goals already have (Session 11), so /app/team's Initiatives
-- card can filter by team instead of proxying through the assignee's own
-- org_unit_id.

alter table projects
  add column org_unit_id uuid references org_units(id) on delete set null;

-- Backfill: without this, every existing project would silently vanish
-- from any specific team's filter on /app/team the moment this ships,
-- since Session 45's assignee-proxy filtering goes away in favor of this
-- explicit column. Inherit each project's current org_unit_id from its
-- assignee, same one-time-backfill posture as Session 40's role_families
-- migration (backfill once, let managers reassign by hand after).
update projects p
set org_unit_id = dr.org_unit_id
from direct_reports dr
where p.direct_report_id = dr.id
  and p.org_unit_id is null
  and dr.org_unit_id is not null;
