-- 2026-10-06: a role expectation decision can be about levels (finding #3 of
-- the 2026-10-05 onboarding review). "One standard for everyone in this role,
-- or separate levels?" is stored with topic 'level': approval keeps it due
-- instead of parking it a month out, and its answer can split the role into
-- two levels on the same ladder (POST /api/role-expectations/roles/{id}/split).
-- Idempotent.

alter table role_expectation_decisions
  drop constraint if exists role_expectation_decisions_topic_check;

alter table role_expectation_decisions
  add constraint role_expectation_decisions_topic_check
  check (topic in ('target', 'measure', 'scope', 'wording', 'other', 'level'));
