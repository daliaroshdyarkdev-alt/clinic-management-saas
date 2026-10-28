-- Minimal emulation of the Supabase platform objects that our migrations and
-- RLS policies depend on. Used ONLY by the plain-PostgreSQL test harness
-- (see docs/OPEN_DECISIONS.md OD-E03). Never applied to a real Supabase
-- project: there, these objects are provided by the platform.
--
-- Emulated:
--   * API roles anon / authenticated / service_role (service_role bypasses RLS)
--   * auth.users (subset of columns), auth.uid(), auth.role(), auth.jwt()
--   * Supabase's permissive default privileges on schema public, so tests
--     prove our migrations revoke them instead of relying on a clean slate.

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
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Column subset of GoTrue's auth.users / auth.identities used by our
-- migrations and supabase/seed.sql.
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email text unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  unique (provider_id, provider)
);

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select auth.jwt() ->> 'role'
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role()
  to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants everything in public to the API roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
