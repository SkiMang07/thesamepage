-- Migration: Settings page RLS additions (Session 6, 2026-08-01)
-- Run once in the Supabase SQL editor.
--
-- Why: schema.sql gives organizations only a SELECT policy. The Settings
-- page bootstraps an organization the first time the manager saves their
-- profile (users.org_id is null for everyone pre-Settings), which needs
-- INSERT — and editing the company name needs UPDATE.
--
-- Note: settings.py inserts organizations with returning="minimal" because
-- the org isn't linked to the user until the users.org_id update lands, so
-- the SELECT policy would block returning the inserted row.

-- Any authenticated user may create an organization (they immediately link
-- themselves to it; unlinked orgs are invisible to everyone via the
-- existing select policy).
create policy "organizations_insert_authenticated" on organizations
  for insert to authenticated
  with check (true);

-- Members may rename their own organization.
create policy "organizations_update_own" on organizations
  for update
  using (id in (select org_id from users where id = auth.uid()))
  with check (id in (select org_id from users where id = auth.uid()));
