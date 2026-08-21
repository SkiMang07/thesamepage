-- ============================================================
-- Session 49 (2026-08-21) — Development plan freeform text
-- See docs/SESSION_HISTORY.md and backend/routes/development.py's
-- docstring for the full follow-up context. Andrew's first two rounds of
-- feedback on Session 47/48's Development feature landed on: manager notes
-- (dev_plan_manager_notes) are fine as a private, append-only log — but he
-- also wants a primary, always-writable "build the plan" surface, which
-- notes was never meant to be.
-- ============================================================

-- Single freeform field on the plan row itself, upserted in place via
-- PUT /{id}/plan (not append-only like dev_plan_manager_notes — this is
-- one evolving narrative per plan, same "one row, updated over time" shape
-- as dev_plan_aspirations, just without needing its own table since it's a
-- single text field with no other structure).
alter table development_plans
  add column if not exists plan_text text;
