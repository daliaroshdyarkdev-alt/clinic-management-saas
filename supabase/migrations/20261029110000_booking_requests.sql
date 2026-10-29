-- Milestone 2: online booking requests and alternative proposals.
-- SRS: APT-001 (requests are not final), APT-002 (approve / reject /
-- propose alternative), APT-003 (an alternative holds no capacity and is
-- re-checked transactionally when the patient accepts).
--
-- The public (patient) side has no Supabase session. The Next.js server
-- calls the `public_*` functions below with the service role after its own
-- input validation; they are executable by service_role only and return the
-- minimum data needed. Anti-bot challenge and per-IP limits are OPEN
-- (OD-B04); the per-phone limit below is an engineering default.

create type public.booking_request_status as enum (
  'submitted', 'confirmed', 'rejected', 'alternative_proposed', 'alternative_declined', 'unavailable', 'cancelled'
);
create type public.offer_status as enum ('offered', 'accepted', 'declined', 'unavailable', 'withdrawn');

create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_doctor_id uuid not null,
  session_id uuid not null,
  requested_starts_at timestamptz,
  requester_name text not null check (char_length(requester_name) between 2 and 200),
  requester_phone_e164 text not null check (requester_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  status public.booking_request_status not null default 'submitted',
  clinic_patient_id uuid,
  appointment_id uuid references public.appointments (id) on delete restrict,
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (char_length(decision_reason) <= 500),
  -- Set when the patient's response needs reception's attention (APT-003).
  needs_attention boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict,
  foreign key (clinic_id, session_id) references public.doctor_sessions (clinic_id, id) on delete restrict,
  foreign key (clinic_id, clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict
);

create index appointment_requests_clinic_status_idx on public.appointment_requests (clinic_id, status, created_at desc);
create index appointment_requests_phone_idx on public.appointment_requests (clinic_id, requester_phone_e164, status);

create trigger appointment_requests_updated_at before update on public.appointment_requests
  for each row execute function private.set_updated_at();
create trigger appointment_requests_clinic_id_immutable before update on public.appointment_requests
  for each row execute function private.forbid_clinic_id_change();

create table public.alternative_offers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  request_id uuid not null references public.appointment_requests (id) on delete restrict,
  session_id uuid not null,
  starts_at timestamptz,
  token_hash bytea not null unique,
  status public.offer_status not null default 'offered',
  offered_by uuid not null references auth.users (id) on delete restrict,
  offered_at timestamptz not null default now(),
  responded_at timestamptz,
  appointment_id uuid references public.appointments (id) on delete restrict,
  foreign key (clinic_id, session_id) references public.doctor_sessions (clinic_id, id) on delete restrict
);

create unique index alternative_offers_one_open on public.alternative_offers (request_id) where status = 'offered';

create trigger alternative_offers_clinic_id_immutable before update on public.alternative_offers
  for each row execute function private.forbid_clinic_id_change();

-- ---------------------------------------------------------------------------
-- Public (patient) side — service_role only.
-- ---------------------------------------------------------------------------

-- What a public booking page may show: clinic and doctor display names and
-- free capacity. No patient data.
create function public.public_booking_options(p_clinic_id uuid, p_days integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic public.clinics%rowtype;
  v_today date;
  v_doctor uuid;
begin
  select * into v_clinic from public.clinics where id = p_clinic_id;
  if not found or v_clinic.account_state <> 'active' or not v_clinic.online_booking_enabled then
    return null;
  end if;
  v_today := private.clinic_today(p_clinic_id);
  for v_doctor in select id from public.clinic_doctors where clinic_id = p_clinic_id and status = 'active' loop
    perform private.materialize_sessions(v_doctor, v_today, v_today + least(greatest(coalesce(p_days, 7), 1), 14));
  end loop;

  return jsonb_build_object(
    'clinic_name', v_clinic.name,
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.display_name,
        'specialty', d.specialty,
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'method', s.method,
            'starts_at', s.starts_at,
            'ends_at', s.ends_at,
            'remaining', private.session_remaining(s.id),
            'free_slots', coalesce(to_jsonb(array(select private.session_free_slots(s.id))), '[]'::jsonb)
          ) order by s.starts_at)
          from public.doctor_sessions s
          where s.clinic_doctor_id = d.id and s.status = 'scheduled' and s.ends_at > now()
            and s.session_date between v_today and v_today + 14
        ), '[]'::jsonb)
      ) order by d.display_name)
      from public.clinic_doctors d
      where d.clinic_id = p_clinic_id and d.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

-- APT-001: a public request is never a booking; it waits for reception.
create function public.public_submit_booking_request(
  p_clinic_id uuid,
  p_session_id uuid,
  p_starts_at timestamptz,
  p_name text,
  p_phone_e164 text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.doctor_sessions%rowtype;
  v_id uuid;
begin
  if not exists (
    select 1 from public.clinics c
    where c.id = p_clinic_id and c.account_state = 'active' and c.online_booking_enabled
  ) then
    raise exception 'online_booking_unavailable' using errcode = 'P0001';
  end if;

  select * into v_session from public.doctor_sessions where id = p_session_id and clinic_id = p_clinic_id;
  if not found or v_session.status <> 'scheduled' or v_session.ends_at <= now() then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.method = 'timed' and (
       p_starts_at is null or p_starts_at < v_session.starts_at or p_starts_at <= now()
       or p_starts_at + make_interval(mins => v_session.slot_minutes) > v_session.ends_at
       or (extract(epoch from (p_starts_at - v_session.starts_at))::bigint % (v_session.slot_minutes * 60)) <> 0) then
    raise exception 'invalid_slot' using errcode = 'P0001';
  end if;

  -- Abuse guard (engineering default, OD-B04): at most 3 open requests per phone per clinic.
  if (
    select count(*) from public.appointment_requests r
    where r.clinic_id = p_clinic_id and r.requester_phone_e164 = btrim(p_phone_e164)
      and r.status in ('submitted', 'alternative_proposed')
  ) >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  begin
    insert into public.appointment_requests (
      clinic_id, clinic_doctor_id, session_id, requested_starts_at, requester_name, requester_phone_e164
    ) values (
      p_clinic_id, v_session.clinic_doctor_id, p_session_id,
      case when v_session.method = 'timed' then p_starts_at end, btrim(p_name), btrim(p_phone_e164)
    ) returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_request' using errcode = 'P0001';
  end;

  perform private.write_audit_event('appointments', 'request.submitted', 'success', p_clinic_id, 'appointment_request',
    v_id::text, '{}'::jsonb, null, 'system');
  return v_id;
end;
$$;

-- The alternative a patient sees through their link.
create function public.public_get_offer(p_token text)
returns table (status public.offer_status, clinic_name text, doctor_name text, method public.booking_method,
               session_starts_at timestamptz, session_ends_at timestamptz, starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.status, c.name, d.display_name, s.method, s.starts_at, s.ends_at, o.starts_at
  from public.alternative_offers o
  join public.doctor_sessions s on s.id = o.session_id
  join public.clinic_doctors d on d.id = s.clinic_doctor_id
  join public.clinics c on c.id = o.clinic_id
  where o.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
$$;

-- APT-003: accepting re-checks availability inside the booking transaction.
-- If the slot/place is gone, nothing is booked and reception is alerted.
create function public.public_respond_to_offer(p_token text, p_accept boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.alternative_offers%rowtype;
  v_request public.appointment_requests%rowtype;
  v_appointment uuid;
begin
  select * into v_offer from public.alternative_offers
   where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256') for update;
  if not found then
    raise exception 'offer_invalid' using errcode = 'P0001';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'offer_closed' using errcode = 'P0001';
  end if;
  select * into v_request from public.appointment_requests where id = v_offer.request_id for update;

  if not coalesce(p_accept, false) then
    update public.alternative_offers set status = 'declined', responded_at = now() where id = v_offer.id;
    update public.appointment_requests set status = 'alternative_declined', needs_attention = true where id = v_request.id;
    perform private.write_audit_event('appointments', 'offer.declined', 'success', v_offer.clinic_id, 'alternative_offer',
      v_offer.id::text, '{}'::jsonb, null, 'system');
    return 'declined';
  end if;

  begin
    v_appointment := private.book(v_offer.session_id, v_request.clinic_patient_id, v_offer.starts_at, false, null, 'online_request');
  exception when raise_exception then
    if sqlerrm in ('slot_taken', 'session_full', 'session_cancelled', 'session_in_past', 'session_not_found',
                   'already_booked', 'clinic_not_operational', 'invalid_slot', 'patient_not_found') then
      update public.alternative_offers set status = 'unavailable', responded_at = now() where id = v_offer.id;
      update public.appointment_requests set status = 'unavailable', needs_attention = true where id = v_request.id;
      perform private.write_audit_event('appointments', 'offer.unavailable', 'failure', v_offer.clinic_id,
        'alternative_offer', v_offer.id::text, jsonb_build_object('reason', sqlerrm), null, 'system');
      return 'unavailable';
    end if;
    raise;
  end;

  update public.alternative_offers set status = 'accepted', responded_at = now(), appointment_id = v_appointment where id = v_offer.id;
  update public.appointment_requests
     set status = 'confirmed', appointment_id = v_appointment, needs_attention = false
   where id = v_request.id;
  perform private.write_audit_event('appointments', 'offer.accepted', 'success', v_offer.clinic_id, 'alternative_offer',
    v_offer.id::text, '{}'::jsonb, null, 'system');
  return 'confirmed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Reception side (APT-002)
-- ---------------------------------------------------------------------------
create function private.lock_request_for_staff(p_request_id uuid) returns public.appointment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.appointment_requests%rowtype;
begin
  select * into v_request from public.appointment_requests where id = p_request_id for update;
  if not found or not private.can_manage_appointments(v_request.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_request;
end;
$$;

create function private.withdraw_open_offers(p_request_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.alternative_offers set status = 'withdrawn', responded_at = now()
  where request_id = p_request_id and status = 'offered';
$$;

-- Books the requested time for a registered patient.
create function public.approve_booking_request(
  p_request_id uuid,
  p_clinic_patient_id uuid,
  p_overbook boolean,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_request public.appointment_requests%rowtype;
  v_appointment uuid;
begin
  v_request := private.lock_request_for_staff(p_request_id);
  if v_request.status not in ('submitted', 'alternative_declined', 'unavailable') then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;

  v_appointment := private.book(v_request.session_id, p_clinic_patient_id, v_request.requested_starts_at,
                                p_overbook, p_reason, 'online_request');
  perform private.withdraw_open_offers(p_request_id);
  update public.appointment_requests
     set status = 'confirmed', clinic_patient_id = p_clinic_patient_id, appointment_id = v_appointment,
         decided_by = v_uid, decided_at = now(), needs_attention = false
   where id = p_request_id;
  perform private.write_audit_event('appointments', 'request.approved', 'success', v_request.clinic_id,
    'appointment_request', p_request_id::text);
  return v_appointment;
end;
$$;

create function public.reject_booking_request(p_request_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_request public.appointment_requests%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_request := private.lock_request_for_staff(p_request_id);
  if v_request.status not in ('submitted', 'alternative_proposed', 'alternative_declined', 'unavailable') then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  perform private.withdraw_open_offers(p_request_id);
  update public.appointment_requests
     set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_reason = v_reason, needs_attention = false
   where id = p_request_id;
  perform private.write_audit_event('appointments', 'request.rejected', 'success', v_request.clinic_id,
    'appointment_request', p_request_id::text);
end;
$$;

-- APT-002/003: propose another time. Holds no capacity. Returns the raw
-- token for the patient link once (delivery by WhatsApp arrives in M5).
create function public.propose_alternative(
  p_request_id uuid,
  p_clinic_patient_id uuid,
  p_session_id uuid,
  p_starts_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_request public.appointment_requests%rowtype;
  v_session public.doctor_sessions%rowtype;
  v_token text;
  v_offer uuid;
begin
  v_request := private.lock_request_for_staff(p_request_id);
  if v_request.status not in ('submitted', 'alternative_proposed', 'alternative_declined', 'unavailable') then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.clinic_patients cp where cp.id = p_clinic_patient_id and cp.clinic_id = v_request.clinic_id
  ) then
    raise exception 'patient_not_found' using errcode = 'P0001';
  end if;
  select * into v_session from public.doctor_sessions where id = p_session_id and clinic_id = v_request.clinic_id;
  if not found or v_session.status <> 'scheduled' or v_session.ends_at <= now() then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.method = 'timed' and (
       p_starts_at is null or p_starts_at < v_session.starts_at or p_starts_at <= now()
       or p_starts_at + make_interval(mins => v_session.slot_minutes) > v_session.ends_at
       or (extract(epoch from (p_starts_at - v_session.starts_at))::bigint % (v_session.slot_minutes * 60)) <> 0) then
    raise exception 'invalid_slot' using errcode = 'P0001';
  end if;

  perform private.withdraw_open_offers(p_request_id);
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.alternative_offers (clinic_id, request_id, session_id, starts_at, token_hash, offered_by)
  values (v_request.clinic_id, p_request_id, p_session_id,
          case when v_session.method = 'timed' then p_starts_at end,
          extensions.digest(v_token, 'sha256'), v_uid)
  returning id into v_offer;

  update public.appointment_requests
     set status = 'alternative_proposed', clinic_patient_id = p_clinic_patient_id,
         decided_by = v_uid, decided_at = now(), needs_attention = false
   where id = p_request_id;
  perform private.write_audit_event('appointments', 'request.alternative_proposed', 'success', v_request.clinic_id,
    'alternative_offer', v_offer::text);
  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on function private.lock_request_for_staff(uuid) from public;
revoke all on function private.withdraw_open_offers(uuid) from public;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.public_booking_options(uuid, integer)',
    'public.public_submit_booking_request(uuid, uuid, timestamptz, text, text)',
    'public.public_get_offer(text)',
    'public.public_respond_to_offer(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.approve_booking_request(uuid, uuid, boolean, text)',
    'public.reject_booking_request(uuid, text)',
    'public.propose_alternative(uuid, uuid, uuid, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;

alter table public.appointment_requests enable row level security;
alter table public.alternative_offers enable row level security;
revoke all on table public.appointment_requests, public.alternative_offers from anon, authenticated;

grant select on table public.appointment_requests to authenticated;
create policy appointment_requests_select_staff on public.appointment_requests
  for select to authenticated using (private.can_manage_appointments(clinic_id));

grant select (id, clinic_id, request_id, session_id, starts_at, status, offered_by, offered_at, responded_at, appointment_id)
  on table public.alternative_offers to authenticated;
create policy alternative_offers_select_staff on public.alternative_offers
  for select to authenticated using (private.can_manage_appointments(clinic_id));
