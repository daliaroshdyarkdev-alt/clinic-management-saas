-- Milestone 2: doctors, scheduling policies, sessions, minimal patient
-- registry, appointments, check-in and queues.
-- SRS: APT-004..016, ONB-004 (operational gate), PAT-001 (minimal), PAT-003 (model).
--
-- Concurrency model (APT-016): every function that changes capacity or
-- numbering in a session first locks that session row (SELECT ... FOR
-- UPDATE), so bookings, check-ins and queue calls on one session are
-- serialised. A GiST exclusion constraint additionally forbids overlapping
-- timed appointments for a doctor, and unique indexes forbid duplicate
-- reservation and waiting numbers.
--
-- Policy options whose automatic variants need thresholds that are still
-- OPEN (late arrival, automatic no-show, hybrid queue order, offer expiry —
-- OPEN_DECISIONS OD-B04) are implemented only in their manual form.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.booking_method as enum ('timed', 'queue');
create type public.overbooking_policy as enum ('disallow', 'receptionist_override', 'doctor_or_owner_approval');
create type public.queue_ordering as enum ('fcfs', 'reservation_priority');
create type public.walk_in_policy as enum ('auto_append', 'receptionist_placement');
create type public.absent_policy as enum ('move_to_end', 'skip_and_prioritize', 'receptionist_assignment');
create type public.patient_cancellation_policy as enum (
  'receptionist_only', 'patient_self_service', 'patient_request_approval'
);
create type public.appointment_status as enum (
  'awaiting_approval', 'booked', 'checked_in', 'called', 'absent', 'completed', 'cancelled', 'no_show'
);
create type public.patient_gender as enum ('male', 'female');

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------

-- APT-015: owners and receptionists manage appointments for all doctors of
-- their clinic; managers only when the owner granted appointments.manage.
create function private.can_manage_appointments(p_clinic_id uuid) returns boolean
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
        m.role in ('owner', 'receptionist')
        or (
          m.role = 'manager'
          and exists (
            select 1 from public.clinic_role_permissions p
            where p.clinic_id = m.clinic_id and p.role = 'manager'
              and p.capability = 'appointments.manage' and p.allowed
          )
        )
      )
  );
$$;

create or replace function public.set_role_permission(
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
  -- Staff administration and appointment management are delegable to
  -- managers only (SRS §2, permission matrix).
  if not (p_capability in ('staff.manage', 'appointments.manage') and p_role = 'manager') then
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

create function private.require_operational(p_clinic_id uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.clinic_is_operational(p_clinic_id) then
    raise exception 'clinic_not_operational' using errcode = 'P0001';
  end if;
end;
$$;

create function private.clinic_today(p_clinic_id uuid) returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone c.timezone)::date from public.clinics c where c.id = p_clinic_id;
$$;

-- ---------------------------------------------------------------------------
-- Doctors and scheduling configuration
-- ---------------------------------------------------------------------------
alter table public.clinics add column online_booking_enabled boolean not null default false;

create table public.clinic_doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 2 and 200),
  specialty text check (char_length(specialty) <= 200),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, user_id),
  unique (clinic_id, id)
);

create trigger clinic_doctors_updated_at before update on public.clinic_doctors
  for each row execute function private.set_updated_at();
create trigger clinic_doctors_clinic_id_immutable before update on public.clinic_doctors
  for each row execute function private.forbid_clinic_id_change();

-- The signed-in user's active doctor record in a clinic (needs an active membership).
create function private.is_clinic_doctor_self(p_clinic_doctor_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_doctors d
    join public.clinic_memberships m on m.clinic_id = d.clinic_id and m.user_id = d.user_id
    where d.id = p_clinic_doctor_id
      and d.user_id = (select auth.uid())
      and d.status = 'active'
      and m.status = 'active'
  );
$$;

-- APT-004/005: a doctor sets their own scheduling preferences; the owner may too.
create function private.can_manage_doctor_schedule(p_clinic_doctor_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_clinic_doctor_self(p_clinic_doctor_id)
    or exists (
      select 1 from public.clinic_doctors d
      where d.id = p_clinic_doctor_id
        and private.has_clinic_role(d.clinic_id, array['owner']::public.clinic_role[])
    );
$$;

create table public.doctor_scheduling_policies (
  clinic_doctor_id uuid primary key,
  clinic_id uuid not null,
  method public.booking_method not null,
  slot_minutes integer check (slot_minutes between 5 and 240),
  overbooking public.overbooking_policy not null,
  queue_ordering public.queue_ordering not null,
  walk_in public.walk_in_policy not null,
  absent_when_called public.absent_policy not null,
  patient_cancellation public.patient_cancellation_policy not null,
  updated_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict,
  check (method <> 'timed' or slot_minutes is not null)
);

create table public.doctor_weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_doctor_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday (extract(dow))
  start_time time not null,
  end_time time not null check (end_time > start_time),
  capacity integer check (capacity between 1 and 500),
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict
);

create index doctor_weekly_schedules_doctor_idx on public.doctor_weekly_schedules (clinic_doctor_id, weekday);

create table public.doctor_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_doctor_id uuid not null,
  exception_date date not null,
  kind text not null check (kind in ('day_off', 'extra_session')),
  start_time time,
  end_time time,
  capacity integer check (capacity between 1 and 500),
  reason text check (char_length(reason) <= 500),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict,
  check (kind = 'day_off' or (start_time is not null and end_time is not null and end_time > start_time))
);

create index doctor_schedule_exceptions_doctor_idx on public.doctor_schedule_exceptions (clinic_doctor_id, exception_date);

create table public.doctor_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_doctor_id uuid not null,
  session_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  method public.booking_method not null,
  capacity integer check (capacity between 1 and 500),
  slot_minutes integer check (slot_minutes between 5 and 240),
  source text not null check (source in ('weekly', 'extra')),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancelled_reason text check (char_length(cancelled_reason) <= 500),
  cancelled_by uuid references auth.users (id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict,
  unique (clinic_doctor_id, starts_at),
  unique (clinic_id, id),
  check ((method = 'queue' and capacity is not null) or (method = 'timed' and slot_minutes is not null)),
  -- A doctor never has two overlapping scheduled sessions.
  exclude using gist (clinic_doctor_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'scheduled')
);

create index doctor_sessions_clinic_date_idx on public.doctor_sessions (clinic_id, session_date);

create trigger doctor_sessions_clinic_id_immutable before update on public.doctor_sessions
  for each row execute function private.forbid_clinic_id_change();

-- Creates missing sessions from the weekly schedule and extra-session
-- exceptions for [p_from, p_to] in the clinic's local time zone. Idempotent:
-- existing (including cancelled) sessions are never recreated or changed.
create function private.materialize_sessions(p_clinic_doctor_id uuid, p_from date, p_to date) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doctor public.clinic_doctors%rowtype;
  v_tz text;
  v_policy public.doctor_scheduling_policies%rowtype;
begin
  select * into v_doctor from public.clinic_doctors where id = p_clinic_doctor_id;
  if not found or v_doctor.status <> 'active' then
    return;
  end if;
  select * into v_policy from public.doctor_scheduling_policies where clinic_doctor_id = p_clinic_doctor_id;
  if not found then
    return; -- no sessions until the doctor's booking method is chosen (APT-004)
  end if;
  select timezone into v_tz from public.clinics where id = v_doctor.clinic_id;

  insert into public.doctor_sessions (
    clinic_id, clinic_doctor_id, session_date, starts_at, ends_at, method, capacity, slot_minutes, source
  )
  select v_doctor.clinic_id, v_doctor.id, g.day,
         (g.day + w.start_time) at time zone v_tz,
         (g.day + w.end_time) at time zone v_tz,
         v_policy.method,
         case when v_policy.method = 'queue' then w.capacity end,
         case when v_policy.method = 'timed' then v_policy.slot_minutes end,
         'weekly'
  from (select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d) g
  join public.doctor_weekly_schedules w
    on w.clinic_doctor_id = v_doctor.id and w.weekday = extract(dow from g.day)::smallint
  where (v_policy.method = 'timed' or w.capacity is not null)
    and not exists (
      select 1 from public.doctor_schedule_exceptions e
      where e.clinic_doctor_id = v_doctor.id and e.exception_date = g.day and e.kind = 'day_off'
    )
  on conflict do nothing;

  insert into public.doctor_sessions (
    clinic_id, clinic_doctor_id, session_date, starts_at, ends_at, method, capacity, slot_minutes, source
  )
  select v_doctor.clinic_id, v_doctor.id, e.exception_date,
         (e.exception_date + e.start_time) at time zone v_tz,
         (e.exception_date + e.end_time) at time zone v_tz,
         v_policy.method,
         case when v_policy.method = 'queue' then e.capacity end,
         case when v_policy.method = 'timed' then v_policy.slot_minutes end,
         'extra'
  from public.doctor_schedule_exceptions e
  where e.clinic_doctor_id = v_doctor.id and e.kind = 'extra_session'
    and e.exception_date between p_from and p_to
    and (v_policy.method = 'timed' or e.capacity is not null)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Minimal patient registry (needed for booking). Duplicate detection and
-- cross-clinic identity linking arrive in Milestone 3 (PAT-002..004): until
-- then every registration creates its own identity and nothing is merged.
-- ---------------------------------------------------------------------------
create table public.patient_identities (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 200),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  date_of_birth date not null check (date_of_birth > date '1900-01-01'),
  gender public.patient_gender not null,
  created_at timestamptz not null default now()
);

create table public.clinic_patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  patient_identity_id uuid not null references public.patient_identities (id) on delete restrict,
  chart_number integer not null check (chart_number > 0),
  address text not null check (char_length(address) between 2 and 500),
  -- Exact ID document types are OPEN (OD-B02): optional free text for now.
  identification text check (char_length(identification) <= 100),
  preferred_language public.app_locale,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, patient_identity_id),
  unique (clinic_id, chart_number),
  unique (clinic_id, id)
);

create trigger clinic_patients_clinic_id_immutable before update on public.clinic_patients
  for each row execute function private.forbid_clinic_id_change();

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_doctor_id uuid not null,
  session_id uuid not null,
  clinic_patient_id uuid not null,
  method public.booking_method not null,
  starts_at timestamptz,
  ends_at timestamptz,
  reservation_number integer check (reservation_number > 0),
  waiting_number integer check (waiting_number > 0),
  queue_rank numeric,
  placement_open boolean not null default false,
  status public.appointment_status not null,
  is_overbooked boolean not null default false,
  overbook_reason text check (char_length(overbook_reason) <= 500),
  source text not null check (source in ('reception', 'walk_in', 'online_request')),
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checked_in_at timestamptz,
  called_at timestamptz,
  completed_at timestamptz,
  foreign key (clinic_id, session_id) references public.doctor_sessions (clinic_id, id) on delete restrict,
  foreign key (clinic_id, clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict,
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict,
  check (method <> 'timed' or (starts_at is not null and ends_at > starts_at)),
  check (method <> 'queue' or reservation_number is not null),
  -- A doctor's regular (non-overbooked) timed appointments never overlap.
  exclude using gist (clinic_doctor_id with =, tstzrange(starts_at, ends_at) with &&)
    where (method = 'timed' and not is_overbooked and status not in ('cancelled', 'no_show'))
);

-- APT-006: reservation numbers (at confirmation) and waiting numbers (at
-- check-in) are separate sequences, each unique within the session.
create unique index appointments_reservation_number_uq on public.appointments (session_id, reservation_number)
  where reservation_number is not null;
create unique index appointments_waiting_number_uq on public.appointments (session_id, waiting_number)
  where waiting_number is not null;
create unique index appointments_one_active_per_patient_session on public.appointments (session_id, clinic_patient_id)
  where status not in ('cancelled', 'no_show');
create index appointments_clinic_doctor_idx on public.appointments (clinic_id, clinic_doctor_id, session_id);

create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger appointments_clinic_id_immutable before update on public.appointments
  for each row execute function private.forbid_clinic_id_change();

create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  actor_user_id uuid references auth.users (id) on delete restrict,
  action text not null check (char_length(action) <= 50),
  from_status public.appointment_status,
  to_status public.appointment_status not null,
  reason text check (char_length(reason) <= 500),
  occurred_at timestamptz not null default now()
);

create index appointment_events_appointment_idx on public.appointment_events (appointment_id, occurred_at);

create trigger appointment_events_append_only before update or delete on public.appointment_events
  for each row execute function private.forbid_mutation();

create function private.log_appointment(
  p_appointment_id uuid, p_clinic_id uuid, p_action text,
  p_from public.appointment_status, p_to public.appointment_status, p_reason text default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.appointment_events (appointment_id, clinic_id, actor_user_id, action, from_status, to_status, reason)
  values (p_appointment_id, p_clinic_id, auth.uid(), p_action, p_from, p_to, p_reason);
$$;

-- Future, untouched sessions are regenerated after a policy or schedule
-- change; sessions that already hold appointments are kept for reception to handle.
create function private.discard_unused_future_sessions(p_clinic_doctor_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.doctor_sessions s
  where s.clinic_doctor_id = p_clinic_doctor_id
    and s.source = 'weekly'
    and s.starts_at > now()
    and not exists (select 1 from public.appointments a where a.session_id = s.id);
$$;

-- Read access helpers for patients and appointments.
create function private.can_view_appointment(p_clinic_id uuid, p_clinic_doctor_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_appointments(p_clinic_id) or private.is_clinic_doctor_self(p_clinic_doctor_id);
$$;

-- Demographics only (never medical content): appointment managers of the
-- clinic, and doctors for patients booked with them.
create function private.can_view_clinic_patient(p_clinic_patient_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.clinic_patients cp
      where cp.id = p_clinic_patient_id and private.can_manage_appointments(cp.clinic_id)
    )
    or exists (
      select 1 from public.appointments a
      where a.clinic_patient_id = p_clinic_patient_id and private.is_clinic_doctor_self(a.clinic_doctor_id)
    );
$$;

-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------

-- Free timed slots of a session (empty for queue sessions).
create function private.session_free_slots(p_session_id uuid) returns setof timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select g.slot
  from public.doctor_sessions s
  cross join lateral generate_series(
    s.starts_at, s.ends_at - make_interval(mins => s.slot_minutes), make_interval(mins => s.slot_minutes)
  ) as g(slot)
  where s.id = p_session_id and s.method = 'timed' and s.status = 'scheduled'
    and g.slot > now()
    and not exists (
      select 1 from public.appointments a
      where a.session_id = s.id and a.method = 'timed' and not a.is_overbooked
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(g.slot, g.slot + make_interval(mins => s.slot_minutes))
    )
  order by g.slot;
$$;

-- Remaining regular places of a queue session (null for timed sessions).
create function private.session_remaining(p_session_id uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.method = 'queue' then greatest(
    s.capacity - (
      select count(*)::integer from public.appointments a
      where a.session_id = s.id and not a.is_overbooked and a.status not in ('cancelled', 'no_show')
    ), 0) end
  from public.doctor_sessions s where s.id = p_session_id;
$$;

-- ---------------------------------------------------------------------------
-- Core booking routine. Callers authorise first; this function enforces
-- capacity, slot alignment, overbooking policy and numbering under the
-- session lock.
-- ---------------------------------------------------------------------------
create function private.book(
  p_session_id uuid,
  p_clinic_patient_id uuid,
  p_starts_at timestamptz,
  p_overbook boolean,
  p_reason text,
  p_source text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.doctor_sessions%rowtype;
  v_policy public.doctor_scheduling_policies%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_end timestamptz;
  v_full boolean;
  v_status public.appointment_status := 'booked';
  v_overbooked boolean := false;
  v_reservation integer;
  v_id uuid;
begin
  select * into v_session from public.doctor_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'session_cancelled' using errcode = 'P0001';
  end if;
  if v_session.ends_at <= now() then
    raise exception 'session_in_past' using errcode = 'P0001';
  end if;
  perform private.require_operational(v_session.clinic_id);

  if not exists (
    select 1 from public.clinic_patients cp where cp.id = p_clinic_patient_id and cp.clinic_id = v_session.clinic_id
  ) then
    raise exception 'patient_not_found' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.appointments a
    where a.session_id = v_session.id and a.clinic_patient_id = p_clinic_patient_id
      and a.status not in ('cancelled', 'no_show')
  ) then
    raise exception 'already_booked' using errcode = 'P0001';
  end if;

  select * into v_policy from public.doctor_scheduling_policies where clinic_doctor_id = v_session.clinic_doctor_id;

  if v_session.method = 'timed' then
    if p_starts_at is null
       or p_starts_at < v_session.starts_at
       or p_starts_at + make_interval(mins => v_session.slot_minutes) > v_session.ends_at
       or (extract(epoch from (p_starts_at - v_session.starts_at))::bigint % (v_session.slot_minutes * 60)) <> 0
       or p_starts_at <= now() then
      raise exception 'invalid_slot' using errcode = 'P0001';
    end if;
    v_end := p_starts_at + make_interval(mins => v_session.slot_minutes);
    v_full := exists (
      select 1 from public.appointments a
      where a.session_id = v_session.id and a.method = 'timed' and not a.is_overbooked
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_starts_at, v_end)
    );
  else
    v_full := private.session_remaining(v_session.id) <= 0;
  end if;

  if v_full then
    if not coalesce(p_overbook, false) then
      raise exception '%', case when v_session.method = 'timed' then 'slot_taken' else 'session_full' end
        using errcode = 'P0001';
    end if;
    -- APT-011: the doctor's overbooking policy cannot be bypassed.
    if v_policy.overbooking = 'disallow' then
      raise exception 'overbooking_not_allowed' using errcode = 'P0001';
    end if;
    if v_reason is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_overbooked := true;
    if v_policy.overbooking = 'doctor_or_owner_approval' then
      v_status := 'awaiting_approval';
    end if;
  end if;

  if v_session.method = 'queue' then
    select coalesce(max(a.reservation_number), 0) + 1 into v_reservation
      from public.appointments a where a.session_id = v_session.id;
  end if;

  insert into public.appointments (
    clinic_id, clinic_doctor_id, session_id, clinic_patient_id, method, starts_at, ends_at,
    reservation_number, status, is_overbooked, overbook_reason, source, created_by
  ) values (
    v_session.clinic_id, v_session.clinic_doctor_id, v_session.id, p_clinic_patient_id, v_session.method,
    case when v_session.method = 'timed' then p_starts_at end, v_end,
    v_reservation, v_status, v_overbooked, case when v_overbooked then v_reason end, p_source, auth.uid()
  ) returning id into v_id;

  perform private.log_appointment(v_id, v_session.clinic_id, 'booked', null, v_status, case when v_overbooked then v_reason end);
  return v_id;
end;
$$;

-- Ordering key at check-in (APT-007).
create function private.base_queue_rank(p_appointment public.appointments, p_ordering public.queue_ordering) returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_appointment.method = 'timed' then extract(epoch from p_appointment.starts_at)::numeric
    when p_ordering = 'reservation_priority' then p_appointment.reservation_number::numeric
    else p_appointment.waiting_number::numeric
  end;
$$;

-- ---------------------------------------------------------------------------
-- Public functions: configuration
-- ---------------------------------------------------------------------------

create function public.add_clinic_doctor(p_membership_id uuid, p_display_name text, p_specialty text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.clinic_memberships%rowtype;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_id uuid;
begin
  perform private.require_user();
  select * into v_member from public.clinic_memberships where id = p_membership_id;
  if not found or not private.has_clinic_role(v_member.clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_member.status <> 'active' or v_member.role not in ('doctor', 'owner') then
    raise exception 'not_a_doctor_member' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 2 and 200 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.clinic_doctors d where d.clinic_id = v_member.clinic_id and d.user_id = v_member.user_id) then
    raise exception 'already_doctor' using errcode = 'P0001';
  end if;

  insert into public.clinic_doctors (clinic_id, user_id, display_name, specialty)
  values (v_member.clinic_id, v_member.user_id, v_name, nullif(btrim(coalesce(p_specialty, '')), ''))
  returning id into v_id;

  perform private.write_audit_event('appointments', 'doctor.added', 'success', v_member.clinic_id, 'clinic_doctor', v_id::text);
  return v_id;
end;
$$;

create function public.set_clinic_doctor_status(p_clinic_doctor_id uuid, p_status text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  perform private.require_user();
  select clinic_id into v_clinic_id from public.clinic_doctors where id = p_clinic_doctor_id;
  if not found or not private.has_clinic_role(v_clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('active', 'inactive') then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  update public.clinic_doctors set status = p_status where id = p_clinic_doctor_id;
  perform private.write_audit_event('appointments', 'doctor.status_changed', 'success', v_clinic_id, 'clinic_doctor',
    p_clinic_doctor_id::text, jsonb_build_object('to', p_status));
end;
$$;

-- APT-004, APT-007..011, APT-013, APT-014 (manual modes only, OD-B04).
create function public.set_scheduling_policy(
  p_clinic_doctor_id uuid,
  p_method public.booking_method,
  p_slot_minutes integer,
  p_overbooking public.overbooking_policy,
  p_queue_ordering public.queue_ordering,
  p_walk_in public.walk_in_policy,
  p_absent_when_called public.absent_policy,
  p_patient_cancellation public.patient_cancellation_policy
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.clinic_doctors where id = p_clinic_doctor_id;
  if not found or not private.can_manage_doctor_schedule(p_clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_method is null or p_overbooking is null or p_queue_ordering is null or p_walk_in is null
     or p_absent_when_called is null or p_patient_cancellation is null
     or (p_method = 'timed' and (p_slot_minutes is null or p_slot_minutes not between 5 and 240)) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;

  insert into public.doctor_scheduling_policies (
    clinic_doctor_id, clinic_id, method, slot_minutes, overbooking, queue_ordering, walk_in,
    absent_when_called, patient_cancellation, updated_by
  ) values (
    p_clinic_doctor_id, v_clinic_id, p_method, case when p_method = 'timed' then p_slot_minutes end, p_overbooking,
    p_queue_ordering, p_walk_in, p_absent_when_called, p_patient_cancellation, v_uid
  )
  on conflict (clinic_doctor_id) do update set
    method = excluded.method, slot_minutes = excluded.slot_minutes, overbooking = excluded.overbooking,
    queue_ordering = excluded.queue_ordering, walk_in = excluded.walk_in,
    absent_when_called = excluded.absent_when_called, patient_cancellation = excluded.patient_cancellation,
    updated_by = excluded.updated_by, updated_at = now();

  perform private.discard_unused_future_sessions(p_clinic_doctor_id);
  perform private.write_audit_event('appointments', 'doctor.policy_changed', 'success', v_clinic_id, 'clinic_doctor',
    p_clinic_doctor_id::text, jsonb_build_object('method', p_method));
end;
$$;

-- APT-005: replaces the weekly schedule. p_slots is a JSON array of
-- {"weekday": 0-6, "start": "HH:MM", "end": "HH:MM", "capacity": n|null}.
create function public.set_weekly_schedule(p_clinic_doctor_id uuid, p_slots jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_count integer;
begin
  perform private.require_user();
  select clinic_id into v_clinic_id from public.clinic_doctors where id = p_clinic_doctor_id;
  if not found or not private.can_manage_doctor_schedule(p_clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 50 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;

  delete from public.doctor_weekly_schedules where clinic_doctor_id = p_clinic_doctor_id;
  begin
    insert into public.doctor_weekly_schedules (clinic_id, clinic_doctor_id, weekday, start_time, end_time, capacity)
    select v_clinic_id, p_clinic_doctor_id, (s ->> 'weekday')::smallint, (s ->> 'start')::time, (s ->> 'end')::time,
           nullif(s ->> 'capacity', '')::integer
    from jsonb_array_elements(p_slots) s;
  exception when others then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;

  select count(*) into v_count
  from public.doctor_weekly_schedules a
  join public.doctor_weekly_schedules b
    on a.clinic_doctor_id = b.clinic_doctor_id and a.weekday = b.weekday and a.id < b.id
   and a.start_time < b.end_time and b.start_time < a.end_time
  where a.clinic_doctor_id = p_clinic_doctor_id;
  if v_count > 0 then
    raise exception 'session_overlap' using errcode = 'P0001';
  end if;

  perform private.discard_unused_future_sessions(p_clinic_doctor_id);
  perform private.write_audit_event('appointments', 'doctor.schedule_changed', 'success', v_clinic_id, 'clinic_doctor',
    p_clinic_doctor_id::text);
end;
$$;

-- APT-005 / APT-012: day off (cancels that day's sessions) or extra session.
create function public.add_schedule_exception(
  p_clinic_doctor_id uuid,
  p_date date,
  p_kind text,
  p_start time,
  p_end time,
  p_capacity integer,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clinic_id uuid;
  v_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select clinic_id into v_clinic_id from public.clinic_doctors where id = p_clinic_doctor_id;
  if not found or not (private.can_manage_doctor_schedule(p_clinic_doctor_id) or private.can_manage_appointments(v_clinic_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('day_off', 'extra_session') or p_date is null or p_date < private.clinic_today(v_clinic_id) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;

  begin
    insert into public.doctor_schedule_exceptions (clinic_id, clinic_doctor_id, exception_date, kind, start_time, end_time, capacity, reason, created_by)
    values (v_clinic_id, p_clinic_doctor_id, p_date, p_kind,
            case when p_kind = 'extra_session' then p_start end, case when p_kind = 'extra_session' then p_end end,
            case when p_kind = 'extra_session' then p_capacity end, v_reason, v_uid)
    returning id into v_id;
  exception when check_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;

  if p_kind = 'day_off' then
    update public.doctor_sessions
       set status = 'cancelled', cancelled_reason = coalesce(v_reason, 'day_off'), cancelled_by = v_uid, cancelled_at = now()
     where clinic_doctor_id = p_clinic_doctor_id and session_date = p_date and status = 'scheduled';
  else
    begin
      perform private.materialize_sessions(p_clinic_doctor_id, p_date, p_date);
    exception when exclusion_violation then
      raise exception 'session_overlap' using errcode = 'P0001';
    end;
    if not exists (
      select 1 from public.doctor_sessions s
      where s.clinic_doctor_id = p_clinic_doctor_id and s.session_date = p_date and s.source = 'extra'
        and s.starts_at = (p_date + p_start) at time zone (select timezone from public.clinics where id = v_clinic_id)
    ) then
      raise exception 'session_overlap' using errcode = 'P0001';
    end if;
  end if;

  perform private.write_audit_event('appointments', 'doctor.schedule_exception', 'success', v_clinic_id, 'clinic_doctor',
    p_clinic_doctor_id::text, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

-- Makes sure sessions exist for a date window before staff screens list them.
create function public.ensure_sessions(p_clinic_id uuid, p_from date, p_to date) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doctor uuid;
begin
  perform private.require_user();
  if not private.is_active_member(p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  for v_doctor in select id from public.clinic_doctors where clinic_id = p_clinic_id and status = 'active' loop
    perform private.materialize_sessions(v_doctor, p_from, p_to);
  end loop;
end;
$$;

-- APT-012: cancelling a session keeps its appointments; reception then
-- cancels or rebooks each one individually.
create function public.cancel_doctor_session(p_session_id uuid, p_reason text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_session public.doctor_sessions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_affected integer;
begin
  select * into v_session from public.doctor_sessions where id = p_session_id for update;
  if not found or not (
    private.can_manage_doctor_schedule(v_session.clinic_doctor_id) or private.can_manage_appointments(v_session.clinic_id)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'session_cancelled' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  update public.doctor_sessions
     set status = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_uid, cancelled_at = now()
   where id = p_session_id;

  select count(*) into v_affected from public.appointments
   where session_id = p_session_id and status in ('awaiting_approval', 'booked', 'checked_in');

  perform private.write_audit_event('appointments', 'session.cancelled', 'success', v_session.clinic_id, 'doctor_session',
    p_session_id::text, jsonb_build_object('affected', v_affected));
  return v_affected;
end;
$$;

create function public.set_online_booking(p_clinic_id uuid, p_enabled boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not private.has_clinic_role(p_clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.clinics set online_booking_enabled = coalesce(p_enabled, false) where id = p_clinic_id;
  perform private.write_audit_event('appointments', 'online_booking.changed', 'success', p_clinic_id, 'clinic',
    p_clinic_id::text, jsonb_build_object('enabled', coalesce(p_enabled, false)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Public functions: patients and appointments
-- ---------------------------------------------------------------------------

-- PAT-001 (minimal). Correction/merge workflow is OPEN (PAT-006).
create function public.register_clinic_patient(
  p_clinic_id uuid,
  p_full_name text,
  p_phone_e164 text,
  p_date_of_birth date,
  p_gender public.patient_gender,
  p_address text,
  p_identification text,
  p_preferred_language public.app_locale
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_identity uuid;
  v_chart integer;
  v_id uuid;
begin
  if not private.can_manage_appointments(p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_operational(p_clinic_id);
  if p_date_of_birth is null or p_date_of_birth > private.clinic_today(p_clinic_id) then
    raise exception 'invalid_patient' using errcode = 'P0001';
  end if;

  perform 1 from public.clinics where id = p_clinic_id for update; -- serialise chart numbers
  select coalesce(max(chart_number), 0) + 1 into v_chart from public.clinic_patients where clinic_id = p_clinic_id;

  begin
    insert into public.patient_identities (full_name, phone_e164, date_of_birth, gender)
    values (btrim(p_full_name), btrim(p_phone_e164), p_date_of_birth, p_gender)
    returning id into v_identity;

    insert into public.clinic_patients (clinic_id, patient_identity_id, chart_number, address, identification, preferred_language, created_by)
    values (p_clinic_id, v_identity, v_chart, btrim(p_address), nullif(btrim(coalesce(p_identification, '')), ''),
            p_preferred_language, v_uid)
    returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_patient' using errcode = 'P0001';
  end;

  perform private.write_audit_event('appointments', 'patient.registered', 'success', p_clinic_id, 'clinic_patient', v_id::text);
  return v_id;
end;
$$;

-- APT-001: reception books directly (all doctors of the clinic).
create function public.book_appointment(
  p_session_id uuid,
  p_clinic_patient_id uuid,
  p_starts_at timestamptz,
  p_overbook boolean,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_id uuid;
begin
  perform private.require_user();
  select clinic_id into v_clinic_id from public.doctor_sessions where id = p_session_id;
  if not found or not private.can_manage_appointments(v_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_id := private.book(p_session_id, p_clinic_patient_id, p_starts_at, p_overbook, p_reason, 'reception');
  perform private.write_audit_event('appointments', 'appointment.booked', 'success', v_clinic_id, 'appointment', v_id::text);
  return v_id;
end;
$$;

-- APT-011: the session's doctor or the clinic owner decides on an
-- overbooking that needs approval.
create function public.decide_overbooking(p_appointment_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_to public.appointment_status;
begin
  perform private.require_user();
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if not found or not (
    private.is_clinic_doctor_self(v_appt.clinic_doctor_id)
    or private.has_clinic_role(v_appt.clinic_id, array['owner']::public.clinic_role[])
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status <> 'awaiting_approval' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  v_to := case when p_approve then 'booked' else 'cancelled' end;
  update public.appointments set status = v_to where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id,
    case when p_approve then 'overbooking_approved' else 'overbooking_rejected' end, v_appt.status, v_to, p_reason);
  perform private.write_audit_event('appointments', 'appointment.overbooking_decided', 'success', v_appt.clinic_id,
    'appointment', p_appointment_id::text, jsonb_build_object('approved', p_approve));
end;
$$;

create function public.cancel_appointment(p_appointment_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.require_user();
  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found or not private.can_manage_appointments(v_appt.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.doctor_sessions where id = v_appt.session_id for update;
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.status not in ('awaiting_approval', 'booked', 'checked_in', 'absent') then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  update public.appointments set status = 'cancelled' where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id, 'cancelled', v_appt.status, 'cancelled', v_reason);
  perform private.write_audit_event('appointments', 'appointment.cancelled', 'success', v_appt.clinic_id, 'appointment',
    p_appointment_id::text);
end;
$$;

-- Loads and locks an appointment together with its session (session first,
-- matching the lock order of private.book).
create function private.lock_appointment(p_appointment_id uuid) returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_appt public.appointments%rowtype;
begin
  select session_id into v_session_id from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.doctor_sessions where id = v_session_id for update;
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  return v_appt;
end;
$$;

-- APT-006: check-in assigns the waiting number (queue sessions), separate
-- from the reservation number given at booking.
create function public.check_in_appointment(p_appointment_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_session public.doctor_sessions%rowtype;
  v_policy public.doctor_scheduling_policies%rowtype;
  v_waiting integer;
begin
  perform private.require_user();
  v_appt := private.lock_appointment(p_appointment_id);
  if not private.can_manage_appointments(v_appt.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_session from public.doctor_sessions where id = v_appt.session_id;
  if v_appt.status <> 'booked' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'session_cancelled' using errcode = 'P0001';
  end if;
  if v_session.session_date <> private.clinic_today(v_appt.clinic_id) then
    raise exception 'not_session_day' using errcode = 'P0001';
  end if;
  select * into v_policy from public.doctor_scheduling_policies where clinic_doctor_id = v_appt.clinic_doctor_id;

  if v_appt.method = 'queue' then
    select coalesce(max(waiting_number), 0) + 1 into v_waiting from public.appointments where session_id = v_appt.session_id;
  end if;

  v_appt.waiting_number := v_waiting;
  update public.appointments
     set status = 'checked_in', waiting_number = v_waiting, checked_in_at = now(),
         queue_rank = private.base_queue_rank(v_appt, v_policy.queue_ordering)
   where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id, 'checked_in', 'booked', 'checked_in');
  return v_waiting;
end;
$$;

-- APT-009: walk-in = booking + immediate check-in (queue sessions only).
create function public.register_walk_in(
  p_session_id uuid,
  p_clinic_patient_id uuid,
  p_overbook boolean,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.doctor_sessions%rowtype;
  v_policy public.doctor_scheduling_policies%rowtype;
  v_appt public.appointments%rowtype;
  v_id uuid;
  v_waiting integer;
begin
  perform private.require_user();
  select * into v_session from public.doctor_sessions where id = p_session_id;
  if not found or not private.can_manage_appointments(v_session.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_session.method <> 'queue' then
    raise exception 'walk_in_requires_queue' using errcode = 'P0001';
  end if;
  if v_session.session_date <> private.clinic_today(v_session.clinic_id) then
    raise exception 'not_session_day' using errcode = 'P0001';
  end if;

  v_id := private.book(p_session_id, p_clinic_patient_id, null, p_overbook, p_reason, 'walk_in');
  select * into v_appt from public.appointments where id = v_id;
  if v_appt.status <> 'booked' then
    return v_id; -- awaiting overbooking approval; checked in once approved
  end if;

  select * into v_policy from public.doctor_scheduling_policies where clinic_doctor_id = v_session.clinic_doctor_id;
  select coalesce(max(waiting_number), 0) + 1 into v_waiting from public.appointments where session_id = p_session_id;
  v_appt.waiting_number := v_waiting;
  update public.appointments
     set status = 'checked_in', waiting_number = v_waiting, checked_in_at = now(),
         queue_rank = private.base_queue_rank(v_appt, v_policy.queue_ordering),
         placement_open = (v_policy.walk_in = 'receptionist_placement')
   where id = v_id;
  perform private.log_appointment(v_id, v_session.clinic_id, 'walk_in_checked_in', 'booked', 'checked_in');
  perform private.write_audit_event('appointments', 'appointment.walk_in', 'success', v_session.clinic_id, 'appointment', v_id::text);
  return v_id;
end;
$$;

-- APT-009 / APT-010: reception places a patient in the queue when the
-- doctor's policy gives reception that choice. NULL "before" = end of queue.
create function public.place_in_queue(p_appointment_id uuid, p_before_appointment_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_before public.appointments%rowtype;
  v_prev numeric;
  v_rank numeric;
begin
  perform private.require_user();
  v_appt := private.lock_appointment(p_appointment_id);
  if not private.can_manage_appointments(v_appt.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status <> 'checked_in' or not v_appt.placement_open then
    raise exception 'placement_not_allowed' using errcode = 'P0001';
  end if;

  if p_before_appointment_id is null then
    select coalesce(max(queue_rank), 0) + 1 into v_rank from public.appointments
     where session_id = v_appt.session_id and status = 'checked_in' and id <> v_appt.id;
  else
    select * into v_before from public.appointments
     where id = p_before_appointment_id and session_id = v_appt.session_id and status = 'checked_in';
    if not found then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    select max(queue_rank) into v_prev from public.appointments
     where session_id = v_appt.session_id and status = 'checked_in' and id <> v_appt.id and queue_rank < v_before.queue_rank;
    v_rank := case when v_prev is null then v_before.queue_rank - 1 else (v_prev + v_before.queue_rank) / 2 end;
  end if;

  update public.appointments set queue_rank = v_rank, placement_open = false where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id, 'placed', 'checked_in', 'checked_in');
end;
$$;

-- Doctor (own sessions) or reception calls the next patient in order.
create function public.call_next_patient(p_session_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.doctor_sessions%rowtype;
  v_next uuid;
begin
  perform private.require_user();
  select * into v_session from public.doctor_sessions where id = p_session_id for update;
  if not found or not private.can_view_appointment(v_session.clinic_id, v_session.clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_operational(v_session.clinic_id);

  select id into v_next from public.appointments
   where session_id = p_session_id and status = 'checked_in'
   order by queue_rank, checked_in_at
   limit 1;
  if v_next is null then
    return null;
  end if;
  update public.appointments set status = 'called', called_at = now() where id = v_next;
  perform private.log_appointment(v_next, v_session.clinic_id, 'called', 'checked_in', 'called');
  return v_next;
end;
$$;

create function public.complete_appointment(p_appointment_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
begin
  perform private.require_user();
  v_appt := private.lock_appointment(p_appointment_id);
  if not private.can_view_appointment(v_appt.clinic_id, v_appt.clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status <> 'called' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  update public.appointments set status = 'completed', completed_at = now() where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id, 'completed', 'called', 'completed');
end;
$$;

-- APT-010: patient not present when called.
create function public.mark_absent(p_appointment_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
begin
  perform private.require_user();
  v_appt := private.lock_appointment(p_appointment_id);
  if not private.can_view_appointment(v_appt.clinic_id, v_appt.clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status <> 'called' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  update public.appointments set status = 'absent' where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id, 'absent', 'called', 'absent');
end;
$$;

-- APT-010: an absent patient returns; position follows the doctor's policy.
create function public.return_from_absence(p_appointment_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_policy public.doctor_scheduling_policies%rowtype;
  v_rank numeric;
begin
  perform private.require_user();
  v_appt := private.lock_appointment(p_appointment_id);
  if not private.can_manage_appointments(v_appt.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status <> 'absent' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  select * into v_policy from public.doctor_scheduling_policies where clinic_doctor_id = v_appt.clinic_doctor_id;

  if v_policy.absent_when_called = 'skip_and_prioritize' then
    select coalesce(min(queue_rank), v_appt.queue_rank + 1) - 1 into v_rank
      from public.appointments where session_id = v_appt.session_id and status = 'checked_in';
  else
    select coalesce(max(queue_rank), 0) + 1 into v_rank
      from public.appointments where session_id = v_appt.session_id and status = 'checked_in';
  end if;

  update public.appointments
     set status = 'checked_in', queue_rank = v_rank,
         placement_open = (v_policy.absent_when_called = 'receptionist_assignment')
   where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id, 'returned', 'absent', 'checked_in');
end;
$$;

-- APT-014: manual no-show only (automatic modes need OD-B04 thresholds).
create function public.mark_no_show(p_appointment_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_session_start timestamptz;
begin
  perform private.require_user();
  v_appt := private.lock_appointment(p_appointment_id);
  if not private.can_manage_appointments(v_appt.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_appt.status not in ('booked', 'absent') then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  select coalesce(v_appt.starts_at, s.starts_at) into v_session_start from public.doctor_sessions s where s.id = v_appt.session_id;
  if v_session_start > now() then
    raise exception 'too_early' using errcode = 'P0001';
  end if;
  update public.appointments set status = 'no_show' where id = p_appointment_id;
  perform private.log_appointment(p_appointment_id, v_appt.clinic_id, 'no_show', v_appt.status, 'no_show', p_reason);
end;
$$;

-- Availability for staff screens.
create function public.get_session_availability(p_session_id uuid)
returns table (remaining integer, free_slots timestamptz[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  perform private.require_user();
  select clinic_id into v_clinic_id from public.doctor_sessions where id = p_session_id;
  if not found or not private.is_active_member(v_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select private.session_remaining(p_session_id),
                      coalesce(array(select private.session_free_slots(p_session_id)), '{}');
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.can_manage_appointments(uuid)',
    'private.require_operational(uuid)',
    'private.clinic_today(uuid)',
    'private.is_clinic_doctor_self(uuid)',
    'private.can_manage_doctor_schedule(uuid)',
    'private.materialize_sessions(uuid, date, date)',
    'private.discard_unused_future_sessions(uuid)',
    'private.log_appointment(uuid, uuid, text, public.appointment_status, public.appointment_status, text)',
    'private.can_view_appointment(uuid, uuid)',
    'private.can_view_clinic_patient(uuid)',
    'private.session_free_slots(uuid)',
    'private.session_remaining(uuid)',
    'private.book(uuid, uuid, timestamptz, boolean, text, text)',
    'private.base_queue_rank(public.appointments, public.queue_ordering)',
    'private.lock_appointment(uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
  end loop;

  -- Used directly inside RLS policies.
  foreach v_fn in array array[
    'private.can_manage_appointments(uuid)',
    'private.is_clinic_doctor_self(uuid)',
    'private.can_view_appointment(uuid, uuid)',
    'private.can_view_clinic_patient(uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.add_clinic_doctor(uuid, text, text)',
    'public.set_clinic_doctor_status(uuid, text)',
    'public.set_scheduling_policy(uuid, public.booking_method, integer, public.overbooking_policy, public.queue_ordering, public.walk_in_policy, public.absent_policy, public.patient_cancellation_policy)',
    'public.set_weekly_schedule(uuid, jsonb)',
    'public.add_schedule_exception(uuid, date, text, time, time, integer, text)',
    'public.ensure_sessions(uuid, date, date)',
    'public.cancel_doctor_session(uuid, text)',
    'public.set_online_booking(uuid, boolean)',
    'public.register_clinic_patient(uuid, text, text, date, public.patient_gender, text, text, public.app_locale)',
    'public.book_appointment(uuid, uuid, timestamptz, boolean, text)',
    'public.decide_overbooking(uuid, boolean, text)',
    'public.cancel_appointment(uuid, text)',
    'public.check_in_appointment(uuid)',
    'public.register_walk_in(uuid, uuid, boolean, text)',
    'public.place_in_queue(uuid, uuid)',
    'public.call_next_patient(uuid)',
    'public.complete_appointment(uuid)',
    'public.mark_absent(uuid)',
    'public.return_from_absence(uuid)',
    'public.mark_no_show(uuid, text)',
    'public.get_session_availability(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS (read-only for clients)
-- ---------------------------------------------------------------------------
alter table public.clinic_doctors enable row level security;
alter table public.doctor_scheduling_policies enable row level security;
alter table public.doctor_weekly_schedules enable row level security;
alter table public.doctor_schedule_exceptions enable row level security;
alter table public.doctor_sessions enable row level security;
alter table public.patient_identities enable row level security;
alter table public.clinic_patients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;

revoke all on table
  public.clinic_doctors, public.doctor_scheduling_policies, public.doctor_weekly_schedules,
  public.doctor_schedule_exceptions, public.doctor_sessions, public.patient_identities,
  public.clinic_patients, public.appointments, public.appointment_events
from anon, authenticated;

grant select on table
  public.clinic_doctors, public.doctor_scheduling_policies, public.doctor_weekly_schedules,
  public.doctor_schedule_exceptions, public.doctor_sessions, public.patient_identities,
  public.clinic_patients, public.appointments, public.appointment_events
to authenticated;

-- Scheduling configuration and sessions: any active member of the clinic.
create policy clinic_doctors_select_member on public.clinic_doctors
  for select to authenticated using (private.is_active_member(clinic_id));
create policy doctor_scheduling_policies_select_member on public.doctor_scheduling_policies
  for select to authenticated using (private.is_active_member(clinic_id));
create policy doctor_weekly_schedules_select_member on public.doctor_weekly_schedules
  for select to authenticated using (private.is_active_member(clinic_id));
create policy doctor_schedule_exceptions_select_member on public.doctor_schedule_exceptions
  for select to authenticated using (private.is_active_member(clinic_id));
create policy doctor_sessions_select_member on public.doctor_sessions
  for select to authenticated using (private.is_active_member(clinic_id));

-- Patients (demographics only).
create policy clinic_patients_select on public.clinic_patients
  for select to authenticated using (private.can_view_clinic_patient(id));
create policy patient_identities_select on public.patient_identities
  for select to authenticated using (
    exists (
      select 1 from public.clinic_patients cp
      where cp.patient_identity_id = patient_identities.id and private.can_view_clinic_patient(cp.id)
    )
  );

-- Appointments: appointment managers of the clinic and the treating doctor.
create policy appointments_select on public.appointments
  for select to authenticated using (private.can_view_appointment(clinic_id, clinic_doctor_id));
create policy appointment_events_select on public.appointment_events
  for select to authenticated using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_events.appointment_id and private.can_view_appointment(a.clinic_id, a.clinic_doctor_id)
    )
  );
