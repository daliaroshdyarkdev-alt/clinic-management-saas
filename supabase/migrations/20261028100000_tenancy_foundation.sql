-- Milestone 0: tenancy foundation.
-- SRS: §2.1 invariants 1-3, STA-001 (roles), STA-003 (membership states),
-- STA-004 (multi-clinic membership), STA-007 (append-only audit), ADM-003.
--
-- Security model
--   * Every table in `public` is reachable through the Supabase Data API, so
--     each one has RLS enabled and explicit, minimal grants. Supabase's
--     default "grant all to anon, authenticated" is revoked below.
--   * Helper functions live in schema `private`, which is not exposed by the
--     Data API (supabase/config.toml `api.schemas`).
--   * There is deliberately no platform-admin branch in any clinic policy
--     (ADM-003; Q97 support access is OPEN, see docs/OPEN_DECISIONS.md OD-S01).

-- ---------------------------------------------------------------------------
-- Default privileges: new objects in public start closed.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Private schema for policy helpers and trigger functions.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
-- RLS policy expressions run as the calling role, so the API roles need USAGE
-- to evaluate helpers. The schema is not exposed through the Data API.
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke all on functions from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.clinic_account_state as enum ('pending', 'active', 'suspended', 'closed');
create type public.clinic_role as enum ('owner', 'manager', 'receptionist', 'cashier', 'doctor');
create type public.membership_status as enum ('active', 'suspended', 'deactivated');
create type public.app_locale as enum ('ar', 'en');

-- ---------------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Invariant 1: clinic_id of a clinic-owned row never changes.
create function private.forbid_clinic_id_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'clinic_id is immutable on %', tg_table_name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.forbid_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only (% rejected)', tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- user_profiles
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null default '' check (char_length(full_name) <= 200),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  locale public.app_locale not null default 'ar',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function private.set_updated_at();

-- Profile row is created for every new auth user.
create function private.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, full_name, locale)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200),
    case when new.raw_user_meta_data ->> 'locale' = 'en' then 'en' else 'ar' end::public.app_locale
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- clinics
-- ---------------------------------------------------------------------------
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  account_state public.clinic_account_state not null default 'pending',
  timezone text not null default 'Africa/Cairo',
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clinics_updated_at
  before update on public.clinics
  for each row execute function private.set_updated_at();

-- ONB-004 / SUB-003: first activation time is recorded once and never moved.
create function private.forbid_activated_at_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception 'clinics.activated_at is set once' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger clinics_activated_at_once
  before update on public.clinics
  for each row execute function private.forbid_activated_at_change();

-- ---------------------------------------------------------------------------
-- clinic_memberships
-- ---------------------------------------------------------------------------
create table public.clinic_memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  role public.clinic_role not null,
  status public.membership_status not null default 'active',
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, user_id)
);

create index clinic_memberships_user_idx on public.clinic_memberships (user_id) where status = 'active';
-- At most one active owner per clinic.
create unique index clinic_memberships_one_active_owner
  on public.clinic_memberships (clinic_id) where role = 'owner' and status = 'active';

create trigger clinic_memberships_updated_at
  before update on public.clinic_memberships
  for each row execute function private.set_updated_at();

create trigger clinic_memberships_clinic_id_immutable
  before update on public.clinic_memberships
  for each row execute function private.forbid_clinic_id_change();

-- STA-003: deactivation is permanent; a membership never moves to another user.
create function private.guard_membership_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'clinic_memberships.user_id is immutable' using errcode = 'P0001';
  end if;
  if old.status = 'deactivated' and new.status <> 'deactivated' then
    raise exception 'deactivated memberships cannot be reactivated' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger clinic_memberships_guard
  before update on public.clinic_memberships
  for each row execute function private.guard_membership_update();

-- ---------------------------------------------------------------------------
-- audit_events (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users (id) on delete restrict,
  actor_kind text not null check (actor_kind in ('user', 'system', 'worker')),
  clinic_id uuid references public.clinics (id) on delete restrict,
  category text not null check (category in (
    'auth', 'tenancy', 'onboarding', 'admin', 'appointments',
    'clinical_access', 'finance', 'messaging', 'billing'
  )),
  action text not null check (char_length(action) between 1 and 100),
  resource_type text,
  resource_id text,
  outcome text not null check (outcome in ('success', 'denied', 'failure')),
  request_id text,
  -- Redacted metadata only: never medical content, never full identifiers.
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_clinic_time_idx on public.audit_events (clinic_id, occurred_at desc);

create trigger audit_events_no_update_delete
  before update or delete on public.audit_events
  for each row execute function private.forbid_mutation();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function private.forbid_mutation();

-- Single write path, called from other SECURITY DEFINER domain functions.
create function private.write_audit_event(
  p_category text,
  p_action text,
  p_outcome text,
  p_clinic_id uuid default null,
  p_resource_type text default null,
  p_resource_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_request_id text default null,
  p_actor_kind text default 'user'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.audit_events (
    actor_user_id, actor_kind, clinic_id, category, action,
    resource_type, resource_id, outcome, request_id, metadata
  ) values (
    auth.uid(), p_actor_kind, p_clinic_id, p_category, p_action,
    p_resource_type, p_resource_id, p_outcome, p_request_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policy helpers. SECURITY DEFINER so policies on clinic_memberships can
-- consult clinic_memberships without recursive RLS evaluation. They only
-- ever answer questions about the calling user (auth.uid()).
-- ---------------------------------------------------------------------------
create function private.is_active_member(p_clinic_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_memberships m
    where m.clinic_id = p_clinic_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create function private.has_clinic_role(p_clinic_id uuid, p_roles public.clinic_role[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_memberships m
    where m.clinic_id = p_clinic_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.forbid_clinic_id_change() from public;
revoke all on function private.forbid_mutation() from public;
revoke all on function private.forbid_activated_at_change() from public;
revoke all on function private.guard_membership_update() from public;
revoke all on function private.handle_new_auth_user() from public;
revoke all on function private.write_audit_event(text, text, text, uuid, text, text, jsonb, text, text) from public;
revoke all on function private.is_active_member(uuid) from public;
revoke all on function private.has_clinic_role(uuid, public.clinic_role[]) from public;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.has_clinic_role(uuid, public.clinic_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants
-- ---------------------------------------------------------------------------
alter table public.user_profiles enable row level security;
alter table public.clinics enable row level security;
alter table public.clinic_memberships enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.user_profiles, public.clinics, public.clinic_memberships, public.audit_events
  from anon, authenticated;
revoke all on sequence public.audit_events_id_seq from anon, authenticated;

-- user_profiles: a user reads and edits only their own profile.
grant select on table public.user_profiles to authenticated;
grant update (full_name, phone_e164, locale) on table public.user_profiles to authenticated;

create policy user_profiles_select_own on public.user_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_profiles_update_own on public.user_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- clinics: visible to active members only. Writes happen through
-- onboarding/admin functions (Milestone 1), never directly from clients.
grant select on table public.clinics to authenticated;

create policy clinics_select_active_member on public.clinics
  for select to authenticated
  using (private.is_active_member(id));

-- clinic_memberships: a user sees their own memberships (any status, so the
-- UI can explain a suspension); the active owner sees the clinic's staff.
-- No client writes: role and status changes go through owner-checked
-- functions (Milestone 1).
grant select on table public.clinic_memberships to authenticated;

create policy clinic_memberships_select_own on public.clinic_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy clinic_memberships_select_owner on public.clinic_memberships
  for select to authenticated
  using (private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]));

-- audit_events: no client access in Milestone 0. Owner audit views arrive
-- with Milestone 1 and will expose redacted columns only.
revoke update, delete, truncate on table public.audit_events from service_role;
