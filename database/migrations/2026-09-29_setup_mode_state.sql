-- ============================================================
-- Setup mode state (docs/design-proposals/2026-09-29-onboarding-path/SETUP_MODE_BRIEF.md)
--
-- Three states, all derived from real records in routes/onboarding.py:
--   activated  a prep sheet exists.
--   set up     team and org, role expectations, and goals all hold.
--              `set_up_at` is stamped once, the first time they do, so
--              archiving a goal later does not take it back.
--   onboarded  set up, plus a logged 1:1, plus a later prep sheet for the
--              same person. `onboarded_at` already exists and stays sticky.
--
-- The three setup_*_at columns stamp the first time each step was seen
-- holding. They make the per-step completion event fire exactly once (the
-- update is scoped to rows still null) and give a time to complete.
--
-- Accounts already onboarded (grandfathered by 2026-09-29_onboarding_state)
-- are also set up. Knowledge documents and the first 1:1 are no longer setup
-- steps; `knowledge_skipped_at` is left in place, unused, for the notes-dump
-- on-ramp to decide about.
-- Idempotent: safe to run twice.
-- ============================================================

alter table users add column if not exists set_up_at timestamptz;
alter table users add column if not exists setup_org_at timestamptz;
alter table users add column if not exists setup_expectations_at timestamptz;
alter table users add column if not exists setup_goals_at timestamptz;

update users
   set set_up_at = onboarded_at
 where set_up_at is null
   and onboarded_at is not null;
