-- =============================================================================
-- TEST-ONLY bootstrap for a PLAIN Postgres (NOT applied on real Supabase).
--
-- It recreates the tiny slice of Supabase the migrations depend on — the `auth`
-- schema, `auth.users`, `auth.uid()`, and the anon/authenticated/service_role
-- roles — so the identical migrations + identical RLS test can run against a
-- bare `postgres:16` container. On real Supabase these already exist and this
-- file is skipped (runner only applies it when RLS_LOCAL_BOOTSTRAP=1).
-- =============================================================================

-- Roles that Supabase provides. service_role bypasses RLS, exactly like Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;

-- Minimal auth.users (real Supabase has far more columns; migrations only need
-- id, email, raw_user_meta_data).
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

-- auth.uid(): identical semantics to Supabase — read the 'sub' claim from the
-- request JWT claims GUC that PostgREST (here: our test) sets per request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
