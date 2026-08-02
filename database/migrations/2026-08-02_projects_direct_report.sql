-- Session 13: activate `projects` (goals=what, projects=how — see
-- PRODUCT_VISION.md and ENGINEERING.md). The table has existed since the
-- original 28-table schema (Session 3) but was never given a direct-report
-- linkage or a UI. Adds the one column needed to assign a project to a
-- specific direct report; everything else (goal_id, status, due_date) was
-- already present.
--
-- Run this in the Supabase SQL editor against the live database.

alter table projects
  add column if not exists direct_report_id uuid references direct_reports(id) on delete cascade;
