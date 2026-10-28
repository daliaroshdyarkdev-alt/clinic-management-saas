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

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
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
