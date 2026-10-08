-- ============================================================
-- Career conversations (Andrew, 2026-10-08)
--
-- One of a person's ordinary 1:1s, chosen ahead of time as the quarterly
-- career conversation. The timing rules are in backend/career_rhythm.py;
-- see docs/CAREER_CONVERSATIONS_SCOPING.md.
--
-- organizations.career_conversation_interval_days: the rolling interval from
-- the last career conversation, set in Settings beside the 1:1 rhythm.
-- Null = off.
--
-- career_conversations: one row per planned, held or skipped conversation.
-- At most one planned row per person. one_on_one_id links the occurrence once
-- it exists; planned_for is the 1:1's date. Idempotent.
-- ============================================================

alter table organizations
  add column if not exists career_conversation_interval_days integer default 90
    check (career_conversation_interval_days is null
           or career_conversation_interval_days between 30 and 365);

create table if not exists career_conversations (
  id                uuid primary key default uuid_generate_v4(),
  manager_id        uuid not null references auth.users(id),
  direct_report_id  uuid not null references direct_reports(id) on delete cascade,
  status            text not null default 'planned'
                    check (status in ('planned', 'held', 'skipped')),
  planned_for       date not null,
  one_on_one_id     uuid references one_on_ones(id) on delete set null,
  heads_up_sent_at  timestamptz,
  held_on           date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table career_conversations enable row level security;

create unique index if not exists career_conversations_one_planned_idx
  on career_conversations (manager_id, direct_report_id)
  where status = 'planned';

create index if not exists career_conversations_report_idx
  on career_conversations (manager_id, direct_report_id, status);

drop policy if exists "career_conversations_all_own" on career_conversations;
create policy "career_conversations_all_own" on career_conversations
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
