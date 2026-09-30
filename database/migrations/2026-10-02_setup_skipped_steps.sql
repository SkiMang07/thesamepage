-- ============================================================
-- Setup: "skip for now" on a step
-- (docs/ONBOARDING_SCOPING.md, setup mode)
--
--   users.setup_skipped_steps   the setup steps the manager chose to skip for
--                               now, from org, expectations, goals. A skipped
--                               step counts toward ending setup but is not
--                               done, and the manager can undo the skip.
--
-- Read softly with the other prompt columns (routes/onboarding.py): before
-- this runs, nothing is skipped and the skip endpoint answers ok: false.
-- Idempotent: safe to run twice.
-- ============================================================

alter table users add column if not exists setup_skipped_steps text[] not null default '{}';
