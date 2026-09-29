-- ============================================================
-- Onboarding state (docs/design-proposals/2026-09-29-onboarding-path/BUILD_BRIEF.md)
--
-- A manager is onboarded when five things are true: team and org set up,
-- expectations configured for every role in use, knowledge documents
-- imported (or declared none), an org goal and a team goal, and a first 1:1
-- logged. The five are derived from real records on each load
-- (routes/onboarding.py). `onboarded_at` is what makes the result sticky:
-- the first time all five hold it is stamped, and archiving a goal later
-- does not take it back.
--
-- `knowledge_skipped_at` is the manager's "nothing to import" answer. It
-- counts as the knowledge step and can be cleared.
--
-- Existing accounts: anyone who already has a direct report is marked
-- onboarded now, so they do not land in setup after this ships.
-- Idempotent: safe to run twice.
-- ============================================================

alter table users add column if not exists onboarded_at timestamptz;
alter table users add column if not exists knowledge_skipped_at timestamptz;

update users u
   set onboarded_at = now()
 where u.onboarded_at is null
   and exists (select 1 from direct_reports d where d.manager_id = u.id);
