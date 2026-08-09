-- ============================================================
-- Team callouts (Session 24, 2026-08-09 — /app/team layout rework; see
-- docs/SESSION_HISTORY.md and the team_page_redesign_options project memory
-- note for the scoping conversation).
--
-- Depends on 2026-08-09_team_agenda_and_commitments.sql already having been
-- run (confirmed live before this migration was written).
--
-- This is "key updates" — the manager-authored broadcast idea scoped and
-- then explicitly deferred in both Session 22 and Session 23 — revived here
-- deliberately small: ONE text block per manager (unique on manager_id),
-- overwritten in place on every edit. Not a dated log like
-- team_meeting_notes — no history, no per-line CRUD. The frontend splits
-- the message on newlines to render bullets.
--
-- Run once in the Supabase SQL editor.
-- ============================================================

create table team_callouts (
  id          uuid primary key default uuid_generate_v4(),
  manager_id  uuid not null unique references auth.users(id),
  message     text not null default '',
  updated_at  timestamptz not null default now()
);

alter table team_callouts enable row level security;

-- manager-scoped, same pattern as team_messages/team_meeting_notes
create policy "team_callouts_all_own" on team_callouts
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
