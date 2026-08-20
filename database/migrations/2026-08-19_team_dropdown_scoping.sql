-- Team dropdown scoping (Session 45, 2026-08-19) — /app/team gains a team
-- picker for managers/directors who lead more than one org_unit. See the
-- team_dropdown_scoping project memory note for the scoping conversation.
--
-- Dropdown source = org_units.leader_user_id (already exists, Session 15),
-- no new "which teams am I part of" concept needed. What changes here is
-- giving team_meeting_notes and team_callouts a per-team scope to filter by
-- — every other surface on the page (roster, initiatives, goals,
-- commitments) already carries enough org_unit_id signal via
-- direct_reports.org_unit_id / goals.org_unit_id to filter client-side with
-- no schema change.
--
-- org_unit_id null on either table means "applies to all teams" (shown
-- under every specific team's filter, same as a company-level goal) — not
-- "unset"/an error state.

alter table team_meeting_notes
  add column org_unit_id uuid references org_units(id) on delete set null;

-- team_callouts uses ON DELETE CASCADE, not SET NULL like the column above
-- — deliberately different, verified by a local functional test. SET NULL
-- would let deleting an org_unit collide with the all-teams partial unique
-- index below whenever that manager already has both a team-specific
-- callout for the deleted unit AND a separate all-teams callout (the
-- SET NULL would try to write a second null-org_unit_id row and the delete
-- would fail outright). CASCADE just removes that team's callout along with
-- the team — a callout scoped to a team that no longer exists shouldn't
-- silently become the all-teams callout anyway.
alter table team_callouts
  add column org_unit_id uuid references org_units(id) on delete cascade;

-- Callouts move from "one row per manager" to "one row per (manager,
-- org_unit) pair, plus at most one org_unit_id-null row for the all-teams
-- callout." A single composite UNIQUE(manager_id, org_unit_id) constraint
-- would NOT enforce the null case the way we want — Postgres treats every
-- NULL as distinct from every other NULL under a plain unique constraint,
-- so duplicate all-teams callouts could pile up silently. Two partial
-- unique indexes instead: one for the null case, one for everything else.
alter table team_callouts
  drop constraint if exists team_callouts_manager_id_key;

create unique index team_callouts_manager_unit_uq
  on team_callouts (manager_id, org_unit_id)
  where org_unit_id is not null;

create unique index team_callouts_manager_all_teams_uq
  on team_callouts (manager_id)
  where org_unit_id is null;
