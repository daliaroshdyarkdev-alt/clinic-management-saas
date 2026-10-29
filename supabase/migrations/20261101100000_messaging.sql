-- Milestone 5: WhatsApp transactional messaging.
-- SRS: WAP-001..014, WAP-016, acceptance scenarios 8, 9 and 10.
--
-- Design
--   * Outbox: every message is a `message_intents` row with a unique
--     idempotency key, created by triggers on domain events (or manually).
--   * The background worker (service role) claims due intents with
--     FOR UPDATE SKIP LOCKED. All send-time checks happen inside the claim:
--     obsolete appointment state, current consent, event still enabled,
--     connection, approved template, and an atomic budget reservation.
--   * Webhooks are stored by provider event id (unique), so replays are
--     no-ops; delivery statuses only move forward; button replies may
--     complete a previously authorised action (accept/decline a proposed
--     alternative) and everything else is routed to reception as an alert.
--   * Access tokens never live in the database: connections hold only a
--     credential reference resolved by the worker from its secret store.
--   * Medical content is never put into messages or variables.

create type public.message_status as enum (
  'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled',
  'obsolete', 'blocked_consent', 'blocked_budget', 'blocked_config'
);

-- ---------------------------------------------------------------------------
-- Platform settings (prices/allowances are OPEN, OD-B05: data, not code)
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{2,80}$'),
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value) values
  ('messaging.default_allowance', '0'),
  ('messaging.overage_unit_minor', 'null');

create function public.admin_set_platform_setting(p_key text, p_value jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, v_uid)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform private.write_audit_event('admin', 'platform_setting.changed', 'success', null, 'platform_setting', p_key);
end;
$$;

-- Messaging allowance and overage price for a clinic. Milestone 6 replaces
-- this with the clinic's subscribed plan version.
create function private.messaging_terms(p_clinic_id uuid, out allowance integer, out overage_unit_minor bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::integer from public.platform_settings where key = 'messaging.default_allowance'), 0),
         (select nullif(value #>> '{}', '')::bigint from public.platform_settings where key = 'messaging.overage_unit_minor');
$$;

-- ---------------------------------------------------------------------------
-- Connections, templates and clinic settings
-- ---------------------------------------------------------------------------
create table public.whatsapp_connections (
  clinic_id uuid primary key references public.clinics (id) on delete restrict,
  ownership_mode text not null check (ownership_mode in ('clinic_owned', 'platform_managed')),
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone text check (char_length(display_phone) <= 30),
  -- Name of the secret holding the access token in the worker's secret store.
  credential_ref text not null check (credential_ref ~ '^[A-Z0-9_]{3,64}$'),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  last_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 200),
  updated_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.whatsapp_template_catalog (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (template_key in (
    'request_received', 'request_approved', 'request_rejected', 'alternative_proposal', 'reminder',
    'cancellation', 'session_cancellation', 'no_show'
  )),
  language public.app_locale not null,
  category text not null default 'utility' check (category in ('utility', 'marketing', 'authentication')),
  provider_template_name text not null check (provider_template_name ~ '^[a-z0-9_]{1,250}$'),
  body_preview text not null,
  -- Set by a platform admin once Meta has approved the template (WAP-004).
  approved boolean not null default false,
  unique (template_key, language)
);

insert into public.whatsapp_template_catalog (template_key, language, provider_template_name, body_preview) values
  ('request_received', 'ar', 'clinic_request_received_ar', 'تم استلام طلب حجزك لدى {{clinic}} مع {{doctor}}. ستتواصل معك العيادة للتأكيد.'),
  ('request_received', 'en', 'clinic_request_received_en', 'We received your booking request at {{clinic}} with {{doctor}}. The clinic will confirm.'),
  ('request_approved', 'ar', 'clinic_request_approved_ar', 'تم تأكيد موعدك لدى {{clinic}} مع {{doctor}} في {{when}}.'),
  ('request_approved', 'en', 'clinic_request_approved_en', 'Your appointment at {{clinic}} with {{doctor}} is confirmed for {{when}}.'),
  ('request_rejected', 'ar', 'clinic_request_rejected_ar', 'نعتذر، لم نتمكن من تأكيد طلبك لدى {{clinic}}.'),
  ('request_rejected', 'en', 'clinic_request_rejected_en', 'Sorry, {{clinic}} could not confirm your request.'),
  ('alternative_proposal', 'ar', 'clinic_alternative_ar', 'تقترح {{clinic}} موعدًا مع {{doctor}} في {{when}}. للرد: {{link}}'),
  ('alternative_proposal', 'en', 'clinic_alternative_en', '{{clinic}} proposes {{when}} with {{doctor}}. Reply here: {{link}}'),
  ('reminder', 'ar', 'clinic_reminder_ar', 'تذكير بموعدك لدى {{clinic}} مع {{doctor}} في {{when}}.'),
  ('reminder', 'en', 'clinic_reminder_en', 'Reminder: your appointment at {{clinic}} with {{doctor}} is at {{when}}.'),
  ('cancellation', 'ar', 'clinic_cancellation_ar', 'تم إلغاء موعدك لدى {{clinic}} في {{when}}.'),
  ('cancellation', 'en', 'clinic_cancellation_en', 'Your appointment at {{clinic}} on {{when}} was cancelled.'),
  ('session_cancellation', 'ar', 'clinic_session_cancelled_ar', 'نعتذر، ألغى {{doctor}} جلسة {{when}}. ستتواصل معك العيادة لإعادة الحجز.'),
  ('session_cancellation', 'en', 'clinic_session_cancelled_en', 'Sorry, {{doctor}} cancelled the session on {{when}}. The clinic will contact you to rebook.'),
  ('no_show', 'ar', 'clinic_no_show_ar', 'افتقدناك في موعدك لدى {{clinic}} في {{when}}. يمكنك حجز موعد جديد.'),
  ('no_show', 'en', 'clinic_no_show_en', 'We missed you at {{clinic}} on {{when}}. You can book a new appointment.');

-- WAP-004: clinic-specific versions, used only after platform approval.
create table public.clinic_template_overrides (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  catalog_id uuid not null references public.whatsapp_template_catalog (id) on delete restrict,
  provider_template_name text not null check (provider_template_name ~ '^[a-z0-9_]{1,250}$'),
  body_preview text not null check (char_length(body_preview) between 1 and 1024),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references auth.users (id) on delete restrict,
  reviewed_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, catalog_id)
);

-- WAP-002/003/005.
create table public.clinic_notification_settings (
  clinic_id uuid primary key references public.clinics (id) on delete restrict,
  enabled_events text[] not null default '{}' check (enabled_events <@ array[
    'request_received', 'request_decision', 'alternative_proposal', 'reminder', 'reschedule',
    'cancellation', 'session_cancellation', 'no_show'
  ]),
  reminder_offsets_minutes integer[] not null default '{}' check (cardinality(reminder_offsets_minutes) <= 5),
  default_language public.app_locale not null default 'ar',
  updated_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now()
);

-- WAP-008/009: messaging consent per clinic and patient, separate from
-- medical consent and marketing. Latest row wins; history is kept.
create table public.messaging_consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_patient_id uuid not null,
  granted boolean not null,
  source text not null check (source in ('receptionist', 'online_checkbox', 'secure_link')),
  recorded_by uuid references auth.users (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  foreign key (clinic_id, clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict
);

create index messaging_consents_patient_idx on public.messaging_consents (clinic_patient_id, recorded_at desc);

create trigger messaging_consents_append_only before update or delete on public.messaging_consents
  for each row execute function private.forbid_mutation();

alter table public.appointment_requests add column whatsapp_consent boolean not null default false;

-- ---------------------------------------------------------------------------
-- Outbox, webhooks, budgets, alerts
-- ---------------------------------------------------------------------------
create table public.message_intents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  event_type text not null,
  template_key text not null,
  language public.app_locale not null,
  recipient_phone_e164 text not null check (recipient_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  clinic_patient_id uuid,
  request_id uuid references public.appointment_requests (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete restrict,
  offer_id uuid references public.alternative_offers (id) on delete restrict,
  session_id uuid references public.doctor_sessions (id) on delete restrict,
  -- Display variables only (names, times, numbers, offer token). Never medical content.
  variables jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  status public.message_status not null default 'queued',
  idempotency_key text not null unique,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_until timestamptz,
  last_error_code text check (char_length(last_error_code) <= 100),
  provider_message_id text unique,
  billing_kind text check (billing_kind in ('allowance', 'overage')),
  cost_minor bigint not null default 0,
  billing_period date,
  manual boolean not null default false,
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  foreign key (clinic_id, clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict
);

create index message_intents_due_idx on public.message_intents (scheduled_for) where status = 'queued';
create index message_intents_clinic_idx on public.message_intents (clinic_id, created_at desc);
create index message_intents_appointment_idx on public.message_intents (appointment_id);

create trigger message_intents_updated_at before update on public.message_intents
  for each row execute function private.set_updated_at();

create table public.message_webhook_events (
  provider_event_id text primary key,
  clinic_id uuid references public.clinics (id) on delete restrict,
  kind text not null check (kind in ('status', 'reply')),
  provider_message_id text,
  detail text check (char_length(detail) <= 100),
  received_at timestamptz not null default now()
);

create table public.messaging_budgets (
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  period_month date not null,
  allowance_count integer not null check (allowance_count >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  overage_unit_minor bigint check (overage_unit_minor >= 0),
  overage_spent_minor bigint not null default 0 check (overage_spent_minor >= 0),
  alert_80_at timestamptz,
  alert_100_at timestamptz,
  primary key (clinic_id, period_month)
);

-- Clinic-defined ceiling for billable overage (WAP-013). No row = no overage.
create table public.messaging_spend_limits (
  clinic_id uuid primary key references public.clinics (id) on delete restrict,
  ceiling_minor bigint not null check (ceiling_minor >= 0),
  updated_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.messaging_alerts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  kind text not null check (kind in (
    'budget_80', 'budget_100', 'budget_blocked', 'send_failed', 'config_blocked',
    'connection_down', 'connection_restored', 'patient_reply'
  )),
  message_intent_id uuid references public.message_intents (id) on delete restrict,
  request_id uuid references public.appointment_requests (id) on delete restrict,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users (id) on delete restrict,
  acknowledged_at timestamptz
);

create index messaging_alerts_open_idx on public.messaging_alerts (clinic_id) where acknowledged_at is null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.can_message(p_clinic_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_finance(p_clinic_id, 'messaging.send') or private.can_manage_appointments(p_clinic_id);
$$;

create function private.event_enabled(p_clinic_id uuid, p_event text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinic_notification_settings s where s.clinic_id = p_clinic_id and p_event = any (s.enabled_events));
$$;

create function private.has_messaging_consent(p_clinic_patient_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.granted from public.messaging_consents c where c.clinic_patient_id = p_clinic_patient_id
                   order by c.recorded_at desc, c.id desc limit 1), false);
$$;

create function private.message_language(p_clinic_id uuid, p_clinic_patient_id uuid) returns public.app_locale
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select preferred_language from public.clinic_patients where id = p_clinic_patient_id),
    (select default_language from public.clinic_notification_settings where clinic_id = p_clinic_id),
    'ar'::public.app_locale
  );
$$;

create function private.appointment_variables(p_appointment_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'clinic', c.name, 'doctor', d.display_name,
    'starts_at', coalesce(a.starts_at, s.starts_at), 'reservation_number', a.reservation_number
  )
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  join public.clinic_doctors d on d.id = a.clinic_doctor_id
  join public.doctor_sessions s on s.id = a.session_id
  where a.id = p_appointment_id;
$$;

-- Creates an intent unless the event is disabled for the clinic (manual
-- sends skip the event switch). Idempotent on the key.
create function private.enqueue_message(
  p_clinic_id uuid,
  p_event text,
  p_template text,
  p_phone text,
  p_clinic_patient_id uuid,
  p_request_id uuid,
  p_appointment_id uuid,
  p_offer_id uuid,
  p_session_id uuid,
  p_variables jsonb,
  p_scheduled_for timestamptz,
  p_idempotency_key text,
  p_manual boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not p_manual and not private.event_enabled(p_clinic_id, p_event) then
    return null;
  end if;
  if p_phone is null then
    return null;
  end if;
  insert into public.message_intents (
    clinic_id, event_type, template_key, language, recipient_phone_e164, clinic_patient_id, request_id,
    appointment_id, offer_id, session_id, variables, scheduled_for, idempotency_key, manual, created_by
  ) values (
    p_clinic_id, p_event, p_template, private.message_language(p_clinic_id, p_clinic_patient_id), p_phone,
    p_clinic_patient_id, p_request_id, p_appointment_id, p_offer_id, p_session_id, coalesce(p_variables, '{}'),
    coalesce(p_scheduled_for, now()), p_idempotency_key, p_manual, auth.uid()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create function private.patient_phone(p_clinic_patient_id uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pi.phone_e164 from public.clinic_patients cp join public.patient_identities pi on pi.id = cp.patient_identity_id
  where cp.id = p_clinic_patient_id;
$$;

-- ---------------------------------------------------------------------------
-- Domain triggers -> outbox
-- ---------------------------------------------------------------------------
create function private.on_request_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vars jsonb;
begin
  select jsonb_build_object('clinic', c.name, 'doctor', d.display_name,
                            'starts_at', coalesce(new.requested_starts_at, s.starts_at))
    into v_vars
    from public.clinics c, public.clinic_doctors d, public.doctor_sessions s
   where c.id = new.clinic_id and d.id = new.clinic_doctor_id and s.id = new.session_id;

  -- The online checkbox becomes the patient's messaging consent once reception
  -- links the request to a patient, unless a later decision already exists.
  if tg_op = 'UPDATE' and new.whatsapp_consent and new.clinic_patient_id is not null
     and new.status in ('confirmed', 'alternative_proposed')
     and not exists (select 1 from public.messaging_consents mc
                     where mc.clinic_patient_id = new.clinic_patient_id and mc.recorded_at >= new.created_at) then
    insert into public.messaging_consents (clinic_id, clinic_patient_id, granted, source, recorded_at)
    values (new.clinic_id, new.clinic_patient_id, true, 'online_checkbox', new.created_at);
  end if;

  if tg_op = 'INSERT' then
    perform private.enqueue_message(new.clinic_id, 'request_received', 'request_received', new.requester_phone_e164,
      null, new.id, null, null, null, v_vars, now(), 'request_received:' || new.id);
  elsif new.status is distinct from old.status and new.status = 'confirmed' then
    perform private.enqueue_message(new.clinic_id, 'request_decision', 'request_approved', new.requester_phone_e164,
      new.clinic_patient_id, new.id, new.appointment_id, null, null,
      coalesce(private.appointment_variables(new.appointment_id), v_vars), now(), 'request_approved:' || new.id);
  elsif new.status is distinct from old.status and new.status = 'rejected' then
    perform private.enqueue_message(new.clinic_id, 'request_decision', 'request_rejected', new.requester_phone_e164,
      new.clinic_patient_id, new.id, null, null, null, v_vars, now(), 'request_rejected:' || new.id);
  end if;
  return new;
end;
$$;

create trigger appointment_requests_messages after insert or update of status on public.appointment_requests
  for each row execute function private.on_request_change();

create function private.on_appointment_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
begin
  if new.action not in ('cancelled', 'no_show') then
    return new;
  end if;
  select * into v_appt from public.appointments where id = new.appointment_id;
  perform private.enqueue_message(v_appt.clinic_id,
    case when new.action = 'cancelled' then 'cancellation' else 'no_show' end,
    case when new.action = 'cancelled' then 'cancellation' else 'no_show' end,
    private.patient_phone(v_appt.clinic_patient_id), v_appt.clinic_patient_id, null, v_appt.id, null, v_appt.session_id,
    private.appointment_variables(v_appt.id), now(), new.action || ':' || v_appt.id);
  return new;
end;
$$;

create trigger appointment_events_messages after insert on public.appointment_events
  for each row execute function private.on_appointment_event();

create function private.on_session_cancelled() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt record;
begin
  if not (new.status = 'cancelled' and old.status = 'scheduled') then
    return new;
  end if;
  for v_appt in
    select id, clinic_patient_id from public.appointments
    where session_id = new.id and status in ('awaiting_approval', 'booked', 'checked_in')
  loop
    perform private.enqueue_message(new.clinic_id, 'session_cancellation', 'session_cancellation',
      private.patient_phone(v_appt.clinic_patient_id), v_appt.clinic_patient_id, null, v_appt.id, null, new.id,
      private.appointment_variables(v_appt.id), now(), 'session_cancellation:' || v_appt.id);
  end loop;
  return new;
end;
$$;

create trigger doctor_sessions_messages after update of status on public.doctor_sessions
  for each row execute function private.on_session_cancelled();

-- Owner-grantable messaging permissions (WAP-013/014).
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
  if not (
    (p_role = 'manager' and p_capability in ('staff.manage', 'appointments.manage', 'finance.collect',
                                             'finance.approve', 'finance.reports', 'finance.accounts',
                                             'messaging.send', 'messaging.budget'))
    or (p_role = 'receptionist' and p_capability in ('finance.collect', 'messaging.send'))
    or (p_role = 'cashier' and p_capability = 'finance.reports')
  ) then
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

-- Alternative proposals now also go out by WhatsApp with the patient link.
create or replace function public.propose_alternative(
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

  perform private.enqueue_message(v_request.clinic_id, 'alternative_proposal', 'alternative_proposal',
    v_request.requester_phone_e164, p_clinic_patient_id, p_request_id, null, v_offer, p_session_id,
    jsonb_build_object(
      'clinic', (select name from public.clinics where id = v_request.clinic_id),
      'doctor', (select display_name from public.clinic_doctors where id = v_session.clinic_doctor_id),
      'starts_at', coalesce(p_starts_at, v_session.starts_at),
      'offer_token', v_token
    ),
    now(), 'alternative_proposal:' || v_offer);

  perform private.write_audit_event('appointments', 'request.alternative_proposed', 'success', v_request.clinic_id,
    'alternative_offer', v_offer::text);
  return v_token;
end;
$$;

-- Public request intake now records the online WhatsApp consent checkbox.
drop function public.public_submit_booking_request(uuid, uuid, timestamptz, text, text);

create function public.public_submit_booking_request(
  p_clinic_id uuid,
  p_session_id uuid,
  p_starts_at timestamptz,
  p_name text,
  p_phone_e164 text,
  p_whatsapp_consent boolean
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
  if (
    select count(*) from public.appointment_requests r
    where r.clinic_id = p_clinic_id and r.requester_phone_e164 = btrim(p_phone_e164)
      and r.status in ('submitted', 'alternative_proposed')
  ) >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  begin
    insert into public.appointment_requests (
      clinic_id, clinic_doctor_id, session_id, requested_starts_at, requester_name, requester_phone_e164, whatsapp_consent
    ) values (
      p_clinic_id, v_session.clinic_doctor_id, p_session_id,
      case when v_session.method = 'timed' then p_starts_at end, btrim(p_name), btrim(p_phone_e164),
      coalesce(p_whatsapp_consent, false)
    ) returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_request' using errcode = 'P0001';
  end;

  perform private.write_audit_event('appointments', 'request.submitted', 'success', p_clinic_id, 'appointment_request',
    v_id::text, '{}'::jsonb, null, 'system');
  return v_id;
end;
$$;

-- Offer response by offer id (shared by the patient page and WhatsApp buttons).
create function private.respond_offer(p_offer_id uuid, p_accept boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.alternative_offers%rowtype;
  v_request public.appointment_requests%rowtype;
  v_appointment uuid;
begin
  select * into v_offer from public.alternative_offers where id = p_offer_id for update;
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

create or replace function public.public_respond_to_offer(p_token text, p_accept boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer_id uuid;
begin
  select id into v_offer_id from public.alternative_offers where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
  if v_offer_id is null then
    raise exception 'offer_invalid' using errcode = 'P0001';
  end if;
  return private.respond_offer(v_offer_id, p_accept);
end;
$$;

-- ---------------------------------------------------------------------------
-- Budget (WAP-013): atomic reservation under a row lock.
-- ---------------------------------------------------------------------------
create function private.reserve_message_budget(p_clinic_id uuid, out kind text, out cost bigint, out period date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms record;
  v_budget public.messaging_budgets%rowtype;
  v_ceiling bigint;
begin
  period := date_trunc('month', now() at time zone 'Africa/Cairo')::date;
  select * into v_terms from private.messaging_terms(p_clinic_id);
  insert into public.messaging_budgets (clinic_id, period_month, allowance_count, overage_unit_minor)
  values (p_clinic_id, period, v_terms.allowance, v_terms.overage_unit_minor)
  on conflict do nothing;
  select * into v_budget from public.messaging_budgets where clinic_id = p_clinic_id and period_month = period for update;
  select ceiling_minor into v_ceiling from public.messaging_spend_limits where clinic_id = p_clinic_id;

  if v_budget.used_count < v_budget.allowance_count then
    update public.messaging_budgets set used_count = used_count + 1 where clinic_id = p_clinic_id and period_month = period;
    kind := 'allowance';
    cost := 0;
    return;
  end if;

  if v_budget.overage_unit_minor is not null and v_ceiling is not null
     and v_budget.overage_spent_minor + v_budget.overage_unit_minor <= v_ceiling then
    update public.messaging_budgets set overage_spent_minor = overage_spent_minor + v_budget.overage_unit_minor
     where clinic_id = p_clinic_id and period_month = period;
    kind := 'overage';
    cost := v_budget.overage_unit_minor;
    -- Threshold alerts fire once per crossing.
    if v_budget.alert_80_at is null and (v_budget.overage_spent_minor + cost) * 10 >= v_ceiling * 8 then
      update public.messaging_budgets set alert_80_at = now() where clinic_id = p_clinic_id and period_month = period;
      insert into public.messaging_alerts (clinic_id, kind) values (p_clinic_id, 'budget_80');
    end if;
    if v_budget.alert_100_at is null and v_budget.overage_spent_minor + 2 * cost > v_ceiling then
      update public.messaging_budgets set alert_100_at = now() where clinic_id = p_clinic_id and period_month = period;
      insert into public.messaging_alerts (clinic_id, kind) values (p_clinic_id, 'budget_100');
    end if;
    return;
  end if;

  if v_budget.alert_100_at is null then
    update public.messaging_budgets set alert_100_at = now() where clinic_id = p_clinic_id and period_month = period;
    insert into public.messaging_alerts (clinic_id, kind) values (p_clinic_id, 'budget_100');
  end if;
  kind := null;
  cost := 0;
end;
$$;

create function private.release_message_budget(p_intent public.message_intents) returns void
language sql
security definer
set search_path = ''
as $$
  update public.messaging_budgets
     set used_count = used_count - case when p_intent.billing_kind = 'allowance' then 1 else 0 end,
         overage_spent_minor = overage_spent_minor - case when p_intent.billing_kind = 'overage' then p_intent.cost_minor else 0 end
   where clinic_id = p_intent.clinic_id and period_month = p_intent.billing_period and p_intent.billing_kind is not null;
$$;

-- ---------------------------------------------------------------------------
-- Send-time checks (WAP-010, scenarios 9 and 10)
-- ---------------------------------------------------------------------------
create function private.intent_is_obsolete(p_intent public.message_intents) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_start timestamptz;
begin
  if p_intent.appointment_id is not null then
    select * into v_appt from public.appointments where id = p_intent.appointment_id;
    select coalesce(v_appt.starts_at, s.starts_at) into v_start from public.doctor_sessions s where s.id = v_appt.session_id;
  end if;
  return case p_intent.template_key
    when 'reminder' then v_appt.status not in ('booked', 'checked_in') or v_start <= now()
    when 'cancellation' then v_appt.status <> 'cancelled'
    when 'no_show' then v_appt.status <> 'no_show'
    when 'session_cancellation' then not exists (select 1 from public.doctor_sessions s where s.id = p_intent.session_id and s.status = 'cancelled')
    when 'request_received' then not exists (select 1 from public.appointment_requests r where r.id = p_intent.request_id and r.status = 'submitted')
    when 'request_approved' then not exists (
      select 1 from public.appointment_requests r join public.appointments a on a.id = r.appointment_id
      where r.id = p_intent.request_id and r.status = 'confirmed' and a.status in ('booked', 'checked_in', 'awaiting_approval'))
    when 'request_rejected' then not exists (select 1 from public.appointment_requests r where r.id = p_intent.request_id and r.status = 'rejected')
    when 'alternative_proposal' then not exists (select 1 from public.alternative_offers o where o.id = p_intent.offer_id and o.status = 'offered')
    else false
  end;
end;
$$;

create function private.intent_has_consent(p_intent public.message_intents) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_intent.clinic_patient_id is not null then private.has_messaging_consent(p_intent.clinic_patient_id)
    else coalesce((select whatsapp_consent from public.appointment_requests where id = p_intent.request_id), false)
  end;
$$;

create function private.provider_template(p_clinic_id uuid, p_key text, p_language public.app_locale) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.provider_template_name from public.clinic_template_overrides o
      join public.whatsapp_template_catalog t on t.id = o.catalog_id
      where o.clinic_id = p_clinic_id and t.template_key = p_key and t.language = p_language and o.status = 'approved'),
    (select t.provider_template_name from public.whatsapp_template_catalog t
      where t.template_key = p_key and t.language = p_language and t.approved)
  );
$$;

-- ---------------------------------------------------------------------------
-- Worker functions (service_role only)
-- ---------------------------------------------------------------------------
create function public.worker_claim_messages(p_limit integer)
returns table (
  intent_id uuid, clinic_id uuid, phone_number_id text, credential_ref text, recipient_phone_e164 text,
  provider_template text, language public.app_locale, variables jsonb, attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v public.message_intents%rowtype;
  v_conn public.whatsapp_connections%rowtype;
  v_template text;
  v_budget record;
begin
  -- Crash recovery: expired leases go back to the queue (at-least-once).
  update public.message_intents set status = 'queued', locked_until = null
   where status = 'sending' and locked_until < now();

  for v in
    select * from public.message_intents
    where status = 'queued' and scheduled_for <= now() and (next_attempt_at is null or next_attempt_at <= now())
    order by scheduled_for
    limit least(greatest(coalesce(p_limit, 10), 1), 100)
    for update skip locked
  loop
    if private.intent_is_obsolete(v) then
      update public.message_intents set status = 'obsolete' where id = v.id;
      continue;
    end if;
    if not private.intent_has_consent(v) then
      update public.message_intents set status = 'blocked_consent' where id = v.id;
      continue;
    end if;
    if not v.manual and not private.event_enabled(v.clinic_id, v.event_type) then
      update public.message_intents set status = 'cancelled', last_error_code = 'event_disabled' where id = v.id;
      continue;
    end if;
    select * into v_conn from public.whatsapp_connections where whatsapp_connections.clinic_id = v.clinic_id;
    if not found or v_conn.status <> 'connected' or not private.clinic_is_operational(v.clinic_id) then
      -- WAP-011: wait for recovery; obsolete checks run again when resumed.
      update public.message_intents set next_attempt_at = now() + interval '5 minutes' where id = v.id;
      continue;
    end if;
    v_template := private.provider_template(v.clinic_id, v.template_key, v.language);
    if v_template is null then
      update public.message_intents set status = 'blocked_config', last_error_code = 'template_not_approved' where id = v.id;
      insert into public.messaging_alerts (clinic_id, kind, message_intent_id) values (v.clinic_id, 'config_blocked', v.id);
      continue;
    end if;
    select * into v_budget from private.reserve_message_budget(v.clinic_id);
    if v_budget.kind is null then
      update public.message_intents set status = 'blocked_budget' where id = v.id;
      insert into public.messaging_alerts (clinic_id, kind, message_intent_id) values (v.clinic_id, 'budget_blocked', v.id);
      continue;
    end if;

    update public.message_intents
       set status = 'sending', attempts = attempts + 1, locked_until = now() + interval '5 minutes',
           billing_kind = v_budget.kind, cost_minor = v_budget.cost, billing_period = v_budget.period
     where id = v.id;

    intent_id := v.id;
    clinic_id := v.clinic_id;
    phone_number_id := v_conn.phone_number_id;
    credential_ref := v_conn.credential_ref;
    recipient_phone_e164 := v.recipient_phone_e164;
    provider_template := v_template;
    language := v.language;
    variables := v.variables;
    attempts := v.attempts + 1;
    return next;
  end loop;
end;
$$;

create function public.worker_record_send_result(
  p_intent_id uuid,
  p_ok boolean,
  p_provider_message_id text,
  p_error_code text,
  p_retryable boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.message_intents%rowtype;
begin
  select * into v from public.message_intents where id = p_intent_id for update;
  if not found or v.status <> 'sending' then
    return 'ignored';
  end if;
  if p_ok then
    update public.message_intents
       set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id, locked_until = null, last_error_code = null
     where id = v.id;
    return 'sent';
  end if;

  perform private.release_message_budget(v);
  if coalesce(p_retryable, false) and v.attempts < 5 then
    update public.message_intents
       set status = 'queued', locked_until = null, last_error_code = left(p_error_code, 100), billing_kind = null, cost_minor = 0,
           next_attempt_at = now() + make_interval(secs => 30 * power(2, v.attempts)::integer)
     where id = v.id;
    return 'retry';
  end if;
  update public.message_intents
     set status = 'failed', locked_until = null, last_error_code = left(p_error_code, 100), billing_kind = null, cost_minor = 0
   where id = v.id;
  insert into public.messaging_alerts (clinic_id, kind, message_intent_id) values (v.clinic_id, 'send_failed', v.id);
  return 'failed';
end;
$$;

-- WAP-003: reminder intents for upcoming appointments (idempotent).
create function public.worker_schedule_reminders() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v record;
begin
  for v in
    select a.id, a.clinic_id, a.clinic_patient_id, a.session_id, coalesce(a.starts_at, s.starts_at) as start_at, o.offset_minutes
    from public.clinic_notification_settings ns
    cross join lateral unnest(ns.reminder_offsets_minutes) as o(offset_minutes)
    join public.appointments a on a.clinic_id = ns.clinic_id
    join public.doctor_sessions s on s.id = a.session_id
    where 'reminder' = any (ns.enabled_events)
      and a.status in ('booked', 'checked_in')
      and coalesce(a.starts_at, s.starts_at) between now() and now() + interval '8 days'
      and coalesce(a.starts_at, s.starts_at) - make_interval(mins => o.offset_minutes) > now() - interval '10 minutes'
  loop
    if private.enqueue_message(v.clinic_id, 'reminder', 'reminder', private.patient_phone(v.clinic_patient_id),
         v.clinic_patient_id, null, v.id, null, v.session_id, private.appointment_variables(v.id),
         greatest(v.start_at - make_interval(mins => v.offset_minutes), now()),
         'reminder:' || v.id || ':' || v.offset_minutes) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create function public.worker_connections() returns table (clinic_id uuid, phone_number_id text, credential_ref text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.clinic_id, c.phone_number_id, c.credential_ref, c.status from public.whatsapp_connections c;
$$;

-- WAP-011: health transitions raise alerts once per change.
create function public.worker_set_connection_status(p_clinic_id uuid, p_status text, p_error text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_status not in ('connected', 'disconnected', 'error') then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  select status into v_old from public.whatsapp_connections where clinic_id = p_clinic_id for update;
  if not found then
    return;
  end if;
  update public.whatsapp_connections set status = p_status, last_checked_at = now(), last_error = left(p_error, 200)
   where clinic_id = p_clinic_id;
  if v_old = 'connected' and p_status <> 'connected' then
    insert into public.messaging_alerts (clinic_id, kind) values (p_clinic_id, 'connection_down');
  elsif v_old <> 'connected' and p_status = 'connected' then
    -- A first connection after configuration is not a recovery.
    if v_old = 'error' then
      insert into public.messaging_alerts (clinic_id, kind) values (p_clinic_id, 'connection_restored');
    end if;
    -- Resume waiting messages now; obsolete ones are filtered at claim time.
    update public.message_intents set next_attempt_at = null where message_intents.clinic_id = p_clinic_id and status = 'queued';
  end if;
end;
$$;

-- Webhooks (WAP-006, WAP-016, scenario 8).
create function public.process_whatsapp_webhook(
  p_event_id text,
  p_phone_number_id text,
  p_kind text,
  p_provider_message_id text,
  p_status text,
  p_billable boolean,
  p_error_code text,
  p_reply_id text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v public.message_intents%rowtype;
  v_rank_old integer;
  v_rank_new integer;
  v_offer uuid;
  v_outcome text;
begin
  select clinic_id into v_clinic from public.whatsapp_connections where phone_number_id = p_phone_number_id;
  if v_clinic is null then
    return 'unknown_number';
  end if;
  begin
    insert into public.message_webhook_events (provider_event_id, clinic_id, kind, provider_message_id, detail)
    values (p_event_id, v_clinic, p_kind, p_provider_message_id, left(coalesce(p_status, p_reply_id), 100));
  exception when unique_violation then
    return 'duplicate';
  end;

  if p_kind = 'status' then
    select * into v from public.message_intents
     where provider_message_id = p_provider_message_id and clinic_id = v_clinic for update;
    if not found then
      return 'unknown_message';
    end if;
    v_rank_old := case v.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
    v_rank_new := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
    if p_status = 'failed' and v_rank_old <= 1 then
      perform private.release_message_budget(v);
      update public.message_intents set status = 'failed', last_error_code = left(p_error_code, 100), billing_kind = null, cost_minor = 0
       where id = v.id;
      insert into public.messaging_alerts (clinic_id, kind, message_intent_id) values (v_clinic, 'send_failed', v.id);
      return 'status';
    elsif v_rank_new > v_rank_old then
      -- Out-of-order or repeated statuses never move a message backwards.
      update public.message_intents
         set status = p_status::public.message_status,
             delivered_at = case when v_rank_new >= 2 then coalesce(delivered_at, now()) else delivered_at end,
             read_at = case when v_rank_new = 3 then now() else read_at end
       where id = v.id;
    end if;
    -- Charge measured from the provider's receipt.
    if p_billable is false and v.billing_kind is not null then
      perform private.release_message_budget(v);
      update public.message_intents set billing_kind = null, cost_minor = 0 where id = v.id;
    end if;
    return 'status';
  end if;

  -- Replies: only buttons for an open proposal act automatically.
  if p_reply_id ~ '^offer_(accept|decline):[0-9a-f-]{36}$' then
    v_offer := substring(p_reply_id from position(':' in p_reply_id) + 1)::uuid;
    if exists (select 1 from public.alternative_offers o where o.id = v_offer and o.clinic_id = v_clinic) then
      begin
        v_outcome := private.respond_offer(v_offer, p_reply_id like 'offer_accept:%');
      exception when raise_exception then
        v_outcome := 'closed';
      end;
      return 'offer_' || v_outcome;
    end if;
  end if;
  insert into public.messaging_alerts (clinic_id, kind) values (v_clinic, 'patient_reply');
  return 'routed_to_reception';
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff functions
-- ---------------------------------------------------------------------------
create function public.set_notification_settings(
  p_clinic_id uuid,
  p_enabled_events text[],
  p_reminder_offsets_minutes integer[],
  p_default_language public.app_locale
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
  if exists (select 1 from unnest(coalesce(p_reminder_offsets_minutes, '{}')) o where o < 15 or o > 10080) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  begin
    insert into public.clinic_notification_settings (clinic_id, enabled_events, reminder_offsets_minutes, default_language, updated_by)
    values (p_clinic_id, coalesce(p_enabled_events, '{}'), coalesce(p_reminder_offsets_minutes, '{}'), p_default_language, v_uid)
    on conflict (clinic_id) do update set enabled_events = excluded.enabled_events,
      reminder_offsets_minutes = excluded.reminder_offsets_minutes, default_language = excluded.default_language,
      updated_by = excluded.updated_by, updated_at = now();
  exception when check_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;
  perform private.write_audit_event('messaging', 'settings.changed', 'success', p_clinic_id, 'clinic', p_clinic_id::text);
end;
$$;

-- WAP-001: clinic-owned or platform-managed number. The token stays in the
-- worker's secret store under `credential_ref`; the worker verifies health.
create function public.configure_whatsapp_connection(
  p_clinic_id uuid,
  p_mode text,
  p_phone_number_id text,
  p_display_phone text,
  p_credential_ref text
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
  if p_mode = 'platform_managed' then
    raise exception 'platform_managed_by_admin' using errcode = 'P0001';
  end if;
  begin
    insert into public.whatsapp_connections (clinic_id, ownership_mode, phone_number_id, display_phone, credential_ref, updated_by)
    values (p_clinic_id, 'clinic_owned', btrim(p_phone_number_id), nullif(btrim(coalesce(p_display_phone, '')), ''),
            upper(btrim(p_credential_ref)), v_uid)
    on conflict (clinic_id) do update set ownership_mode = 'clinic_owned', phone_number_id = excluded.phone_number_id,
      display_phone = excluded.display_phone, credential_ref = excluded.credential_ref, status = 'disconnected',
      updated_by = excluded.updated_by, updated_at = now();
  exception when check_violation or unique_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;
  perform private.write_audit_event('messaging', 'connection.configured', 'success', p_clinic_id, 'clinic', p_clinic_id::text);
end;
$$;

create function public.admin_configure_platform_number(
  p_clinic_id uuid,
  p_phone_number_id text,
  p_display_phone text,
  p_credential_ref text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  begin
    insert into public.whatsapp_connections (clinic_id, ownership_mode, phone_number_id, display_phone, credential_ref, updated_by)
    values (p_clinic_id, 'platform_managed', btrim(p_phone_number_id), nullif(btrim(coalesce(p_display_phone, '')), ''),
            upper(btrim(p_credential_ref)), v_uid)
    on conflict (clinic_id) do update set ownership_mode = 'platform_managed', phone_number_id = excluded.phone_number_id,
      display_phone = excluded.display_phone, credential_ref = excluded.credential_ref, status = 'disconnected',
      updated_by = excluded.updated_by, updated_at = now();
  exception when check_violation or unique_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;
end;
$$;

-- WAP-013: owner, or a manager explicitly granted messaging.budget.
create function public.set_messaging_ceiling(p_clinic_id uuid, p_ceiling_minor bigint) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_period date := date_trunc('month', now() at time zone 'Africa/Cairo')::date;
begin
  if not private.has_finance(p_clinic_id, 'messaging.budget') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ceiling_minor is null or p_ceiling_minor < 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  insert into public.messaging_spend_limits (clinic_id, ceiling_minor, updated_by) values (p_clinic_id, p_ceiling_minor, v_uid)
  on conflict (clinic_id) do update set ceiling_minor = excluded.ceiling_minor, updated_by = excluded.updated_by, updated_at = now();
  -- A raised ceiling re-arms threshold alerts that are no longer crossed.
  update public.messaging_budgets
     set alert_80_at = case when overage_spent_minor * 10 < p_ceiling_minor * 8 then null else alert_80_at end,
         alert_100_at = case when overage_spent_minor < p_ceiling_minor then null else alert_100_at end
   where clinic_id = p_clinic_id and period_month = v_period;
  perform private.write_audit_event('messaging', 'ceiling.changed', 'success', p_clinic_id, 'clinic', p_clinic_id::text,
    jsonb_build_object('ceiling_minor', p_ceiling_minor));
end;
$$;

-- WAP-008/009: consent capture and withdrawal by reception; withdrawal
-- also cancels queued messages (and send-time checks catch the rest).
create function public.record_messaging_consent(p_clinic_patient_id uuid, p_granted boolean, p_source text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.clinic_patients where id = p_clinic_patient_id;
  if not found or not private.can_manage_appointments(v_clinic) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_granted is null or p_source not in ('receptionist', 'secure_link') then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  insert into public.messaging_consents (clinic_id, clinic_patient_id, granted, source, recorded_by)
  values (v_clinic, p_clinic_patient_id, p_granted, p_source, v_uid);
  if not p_granted then
    update public.message_intents set status = 'cancelled', last_error_code = 'consent_withdrawn'
     where clinic_patient_id = p_clinic_patient_id and status = 'queued';
  end if;
  perform private.write_audit_event('messaging', 'consent.recorded', 'success', v_clinic, 'clinic_patient',
    p_clinic_patient_id::text, jsonb_build_object('granted', p_granted));
end;
$$;

-- WAP-007: reception sends an approved appointment template manually.
create function public.send_manual_message(p_appointment_id uuid, p_template_key text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
begin
  perform private.require_user();
  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found or not private.has_finance(v_appt.clinic_id, 'messaging.send') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_template_key not in ('reminder', 'cancellation', 'no_show', 'session_cancellation') then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  return private.enqueue_message(v_appt.clinic_id, 'manual', p_template_key, private.patient_phone(v_appt.clinic_patient_id),
    v_appt.clinic_patient_id, null, v_appt.id, null, v_appt.session_id, private.appointment_variables(v_appt.id), now(),
    'manual:' || gen_random_uuid(), true);
end;
$$;

create function public.acknowledge_messaging_alert(p_alert_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.messaging_alerts where id = p_alert_id;
  if not found or not private.can_message(v_clinic) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.messaging_alerts set acknowledged_at = now(), acknowledged_by = v_uid where id = p_alert_id and acknowledged_at is null;
end;
$$;

create function public.request_template_override(p_clinic_id uuid, p_catalog_id uuid, p_provider_template_name text, p_body_preview text)
returns void
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
  begin
    insert into public.clinic_template_overrides (clinic_id, catalog_id, provider_template_name, body_preview, requested_by)
    values (p_clinic_id, p_catalog_id, btrim(p_provider_template_name), btrim(p_body_preview), v_uid)
    on conflict (clinic_id, catalog_id) do update set provider_template_name = excluded.provider_template_name,
      body_preview = excluded.body_preview, status = 'pending', requested_by = excluded.requested_by, reviewed_by = null;
  exception when check_violation or foreign_key_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;
end;
$$;

create function public.admin_review_template(p_catalog_id uuid, p_override_id uuid, p_approved boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_override_id is not null then
    update public.clinic_template_overrides set status = case when p_approved then 'approved' else 'rejected' end, reviewed_by = v_uid
     where id = p_override_id;
  else
    update public.whatsapp_template_catalog set approved = coalesce(p_approved, false) where id = p_catalog_id;
  end if;
  perform private.write_audit_event('admin', 'template.reviewed', 'success', null, 'whatsapp_template',
    coalesce(p_override_id, p_catalog_id)::text, jsonb_build_object('approved', p_approved));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.messaging_terms(uuid)', 'private.can_message(uuid)', 'private.event_enabled(uuid, text)',
    'private.has_messaging_consent(uuid)', 'private.message_language(uuid, uuid)', 'private.appointment_variables(uuid)',
    'private.enqueue_message(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz, text, boolean)',
    'private.patient_phone(uuid)', 'private.on_request_change()', 'private.on_appointment_event()',
    'private.on_session_cancelled()', 'private.respond_offer(uuid, boolean)', 'private.reserve_message_budget(uuid)',
    'private.release_message_budget(public.message_intents)', 'private.intent_is_obsolete(public.message_intents)',
    'private.intent_has_consent(public.message_intents)', 'private.provider_template(uuid, text, public.app_locale)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
  end loop;
  grant execute on function private.can_message(uuid) to authenticated;

  foreach v_fn in array array[
    'public.worker_claim_messages(integer)', 'public.worker_record_send_result(uuid, boolean, text, text, boolean)',
    'public.worker_schedule_reminders()', 'public.worker_connections()', 'public.worker_set_connection_status(uuid, text, text)',
    'public.process_whatsapp_webhook(text, text, text, text, text, boolean, text, text)',
    'public.public_submit_booking_request(uuid, uuid, timestamptz, text, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.admin_set_platform_setting(text, jsonb)', 'public.set_notification_settings(uuid, text[], integer[], public.app_locale)',
    'public.configure_whatsapp_connection(uuid, text, text, text, text)',
    'public.admin_configure_platform_number(uuid, text, text, text)', 'public.set_messaging_ceiling(uuid, bigint)',
    'public.record_messaging_consent(uuid, boolean, text)', 'public.send_manual_message(uuid, text)',
    'public.acknowledge_messaging_alert(uuid)', 'public.request_template_override(uuid, uuid, text, text)',
    'public.admin_review_template(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;

alter table public.platform_settings enable row level security;
alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_template_catalog enable row level security;
alter table public.clinic_template_overrides enable row level security;
alter table public.clinic_notification_settings enable row level security;
alter table public.messaging_consents enable row level security;
alter table public.message_intents enable row level security;
alter table public.message_webhook_events enable row level security;
alter table public.messaging_budgets enable row level security;
alter table public.messaging_spend_limits enable row level security;
alter table public.messaging_alerts enable row level security;

revoke all on table
  public.platform_settings, public.whatsapp_connections, public.whatsapp_template_catalog,
  public.clinic_template_overrides, public.clinic_notification_settings, public.messaging_consents,
  public.message_intents, public.message_webhook_events, public.messaging_budgets, public.messaging_spend_limits,
  public.messaging_alerts
from anon, authenticated;

grant select on table public.platform_settings to authenticated;
create policy platform_settings_select_admin on public.platform_settings
  for select to authenticated using (private.is_platform_admin());

grant select on table public.whatsapp_connections to authenticated;
create policy whatsapp_connections_select on public.whatsapp_connections
  for select to authenticated using (private.can_message(clinic_id) or private.is_platform_admin());

grant select on table public.whatsapp_template_catalog to authenticated;
create policy whatsapp_template_catalog_select on public.whatsapp_template_catalog
  for select to authenticated using (true);

grant select on table public.clinic_template_overrides to authenticated;
create policy clinic_template_overrides_select on public.clinic_template_overrides
  for select to authenticated using (private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin());

grant select on table public.clinic_notification_settings to authenticated;
create policy clinic_notification_settings_select on public.clinic_notification_settings
  for select to authenticated using (private.is_active_member(clinic_id));

grant select on table public.messaging_consents to authenticated;
create policy messaging_consents_select on public.messaging_consents
  for select to authenticated using (private.can_message(clinic_id));

-- WAP-012 message log. Variables (which may include an offer link token) are not readable.
grant select (id, clinic_id, event_type, template_key, language, recipient_phone_e164, clinic_patient_id, request_id,
              appointment_id, scheduled_for, status, attempts, last_error_code, billing_kind, cost_minor, manual,
              created_at, updated_at, sent_at, delivered_at, read_at)
  on table public.message_intents to authenticated;
create policy message_intents_select on public.message_intents
  for select to authenticated using (private.can_message(clinic_id));

grant select on table public.messaging_budgets to authenticated;
create policy messaging_budgets_select on public.messaging_budgets
  for select to authenticated using (private.can_message(clinic_id) or private.has_finance(clinic_id, 'messaging.budget'));

grant select on table public.messaging_spend_limits to authenticated;
create policy messaging_spend_limits_select on public.messaging_spend_limits
  for select to authenticated using (private.can_message(clinic_id) or private.has_finance(clinic_id, 'messaging.budget'));

grant select on table public.messaging_alerts to authenticated;
create policy messaging_alerts_select on public.messaging_alerts
  for select to authenticated using (private.can_message(clinic_id));
