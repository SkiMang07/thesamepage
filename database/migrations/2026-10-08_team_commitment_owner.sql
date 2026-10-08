-- ============================================================
-- Team-meeting commitments: committed_by names who owes it (Andrew, 2026-10-08)
--
-- A 1:1 commitment has always said who owes it in committed_by
-- ('manager' | 'direct_report'), with direct_report_id naming the person it
-- is with. Team-meeting wrap-ups saved every row as committed_by = 'manager'
-- and used direct_report_id for the person who owes it, so "Jordan: compile
-- the deck" counted as the manager's own on Mission Control and on Jordan's
-- page, while the Team page showed it as Jordan's.
--
-- The writers now save 'direct_report' whenever a person is named. This
-- corrects the team rows saved before that: team-meeting rows, and rows
-- added with the Team page's "+ Add", whose picker was always "Owner" (who
-- owes it). Every live row of that shape was checked on 2026-10-08 and each
-- names the person who owes it. Rows that are not team rows are untouched.
--
-- No schema change; schema.sql only documents the rule. Idempotent: a
-- second run matches nothing.
-- ============================================================

update commitments
   set committed_by = 'direct_report'
 where source_type in ('team_meeting', 'manual')
   and is_team_commitment
   and committed_by = 'manager'
   and direct_report_id is not null;
