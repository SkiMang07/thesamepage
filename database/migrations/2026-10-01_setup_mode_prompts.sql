-- ============================================================
-- Setup mode, chunk D: entry modal, fading card, completion receipt
-- (docs/design-proposals/2026-09-29-onboarding-path/CHUNK_D_PLAN.md)
--
--   users.setup_intro_seen_at      the manager closed the entry modal ("what
--                                  setup is and why"). Stamped once.
--   users.setup_receipt_seen_at    the manager closed the completion modal.
--                                  Stamped once.
--   users.setup_card_dismissals    how many times "Not now" was chosen on the
--                                  setup card. Reset to 0 when a setup step
--                                  completes.
--   users.setup_card_snoozed_until the card stays hidden until then. Reset
--                                  when a setup step completes.
--
-- Backfill: anyone already set up has nothing to be introduced to and no
-- completion to be shown, so both modals are marked seen at their set_up_at.
-- Idempotent: safe to run twice.
-- ============================================================

alter table users add column if not exists setup_intro_seen_at timestamptz;
alter table users add column if not exists setup_receipt_seen_at timestamptz;
alter table users add column if not exists setup_card_dismissals integer not null default 0;
alter table users add column if not exists setup_card_snoozed_until timestamptz;

update users
   set setup_intro_seen_at = coalesce(setup_intro_seen_at, set_up_at),
       setup_receipt_seen_at = coalesce(setup_receipt_seen_at, set_up_at)
 where set_up_at is not null;
