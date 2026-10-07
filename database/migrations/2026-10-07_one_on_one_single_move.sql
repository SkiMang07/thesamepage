-- ============================================================
-- Move just this 1:1 (Andrew, 2026-10-07)
--
--   one_on_ones.series_slot_at   the series' usual date this occurrence
--                                stands in for, set only when the manager
--                                moved this one 1:1 by itself ("Just this
--                                1:1"). Null means scheduled_at is on the
--                                series' usual day.
--
-- Logging a moved occurrence rolls the next one forward from this usual
-- date, so the series returns to its usual day. "This and every one after"
-- re-anchors the series and clears it. Idempotent: safe to run twice.
-- ============================================================

alter table one_on_ones add column if not exists series_slot_at timestamptz;
