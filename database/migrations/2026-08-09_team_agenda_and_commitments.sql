-- ============================================================
-- Team Mission Control follow-up (Session 23, 2026-08-09; see
-- docs/SESSION_HISTORY.md and the team_mission_control_followup project
-- memory note for the scoping conversation).
--
-- Depends on 2026-08-08_team_messages.sql and 2026-08-08_team_mission_control.sql
-- already having been run (confirmed live before this migration was written).
--
-- Two independent additions, bundled in one file since both are small
-- column adds with no new tables/policies:
--
--   1. team_meeting_notes.meeting_date (date, nullable) — the "next
--      meeting's agenda" surfacing mechanism. Status is derived, never
--      stored, same pattern as one_on_ones' planned/completed split
--      (see the planned_sessions project memory note): a note whose
--      meeting_date is today-or-future is the surfaced upcoming agenda;
--      a null or past meeting_date means it's a logged past meeting.
--      Existing rows all get null, which correctly reads as "already
--      logged" (they predate this column, so they were never anything
--      but a same-day log entry).
--
--   2. commitments.is_team_commitment (boolean, default false) — lets a
--      commitment assigned to one direct report (direct_report_id,
--      unchanged) also surface on Team Mission Control's team-wide
--      commitments list. Purely additive: existing commitments default to
--      false and behave exactly as before everywhere else (dashboard, DR
--      detail, prep). Andrew's explicit call over a separate
--      team_commitments table — see the scoping conversation.
--
-- Run once in the Supabase SQL editor.
-- ============================================================

alter table team_meeting_notes
  add column if not exists meeting_date date;

alter table commitments
  add column if not exists is_team_commitment boolean not null default false;
