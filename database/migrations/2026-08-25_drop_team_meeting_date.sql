-- ============================================================
-- Drop team_meetings.meeting_date — the legacy column from the old
-- one-row-per-note model.
--
-- 2026-08-24's migration kept it deliberately for one migration of overlap:
-- its backfill INFERRED agenda-vs-recap from whether meeting_date was null,
-- and keeping the column meant a wrong inference was still recoverable. That
-- backfill has now been verified against live data, so the column is dead
-- weight — nothing in the backend or frontend reads it.
--
-- The guard is the point of this file. Dropping a column is irreversible, so
-- it refuses if any row still looks like it depends on the old data:
-- scheduled_at is what replaced meeting_date, and a row with a meeting_date
-- but no scheduled_at means the backfill never reached it. Better a loud
-- abort than a silently discarded date.
--
-- Guard and drop live in ONE block on purpose. Split across two statements,
-- a client that doesn't stop on error (plain psql, for one) would run the
-- DROP anyway after the guard raised — the abort has to be in the same
-- atomic unit as the thing it is preventing. Verified by testing the failure
-- path, not by assuming.
--
-- The early return also makes re-running a no-op instead of an error.
-- ============================================================

do $$
declare
  unmigrated int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'team_meetings' and column_name = 'meeting_date'
  ) then
    raise notice 'meeting_date is already gone — nothing to do.';
    return;
  end if;

  execute $q$
    select count(*) from team_meetings
     where meeting_date is not null and scheduled_at is null
  $q$ into unmigrated;

  if unmigrated > 0 then
    raise exception
      'Refusing to drop meeting_date: % row(s) still have a meeting_date but no scheduled_at. Re-run 2026-08-24_team_meetings.sql first.',
      unmigrated;
  end if;

  execute 'alter table team_meetings drop column meeting_date';
  raise notice 'meeting_date dropped.';
end $$;
