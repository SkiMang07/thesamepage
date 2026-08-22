-- ============================================================
-- Direct-report capture notes (Session 50, 2026-08-21 — Person Page
-- "Command Deck" rework; see docs/SESSION_HISTORY.md and the
-- person_page_redesign project memory note for the scoping conversation).
--
-- The new /app/reports/[id] cockpit column gets a between-sessions capture
-- box: quick freeform jots (something worth remembering, unprompted, not
-- during a formal prep pass) that should show up automatically the next
-- time the manager preps for this person. Deliberately its own small inbox
-- table rather than a column on one_on_ones — a capture can happen whether
-- or not a "planned" session (prep_guide set) exists yet, and a planned
-- session today is only ever created BY /prep, never before it. See
-- backend/routes/one_on_ones.py's capture endpoints and frontend/app/app/
-- reports/[id]/prep/page.tsx, which prefills step 1's raw-notes box from
-- these rows and deletes them once a prep sheet is generated (their content
-- is folded into that sheet at that point, so nothing is lost by clearing
-- the inbox).
--
-- manager_id = the writing manager's auth.uid() (RLS scopes through it),
-- same flat pattern as commitments — no nested-table lookup, avoiding the
-- RLS recursion class of bug documented in the rls_recursion project memory
-- note (that was specifically about policies that subquery `users`; this
-- table doesn't need to).
--
-- Run once in the Supabase SQL editor.
-- ============================================================

create table dr_capture_notes (
  id                uuid primary key default uuid_generate_v4(),
  manager_id        uuid not null references auth.users(id),
  direct_report_id  uuid not null references direct_reports(id) on delete cascade,
  content           text not null,
  created_at        timestamptz not null default now()
);

alter table dr_capture_notes enable row level security;

create index dr_capture_notes_report_idx on dr_capture_notes (direct_report_id, created_at desc);

create policy "dr_capture_notes_all_own" on dr_capture_notes
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
