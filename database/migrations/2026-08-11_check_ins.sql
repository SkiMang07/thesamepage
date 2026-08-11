-- Check-ins (Session 26, 2026-08-11 — goals/initiatives progress layer; see
-- docs/SESSION_HISTORY.md for the scoping conversation).
--
-- The temporal layer for goals and projects (initiatives): each row is a
-- timestamped assertion of status + optional progress % + optional one-line
-- note, against exactly one goal OR one project. The parent's `status`
-- column is write-through-updated by the backend on every check-in, so
-- existing status-reading surfaces keep working; progress, trend, and
-- staleness are all derived from this table (latest row = current progress,
-- latest two rows = trend, latest created_at = freshness).
--
-- One shared table rather than goal_updates + project_updates: both parents
-- share the same status enum and check-in shape, and the COO-agent temporal
-- layer (data gap #2 in docs/COO_AGENT_QUESTION_SET.md) wants one place to
-- diff history. Progress is a manually-asserted 0-100 (structured key
-- results considered and deferred).
--
-- Depends only on the base goals/projects tables (Sessions 10/13) — no
-- dependency on the 2026-08-09 migrations.
--
-- Run once in the Supabase SQL editor.

create table check_ins (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null references auth.users(id),
  -- Exactly one of these two is set (enforced below).
  goal_id     uuid references goals(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  status      text not null
              check (status in ('active', 'on_track', 'at_risk', 'completed', 'cancelled')),
  -- Manually-asserted percent complete. Nullable — a check-in can be just a
  -- status/note without re-asserting a number.
  progress    integer check (progress >= 0 and progress <= 100),
  note        text,
  created_at  timestamptz not null default now(),
  constraint check_ins_exactly_one_parent
    check (num_nonnulls(goal_id, project_id) = 1)
);

-- Latest-N-per-parent is the only read pattern.
create index check_ins_goal_idx on check_ins (goal_id, created_at desc);
create index check_ins_project_idx on check_ins (project_id, created_at desc);

alter table check_ins enable row level security;

-- Owner-scoped, same pattern (and same actor) as the goals/projects rows
-- they annotate.
create policy "check_ins_all_own" on check_ins
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
