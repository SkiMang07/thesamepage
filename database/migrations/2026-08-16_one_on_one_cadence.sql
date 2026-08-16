-- ============================================================
-- 1:1 cadence — org default + per-person override (nav rework pass 2,
-- Session 38, 2026-08-16; see docs/ONE_ON_ONES_PAGE_SPEC.md section 3).
--
-- Replaces the hardcoded "21" that previously lived in three places
-- (backend/routes/dashboard.py's _CADENCE_DAYS, one_on_ones.py's prep
-- staleness logic, frontend dashboard/page.tsx's CADENCE_DAYS) with a
-- single resolved value: direct_reports.one_on_one_cadence_days (a
-- specific person's override) -> organizations.one_on_one_cadence_days
-- (the org default, itself defaulting to 21) -> 21 (the hardcoded fallback
-- for a manager with no organization row yet). See
-- backend/utils.py's resolve_cadence_days() for the resolver and
-- GET /api/one-on-ones/overview for where cadence_source ("custom" | "org"
-- | "default") is surfaced.
--
-- A scalar on organizations, not a new settings table: capacity_settings
-- exists as a table because it holds a cluster of related defaults (hours,
-- utilization, off-days); one integer doesn't earn that treatment.
--
-- No new RLS policies needed — organizations already has
-- "organizations_update_own" (scoped by current_org_id()) and
-- direct_reports already has "direct_reports_all_own" (scoped by
-- manager_id = auth.uid()), both covering every column including these new
-- ones (RLS is row-level, not column-level).
--
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================

alter table organizations
  add column if not exists one_on_one_cadence_days int not null default 21;

alter table direct_reports
  add column if not exists one_on_one_cadence_days int;  -- null = inherit org default
