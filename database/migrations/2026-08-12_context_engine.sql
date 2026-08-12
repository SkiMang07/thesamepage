-- Context Engine — Session 27 (2026-08-12), Session I of the build plan
-- (docs/CONTEXT_ENGINE_BUILD_PLAN.md — schema & storage foundation).
-- See docs/CONTEXT_ENGINE.md for the full framework (the Space + the
-- Librarian + the Brain).
--
-- Four new tables, org-scoped like org_units/role_levels/capacity_settings
-- (org_id = current_org_id()) — NOT owner_id-scoped like goals/projects/
-- direct_reports. Docs are shared org context (strategy, values, customers,
-- pricing), not one manager's private data, so any manager in the org can
-- read/write them — same trust level as org_units or role_levels today.
--
-- This is a deliberate simplification of build-plan resolution #5
-- ("scope + RLS only"): the org_unit scope tags (company/department/team)
-- drive RETRIEVAL RELEVANCE and Brain grouping at the application layer,
-- not a hard RLS boundary between managers in the same org. This codebase
-- has no precedent for per-org-unit row-level RLS on raw rows — the rollup
-- functions (org_unit_capacity_rollup, org_unit_goals_rollup, etc.) solve a
-- similar problem by returning aggregates only, never named rows. True
-- org-unit-gated RLS on full document text would be new ground; revisit if
-- a real multi-manager org needs it (same "no second manager yet to test a
-- real permission system against" caveat noted on the capacity rollup
-- applies here).
--
-- Depends on: organizations, auth.users, org_units (Session 11) — confirm
-- org_units' migration is live before running this one.
--
-- Run this against the live Supabase database. database/schema.sql has
-- already been updated to match, for future reads.

-- -------------------------
-- DOCUMENT_SERIES
-- Recurring-doc grouping (monthly town halls, quarterly product updates).
-- Created before `documents` since documents.series_id references it.
-- -------------------------
create table if not exists document_series (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  cadence    text,
  created_at timestamptz not null default now()
);

alter table document_series enable row level security;

create policy "document_series_all_own_org" on document_series
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- -------------------------
-- DOCUMENTS
-- One row per uploaded doc. Librarian-assigned metadata (category,
-- freshness_class, effective_date, summary_card, novelty_score,
-- extracted_text) starts null and fills in as the extraction pipeline
-- (Session II) runs; `status` tracks that lifecycle. `confirmed_at` stays
-- null until the user confirms the Librarian's proposed card (Session III)
-- — only confirmed docs are eligible for retrieval (Session IV) or Brain
-- fill (Session V).
--
-- `category` is a single field for v1 (build-plan resolution #3: per-
-- document, not per-category-question) — the framework doc's note that
-- "stream items get topic cross-tags" (multi-category cross-filing) is
-- deliberately not built this pass; revisit only alongside a future
-- per-category-question novelty upgrade.
-- -------------------------
create table if not exists documents (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  uploaded_by     uuid not null references auth.users(id),
  title           text not null,
  storage_path    text not null,
  file_type       text not null check (file_type in ('pptx', 'pdf', 'text')),
  status          text not null default 'processing'
                  check (status in ('processing', 'pending_review', 'confirmed', 'failed')),
  category        text
                  check (category is null or category in (
                    'where_we_are_going',
                    'who_we_are_and_how_we_operate',
                    'who_we_serve',
                    'what_we_offer',
                    'how_people_grow_here'
                  )),
  freshness_class text
                  check (freshness_class is null or freshness_class in (
                    'evergreen', 'dated', 'stream_instance'
                  )),
  effective_date  date,
  series_id       uuid references document_series(id) on delete set null,
  summary_card    text,
  extracted_text  text,
  novelty_score   integer check (novelty_score is null or (novelty_score between 0 and 100)),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);

alter table documents enable row level security;

create policy "documents_all_own_org" on documents
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create index if not exists documents_org_id_idx on documents(org_id);
create index if not exists documents_series_id_idx on documents(series_id);
create index if not exists documents_status_idx on documents(status);
create index if not exists documents_category_idx on documents(category);

-- -------------------------
-- DOCUMENT_SCOPES
-- Which org_unit(s) a document applies to — a set, not a single value (a
-- doc can carry multiple scopes). `org_unit_id is null` means company-wide
-- (org_units has no "company" row — see org_units.py — so null is the only
-- way to express "the whole org" here). Scope cascades down the org_units
-- tree at the application layer (Session IV's retrieval helper): a
-- company-wide doc applies to every department/team, a department-scoped
-- doc applies to all of that department's teams.
-- -------------------------
create table if not exists document_scopes (
  id           uuid primary key default uuid_generate_v4(),
  document_id  uuid not null references documents(id) on delete cascade,
  org_unit_id  uuid references org_units(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table document_scopes enable row level security;

create policy "document_scopes_all_own_org" on document_scopes
  for all using (
    document_id in (select id from documents where org_id = public.current_org_id())
  )
  with check (
    document_id in (select id from documents where org_id = public.current_org_id())
  );

create index if not exists document_scopes_document_id_idx on document_scopes(document_id);
create index if not exists document_scopes_org_unit_id_idx on document_scopes(org_unit_id);

-- Postgres treats every NULL as distinct, so a plain UNIQUE(document_id,
-- org_unit_id) would let the same document collect unlimited duplicate
-- "company-wide" (null) rows. Two partial indexes cover both cases.
create unique index if not exists document_scopes_unique_org_unit
  on document_scopes(document_id, org_unit_id) where org_unit_id is not null;
create unique index if not exists document_scopes_unique_company_wide
  on document_scopes(document_id) where org_unit_id is null;

-- -------------------------
-- DOCUMENT_CITATIONS
-- Usage ledger — one row every time an agent answer cites a document.
-- Feeds the Brain's credit flow-back (Session V: "used in N answers this
-- week") and Session IV's retrieval/usage tracking. Written by whichever
-- manager's agent call cited the doc, through their own RLS-scoped client
-- (never service-role — same rule as every other user-data write in this
-- app), so no separate insert policy is needed beyond the standard one.
-- -------------------------
create table if not exists document_citations (
  id          uuid primary key default uuid_generate_v4(),
  document_id uuid not null references documents(id) on delete cascade,
  cited_by    uuid not null references auth.users(id),
  context     text,
  created_at  timestamptz not null default now()
);

alter table document_citations enable row level security;

create policy "document_citations_all_own_org" on document_citations
  for all using (
    document_id in (select id from documents where org_id = public.current_org_id())
  )
  with check (
    document_id in (select id from documents where org_id = public.current_org_id())
  );

create index if not exists document_citations_document_id_idx on document_citations(document_id);
create index if not exists document_citations_recency_idx on document_citations(document_id, created_at desc);

-- -------------------------
-- STORAGE
-- Raw uploaded files (PPTX/PDF/text) live in Supabase Storage, not in the
-- database. Path convention Session II's upload endpoint must follow:
--   {org_id}/{document_id}/{original_filename}
-- storage.foldername(name) splits the object path on '/' — folder[1] is
-- the org_id segment, checked against current_org_id() the same way every
-- other org-scoped policy in this file does. storage.objects already has
-- RLS enabled by default on Supabase projects.
--
-- Note: this part can't be exercised by the local-Postgres functional test
-- this migration was verified with (bare Postgres has no storage schema) —
-- same "unverified outside real Supabase" caveat every session's sandbox
-- carries for real Auth integration. Confirm against live Supabase.
-- -------------------------
insert into storage.buckets (id, name, public)
values ('context-engine-docs', 'context-engine-docs', false)
on conflict (id) do nothing;

create policy "context_engine_docs_select_own_org" on storage.objects
  for select using (
    bucket_id = 'context-engine-docs'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "context_engine_docs_insert_own_org" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'context-engine-docs'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "context_engine_docs_delete_own_org" on storage.objects
  for delete using (
    bucket_id = 'context-engine-docs'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );
