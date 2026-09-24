-- ============================================================
-- Team commitments get a team of their own.
--
-- Before this, /app/team derived a commitment's team from its assignee's
-- direct_reports.org_unit_id. A commitment the manager owns ("You", null
-- direct_report_id) had no team to derive, so it showed under EVERY team —
-- and most of what a team meeting produces is the manager's own work, so
-- LATAM GTM's list filled up with other teams' commitments.
--
-- commitments.org_unit_id is the team a commitment belongs to. Null means
-- no team recorded; the team page then falls back to the assignee's team,
-- and a null-with-no-assignee row shows only under "All teams".
--
-- Backfill, in order:
--   1. Rows logged from a team meeting take that meeting's team.
--   2. Remaining team commitments with an assignee take the assignee's team.
-- Manual "You" rows added from the card before today stay null — nothing
-- records which team they were added under.
-- ============================================================

alter table commitments
  add column if not exists org_unit_id uuid references org_units(id) on delete set null;

update commitments c
set org_unit_id = tm.org_unit_id
from team_meetings tm
where c.org_unit_id is null
  and c.source_type = 'team_meeting'
  and c.source_id = tm.id
  and tm.org_unit_id is not null;

update commitments c
set org_unit_id = dr.org_unit_id
from direct_reports dr
where c.org_unit_id is null
  and c.is_team_commitment
  and c.direct_report_id = dr.id
  and dr.org_unit_id is not null;

create index if not exists commitments_org_unit_idx
  on commitments (org_unit_id) where org_unit_id is not null;
