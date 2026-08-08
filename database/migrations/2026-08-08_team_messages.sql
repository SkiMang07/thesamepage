-- ============================================================
-- Team View — team_messages (Session 21, 2026-08-08; see
-- docs/SESSION_HISTORY.md and the team_space_brainstorm project memory
-- note for the scoping conversation).
--
-- Decisions locked before this file was written:
--   - Team View v1 is a manager's own direct reports only, not an org_unit
--     rollup like role-scoped views — matches Mission Control's scope.
--   - The roster/projects/priorities half of Team View is read-only,
--     assembled from tables that already exist (direct_reports, projects,
--     goals) — no new table needed for that part.
--   - Messaging is the one new piece: a free-text update a manager can log
--     per direct report. STORE-ONLY for v1 — IC login isn't built yet (see
--     direct_reports.user_id in schema.sql), so there is no surface for a
--     report to read this today. Andrew's explicit call over building an
--     email-delivery path this session.
--
-- This file is idempotent-ish (create table / create policy will error on
-- re-run, matching every other migration in this repo) — run once against
-- the live database, same as 2026-08-03_org_unit_leaders.sql.
-- ============================================================

create table team_messages (
  id                uuid primary key default uuid_generate_v4(),
  manager_id        uuid not null references auth.users(id),
  direct_report_id  uuid not null references direct_reports(id) on delete cascade,
  message           text not null,
  created_at        timestamptz not null default now()
);

alter table team_messages enable row level security;

create index team_messages_report_idx on team_messages (direct_report_id, created_at desc);

-- Private to the manager who sent them, same manager-scoped pattern as
-- one_on_ones/assessments.
create policy "team_messages_all_own" on team_messages
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
