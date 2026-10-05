-- ============================================================
-- First-1:1 wrap-up reminder (Andrew, 2026-10-05)
--
--   users.wrapup_reminder_sent_at   when the evening-of-the-first-1:1 reminder
--                                   was handed to HubSpot. Stamped once; the
--                                   worker never reminds a manager twice.
--
-- Read softly by backend/jobs/wrapup_reminder.py: before this runs, the
-- reminder does nothing. Idempotent: safe to run twice.
-- ============================================================

alter table users add column if not exists wrapup_reminder_sent_at timestamptz;
