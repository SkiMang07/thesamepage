-- Session 8 (2026-08-01): commitments can be owed by either side of the 1:1.
--
-- The wrap-up flow extracts commitments from call notes for BOTH people:
-- "I'll send the intro" (manager) and "Leah will draft the QBR deck" (report).
-- committed_by records who owes the item. owner_id stays the manager — they
-- remain the record-keeper and RLS continues to scope through it unchanged.
--
-- Existing rows were all manager-made promises, so the default backfills them
-- correctly.
--
-- Run once in the Supabase SQL editor.

alter table commitments
  add column if not exists committed_by text not null default 'manager'
    check (committed_by in ('manager', 'direct_report'));
