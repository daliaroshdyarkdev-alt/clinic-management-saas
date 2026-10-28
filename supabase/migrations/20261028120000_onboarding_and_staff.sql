-- Milestone 1: clinic onboarding, platform review, staff invitations and
-- owner-controlled permissions.
-- SRS: ONB-001..005, ONB-007, STA-001..005, ADM-001, ADM-003, SUB-003 (trial start).
--
-- All state changes go through SECURITY DEFINER functions below. Each one
-- derives the caller from auth.uid(), re-checks membership/role/capability,
-- validates the transition, and writes an audit event in the same
-- transaction. Clients have SELECT-only access to the tables (RLS-filtered).
--
-- Error contract: functions raise SQLSTATE 42501 with message 'forbidden'
-- for authorisation failures and P0001 with a snake_case code for rule
-- violations (mapped to translated messages in modules/shared/db-errors.ts).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.license_type as enum ('clinic_operating', 'doctor_professional');
create type public.license_review_status as enum (
  'submitted', 'approved', 'rejected', 'replacement_requested', 'superseded'
);
-- Owner-grantable capabilities. Clinical-content access is deliberately not a
-- capability: it is never grantable (STA-001 non-overrideable boundary).
create type public.clinic_capability as enum ('staff.manage');

-- ---------------------------------------------------------------------------
-- user_profiles.email: copy of the auth email so staff screens can show it.
-- ---------------------------------------------------------------------------
alter table public.user_profiles add column email text;
update public.user_profiles p set email = u.email from auth.users u where u.id = p.user_id;

create or replace function private.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, full_name, locale, email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200),
    case when new.raw_user_meta_data ->> 'locale' = 'en' then 'en' else 'ar' end::public.app_locale,
    new.email
  );
  return new;
end;
$$;

create function private.handle_auth_email_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles set email = new.email where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_auth_email_change();

revoke all on function private.handle_auth_email_change() from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.clinic_role_permissions (
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  role public.clinic_role not null check (role <> 'owner'),
  capability public.clinic_capability not null,
  allowed boolean not null,
  updated_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (clinic_id, role, capability)
);

create trigger clinic_role_permissions_clinic_id_immutable
  before update on public.clinic_role_permissions
  for each row execute function private.forbid_clinic_id_change();

create table public.clinic_invitations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  email text not null check (email = lower(email) and char_length(email) <= 320),
  role public.clinic_role not null check (role <> 'owner'),
  -- SHA-256 of the single-use token; the raw token exists only in the link.
  token_hash bytea not null unique,
  invited_by uuid not null references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (not (accepted_at is not null and revoked_at is not null))
);

create index clinic_invitations_clinic_idx on public.clinic_invitations (clinic_id, created_at desc);
-- At most one open invitation per clinic and email.
create unique index clinic_invitations_one_open
  on public.clinic_invitations (clinic_id, email) where accepted_at is null and revoked_at is null;

create trigger clinic_invitations_clinic_id_immutable
  before update on public.clinic_invitations
  for each row execute function private.forbid_clinic_id_change();

create table public.clinic_licenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  license_type public.license_type not null,
  revision integer not null check (revision > 0),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  review_status public.license_review_status not null default 'submitted',
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text check (char_length(review_reason) <= 1000),
  unique (clinic_id, license_type, revision)
);

create trigger clinic_licenses_clinic_id_immutable
  before update on public.clinic_licenses
  for each row execute function private.forbid_clinic_id_change();

-- Licence history is evidence: rows are never deleted.
create trigger clinic_licenses_no_delete
  before delete on public.clinic_licenses
  for each row execute function private.forbid_mutation();

create table public.clinic_review_decisions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  license_id uuid not null references public.clinic_licenses (id) on delete restrict,
  decision public.license_review_status not null
    check (decision in ('approved', 'rejected', 'replacement_requested')),
  reason text check (char_length(reason) <= 1000),
  decided_by uuid not null references auth.users (id) on delete restrict,
  decided_at timestamptz not null default now()
);

create index clinic_review_decisions_clinic_idx on public.clinic_review_decisions (clinic_id, decided_at desc);

create trigger clinic_review_decisions_append_only
  before update or delete on public.clinic_review_decisions
  for each row execute function private.forbid_mutation();

create table public.clinic_state_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  from_state public.clinic_account_state,
  to_state public.clinic_account_state not null,
  reason text check (char_length(reason) <= 1000),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index clinic_state_events_clinic_idx on public.clinic_state_events (clinic_id, occurred_at desc);

create trigger clinic_state_events_append_only
  before update or delete on public.clinic_state_events
  for each row execute function private.forbid_mutation();

-- Trial subset of the subscription model (full billing arrives in Milestone 6).
create table public.clinic_subscriptions (
  clinic_id uuid primary key references public.clinics (id) on delete restrict,
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null check (trial_ends_at > trial_started_at),
  created_at timestamptz not null default now()
);

create function private.forbid_trial_start_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trial_started_at is distinct from old.trial_started_at then
    raise exception 'trial_started_at is set once' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger clinic_subscriptions_trial_start_once
  before update on public.clinic_subscriptions
  for each row execute function private.forbid_trial_start_change();

create table public.legal_disclaimer_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  body_ar text not null,
  body_en text not null,
  -- true until legal counsel approves the text (OPEN_DECISIONS OD-L01).
  is_draft boolean not null default true,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index legal_disclaimer_versions_one_current
  on public.legal_disclaimer_versions (is_current) where is_current;

create table public.disclaimer_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  version_id uuid not null references public.legal_disclaimer_versions (id) on delete restrict,
  clinic_id uuid references public.clinics (id) on delete restrict,
  accepted_at timestamptz not null default now()
);

create trigger disclaimer_acceptances_append_only
  before update or delete on public.disclaimer_acceptances
  for each row execute function private.forbid_mutation();

insert into public.legal_disclaimer_versions (version, body_ar, body_en, is_draft, is_current) values (
  'draft-2026-10',
  'مسودة — بانتظار المراجعة القانونية. هذه المنصة أداة لإدارة العيادة ولا تغني عن التزامات العيادة القانونية والطبية وحماية البيانات. العيادة مسؤولة عن صحة التراخيص المرفوعة وعن الحصول على موافقات المرضى المطلوبة.',
  'DRAFT — pending legal review. This platform is a clinic management tool and does not replace the clinic''s own legal, medical and data-protection obligations. The clinic is responsible for the validity of uploaded licences and for obtaining required patient consents.',
  true,
  true
);

-- ---------------------------------------------------------------------------
-- Policy helpers
-- ---------------------------------------------------------------------------
create function private.require_user() returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function private.is_platform_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

-- Owners implicitly hold every capability; other roles only what the owner granted.
create function private.has_capability(p_clinic_id uuid, p_capability public.clinic_capability) returns boolean
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
      and (
        m.role = 'owner'
        or exists (
          select 1 from public.clinic_role_permissions p
          where p.clinic_id = m.clinic_id and p.role = m.role
            and p.capability = p_capability and p.allowed
        )
      )
  );
$$;

-- ONB-004: only approved, active clinics may run live operations. Used by
-- appointment, consultation and messaging functions from Milestone 2 on.
create function private.clinic_is_operational(p_clinic_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinics c where c.id = p_clinic_id and c.account_state = 'active');
$$;

create function private.clinic_accepts_setup_changes(p_clinic_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinics c where c.id = p_clinic_id and c.account_state in ('pending', 'active'));
$$;

-- Extracts the clinic id from a storage path "<clinic_id>/..."; null if malformed.
create function private.clinic_id_from_path(p_name text) returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      then substring(p_name from 1 for 36)::uuid
  end;
$$;

-- Staff screens may show the profile of anyone holding a membership in a
-- clinic where the caller manages staff; platform admins see clinic owners.
create function private.can_view_profile(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.clinic_memberships m
      where m.user_id = p_user_id
        and private.has_capability(m.clinic_id, 'staff.manage')
    )
    or (
      private.is_platform_admin()
      and exists (select 1 from public.clinic_memberships m where m.user_id = p_user_id and m.role = 'owner')
    );
$$;

-- ---------------------------------------------------------------------------
-- Onboarding functions
-- ---------------------------------------------------------------------------

-- ONB-001 / ONB-007: a signed-in user registers a clinic and becomes its owner.
create function public.register_clinic(p_name text, p_disclaimer_version_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_clinic_id uuid;
begin
  if char_length(v_name) not between 2 and 200 then
    raise exception 'invalid_clinic_name' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.legal_disclaimer_versions v where v.id = p_disclaimer_version_id and v.is_current
  ) then
    raise exception 'disclaimer_not_current' using errcode = 'P0001';
  end if;

  -- Abuse guard (engineering default, OPEN_DECISIONS OD-E06).
  if (
    select count(*) from public.clinic_memberships m
    join public.clinics c on c.id = m.clinic_id
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active' and c.account_state = 'pending'
  ) >= 3 then
    raise exception 'too_many_pending_clinics' using errcode = 'P0001';
  end if;

  insert into public.clinics (name, account_state) values (v_name, 'pending') returning id into v_clinic_id;
  insert into public.clinic_memberships (clinic_id, user_id, role, status) values (v_clinic_id, v_uid, 'owner', 'active');
  insert into public.disclaimer_acceptances (user_id, version_id, clinic_id) values (v_uid, p_disclaimer_version_id, v_clinic_id);
  insert into public.clinic_state_events (clinic_id, from_state, to_state, reason, actor_user_id)
    values (v_clinic_id, null, 'pending', 'registered', v_uid);

  perform private.write_audit_event('onboarding', 'clinic.registered', 'success', v_clinic_id, 'clinic', v_clinic_id::text);
  return v_clinic_id;
end;
$$;

-- ONB-002: record an uploaded licence file. The object must already exist in
-- the private `licenses` bucket under "<clinic_id>/<license_type>/<uuid>.<ext>".
create function public.submit_clinic_license(
  p_clinic_id uuid,
  p_license_type public.license_type,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_revision integer;
  v_id uuid;
begin
  if not private.has_clinic_role(p_clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.clinic_accepts_setup_changes(p_clinic_id) then
    raise exception 'clinic_not_editable' using errcode = 'P0001';
  end if;
  if p_storage_path is null
     or p_storage_path !~ ('^' || p_clinic_id::text || '/' || p_license_type::text
                           || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$') then
    raise exception 'invalid_storage_path' using errcode = 'P0001';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_size_bytes is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'invalid_file' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'licenses' and o.name = p_storage_path) then
    raise exception 'file_not_found' using errcode = 'P0001';
  end if;

  -- Serialise revisions per clinic.
  perform 1 from public.clinics c where c.id = p_clinic_id for update;

  update public.clinic_licenses
     set review_status = 'superseded'
   where clinic_id = p_clinic_id and license_type = p_license_type and review_status <> 'superseded';

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.clinic_licenses where clinic_id = p_clinic_id and license_type = p_license_type;

  insert into public.clinic_licenses (clinic_id, license_type, revision, storage_path, mime_type, size_bytes, uploaded_by)
  values (p_clinic_id, p_license_type, v_revision, p_storage_path, p_mime_type, p_size_bytes, v_uid)
  returning id into v_id;

  perform private.write_audit_event(
    'onboarding', 'license.submitted', 'success', p_clinic_id, 'clinic_license', v_id::text,
    jsonb_build_object('license_type', p_license_type, 'revision', v_revision)
  );
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform administration (ADM-001). No function here reads clinic
-- operational, clinical or financial records (ADM-003).
-- ---------------------------------------------------------------------------

-- ONB-003: review one licence revision.
create function public.admin_review_license(
  p_license_id uuid,
  p_decision public.license_review_status,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_license public.clinic_licenses%rowtype;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected', 'replacement_requested') then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;
  if p_decision <> 'approved' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_license from public.clinic_licenses where id = p_license_id for update;
  if not found or v_license.review_status <> 'submitted' then
    raise exception 'license_not_reviewable' using errcode = 'P0001';
  end if;

  update public.clinic_licenses
     set review_status = p_decision, reviewed_by = v_uid, reviewed_at = now(), review_reason = v_reason
   where id = p_license_id;

  insert into public.clinic_review_decisions (clinic_id, license_id, decision, reason, decided_by)
  values (v_license.clinic_id, p_license_id, p_decision, v_reason, v_uid);

  perform private.write_audit_event(
    'admin', 'license.reviewed', 'success', v_license.clinic_id, 'clinic_license', p_license_id::text,
    jsonb_build_object('decision', p_decision)
  );
end;
$$;

-- ONB-004 / SUB-003: activate a pending clinic once both current licences
-- are approved. The 14-day trial starts at the first activation only.
create function public.admin_activate_clinic(p_clinic_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clinic public.clinics%rowtype;
  v_type public.license_type;
  v_activated_at timestamptz;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_clinic from public.clinics where id = p_clinic_id for update;
  if not found or v_clinic.account_state <> 'pending' then
    raise exception 'clinic_not_pending' using errcode = 'P0001';
  end if;

  foreach v_type in array enum_range(null::public.license_type) loop
    if not exists (
      select 1 from public.clinic_licenses l
      where l.clinic_id = p_clinic_id and l.license_type = v_type and l.review_status = 'approved'
    ) then
      raise exception 'licenses_not_approved' using errcode = 'P0001';
    end if;
  end loop;

  v_activated_at := coalesce(v_clinic.activated_at, now());
  update public.clinics set account_state = 'active', activated_at = v_activated_at where id = p_clinic_id;

  insert into public.clinic_subscriptions (clinic_id, trial_started_at, trial_ends_at)
  values (p_clinic_id, v_activated_at, v_activated_at + interval '14 days')
  on conflict (clinic_id) do nothing;

  insert into public.clinic_state_events (clinic_id, from_state, to_state, reason, actor_user_id)
  values (p_clinic_id, 'pending', 'active', 'licenses_approved', v_uid);

  perform private.write_audit_event('admin', 'clinic.activated', 'success', p_clinic_id, 'clinic', p_clinic_id::text);
end;
$$;

-- ONB-005: suspend, reactivate or close an activated clinic. Closure never
-- deletes data and is final until the closure sequence is decided (OD-B01).
create function public.admin_set_clinic_state(
  p_clinic_id uuid,
  p_to_state public.clinic_account_state,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_from public.clinic_account_state;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select account_state into v_from from public.clinics where id = p_clinic_id for update;
  if not found then
    raise exception 'clinic_not_found' using errcode = 'P0001';
  end if;

  if not (
    (v_from = 'active' and p_to_state in ('suspended', 'closed'))
    or (v_from = 'suspended' and p_to_state in ('active', 'closed'))
    or (v_from = 'pending' and p_to_state = 'closed')
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.clinics set account_state = p_to_state where id = p_clinic_id;
  insert into public.clinic_state_events (clinic_id, from_state, to_state, reason, actor_user_id)
  values (p_clinic_id, v_from, p_to_state, v_reason, v_uid);

  perform private.write_audit_event(
    'admin', 'clinic.state_changed', 'success', p_clinic_id, 'clinic', p_clinic_id::text,
    jsonb_build_object('from', v_from, 'to', p_to_state)
  );
end;
$$;

-- Admin opens a licence file: audited, then the app creates a short-lived signed URL.
create function public.admin_record_license_access(p_license_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_clinic_id uuid;
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select storage_path, clinic_id into v_path, v_clinic_id from public.clinic_licenses where id = p_license_id;
  if not found then
    raise exception 'license_not_found' using errcode = 'P0001';
  end if;
  perform private.write_audit_event('admin', 'license.viewed', 'success', v_clinic_id, 'clinic_license', p_license_id::text);
  return v_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff functions (STA-002, STA-003, STA-005)
-- ---------------------------------------------------------------------------

-- Returns the raw token once so the inviter can share the link. Only its
-- SHA-256 hash is stored.
create function public.invite_staff(p_clinic_id uuid, p_email text, p_role public.clinic_role)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_existing public.membership_status;
begin
  if not private.has_capability(p_clinic_id, 'staff.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.clinic_accepts_setup_changes(p_clinic_id) then
    raise exception 'clinic_not_editable' using errcode = 'P0001';
  end if;
  if p_role = 'owner' then
    raise exception 'invalid_role' using errcode = 'P0001';
  end if;
  -- Managers may invite operational roles only (OD-B08).
  if p_role = 'manager' and not private.has_clinic_role(p_clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  select m.status into v_existing
    from public.clinic_memberships m join auth.users u on u.id = m.user_id
   where m.clinic_id = p_clinic_id and lower(u.email) = v_email;
  if v_existing = 'deactivated' then
    raise exception 'membership_deactivated' using errcode = 'P0001';
  elsif v_existing is not null then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  -- Expired invitations no longer block a new one.
  update public.clinic_invitations
     set revoked_at = now(), revoked_by = v_uid
   where clinic_id = p_clinic_id and email = v_email
     and accepted_at is null and revoked_at is null and expires_at <= now();

  if exists (
    select 1 from public.clinic_invitations i
    where i.clinic_id = p_clinic_id and i.email = v_email and i.accepted_at is null and i.revoked_at is null
  ) then
    raise exception 'invitation_pending' using errcode = 'P0001';
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.clinic_invitations (clinic_id, email, role, token_hash, invited_by, expires_at)
  values (p_clinic_id, v_email, p_role, extensions.digest(v_token, 'sha256'), v_uid, now() + interval '7 days')
  returning id into v_id;

  perform private.write_audit_event(
    'tenancy', 'invitation.created', 'success', p_clinic_id, 'clinic_invitation', v_id::text,
    jsonb_build_object('role', p_role)
  );
  return query select v_id, v_token;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.clinic_invitations%rowtype;
begin
  select * into v_inv from public.clinic_invitations where id = p_invitation_id for update;
  if not found or not private.has_capability(v_inv.clinic_id, 'staff.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'invitation_closed' using errcode = 'P0001';
  end if;

  update public.clinic_invitations set revoked_at = now(), revoked_by = v_uid where id = p_invitation_id;
  perform private.write_audit_event('tenancy', 'invitation.revoked', 'success', v_inv.clinic_id, 'clinic_invitation', p_invitation_id::text);
end;
$$;

create function private.invitation_status(p_inv public.clinic_invitations) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_inv.id is null then 'invalid'
    when p_inv.accepted_at is not null then 'used'
    when p_inv.revoked_at is not null then 'revoked'
    when p_inv.expires_at <= now() then 'expired'
    else 'valid'
  end;
$$;

-- What the invite page may show to the signed-in invitee. Clinic name and
-- role are revealed only to the account the invitation was sent to.
create function public.get_invitation_preview(p_token text)
returns table (status text, clinic_name text, role public.clinic_role, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.clinic_invitations%rowtype;
  v_status text;
  v_email text;
begin
  select * into v_inv from public.clinic_invitations i
   where i.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
  v_status := private.invitation_status(v_inv);
  if v_status <> 'valid' then
    return query select v_status, null::text, null::public.clinic_role, null::timestamptz;
    return;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_inv.email then
    return query select 'email_mismatch'::text, null::text, null::public.clinic_role, null::timestamptz;
    return;
  end if;

  return query
    select 'valid'::text, c.name, v_inv.role, v_inv.expires_at
    from public.clinics c where c.id = v_inv.clinic_id;
end;
$$;

create function public.accept_invitation(p_token text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.clinic_invitations%rowtype;
  v_status text;
  v_user auth.users%rowtype;
  v_existing public.membership_status;
begin
  select * into v_inv from public.clinic_invitations i
   where i.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
   for update;
  v_status := private.invitation_status(v_inv);
  if v_status <> 'valid' then
    raise exception 'invitation_%', v_status using errcode = 'P0001';
  end if;

  select * into v_user from auth.users u where u.id = v_uid;
  if lower(v_user.email) is distinct from v_inv.email then
    raise exception 'invitation_email_mismatch' using errcode = 'P0001';
  end if;
  if v_user.email_confirmed_at is null then
    raise exception 'email_not_confirmed' using errcode = 'P0001';
  end if;
  if not private.clinic_accepts_setup_changes(v_inv.clinic_id) then
    raise exception 'clinic_not_editable' using errcode = 'P0001';
  end if;

  select m.status into v_existing from public.clinic_memberships m
   where m.clinic_id = v_inv.clinic_id and m.user_id = v_uid;
  if v_existing = 'deactivated' then
    raise exception 'membership_deactivated' using errcode = 'P0001';
  elsif v_existing is not null then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.clinic_memberships (clinic_id, user_id, role, status)
  values (v_inv.clinic_id, v_uid, v_inv.role, 'active');
  update public.clinic_invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  perform private.write_audit_event(
    'tenancy', 'invitation.accepted', 'success', v_inv.clinic_id, 'clinic_invitation', v_inv.id::text,
    jsonb_build_object('role', v_inv.role)
  );
  return v_inv.clinic_id;
end;
$$;

-- STA-003 / STA-005. Suspension and deactivation take effect on the next
-- query, because every policy checks membership status (no reliance on token
-- expiry). Other clinics' memberships of the same person are unaffected.
create function public.set_membership_status(
  p_membership_id uuid,
  p_status public.membership_status,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target public.clinic_memberships%rowtype;
begin
  select * into v_target from public.clinic_memberships where id = p_membership_id for update;
  if not found or not private.has_capability(v_target.clinic_id, 'staff.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_target.role = 'owner' then
    raise exception 'owner_protected' using errcode = 'P0001';
  end if;
  if v_target.user_id = v_uid then
    raise exception 'cannot_change_self' using errcode = 'P0001';
  end if;
  if v_target.role = 'manager'
     and not private.has_clinic_role(v_target.clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.clinic_accepts_setup_changes(v_target.clinic_id) then
    raise exception 'clinic_not_editable' using errcode = 'P0001';
  end if;
  if not (
    (v_target.status = 'active' and p_status in ('suspended', 'deactivated'))
    or (v_target.status = 'suspended' and p_status in ('active', 'deactivated'))
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if p_status <> 'active' and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  update public.clinic_memberships set status = p_status where id = p_membership_id;
  perform private.write_audit_event(
    'tenancy', 'membership.status_changed', 'success', v_target.clinic_id, 'clinic_membership', p_membership_id::text,
    jsonb_build_object('from', v_target.status, 'to', p_status)
  );
end;
$$;

-- STA-005: role assignment is owner-only. Ownership transfer is out of scope.
create function public.change_member_role(p_membership_id uuid, p_role public.clinic_role) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.clinic_memberships%rowtype;
begin
  perform private.require_user();
  select * into v_target from public.clinic_memberships where id = p_membership_id for update;
  if not found or not private.has_clinic_role(v_target.clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_target.role = 'owner' or p_role = 'owner' then
    raise exception 'owner_protected' using errcode = 'P0001';
  end if;
  if v_target.status = 'deactivated' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if v_target.role = p_role then
    return;
  end if;

  update public.clinic_memberships set role = p_role where id = p_membership_id;
  perform private.write_audit_event(
    'tenancy', 'membership.role_changed', 'success', v_target.clinic_id, 'clinic_membership', p_membership_id::text,
    jsonb_build_object('from', v_target.role, 'to', p_role)
  );
end;
$$;

-- STA-001 / STA-005: owner-only permission changes.
create function public.set_role_permission(
  p_clinic_id uuid,
  p_role public.clinic_role,
  p_capability public.clinic_capability,
  p_allowed boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.has_clinic_role(p_clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Which roles a capability may be granted to (SRS §2: staff administration
  -- is delegable to managers only).
  if not (p_capability = 'staff.manage' and p_role = 'manager') then
    raise exception 'capability_not_grantable' using errcode = 'P0001';
  end if;
  if p_allowed is null then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;

  insert into public.clinic_role_permissions (clinic_id, role, capability, allowed, updated_by)
  values (p_clinic_id, p_role, p_capability, p_allowed, v_uid)
  on conflict (clinic_id, role, capability)
  do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now();

  perform private.write_audit_event(
    'tenancy', 'permission.changed', 'success', p_clinic_id, 'clinic_role_permission', null,
    jsonb_build_object('role', p_role, 'capability', p_capability, 'allowed', p_allowed)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function private.require_user() from public;
revoke all on function private.is_platform_admin() from public;
revoke all on function private.has_capability(uuid, public.clinic_capability) from public;
revoke all on function private.clinic_is_operational(uuid) from public;
revoke all on function private.clinic_accepts_setup_changes(uuid) from public;
revoke all on function private.clinic_id_from_path(text) from public;
revoke all on function private.can_view_profile(uuid) from public;
revoke all on function private.invitation_status(public.clinic_invitations) from public;
revoke all on function private.forbid_trial_start_change() from public;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.has_capability(uuid, public.clinic_capability) to authenticated;
grant execute on function private.clinic_id_from_path(text) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.register_clinic(text, uuid)',
    'public.submit_clinic_license(uuid, public.license_type, text, text, integer)',
    'public.admin_review_license(uuid, public.license_review_status, text)',
    'public.admin_activate_clinic(uuid)',
    'public.admin_set_clinic_state(uuid, public.clinic_account_state, text)',
    'public.admin_record_license_access(uuid)',
    'public.invite_staff(uuid, text, public.clinic_role)',
    'public.revoke_invitation(uuid)',
    'public.get_invitation_preview(text)',
    'public.accept_invitation(text)',
    'public.set_membership_status(uuid, public.membership_status, text)',
    'public.change_member_role(uuid, public.clinic_role)',
    'public.set_role_permission(uuid, public.clinic_role, public.clinic_capability, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS: read access only. All writes go through the functions above.
-- ---------------------------------------------------------------------------
alter table public.platform_admins enable row level security;
alter table public.clinic_role_permissions enable row level security;
alter table public.clinic_invitations enable row level security;
alter table public.clinic_licenses enable row level security;
alter table public.clinic_review_decisions enable row level security;
alter table public.clinic_state_events enable row level security;
alter table public.clinic_subscriptions enable row level security;
alter table public.legal_disclaimer_versions enable row level security;
alter table public.disclaimer_acceptances enable row level security;

revoke all on table
  public.platform_admins, public.clinic_role_permissions, public.clinic_invitations,
  public.clinic_licenses, public.clinic_review_decisions, public.clinic_state_events,
  public.clinic_subscriptions, public.legal_disclaimer_versions, public.disclaimer_acceptances
from anon, authenticated;

-- platform_admins: a user can learn only whether they themselves are an admin.
grant select on table public.platform_admins to authenticated;
create policy platform_admins_select_self on public.platform_admins
  for select to authenticated using (user_id = (select auth.uid()));

-- clinic_role_permissions: readable by active members of the clinic.
grant select on table public.clinic_role_permissions to authenticated;
create policy clinic_role_permissions_select_member on public.clinic_role_permissions
  for select to authenticated using (private.is_active_member(clinic_id));

-- clinic_invitations: staff managers of the clinic; the token hash is never readable.
grant select (id, clinic_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on table public.clinic_invitations to authenticated;
create policy clinic_invitations_select_staff_manager on public.clinic_invitations
  for select to authenticated using (private.has_capability(clinic_id, 'staff.manage'));

-- Licences, review decisions, state history: clinic owner and platform admins.
grant select on table public.clinic_licenses to authenticated;
create policy clinic_licenses_select_owner_or_admin on public.clinic_licenses
  for select to authenticated
  using (private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin());

grant select on table public.clinic_review_decisions to authenticated;
create policy clinic_review_decisions_select_owner_or_admin on public.clinic_review_decisions
  for select to authenticated
  using (private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin());

grant select on table public.clinic_state_events to authenticated;
create policy clinic_state_events_select_owner_or_admin on public.clinic_state_events
  for select to authenticated
  using (private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin());

grant select on table public.clinic_subscriptions to authenticated;
create policy clinic_subscriptions_select_owner_or_admin on public.clinic_subscriptions
  for select to authenticated
  using (private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin());

-- Disclaimer text is readable by any signed-in user (shown before registration).
grant select on table public.legal_disclaimer_versions to authenticated;
create policy legal_disclaimer_versions_select_all on public.legal_disclaimer_versions
  for select to authenticated using (true);

grant select on table public.disclaimer_acceptances to authenticated;
create policy disclaimer_acceptances_select_own on public.disclaimer_acceptances
  for select to authenticated using (user_id = (select auth.uid()));

-- Additional read paths on Milestone 0 tables.
create policy clinics_select_platform_admin on public.clinics
  for select to authenticated using (private.is_platform_admin());

create policy clinic_memberships_select_staff_manager on public.clinic_memberships
  for select to authenticated using (private.has_capability(clinic_id, 'staff.manage'));

create policy clinic_memberships_select_admin_owners on public.clinic_memberships
  for select to authenticated using (role = 'owner' and private.is_platform_admin());

create policy user_profiles_select_staff_or_admin on public.user_profiles
  for select to authenticated using (private.can_view_profile(user_id));

-- ---------------------------------------------------------------------------
-- Storage: private licence bucket (ONB-002). Objects are immutable; a
-- replacement is a new object and a new licence revision.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('licenses', 'licenses', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy licenses_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'licenses'
    and private.has_clinic_role(private.clinic_id_from_path(name), array['owner']::public.clinic_role[])
    and private.clinic_accepts_setup_changes(private.clinic_id_from_path(name))
  );

create policy licenses_select_owner_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'licenses'
    and (
      private.has_clinic_role(private.clinic_id_from_path(name), array['owner']::public.clinic_role[])
      or private.is_platform_admin()
    )
  );

grant execute on function private.clinic_accepts_setup_changes(uuid) to authenticated;
