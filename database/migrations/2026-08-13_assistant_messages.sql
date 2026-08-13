-- ============================================================
-- Scribe thread persistence (Session S3, 2026-08-13).
--
-- Stores the assistant conversation per manager so the drawer thread
-- survives browser refreshes and different devices. Pattern: manager-
-- scoped, same as team_messages/one_on_ones — the thread belongs to
-- the manager running the conversation, not to the org.
--
-- drafts (jsonb) stores the emit_draft payloads emitted during that
-- assistant turn, so the drawer can re-render draft cards on hydration.
-- Null for user-role rows (user turns never emit drafts).
--
-- A single index on (manager_id, created_at asc) covers the only read
-- pattern: load all messages for the current manager in order.
-- ============================================================

create table assistant_messages (
  id         uuid primary key default uuid_generate_v4(),
  manager_id uuid not null references auth.users(id),
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  drafts     jsonb,
  created_at timestamptz not null default now()
);

alter table assistant_messages enable row level security;

create index assistant_messages_manager_idx on assistant_messages (manager_id, created_at asc);

create policy "assistant_messages_all_own" on assistant_messages
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
