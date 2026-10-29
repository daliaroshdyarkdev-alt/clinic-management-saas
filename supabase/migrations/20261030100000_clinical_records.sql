-- Milestone 3: duplicate-candidate review, doctor templates, consultations,
-- corrections and per-visit cross-clinic access.
-- SRS: PAT-002, PAT-004, MED-001..010, invariants 4-5, acceptance 2 and 5.
--
-- Medical content lives in schema `clinical`, which is NOT exposed through
-- the Data API and grants nothing to API roles. It is reachable only through
-- the SECURITY DEFINER functions below, which allow the assigned treating
-- doctor (active membership + active doctor record) and log every access
-- (metadata only). Owners, reception, cashiers, other doctors and platform
-- admins have no path to it (MED-005, ADM-003). Lawful exceptions and
-- break-glass access are OPEN and not built (OD-S02).

-- ---------------------------------------------------------------------------
-- PAT-002: duplicate candidates (flag only; never merged, PAT-006 OPEN)
-- ---------------------------------------------------------------------------
create table public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_patient_id uuid not null,
  candidate_clinic_patient_id uuid not null,
  reasons text[] not null,
  status text not null default 'open' check (status in ('open', 'not_duplicate', 'confirmed_duplicate')),
  reviewed_by uuid references auth.users (id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict,
  foreign key (clinic_id, candidate_clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict,
  unique (clinic_patient_id, candidate_clinic_patient_id),
  check (clinic_patient_id <> candidate_clinic_patient_id)
);

create function private.normalize_name(p_name text) returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', ' ', 'g');
$$;

create function private.flag_duplicates(p_clinic_patient_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.duplicate_candidates (clinic_id, clinic_patient_id, candidate_clinic_patient_id, reasons)
  select me.clinic_id, me.id, other.id,
         array_remove(array[
           case when mi.phone_e164 = oi.phone_e164 then 'phone' end,
           case when mi.date_of_birth = oi.date_of_birth then 'date_of_birth' end,
           case when private.normalize_name(mi.full_name) = private.normalize_name(oi.full_name) then 'name' end,
           case when me.identification is not null and me.identification = other.identification then 'identification' end
         ], null)
  from public.clinic_patients me
  join public.patient_identities mi on mi.id = me.patient_identity_id
  join public.clinic_patients other on other.clinic_id = me.clinic_id and other.id <> me.id
  join public.patient_identities oi on oi.id = other.patient_identity_id
  where me.id = p_clinic_patient_id
    and (
      (mi.phone_e164 = oi.phone_e164 and mi.date_of_birth = oi.date_of_birth)
      or (private.normalize_name(mi.full_name) = private.normalize_name(oi.full_name) and mi.date_of_birth = oi.date_of_birth)
      or (me.identification is not null and me.identification = other.identification)
    )
  on conflict do nothing;
$$;

create or replace function public.register_clinic_patient(
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

  perform 1 from public.clinics where id = p_clinic_id for update;
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

  perform private.flag_duplicates(v_id);
  perform private.write_audit_event('appointments', 'patient.registered', 'success', p_clinic_id, 'clinic_patient', v_id::text);
  return v_id;
end;
$$;

create function public.review_duplicate_candidate(p_candidate_id uuid, p_status text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.duplicate_candidates where id = p_candidate_id for update;
  if not found or not private.can_manage_appointments(v_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('not_duplicate', 'confirmed_duplicate') then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  update public.duplicate_candidates set status = p_status, reviewed_by = v_uid, reviewed_at = now() where id = p_candidate_id;
  perform private.write_audit_event('appointments', 'patient.duplicate_reviewed', 'success', v_clinic_id,
    'duplicate_candidate', p_candidate_id::text, jsonb_build_object('status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Clinical schema
-- ---------------------------------------------------------------------------
create schema clinical;
revoke all on schema clinical from public;

create table clinical.medical_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_doctor_id uuid not null,
  version integer not null check (version > 0),
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_doctor_id, version),
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict
);

create trigger medical_templates_append_only before update or delete on clinical.medical_templates
  for each row execute function private.forbid_mutation();

create table clinical.consultations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  appointment_id uuid not null unique references public.appointments (id) on delete restrict,
  clinic_patient_id uuid not null,
  clinic_doctor_id uuid not null,
  template_id uuid not null references clinical.medical_templates (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete restrict,
  foreign key (clinic_id, clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict,
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict
);

create index consultations_patient_idx on clinical.consultations (clinic_patient_id, started_at desc);

-- MED-003: a completed consultation can never change or disappear.
create function private.guard_consultation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'consultations cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status = 'completed' then
    raise exception 'completed consultations are locked' using errcode = 'P0001';
  end if;
  if new.clinic_id is distinct from old.clinic_id or new.appointment_id is distinct from old.appointment_id
     or new.clinic_patient_id is distinct from old.clinic_patient_id or new.template_id is distinct from old.template_id then
    raise exception 'consultation identity is immutable' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger consultations_guard before update or delete on clinical.consultations
  for each row execute function private.guard_consultation();

-- MED-004: corrections are linked, append-only notes.
create table clinical.medical_corrections (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references clinical.consultations (id) on delete restrict,
  author_user_id uuid not null references auth.users (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create trigger medical_corrections_append_only before update or delete on clinical.medical_corrections
  for each row execute function private.forbid_mutation();

-- MED-006/007: per destination clinic + visit + doctor, view-only, revocable.
create table clinical.cross_clinic_access_grants (
  id uuid primary key default gen_random_uuid(),
  destination_clinic_id uuid not null,
  consultation_id uuid not null references clinical.consultations (id) on delete restrict,
  clinic_doctor_id uuid not null,
  source_clinic_id uuid not null references public.clinics (id) on delete restrict,
  source_clinic_patient_id uuid not null,
  method text not null check (method in ('in_person_id_verification', 'whatsapp_link', 'otp')),
  evidence_note text check (char_length(evidence_note) <= 1000),
  recorded_by uuid not null references auth.users (id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('consultation_completed', 'doctor_reassigned', 'patient_withdrew')),
  foreign key (source_clinic_id, source_clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict,
  check (source_clinic_id <> destination_clinic_id)
);

-- One active grant per visit and source record; a fresh consent after a
-- withdrawal creates a new grant.
create unique index cross_clinic_access_grants_one_active
  on clinical.cross_clinic_access_grants (consultation_id, source_clinic_patient_id) where revoked_at is null;

create function private.guard_grant() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'grants cannot be deleted' using errcode = 'P0001';
  end if;
  if old.revoked_at is not null then
    raise exception 'revoked grants are final' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'revoked_at' - 'revoke_reason') is distinct from (to_jsonb(old) - 'revoked_at' - 'revoke_reason') then
    raise exception 'grants are immutable except revocation' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger cross_clinic_access_grants_guard before update or delete on clinical.cross_clinic_access_grants
  for each row execute function private.guard_grant();

-- MED-010: access log, metadata only (never medical content).
create table clinical.clinical_access_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users (id) on delete restrict,
  clinic_id uuid not null,
  consultation_id uuid,
  grant_id uuid,
  action text not null check (char_length(action) <= 50)
);

create trigger clinical_access_events_append_only before update or delete on clinical.clinical_access_events
  for each row execute function private.forbid_mutation();

create function private.log_clinical_access(p_clinic_id uuid, p_consultation_id uuid, p_grant_id uuid, p_action text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into clinical.clinical_access_events (actor_user_id, clinic_id, consultation_id, grant_id, action)
  values (auth.uid(), p_clinic_id, p_consultation_id, p_grant_id, p_action);
$$;

-- Revocation triggers (MED-007).
create function private.revoke_grants_on_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    update clinical.cross_clinic_access_grants set revoked_at = now(), revoke_reason = 'consultation_completed'
     where consultation_id = new.id and revoked_at is null;
  elsif new.clinic_doctor_id is distinct from old.clinic_doctor_id then
    update clinical.cross_clinic_access_grants set revoked_at = now(), revoke_reason = 'doctor_reassigned'
     where consultation_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger consultations_revoke_grants after update on clinical.consultations
  for each row execute function private.revoke_grants_on_change();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create function private.load_own_consultation(p_consultation_id uuid, p_lock boolean default false)
returns clinical.consultations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v clinical.consultations%rowtype;
begin
  perform private.require_user();
  if p_lock then
    select * into v from clinical.consultations where id = p_consultation_id for update;
  else
    select * into v from clinical.consultations where id = p_consultation_id;
  end if;
  -- Same error for "not found" and "not yours": existence is not revealed.
  if not found or not private.is_clinic_doctor_self(v.clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v;
end;
$$;

create function private.validate_template_fields(p_fields jsonb) returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_field jsonb;
  v_keys text[] := '{}';
begin
  if jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) = 0 or jsonb_array_length(p_fields) > 60 then
    raise exception 'invalid_template' using errcode = 'P0001';
  end if;
  for v_field in select * from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(v_field) <> 'object'
       or coalesce(v_field ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
       or char_length(coalesce(v_field ->> 'label', '')) not between 1 and 120
       or coalesce(v_field ->> 'type', '') not in ('text', 'textarea', 'number', 'date', 'select', 'checkbox')
       or (v_field ->> 'type' = 'select' and (jsonb_typeof(v_field -> 'options') <> 'array'
           or jsonb_array_length(v_field -> 'options') not between 1 and 50))
       or (v_field ? 'required' and jsonb_typeof(v_field -> 'required') <> 'boolean')
       or (v_field ->> 'key') = any (v_keys) then
      raise exception 'invalid_template' using errcode = 'P0001';
    end if;
    v_keys := v_keys || (v_field ->> 'key');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Templates (MED-001/002)
-- ---------------------------------------------------------------------------
create function public.save_medical_template(p_clinic_doctor_id uuid, p_fields jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clinic_id uuid;
  v_version integer;
begin
  -- Each doctor configures their own forms (not the owner).
  if not private.is_clinic_doctor_self(p_clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.validate_template_fields(p_fields);
  select clinic_id into v_clinic_id from public.clinic_doctors where id = p_clinic_doctor_id for update;
  select coalesce(max(version), 0) + 1 into v_version from clinical.medical_templates where clinic_doctor_id = p_clinic_doctor_id;
  insert into clinical.medical_templates (clinic_id, clinic_doctor_id, version, fields, created_by)
  values (v_clinic_id, p_clinic_doctor_id, v_version, p_fields, v_uid);
  perform private.write_audit_event('clinical_access', 'template.saved', 'success', v_clinic_id, 'clinic_doctor',
    p_clinic_doctor_id::text, jsonb_build_object('version', v_version));
  return v_version;
end;
$$;

create function public.get_medical_template(p_clinic_doctor_id uuid)
returns table (version integer, fields jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not private.is_clinic_doctor_self(p_clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select t.version, t.fields from clinical.medical_templates t
    where t.clinic_doctor_id = p_clinic_doctor_id order by t.version desc limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consultations (MED-003..005, MED-009)
-- ---------------------------------------------------------------------------

-- Opens (or returns) the consultation of an appointment. Only that
-- appointment's doctor can, once the patient has arrived.
create function public.start_consultation(p_appointment_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_existing uuid;
  v_template uuid;
  v_id uuid;
begin
  perform private.require_user();
  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found or not private.is_clinic_doctor_self(v_appt.clinic_doctor_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_existing from clinical.consultations where appointment_id = p_appointment_id;
  if v_existing is not null then
    perform private.load_own_consultation(v_existing);
    return v_existing;
  end if;

  perform private.require_operational(v_appt.clinic_id);
  if v_appt.status not in ('checked_in', 'called') then
    raise exception 'patient_not_arrived' using errcode = 'P0001';
  end if;
  select id into v_template from clinical.medical_templates
   where clinic_doctor_id = v_appt.clinic_doctor_id order by version desc limit 1;
  if v_template is null then
    raise exception 'template_required' using errcode = 'P0001';
  end if;

  insert into clinical.consultations (clinic_id, appointment_id, clinic_patient_id, clinic_doctor_id, template_id)
  values (v_appt.clinic_id, v_appt.id, v_appt.clinic_patient_id, v_appt.clinic_doctor_id, v_template)
  returning id into v_id;
  perform private.log_clinical_access(v_appt.clinic_id, v_id, null, 'consultation.started');
  return v_id;
end;
$$;

-- Full consultation for its treating doctor. Fields come from the doctor's
-- current template; values of fields removed since are returned separately
-- as read-only "archived information" (MED-002).
create function public.get_consultation(p_consultation_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v clinical.consultations%rowtype;
  v_current jsonb;
  v_keys text[];
  v_result jsonb;
begin
  v := private.load_own_consultation(p_consultation_id);
  select fields into v_current from clinical.medical_templates
   where clinic_doctor_id = v.clinic_doctor_id order by version desc limit 1;
  select coalesce(array_agg(f ->> 'key'), '{}') into v_keys from jsonb_array_elements(v_current) f;

  select jsonb_build_object(
    'id', v.id,
    'appointment_id', v.appointment_id,
    'status', v.status,
    'started_at', v.started_at,
    'completed_at', v.completed_at,
    'fields', v_current,
    'values', (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v.payload) where key = any (v_keys)),
    'archived', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', e.key,
        'label', coalesce((select f ->> 'label' from clinical.medical_templates t, jsonb_array_elements(t.fields) f
                           where t.clinic_doctor_id = v.clinic_doctor_id and f ->> 'key' = e.key
                           order by t.version desc limit 1), e.key),
        'value', e.value)), '[]')
      from jsonb_each(v.payload) e where not (e.key = any (v_keys))
    ),
    'corrections', (
      select coalesce(jsonb_agg(jsonb_build_object('body', c.body, 'created_at', c.created_at) order by c.created_at), '[]')
      from clinical.medical_corrections c where c.consultation_id = v.id
    ),
    'patient', (
      select jsonb_build_object('chart_number', cp.chart_number, 'full_name', pi.full_name,
                                'date_of_birth', pi.date_of_birth, 'gender', pi.gender)
      from public.clinic_patients cp join public.patient_identities pi on pi.id = cp.patient_identity_id
      where cp.id = v.clinic_patient_id
    )
  ) into v_result;

  perform private.log_clinical_access(v.clinic_id, v.id, null, 'consultation.viewed');
  return v_result;
end;
$$;

create function private.validate_payload(p_template_fields jsonb, p_payload jsonb, p_require boolean) returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_field jsonb;
  v_value jsonb;
begin
  if jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 100000 then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_payload) k
    where not exists (select 1 from jsonb_array_elements(p_template_fields) f where f ->> 'key' = k)
  ) then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  for v_field in select * from jsonb_array_elements(p_template_fields) loop
    v_value := p_payload -> (v_field ->> 'key');
    if v_value is not null and jsonb_typeof(v_value) <> 'null' then
      if (v_field ->> 'type' in ('text', 'textarea', 'date', 'select') and jsonb_typeof(v_value) <> 'string')
         or (v_field ->> 'type' = 'number' and jsonb_typeof(v_value) <> 'number')
         or (v_field ->> 'type' = 'checkbox' and jsonb_typeof(v_value) <> 'boolean')
         or (v_field ->> 'type' = 'select' and not (v_field -> 'options') ? (v_value #>> '{}')) then
        raise exception 'invalid_payload' using errcode = 'P0001';
      end if;
    elsif p_require and coalesce((v_field ->> 'required')::boolean, false) then
      raise exception 'required_fields_missing' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

create function public.save_consultation_draft(p_consultation_id uuid, p_payload jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v clinical.consultations%rowtype;
  v_fields jsonb;
begin
  v := private.load_own_consultation(p_consultation_id, true);
  if v.status <> 'draft' then
    raise exception 'consultation_locked' using errcode = 'P0001';
  end if;
  select fields into v_fields from clinical.medical_templates
   where clinic_doctor_id = v.clinic_doctor_id order by version desc limit 1;
  perform private.validate_payload(v_fields, p_payload, false);
  -- Values of archived fields entered earlier are kept.
  update clinical.consultations set payload = payload || p_payload where id = v.id;
  perform private.log_clinical_access(v.clinic_id, v.id, null, 'consultation.saved');
end;
$$;

create function public.complete_consultation(p_consultation_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v clinical.consultations%rowtype;
  v_fields jsonb;
begin
  v := private.load_own_consultation(p_consultation_id, true);
  if v.status <> 'draft' then
    raise exception 'consultation_locked' using errcode = 'P0001';
  end if;
  select fields into v_fields from clinical.medical_templates
   where clinic_doctor_id = v.clinic_doctor_id order by version desc limit 1;
  perform private.validate_payload(v_fields, v.payload - array(
    select k from jsonb_object_keys(v.payload) k
    where not exists (select 1 from jsonb_array_elements(v_fields) f where f ->> 'key' = k)
  ), true);

  update clinical.consultations set status = 'completed', completed_at = now(), completed_by = v_uid where id = v.id;

  perform 1 from public.doctor_sessions s join public.appointments a on a.session_id = s.id where a.id = v.appointment_id for update of s;
  update public.appointments set status = 'completed', completed_at = now()
   where id = v.appointment_id and status in ('checked_in', 'called');
  if found then
    perform private.log_appointment(v.appointment_id, v.clinic_id, 'completed', 'called', 'completed');
  end if;

  perform private.log_clinical_access(v.clinic_id, v.id, null, 'consultation.completed');
end;
$$;

create function public.add_medical_correction(p_consultation_id uuid, p_body text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v clinical.consultations%rowtype;
begin
  v := private.load_own_consultation(p_consultation_id);
  if v.status <> 'completed' then
    raise exception 'consultation_not_completed' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  insert into clinical.medical_corrections (consultation_id, author_user_id, body) values (v.id, v_uid, btrim(p_body));
  perform private.log_clinical_access(v.clinic_id, v.id, null, 'consultation.corrected');
end;
$$;

-- The treating doctor's own consultations with a patient (metadata only).
create function public.list_patient_consultations(p_clinic_patient_id uuid)
returns table (id uuid, appointment_id uuid, status text, started_at timestamptz, completed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  return query
    select c.id, c.appointment_id, c.status, c.started_at, c.completed_at
    from clinical.consultations c
    where c.clinic_patient_id = p_clinic_patient_id and private.is_clinic_doctor_self(c.clinic_doctor_id)
    order by c.started_at desc;
end;
$$;

-- Reception or the owner hands an open consultation to another doctor.
create function public.reassign_consultation(p_consultation_id uuid, p_clinic_doctor_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v clinical.consultations%rowtype;
begin
  perform private.require_user();
  select * into v from clinical.consultations where id = p_consultation_id for update;
  if not found or not private.can_manage_appointments(v.clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v.status <> 'draft' then
    raise exception 'consultation_locked' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.clinic_doctors d where d.id = p_clinic_doctor_id and d.clinic_id = v.clinic_id and d.status = 'active'
  ) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  update clinical.consultations set clinic_doctor_id = p_clinic_doctor_id where id = v.id;
  perform private.log_clinical_access(v.clinic_id, v.id, null, 'consultation.reassigned');
  perform private.write_audit_event('clinical_access', 'consultation.reassigned', 'success', v.clinic_id, 'consultation', v.id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cross-clinic access (MED-006..008)
-- ---------------------------------------------------------------------------

-- Records the patient's explicit consent for THIS visit and doctor. The
-- patient's identity is verified in person (OTP / WhatsApp link methods
-- arrive with Milestone 5). Matching records in other clinics are those whose
-- patient has the same mobile and birth date (and ID, when both have one),
-- and the patient being treated must match too.
create function public.grant_cross_clinic_access(
  p_consultation_id uuid,
  p_phone_e164 text,
  p_date_of_birth date,
  p_identification text,
  p_method text,
  p_evidence_note text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v clinical.consultations%rowtype;
  v_me record;
  v_count integer;
  v_identification text := nullif(btrim(coalesce(p_identification, '')), '');
begin
  v := private.load_own_consultation(p_consultation_id, true);
  if v.status <> 'draft' then
    raise exception 'consultation_locked' using errcode = 'P0001';
  end if;
  if p_method <> 'in_person_id_verification' or char_length(btrim(coalesce(p_evidence_note, ''))) < 3 then
    raise exception 'consent_evidence_required' using errcode = 'P0001';
  end if;

  select pi.phone_e164, pi.date_of_birth, cp.identification into v_me
    from public.clinic_patients cp join public.patient_identities pi on pi.id = cp.patient_identity_id
   where cp.id = v.clinic_patient_id;
  if v_me.phone_e164 <> btrim(p_phone_e164) or v_me.date_of_birth <> p_date_of_birth
     or (v_identification is not null and v_me.identification is not null and v_me.identification <> v_identification) then
    raise exception 'identity_mismatch' using errcode = 'P0001';
  end if;

  insert into clinical.cross_clinic_access_grants (
    destination_clinic_id, consultation_id, clinic_doctor_id, source_clinic_id, source_clinic_patient_id,
    method, evidence_note, recorded_by
  )
  select v.clinic_id, v.id, v.clinic_doctor_id, cp.clinic_id, cp.id, p_method, btrim(p_evidence_note), v_uid
  from public.clinic_patients cp
  join public.patient_identities pi on pi.id = cp.patient_identity_id
  where cp.clinic_id <> v.clinic_id
    and pi.phone_e164 = btrim(p_phone_e164)
    and pi.date_of_birth = p_date_of_birth
    and (v_identification is null or cp.identification is null or cp.identification = v_identification)
    and exists (select 1 from clinical.consultations sc where sc.clinic_patient_id = cp.id and sc.status = 'completed')
    and not exists (
      select 1 from clinical.cross_clinic_access_grants g
      where g.consultation_id = v.id and g.source_clinic_patient_id = cp.id and g.revoked_at is null
    );
  get diagnostics v_count = row_count;

  perform private.log_clinical_access(v.clinic_id, v.id, null, 'consent.recorded');
  perform private.write_audit_event('clinical_access', 'consent.recorded', 'success', v.clinic_id, 'consultation', v.id::text,
    jsonb_build_object('method', p_method, 'grants', v_count));
  return v_count;
end;
$$;

create function public.list_external_grants(p_consultation_id uuid)
returns table (grant_id uuid, source_clinic_name text, records integer, granted_at timestamptz, revoked_at timestamptz, revoke_reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v clinical.consultations%rowtype;
begin
  v := private.load_own_consultation(p_consultation_id);
  return query
    select g.id, c.name,
           (select count(*)::integer from clinical.consultations sc
             where sc.clinic_patient_id = g.source_clinic_patient_id and sc.status = 'completed'),
           g.granted_at, g.revoked_at, g.revoke_reason
    from clinical.cross_clinic_access_grants g
    join public.clinics c on c.id = g.source_clinic_id
    where g.consultation_id = v.id and g.clinic_doctor_id = v.clinic_doctor_id
    order by g.granted_at;
end;
$$;

-- View-only gateway (no export). Active grant + the grantee doctor + the
-- destination consultation still open; every read is logged.
create function public.read_external_records(p_grant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g clinical.cross_clinic_access_grants%rowtype;
  v clinical.consultations%rowtype;
  v_result jsonb;
begin
  perform private.require_user();
  select * into g from clinical.cross_clinic_access_grants where id = p_grant_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v := private.load_own_consultation(g.consultation_id);
  if g.revoked_at is not null or v.status <> 'draft' or v.clinic_doctor_id <> g.clinic_doctor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'source_clinic', (select name from public.clinics where id = g.source_clinic_id),
    'consultations', coalesce(jsonb_agg(jsonb_build_object(
      'completed_at', sc.completed_at,
      'doctor', d.display_name,
      'fields', t.fields,
      'values', sc.payload,
      'corrections', (
        select coalesce(jsonb_agg(jsonb_build_object('body', c.body, 'created_at', c.created_at) order by c.created_at), '[]')
        from clinical.medical_corrections c where c.consultation_id = sc.id
      )
    ) order by sc.completed_at desc), '[]')
  ) into v_result
  from clinical.consultations sc
  join public.clinic_doctors d on d.id = sc.clinic_doctor_id
  join clinical.medical_templates t on t.id = sc.template_id
  where sc.clinic_patient_id = g.source_clinic_patient_id and sc.status = 'completed';

  perform private.log_clinical_access(v.clinic_id, v.id, g.id, 'external.viewed');
  return v_result;
end;
$$;

-- Verified withdrawal of consent, recorded by the doctor or reception.
create function public.revoke_cross_clinic_access(p_grant_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g clinical.cross_clinic_access_grants%rowtype;
  v_doctor uuid;
begin
  perform private.require_user();
  select * into g from clinical.cross_clinic_access_grants where id = p_grant_id for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select clinic_doctor_id into v_doctor from clinical.consultations where id = g.consultation_id;
  if not (private.is_clinic_doctor_self(v_doctor) or private.can_manage_appointments(g.destination_clinic_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if g.revoked_at is not null then
    return;
  end if;
  update clinical.cross_clinic_access_grants set revoked_at = now(), revoke_reason = 'patient_withdrew' where id = p_grant_id;
  perform private.log_clinical_access(g.destination_clinic_id, g.consultation_id, g.id, 'consent.withdrawn');
end;
$$;

-- Lets reception see which appointments already have a consultation and
-- reassign it, without any medical content.
create function public.consultation_status_for_appointments(p_appointment_ids uuid[])
returns table (appointment_id uuid, consultation_id uuid, status text, clinic_doctor_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.appointment_id, c.id, c.status, c.clinic_doctor_id
  from clinical.consultations c
  where c.appointment_id = any (p_appointment_ids)
    and (private.can_manage_appointments(c.clinic_id) or private.is_clinic_doctor_self(c.clinic_doctor_id));
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.normalize_name(text)',
    'private.flag_duplicates(uuid)',
    'private.guard_consultation()',
    'private.guard_grant()',
    'private.log_clinical_access(uuid, uuid, uuid, text)',
    'private.revoke_grants_on_change()',
    'private.load_own_consultation(uuid, boolean)',
    'private.validate_template_fields(jsonb)',
    'private.validate_payload(jsonb, jsonb, boolean)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.review_duplicate_candidate(uuid, text)',
    'public.save_medical_template(uuid, jsonb)',
    'public.get_medical_template(uuid)',
    'public.start_consultation(uuid)',
    'public.get_consultation(uuid)',
    'public.save_consultation_draft(uuid, jsonb)',
    'public.complete_consultation(uuid)',
    'public.add_medical_correction(uuid, text)',
    'public.list_patient_consultations(uuid)',
    'public.reassign_consultation(uuid, uuid)',
    'public.grant_cross_clinic_access(uuid, text, date, text, text, text)',
    'public.list_external_grants(uuid)',
    'public.read_external_records(uuid)',
    'public.revoke_cross_clinic_access(uuid)',
    'public.consultation_status_for_appointments(uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;

alter table public.duplicate_candidates enable row level security;
revoke all on table public.duplicate_candidates from anon, authenticated;
grant select on table public.duplicate_candidates to authenticated;
create policy duplicate_candidates_select on public.duplicate_candidates
  for select to authenticated using (private.can_manage_appointments(clinic_id));

-- Belt and braces: no API role may touch the clinical schema directly.
revoke all on all tables in schema clinical from public, anon, authenticated, service_role;
alter default privileges in schema clinical revoke all on tables from public, anon, authenticated, service_role;
