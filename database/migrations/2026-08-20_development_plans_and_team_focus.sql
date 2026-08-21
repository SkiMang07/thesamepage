-- ============================================================
-- Session 47 (2026-08-20) — Development / Career Plans
-- See docs/SESSION_HISTORY.md and the development_scoping project memory
-- note for the scoping conversation. Scoped via AskUserQuestion: individual
-- plans (activating the dormant development_plans/dev_plan_* tables from
-- the original schema scaffold, same "dormant table, just needs activating"
-- pattern as Goals/Assessments/Capacity) + a lightweight team-level
-- "training focus" note, AI-assisted opportunity drafting grounded in
-- assessment scores, placement as a section on the direct report detail
-- page (no new top-level nav item).
-- ============================================================

-- dev_plan_aspirations was created (original scaffold) without a unique
-- constraint on development_plan_id even though the app treats it as a
-- single "current aspiration" per plan (desired role + timeline + notes,
-- upserted as one unit — same one-row-per-key shape as capacity_profiles).
-- Add the constraint now, before any real data exists, so a future race
-- (double-submit, etc.) can't silently create two competing rows the UI
-- would have no way to reconcile.
create unique index if not exists dev_plan_aspirations_plan_uq
  on dev_plan_aspirations (development_plan_id);

-- dev_plan_opportunities gains an optional trace back to the assessment
-- item that prompted it (Andrew's "connect to assessment scores" scoping
-- decision). Nullable — manually-added opportunities (the majority in v1,
-- before AI drafting is dogfooded) have neither. source_kind is 'skill' or
-- 'value' (metrics are numeric time-series, not a natural "opportunity"
-- source); source_config_id points at skill_configs.id or value_configs.id
-- depending on source_kind — no FK since it's one of two possible tables,
-- same "no cross-table FK, app-layer validated" posture as
-- commitments.source_type/source_id.
alter table dev_plan_opportunities
  add column if not exists source_kind text check (source_kind in ('skill', 'value')),
  add column if not exists source_config_id uuid;

-- ============================================================
-- TEAM DEV FOCUS
-- Lightweight team-level counterpart to individual development plans —
-- "this month's training focus" for a team, not a full plan. Deliberately
-- the smallest possible shape: mirrors team_callouts exactly (Session 24,
-- widened Session 45 for the org_unit_id per-team split) rather than a new
-- relational model — one pinned, manager-authored text block per
-- (manager, org_unit) pair, overwritten in place on each edit, no history.
-- Kept as its own table rather than reusing team_callouts so the two
-- concepts (general "key updates" vs. a training/development focus) don't
-- collide in one text block or one UI panel.
-- ============================================================

create table if not exists team_dev_focus (
  id           uuid primary key default uuid_generate_v4(),
  manager_id   uuid not null references auth.users(id),
  message      text not null default '',
  org_unit_id  uuid references org_units(id) on delete cascade,
  updated_at   timestamptz not null default now()
);

alter table team_dev_focus enable row level security;

create unique index if not exists team_dev_focus_manager_unit_uq
  on team_dev_focus (manager_id, org_unit_id)
  where org_unit_id is not null;

create unique index if not exists team_dev_focus_manager_all_teams_uq
  on team_dev_focus (manager_id)
  where org_unit_id is null;

create policy "team_dev_focus_all_own" on team_dev_focus
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
