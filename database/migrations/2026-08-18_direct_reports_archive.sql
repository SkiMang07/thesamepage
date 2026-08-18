-- Archive, not delete (Session 43, Polish Pass A+B — see
-- docs/TEAM_SETUP_UX_REVIEW.md §7.3 and the team_setup_ux_review project
-- memory note). P1: offboarding a direct report should not torch their
-- history (1:1s, assessments, goals, metric entries all cascade-delete off
-- direct_reports.id today). This is a soft-delete column only — no cascade
-- behavior changes, no UI hard-delete is built on top of this. Archived
-- people keep every row they ever touched; they just stop showing up in
-- rosters, People rows, rollups, capacity, and setup counts. Backend routes
-- (direct_reports.py, dashboard.py, team.py, capacity.py, setup_status.py,
-- assessments.py) filter `archived_at is null` on every listing query as of
-- this session; a specific-report fetch by id (person page, 1:1 prep,
-- scorecard) is deliberately NOT filtered, since an archived person's detail
-- page must stay reachable for that history.
--
-- Run this against the live Supabase database. database/schema.sql has
-- already been updated to match, for future reads.

alter table direct_reports
  add column if not exists archived_at timestamptz null;

-- Cheap index for the "exclude archived" filter every listing query now
-- applies — direct_reports is manager-scoped and small per-manager, but this
-- keeps the common `archived_at is null` predicate free as the table grows.
create index if not exists direct_reports_archived_at_idx on direct_reports (archived_at);
