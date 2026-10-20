-- =============================================================================
-- Milestone 0: database security baseline (ADR-0004)
--
-- Goal: nothing in the exposed `public` schema is reachable by the `anon` or
-- `authenticated` API roles unless a later migration GRANTs it explicitly and
-- enables Row Level Security with policies (CLAUDE.md hard rule).
--
-- This migration creates no business tables.
-- =============================================================================

-- 1. Store and compare timestamps in UTC. Clinic-local display uses Africa/Cairo
--    in the application layer (SRS §6).
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'UTC');
end
$$;

-- 2. Remove Supabase's permissive default privileges for objects that the
--    migration role creates in `public` from now on.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- Functions are executable by PUBLIC by default in PostgreSQL. Require explicit
-- GRANT EXECUTE for every function created by the migration role.
alter default privileges for role postgres
  revoke execute on functions from public;

-- 3. Revoke anything that may already exist in `public` (a fresh project has no
--    tables; this keeps the baseline correct if applied to an existing one).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 4. Non-exposed schema for authorization helpers and internal tables.
--    It must never be added to the API's exposed schemas.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

comment on schema private is
  'Internal helpers and tables. Not exposed through the Data API. Grants must be explicit and tested.';
