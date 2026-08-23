-- Mission Control recommendation feedback + analytics.
-- Append-only and manager-scoped. Dispositions record how the manager
-- interpreted a recommendation; they never alter the underlying source row.

create table mission_control_events (
  id                   uuid primary key default uuid_generate_v4(),
  manager_id           uuid not null references auth.users(id) on delete cascade,
  brief_id             uuid not null,
  parent_event_id      uuid references mission_control_events(id) on delete set null,
  event_type           text not null check (event_type in (
    'impression',
    'why_opened',
    'cta_clicked',
    'addressed',
    'snoozed',
    'not_relevant',
    'setup_dismissed_today',
    'ai_explanation_succeeded',
    'ai_explanation_failed',
    'downstream_completed'
  )),
  candidate_key        text not null,
  evidence_fingerprint text not null,
  candidate_type       text not null,
  entity_type          text,
  entity_id            uuid,
  rank                 smallint check (rank between 1 and 3),
  score                integer,
  snoozed_until        timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  constraint mission_control_snooze_time check (
    (event_type in ('snoozed', 'setup_dismissed_today') and snoozed_until is not null)
    or
    (event_type not in ('snoozed', 'setup_dismissed_today') and snoozed_until is null)
  )
);

alter table mission_control_events enable row level security;

create index mission_control_events_manager_created_idx
  on mission_control_events (manager_id, created_at desc);

create index mission_control_events_candidate_idx
  on mission_control_events (
    manager_id,
    candidate_key,
    evidence_fingerprint,
    created_at desc
  );

create unique index mission_control_events_completion_once_idx
  on mission_control_events (manager_id, parent_event_id)
  where event_type = 'downstream_completed';

create policy "mission_control_events_select_own" on mission_control_events
  for select using (manager_id = auth.uid());

create policy "mission_control_events_insert_own" on mission_control_events
  for insert with check (manager_id = auth.uid());
