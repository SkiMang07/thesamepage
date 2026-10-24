-- ============================================================
-- 1:1 log Undo (2026-10-24)
--
-- Session 4 of docs/CALL_TRANSCRIPTION_BUILD_SCOPING.md: the receipt after
-- Save log carries Undo. A save changes more than the meeting row: it adds
-- commitments, moves the next 1:1's date forward, merges carry-forward
-- topics and may replace the next opening line, and can mark a planned
-- career conversation held. None of that can be rebuilt after the fact, so
-- the save records a before-picture of every row it changed here, and
-- POST /api/one-on-ones/session/{id}/undo-log puts each one back within 30
-- minutes of the save.
--
--   - one_on_ones.log_undo: that before-picture, on the completed meeting.
--     Manager only (one_on_ones has no report policy). Cleared by Undo.
--     Holds row ids, dates, carry-forward topics and the opening line it
--     replaced; never call notes or private notes.
--
-- Idempotent: safe to run twice. Run in the Supabase SQL editor before the
-- push that ships the matching routes/one_on_ones.py.
-- ============================================================

alter table one_on_ones
  add column if not exists log_undo jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'one_on_ones_log_undo_object'
  ) then
    alter table one_on_ones
      add constraint one_on_ones_log_undo_object
      check (log_undo is null or jsonb_typeof(log_undo) = 'object');
  end if;
end $$;
