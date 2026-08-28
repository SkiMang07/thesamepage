-- ============================================================
-- 1:1s: the meeting date becomes a real, editable value.
--
-- one_on_ones had no answer to "when did this conversation happen".
-- scheduled_at held the planned date, created_at held the moment the row
-- was inserted, and history rendered `scheduled_at || created_at` and
-- called the result a meeting date. That held up while every meeting was
-- prepped first. It broke the moment a past conversation was logged from
-- /app/reports/[id]/log: that path completes the person's existing
-- unfinished workspace, so the conversation inherited the date the
-- workspace shell happened to be created on. A 1:1 held on the 26th filed
-- itself under the 2nd, "Last met" disagreed with History on the same
-- page, /overview kept the person flagged overdue, and _build_prep_prompt
-- opened the next sheet with "it has been 26 days since the last 1:1"
-- about a conversation logged four minutes earlier.
--
-- No new date column. scheduled_at IS the meeting date, exactly as
-- team_meetings has used it since 2026-08-24: the date orders meetings and
-- never derives status. logged_at joins it here for the same reason it
-- exists there, so there is an honest home for "when the write-up was
-- saved" and created_at is never read as a meeting date again.
-- ============================================================

alter table one_on_ones
  add column if not exists logged_at timestamptz;

-- ------------------------------------------------------------
-- Backfill.
--
-- A completed row that never carried a planned date gets created_at as the
-- best available evidence, normalised to the noon-UTC encoding every date
-- in this app uses so the calendar day is stable in every timezone. Rows
-- that already have a scheduled_at keep it: a manager set that value on the
-- prep sheet, which is better evidence than row creation.
--
-- Only completed rows are touched. An unfinished undated workspace stays
-- undated and keeps its derived "gathering" status. Re-running is safe.
--
-- Known imprecision, accepted: a row created late in the manager's evening
-- carries the next UTC calendar day, so its backfilled date can land one day
-- ahead of the day they were actually working. It applies to legacy rows
-- only -- every row written after this migration carries a date the manager
-- confirmed on the review screen -- and a one-day skew on old history beats
-- leaving the column null and keeping the created_at fallback alive.
-- ------------------------------------------------------------
update one_on_ones
   set scheduled_at = ((created_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC'
 where summary is not null
   and scheduled_at is null;

update one_on_ones
   set logged_at = created_at
 where summary is not null
   and logged_at is null;
