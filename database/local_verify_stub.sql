-- ============================================================================
-- The Same Page — local Supabase stub for schema.sql / RLS verification
-- ============================================================================
-- Reusable script, checked in so future sessions don't have to re-derive this
-- via trial and error (first built + debugged in Session 43, 2026-08-18 —
-- see docs/SESSION_HISTORY_ARCHIVE.md for the full story of each fix below).
--
-- Purpose: stand up a bare local Postgres instance well enough that the
-- REAL database/schema.sql (and any migration file) runs against it end to
-- end with zero errors, so schema/RLS changes get tested before they reach
-- the Supabase SQL editor. This is not a full Supabase — it's the minimum
-- surface schema.sql actually touches (auth.*, storage.*, the anon/
-- authenticated/service_role roles, and their default grants).
--
-- USAGE (run these three steps in order, every time):
--
--   1) Fresh database, every run — never reuse a dirty one, duplicate-key
--      errors from leftover rows are the #1 time-sink here:
--        dropdb --if-exists tsp_verify && createdb tsp_verify
--
--   2) This stub, then the real schema (and migration, if testing one):
--        psql tsp_verify -f database/local_verify_stub.sql
--        psql tsp_verify -f database/schema.sql
--        psql tsp_verify -f database/migrations/<the migration under test>.sql   -- if applicable
--
--   3) THEN grant on what schema.sql just created — must run after schema.sql,
--      not before, or "all tables in schema public" grants nothing:
--        psql tsp_verify -c "grant all on all tables in schema public to anon, authenticated; grant all on all sequences in schema public to anon, authenticated; grant execute on all functions in schema public to anon, authenticated;"
--
-- Then write a scratch functional-test .sql (two managers, `set role
-- authenticated`, `select set_config('app.current_user_id', '<uuid>', false)`
-- per Session 43's /tmp/functional_test.sql and /tmp/rollup_test.sql pattern)
-- to actually exercise the RLS policies and any SECURITY DEFINER rollup
-- functions you touched — this stub only gets you to "schema applies
-- cleanly," not "the policy does what I think it does."
--
-- Known gotchas already solved below, don't rediscover them:
--   - `handle_new_user()`'s trigger reads `new.raw_user_meta_data`, which a
--     bare auth.users table doesn't have — included here.
--   - Bare Postgres has no `storage` schema; schema.sql's Context Engine
--     storage policies need buckets/objects/foldername() to exist first.
--   - `INSERT ... RETURNING` from a table whose SELECT policy depends on
--     `current_org_id()` can deadlock on bootstrap (the org doesn't exist
--     yet, so the function returns null, so the RETURNING select policy
--     fails) — insert org rows with an explicit literal UUID and skip
--     RETURNING in test scripts, don't fight this in the stub itself.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

-- Session-variable-backed auth.uid()/auth.email() — set per test session via
-- select set_config('app.current_user_id', '<uuid>', false);
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create or replace function auth.email() returns text
language sql stable
as $$
  select nullif(current_setting('app.current_user_email', true), '')
$$;

-- Real Supabase roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

create extension if not exists pgcrypto;

-- Minimal storage schema stub (buckets/objects/foldername) — covers only
-- what schema.sql's Context Engine storage policies reference.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select string_to_array(name, '/')
$$;

grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
