-- Milestone 6: SaaS subscriptions and platform billing.
-- SRS: SUB-001..010, ADM-001/002 (re-verification, trial extensions, manual
-- payment approval, plan versions), ONB-006; acceptance scenarios 11, 12, 13.
--
-- Design
--   * Plans are versioned; a version is immutable once published. A paid
--     period stores a snapshot of the version's terms (doctor limit,
--     messaging allowance, overage price), so catalogue changes never alter
--     terms already paid for (SUB-010).
--   * Every verified payment creates exactly one `subscription_periods` row.
--     A period starts at the latest of now, the trial end and the end of the
--     last paid period, so upgrades, downgrades and capacity changes only
--     take effect at the next renewal (SUB-008, scenario 11).
--   * Payments are separate from clinic finance. Gateway webhooks are
--     idempotent per provider event id and per payment; manual InstaPay/bank
--     evidence never grants anything until a platform admin verifies it
--     (SUB-006, scenario 12).
--   * Expiry never erases data. After the grace period the clinic enters a
--     restricted mode that stops growth (new bookings, online requests,
--     outbound WhatsApp, doctor activation) while records, consultations on
--     existing visits, finance and exports keep working (SUB-004, scenario 13).
--   * Prices, tiers, grace length and trial capacity are OPEN (SUB-011,
--     OD-B05): they are platform data with conservative defaults.

-- ---------------------------------------------------------------------------
-- Platform settings used by billing (data, not code)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('billing.grace_days', '7'),
  ('billing.trial_doctor_limit', '3')
on conflict (key) do nothing;

create function private.setting_int(p_key text, p_default integer) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::integer from public.platform_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Plans and versions (SUB-001, SUB-005, SUB-010)
-- ---------------------------------------------------------------------------
create table public.platform_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_ar text not null check (char_length(name_ar) between 1 and 100),
  name_en text not null check (char_length(name_en) between 1 and 100),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.platform_plans (id) on delete restrict,
  version integer not null check (version > 0),
  doctor_limit integer not null check (doctor_limit between 1 and 1000),
  -- Null price = not offered for that period. Annual prices carry any discount.
  monthly_price_minor bigint check (monthly_price_minor >= 0),
  annual_price_minor bigint check (annual_price_minor >= 0),
  extra_doctor_monthly_minor bigint check (extra_doctor_monthly_minor >= 0),
  extra_doctor_annual_minor bigint check (extra_doctor_annual_minor >= 0),
  messaging_allowance integer not null default 0 check (messaging_allowance >= 0),
  messaging_overage_unit_minor bigint check (messaging_overage_unit_minor >= 0),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  published_by uuid not null references auth.users (id) on delete restrict,
  published_at timestamptz not null default now(),
  unique (plan_id, version),
  check (monthly_price_minor is not null or annual_price_minor is not null)
);

create trigger plan_versions_immutable before update or delete on public.plan_versions
  for each row execute function private.forbid_mutation();

-- Latest version of each public plan is what clinics can buy.
create view private.current_plan_versions as
  select distinct on (v.plan_id) v.*
  from public.plan_versions v
  join public.platform_plans p on p.id = v.plan_id
  where p.is_public
  order by v.plan_id, v.version desc;

-- ---------------------------------------------------------------------------
-- Trial extensions (SUB-003, ADM-002)
-- ---------------------------------------------------------------------------
create table public.trial_extensions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  days integer not null check (days between 1 and 60),
  previous_trial_ends_at timestamptz not null,
  new_trial_ends_at timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  granted_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create trigger trial_extensions_append_only before update or delete on public.trial_extensions
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Payments, periods, receipts (SUB-006, SUB-009)
-- ---------------------------------------------------------------------------
create type public.subscription_payment_status as enum (
  'awaiting_gateway', 'pending_verification', 'paid', 'rejected', 'failed', 'cancelled'
);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  plan_version_id uuid not null references public.plan_versions (id) on delete restrict,
  billing_period text not null check (billing_period in ('monthly', 'annual')),
  extra_doctor_slots integer not null default 0 check (extra_doctor_slots between 0 and 100),
  -- Computed by the server from the plan version; never taken from the client.
  amount_minor bigint not null check (amount_minor >= 0),
  source text not null check (source in ('gateway', 'instapay', 'bank_transfer')),
  status public.subscription_payment_status not null,
  provider text check (char_length(provider) <= 40),
  provider_ref text check (char_length(provider_ref) <= 200),
  payer_reference text check (char_length(payer_reference) <= 200),
  evidence_path text unique,
  evidence_mime text,
  evidence_size integer,
  submitted_by uuid not null references auth.users (id) on delete restrict,
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (char_length(decision_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source = 'gateway' or evidence_path is not null)
);

create unique index subscription_payments_provider_ref_key on public.subscription_payments (provider, provider_ref)
  where provider_ref is not null;
create index subscription_payments_clinic_idx on public.subscription_payments (clinic_id, created_at desc);
create index subscription_payments_pending_idx on public.subscription_payments (created_at) where status = 'pending_verification';

create trigger subscription_payments_updated_at before update on public.subscription_payments
  for each row execute function private.set_updated_at();
create trigger subscription_payments_clinic_id_immutable before update on public.subscription_payments
  for each row execute function private.forbid_clinic_id_change();

create table public.subscription_periods (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  payment_id uuid not null unique references public.subscription_payments (id) on delete restrict,
  plan_version_id uuid not null references public.plan_versions (id) on delete restrict,
  billing_period text not null check (billing_period in ('monthly', 'annual')),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  -- Snapshot of the paid terms (SUB-010).
  doctor_limit integer not null,
  extra_doctor_slots integer not null,
  messaging_allowance integer not null,
  messaging_overage_unit_minor bigint,
  created_at timestamptz not null default now()
);

create index subscription_periods_clinic_idx on public.subscription_periods (clinic_id, period_start);
-- Periods of one clinic never overlap.
alter table public.subscription_periods add constraint subscription_periods_no_overlap
  exclude using gist (clinic_id with =, tstzrange(period_start, period_end) with &&);

create trigger subscription_periods_append_only before update or delete on public.subscription_periods
  for each row execute function private.forbid_mutation();

create sequence public.subscription_receipt_number_seq;

create table public.subscription_receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  payment_id uuid not null unique references public.subscription_payments (id) on delete restrict,
  receipt_number bigint not null unique default nextval('public.subscription_receipt_number_seq'),
  amount_minor bigint not null,
  issued_at timestamptz not null default now()
);

create trigger subscription_receipts_append_only before update or delete on public.subscription_receipts
  for each row execute function private.forbid_mutation();

create table public.payment_webhook_events (
  provider text not null check (char_length(provider) <= 40),
  provider_event_id text not null check (char_length(provider_event_id) <= 200),
  payment_id uuid references public.subscription_payments (id) on delete restrict,
  outcome text not null,
  received_at timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

-- ONB-006: platform request for a fresh licence revision of an active clinic.
create table public.license_reverification_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  license_type public.license_type not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  requested_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  fulfilled_license_id uuid references public.clinic_licenses (id) on delete restrict,
  fulfilled_at timestamptz
);

create unique index license_reverification_open_key on public.license_reverification_requests (clinic_id, license_type)
  where fulfilled_at is null;

-- ---------------------------------------------------------------------------
-- Entitlement (SUB-002..004)
-- ---------------------------------------------------------------------------
create function private.current_period(p_clinic_id uuid) returns public.subscription_periods
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.subscription_periods
  where clinic_id = p_clinic_id and period_start <= now() and period_end > now()
  limit 1;
$$;

-- 'none' (never activated), 'trial', 'active', 'grace' or 'restricted'.
create function private.subscription_state(p_clinic_id uuid) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.clinic_subscriptions%rowtype;
  v_last_end timestamptz;
begin
  select * into v_sub from public.clinic_subscriptions where clinic_id = p_clinic_id;
  if not found then
    return 'none';
  end if;
  if (private.current_period(p_clinic_id)).id is not null then
    return 'active';
  end if;
  if now() < v_sub.trial_ends_at then
    return 'trial';
  end if;
  select max(period_end) into v_last_end from public.subscription_periods where clinic_id = p_clinic_id and period_start <= now();
  if now() < greatest(v_sub.trial_ends_at, coalesce(v_last_end, v_sub.trial_ends_at))
             + make_interval(days => private.setting_int('billing.grace_days', 7)) then
    return 'grace';
  end if;
  return 'restricted';
end;
$$;

create function private.clinic_entitled(p_clinic_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.subscription_state(p_clinic_id) in ('trial', 'active', 'grace');
$$;

-- Active-doctor capacity: the paid period's snapshot, else the last paid
-- period during grace, else the trial limit (also used while a clinic is
-- still pending activation). Restricted clinics add none.
create function private.doctor_capacity(p_clinic_id uuid) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text := private.subscription_state(p_clinic_id);
  v_period public.subscription_periods%rowtype;
begin
  if v_state = 'restricted' then
    return 0;
  end if;
  if v_state = 'active' then
    v_period := private.current_period(p_clinic_id);
  else
    select * into v_period from public.subscription_periods
     where clinic_id = p_clinic_id and period_end <= now() order by period_end desc limit 1;
  end if;
  if v_period.id is not null and v_state <> 'trial' then
    return v_period.doctor_limit + v_period.extra_doctor_slots;
  end if;
  return private.setting_int('billing.trial_doctor_limit', 3);
end;
$$;

-- Restricted mode blocks growth only; it never touches existing records.
create function private.enforce_entitlement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.clinic_entitled(new.clinic_id) then
    raise exception 'subscription_restricted' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger appointments_entitlement before insert on public.appointments
  for each row execute function private.enforce_entitlement();
create trigger appointment_requests_entitlement before insert on public.appointment_requests
  for each row execute function private.enforce_entitlement();

-- SUB-002: doctors beyond capacity are added inactive and cannot be
-- activated until capacity exists. Serialised per clinic.
create function private.enforce_doctor_capacity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  perform 1 from public.clinics where id = new.clinic_id for update;
  select count(*) into v_active from public.clinic_doctors
   where clinic_id = new.clinic_id and status = 'active' and id <> new.id;
  if v_active >= private.doctor_capacity(new.clinic_id) then
    if tg_op = 'INSERT' then
      new.status := 'inactive';
    else
      raise exception 'doctor_capacity_reached' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger clinic_doctors_capacity before insert or update of status on public.clinic_doctors
  for each row execute function private.enforce_doctor_capacity();

-- Messaging allowance and overage now come from the paid period's snapshot;
-- platform defaults apply during the trial.
create or replace function private.messaging_terms(p_clinic_id uuid, out allowance integer, out overage_unit_minor bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period public.subscription_periods%rowtype := private.current_period(p_clinic_id);
begin
  if v_period.id is not null then
    allowance := v_period.messaging_allowance;
    overage_unit_minor := v_period.messaging_overage_unit_minor;
    return;
  end if;
  allowance := coalesce((select (value #>> '{}')::integer from public.platform_settings where key = 'messaging.default_allowance'), 0);
  overage_unit_minor := (select nullif(value #>> '{}', '')::bigint from public.platform_settings where key = 'messaging.overage_unit_minor');
end;
$$;

-- Restricted clinics send no WhatsApp messages; queued ones wait and are
-- re-checked (obsolete, consent) if the subscription is renewed.
create or replace function public.worker_claim_messages(p_limit integer)
returns table (
  intent_id uuid, clinic_id uuid, phone_number_id text, credential_ref text, recipient_phone_e164 text,
  template_key text, provider_template text, language public.app_locale, variables jsonb, offer_id uuid, attempts integer
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
    if not found or v_conn.status <> 'connected' or not private.clinic_is_operational(v.clinic_id)
       or not private.clinic_entitled(v.clinic_id) then
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
    template_key := v.template_key;
    provider_template := v_template;
    language := v.language;
    variables := v.variables;
    offer_id := v.offer_id;
    attempts := v.attempts + 1;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Applying a verified payment (shared by gateway and manual paths)
-- ---------------------------------------------------------------------------
create function private.apply_payment(p_payment_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_version public.plan_versions%rowtype;
  v_sub public.clinic_subscriptions%rowtype;
  v_start timestamptz;
  v_period uuid;
begin
  select * into v_payment from public.subscription_payments where id = p_payment_id for update;
  if v_payment.status = 'paid' then
    return (select id from public.subscription_periods where payment_id = p_payment_id);
  end if;
  -- One clinic's renewals are serialised so periods never overlap.
  select * into v_sub from public.clinic_subscriptions where clinic_id = v_payment.clinic_id for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;
  select * into v_version from public.plan_versions where id = v_payment.plan_version_id;

  v_start := greatest(now(), v_sub.trial_ends_at,
    coalesce((select max(period_end) from public.subscription_periods where clinic_id = v_payment.clinic_id), now()));

  insert into public.subscription_periods (
    clinic_id, payment_id, plan_version_id, billing_period, period_start, period_end, doctor_limit,
    extra_doctor_slots, messaging_allowance, messaging_overage_unit_minor
  ) values (
    v_payment.clinic_id, v_payment.id, v_version.id, v_payment.billing_period, v_start,
    v_start + case when v_payment.billing_period = 'annual' then interval '1 year' else interval '1 month' end,
    v_version.doctor_limit, v_payment.extra_doctor_slots, v_version.messaging_allowance,
    v_version.messaging_overage_unit_minor
  ) returning id into v_period;

  update public.subscription_payments set status = 'paid' where id = v_payment.id;
  insert into public.subscription_receipts (clinic_id, payment_id, amount_minor)
  values (v_payment.clinic_id, v_payment.id, v_payment.amount_minor);

  perform private.write_audit_event('billing', 'payment.applied', 'success', v_payment.clinic_id, 'subscription_payment',
    v_payment.id::text, jsonb_build_object('source', v_payment.source, 'period_start', v_start), null, 'system');
  return v_period;
end;
$$;

-- Server-side price (never from the client).
create function private.payment_amount(p_version public.plan_versions, p_period text, p_extra integer) returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base bigint := case p_period when 'monthly' then p_version.monthly_price_minor when 'annual' then p_version.annual_price_minor end;
  v_extra bigint := case p_period when 'monthly' then p_version.extra_doctor_monthly_minor
                                  when 'annual' then p_version.extra_doctor_annual_minor end;
begin
  if v_base is null or (coalesce(p_extra, 0) > 0 and v_extra is null) then
    raise exception 'plan_not_available' using errcode = 'P0001';
  end if;
  return v_base + coalesce(p_extra, 0) * coalesce(v_extra, 0);
end;
$$;

create function private.prepare_payment(p_clinic_id uuid, p_plan_version_id uuid, p_period text, p_extra integer)
returns public.plan_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.plan_versions%rowtype;
begin
  if not private.has_clinic_role(p_clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id and account_state in ('active', 'suspended'))
     or not exists (select 1 from public.clinic_subscriptions where clinic_id = p_clinic_id) then
    raise exception 'clinic_not_operational' using errcode = 'P0001';
  end if;
  -- Only the current version of a public plan can be bought.
  select v.* into v_version from public.plan_versions v
   where v.id = p_plan_version_id and v.id in (select id from private.current_plan_versions);
  if not found then
    raise exception 'plan_not_available' using errcode = 'P0001';
  end if;
  if p_period not in ('monthly', 'annual') or coalesce(p_extra, -1) not between 0 and 100 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner functions
-- ---------------------------------------------------------------------------
-- SUB-006 online path: creates the payment the gateway will confirm.
create function public.start_gateway_payment(
  p_clinic_id uuid,
  p_plan_version_id uuid,
  p_billing_period text,
  p_extra_doctor_slots integer,
  p_provider text
) returns table (payment_id uuid, amount_minor bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_version public.plan_versions;
  v_amount bigint;
  v_id uuid;
begin
  v_version := private.prepare_payment(p_clinic_id, p_plan_version_id, p_billing_period, p_extra_doctor_slots);
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  v_amount := private.payment_amount(v_version, p_billing_period, p_extra_doctor_slots);
  insert into public.subscription_payments (
    clinic_id, plan_version_id, billing_period, extra_doctor_slots, amount_minor, source, status, provider, submitted_by
  ) values (
    p_clinic_id, p_plan_version_id, p_billing_period, p_extra_doctor_slots, v_amount, 'gateway', 'awaiting_gateway', p_provider, v_uid
  ) returning id into v_id;
  perform private.write_audit_event('billing', 'payment.started', 'success', p_clinic_id, 'subscription_payment', v_id::text);
  payment_id := v_id;
  amount_minor := v_amount;
  return next;
end;
$$;

-- The app records the gateway's checkout reference for later matching.
create function public.attach_gateway_reference(p_payment_id uuid, p_provider_ref text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
begin
  perform private.require_user();
  select * into v_payment from public.subscription_payments where id = p_payment_id for update;
  if not found or not private.has_clinic_role(v_payment.clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_payment.status <> 'awaiting_gateway' or v_payment.provider_ref is not null
     or p_provider_ref is null or char_length(p_provider_ref) not between 1 and 200 then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  update public.subscription_payments set provider_ref = p_provider_ref where id = p_payment_id;
end;
$$;

-- SUB-006 manual path: evidence first, entitlement only after admin verification.
create function public.submit_manual_payment(
  p_clinic_id uuid,
  p_plan_version_id uuid,
  p_billing_period text,
  p_extra_doctor_slots integer,
  p_source text,
  p_payer_reference text,
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
  v_version public.plan_versions;
  v_id uuid;
  v_ref text := nullif(btrim(coalesce(p_payer_reference, '')), '');
begin
  v_version := private.prepare_payment(p_clinic_id, p_plan_version_id, p_billing_period, p_extra_doctor_slots);
  if p_source not in ('instapay', 'bank_transfer') then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  if v_ref is null then
    raise exception 'reference_required' using errcode = 'P0001';
  end if;
  if p_storage_path is null
     or p_storage_path !~ ('^' || p_clinic_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$') then
    raise exception 'invalid_storage_path' using errcode = 'P0001';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_size_bytes is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'invalid_file' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'billing-evidence' and o.name = p_storage_path) then
    raise exception 'file_not_found' using errcode = 'P0001';
  end if;
  begin
    insert into public.subscription_payments (
      clinic_id, plan_version_id, billing_period, extra_doctor_slots, amount_minor, source, status, payer_reference,
      evidence_path, evidence_mime, evidence_size, submitted_by
    ) values (
      p_clinic_id, p_plan_version_id, p_billing_period, p_extra_doctor_slots,
      private.payment_amount(v_version, p_billing_period, p_extra_doctor_slots), p_source, 'pending_verification',
      left(v_ref, 200), p_storage_path, p_mime_type, p_size_bytes, v_uid
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'invalid_storage_path' using errcode = 'P0001';
  end;
  perform private.write_audit_event('billing', 'payment.manual_submitted', 'success', p_clinic_id, 'subscription_payment', v_id::text);
  return v_id;
end;
$$;

-- Owner view of entitlement (presentation; every rule above is enforced in SQL).
create function public.clinic_billing_status(p_clinic_id uuid)
returns table (
  state text, trial_ends_at timestamptz, period_start timestamptz, period_end timestamptz, plan_version_id uuid,
  doctor_capacity integer, active_doctors integer, next_period_start timestamptz, next_plan_version_id uuid,
  grace_days integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_current public.subscription_periods%rowtype;
  v_next public.subscription_periods%rowtype;
begin
  if not (private.is_active_member(p_clinic_id) or private.is_platform_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_current := private.current_period(p_clinic_id);
  select * into v_next from public.subscription_periods
   where clinic_id = p_clinic_id and period_start > now() order by period_start limit 1;
  state := private.subscription_state(p_clinic_id);
  trial_ends_at := (select s.trial_ends_at from public.clinic_subscriptions s where s.clinic_id = p_clinic_id);
  period_start := v_current.period_start;
  period_end := v_current.period_end;
  plan_version_id := v_current.plan_version_id;
  doctor_capacity := private.doctor_capacity(p_clinic_id);
  active_doctors := (select count(*) from public.clinic_doctors d where d.clinic_id = p_clinic_id and d.status = 'active');
  next_period_start := v_next.period_start;
  next_plan_version_id := v_next.plan_version_id;
  grace_days := private.setting_int('billing.grace_days', 7);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gateway webhooks (service role only; scenario 12)
-- ---------------------------------------------------------------------------
create function public.process_payment_webhook(
  p_provider text,
  p_event_id text,
  p_provider_ref text,
  p_status text,
  p_amount_minor bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_outcome text;
begin
  begin
    insert into public.payment_webhook_events (provider, provider_event_id, outcome) values (p_provider, p_event_id, 'received');
  exception when unique_violation then
    return 'duplicate';
  end;

  select * into v_payment from public.subscription_payments
   where provider = p_provider and provider_ref = p_provider_ref and source = 'gateway' for update;
  if not found then
    v_outcome := 'unknown_payment';
  elsif v_payment.status = 'paid' then
    v_outcome := 'already_paid';
  elsif p_status = 'paid' then
    if p_amount_minor is distinct from v_payment.amount_minor then
      v_outcome := 'amount_mismatch';
      perform private.write_audit_event('billing', 'payment.amount_mismatch', 'failure', v_payment.clinic_id,
        'subscription_payment', v_payment.id::text, '{}'::jsonb, null, 'system');
    elsif v_payment.status <> 'awaiting_gateway' then
      v_outcome := 'invalid_state';
    else
      perform private.apply_payment(v_payment.id);
      v_outcome := 'applied';
    end if;
  elsif p_status = 'failed' and v_payment.status = 'awaiting_gateway' then
    update public.subscription_payments set status = 'failed' where id = v_payment.id;
    v_outcome := 'failed';
  else
    v_outcome := 'ignored';
  end if;

  update public.payment_webhook_events set payment_id = v_payment.id, outcome = v_outcome
   where provider = p_provider and provider_event_id = p_event_id;
  return v_outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform administration (ADM-002, ONB-006). No clinic finance or medical data.
-- ---------------------------------------------------------------------------
create function public.admin_create_plan(p_code text, p_name_ar text, p_name_en text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  begin
    insert into public.platform_plans (code, name_ar, name_en) values (btrim(p_code), btrim(p_name_ar), btrim(p_name_en))
    returning id into v_id;
  exception when check_violation or unique_violation or not_null_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;
  perform private.write_audit_event('admin', 'plan.created', 'success', null, 'platform_plan', v_id::text);
  return v_id;
end;
$$;

create function public.admin_set_plan_visibility(p_plan_id uuid, p_is_public boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.platform_plans set is_public = coalesce(p_is_public, false) where id = p_plan_id;
  perform private.write_audit_event('admin', 'plan.visibility_changed', 'success', null, 'platform_plan', p_plan_id::text,
    jsonb_build_object('is_public', p_is_public));
end;
$$;

-- New immutable version; existing periods keep their snapshots.
create function public.admin_publish_plan_version(
  p_plan_id uuid,
  p_doctor_limit integer,
  p_monthly_price_minor bigint,
  p_annual_price_minor bigint,
  p_extra_doctor_monthly_minor bigint,
  p_extra_doctor_annual_minor bigint,
  p_messaging_allowance integer,
  p_messaging_overage_unit_minor bigint,
  p_features jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
  v_version integer;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.platform_plans where id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_available' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.plan_versions where plan_id = p_plan_id;
  begin
    insert into public.plan_versions (
      plan_id, version, doctor_limit, monthly_price_minor, annual_price_minor, extra_doctor_monthly_minor,
      extra_doctor_annual_minor, messaging_allowance, messaging_overage_unit_minor, features, published_by
    ) values (
      p_plan_id, v_version, p_doctor_limit, p_monthly_price_minor, p_annual_price_minor, p_extra_doctor_monthly_minor,
      p_extra_doctor_annual_minor, coalesce(p_messaging_allowance, 0), p_messaging_overage_unit_minor,
      coalesce(p_features, '{}'::jsonb), v_uid
    ) returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;
  perform private.write_audit_event('admin', 'plan.version_published', 'success', null, 'plan_version', v_id::text,
    jsonb_build_object('version', v_version));
  return v_id;
end;
$$;

create function public.admin_extend_trial(p_clinic_id uuid, p_days integer, p_reason text) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_sub public.clinic_subscriptions%rowtype;
  v_new timestamptz;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_days is null or p_days not between 1 and 60 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  select * into v_sub from public.clinic_subscriptions where clinic_id = p_clinic_id for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;
  v_new := greatest(v_sub.trial_ends_at, now()) + make_interval(days => p_days);
  update public.clinic_subscriptions set trial_ends_at = v_new where clinic_id = p_clinic_id;
  insert into public.trial_extensions (clinic_id, days, previous_trial_ends_at, new_trial_ends_at, reason, granted_by)
  values (p_clinic_id, p_days, v_sub.trial_ends_at, v_new, v_reason, v_uid);
  perform private.write_audit_event('admin', 'trial.extended', 'success', p_clinic_id, 'clinic', p_clinic_id::text,
    jsonb_build_object('days', p_days));
  return v_new;
end;
$$;

create function public.admin_decide_manual_payment(p_payment_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_payment public.subscription_payments%rowtype;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_payment from public.subscription_payments where id = p_payment_id for update;
  if not found or v_payment.source = 'gateway' or v_payment.status <> 'pending_verification' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if not coalesce(p_approve, false) and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  update public.subscription_payments set decided_by = v_uid, decided_at = now(), decision_reason = v_reason,
    status = case when p_approve then status else 'rejected' end
   where id = p_payment_id;
  if p_approve then
    perform private.apply_payment(p_payment_id);
  end if;
  perform private.write_audit_event('admin', case when p_approve then 'payment.verified' else 'payment.rejected' end,
    'success', v_payment.clinic_id, 'subscription_payment', p_payment_id::text);
end;
$$;

-- Audited path for an admin to open payment evidence (cf. licences).
create function public.admin_record_payment_evidence_access(p_payment_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_clinic uuid;
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select evidence_path, clinic_id into v_path, v_clinic from public.subscription_payments where id = p_payment_id;
  if v_path is null then
    raise exception 'file_not_found' using errcode = 'P0001';
  end if;
  perform private.write_audit_event('admin', 'payment.evidence_viewed', 'success', v_clinic, 'subscription_payment', p_payment_id::text);
  return v_path;
end;
$$;

create function public.admin_request_license_reverification(p_clinic_id uuid, p_license_type public.license_type, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id and account_state in ('active', 'suspended')) then
    raise exception 'clinic_not_found' using errcode = 'P0001';
  end if;
  begin
    insert into public.license_reverification_requests (clinic_id, license_type, reason, requested_by)
    values (p_clinic_id, p_license_type, v_reason, v_uid) returning id into v_id;
  exception when unique_violation then
    raise exception 'request_pending' using errcode = 'P0001';
  end;
  perform private.write_audit_event('admin', 'license.reverification_requested', 'success', p_clinic_id, 'clinic',
    p_clinic_id::text, jsonb_build_object('license_type', p_license_type));
  return v_id;
end;
$$;

-- ONB-006: an active clinic keeps its approved licence until a newer
-- revision is approved; pending clinics behave as before.
create or replace function public.submit_clinic_license(
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
  v_active boolean;
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

  select account_state = 'active' into v_active from public.clinics c where c.id = p_clinic_id for update;

  update public.clinic_licenses
     set review_status = 'superseded'
   where clinic_id = p_clinic_id and license_type = p_license_type and review_status <> 'superseded'
     and not (v_active and review_status = 'approved');

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.clinic_licenses where clinic_id = p_clinic_id and license_type = p_license_type;

  insert into public.clinic_licenses (clinic_id, license_type, revision, storage_path, mime_type, size_bytes, uploaded_by)
  values (p_clinic_id, p_license_type, v_revision, p_storage_path, p_mime_type, p_size_bytes, v_uid)
  returning id into v_id;

  update public.license_reverification_requests set fulfilled_license_id = v_id, fulfilled_at = now()
   where clinic_id = p_clinic_id and license_type = p_license_type and fulfilled_at is null;

  perform private.write_audit_event(
    'onboarding', 'license.submitted', 'success', p_clinic_id, 'clinic_license', v_id::text,
    jsonb_build_object('license_type', p_license_type, 'revision', v_revision)
  );
  return v_id;
end;
$$;

create function private.supersede_older_approved() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_status = 'approved' and old.review_status <> 'approved' then
    update public.clinic_licenses set review_status = 'superseded'
     where clinic_id = new.clinic_id and license_type = new.license_type and id <> new.id
       and review_status = 'approved' and revision < new.revision;
  end if;
  return new;
end;
$$;

create trigger clinic_licenses_supersede_older after update of review_status on public.clinic_licenses
  for each row execute function private.supersede_older_approved();

-- ---------------------------------------------------------------------------
-- Storage: payment evidence (private bucket, owner upload, owner/admin read)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('billing-evidence', 'billing-evidence', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy billing_evidence_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'billing-evidence'
    and private.has_clinic_role(private.clinic_id_from_path(name), array['owner']::public.clinic_role[])
  );

create policy billing_evidence_select_owner_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'billing-evidence'
    and (
      private.has_clinic_role(private.clinic_id_from_path(name), array['owner']::public.clinic_role[])
      or private.is_platform_admin()
    )
  );

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.setting_int(text, integer)', 'private.current_period(uuid)', 'private.subscription_state(uuid)',
    'private.clinic_entitled(uuid)', 'private.doctor_capacity(uuid)', 'private.enforce_entitlement()',
    'private.enforce_doctor_capacity()', 'private.apply_payment(uuid)',
    'private.payment_amount(public.plan_versions, text, integer)',
    'private.prepare_payment(uuid, uuid, text, integer)', 'private.supersede_older_approved()'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
  end loop;

  execute 'revoke all on function public.process_payment_webhook(text, text, text, text, bigint) from public, anon, authenticated';
  execute 'grant execute on function public.process_payment_webhook(text, text, text, text, bigint) to service_role';

  foreach v_fn in array array[
    'public.start_gateway_payment(uuid, uuid, text, integer, text)', 'public.attach_gateway_reference(uuid, text)',
    'public.submit_manual_payment(uuid, uuid, text, integer, text, text, text, text, integer)',
    'public.clinic_billing_status(uuid)', 'public.admin_create_plan(text, text, text)',
    'public.admin_set_plan_visibility(uuid, boolean)',
    'public.admin_publish_plan_version(uuid, integer, bigint, bigint, bigint, bigint, integer, bigint, jsonb)',
    'public.admin_extend_trial(uuid, integer, text)', 'public.admin_decide_manual_payment(uuid, boolean, text)',
    'public.admin_record_payment_evidence_access(uuid)',
    'public.admin_request_license_reverification(uuid, public.license_type, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;

revoke all on private.current_plan_versions from public, anon, authenticated;
revoke all on sequence public.subscription_receipt_number_seq from public, anon, authenticated;

alter table public.platform_plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.trial_extensions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_periods enable row level security;
alter table public.subscription_receipts enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.license_reverification_requests enable row level security;

revoke all on table
  public.platform_plans, public.plan_versions, public.trial_extensions, public.subscription_payments,
  public.subscription_periods, public.subscription_receipts, public.payment_webhook_events,
  public.license_reverification_requests
from anon, authenticated;

-- The catalogue is visible to signed-in users (owners choose a plan).
grant select on table public.platform_plans, public.plan_versions to authenticated;
create policy platform_plans_select on public.platform_plans
  for select to authenticated using (is_public or private.is_platform_admin());
create policy plan_versions_select on public.plan_versions
  for select to authenticated using (
    private.is_platform_admin()
    or exists (select 1 from public.platform_plans p where p.id = plan_id and p.is_public)
    or exists (select 1 from public.subscription_periods sp where sp.plan_version_id = plan_versions.id
               and private.has_clinic_role(sp.clinic_id, array['owner']::public.clinic_role[]))
  );

grant select on table public.trial_extensions to authenticated;
create policy trial_extensions_select on public.trial_extensions
  for select to authenticated using (
    private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin()
  );

-- SaaS billing is between the owner and the platform; staff do not see it.
grant select (id, clinic_id, plan_version_id, billing_period, extra_doctor_slots, amount_minor, source, status,
              provider, payer_reference, decided_at, decision_reason, created_at)
  on table public.subscription_payments to authenticated;
create policy subscription_payments_select on public.subscription_payments
  for select to authenticated using (
    private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin()
  );

grant select on table public.subscription_periods to authenticated;
create policy subscription_periods_select on public.subscription_periods
  for select to authenticated using (
    private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin()
  );

grant select on table public.subscription_receipts to authenticated;
create policy subscription_receipts_select on public.subscription_receipts
  for select to authenticated using (
    private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin()
  );

grant select on table public.license_reverification_requests to authenticated;
create policy license_reverification_requests_select on public.license_reverification_requests
  for select to authenticated using (
    private.has_clinic_role(clinic_id, array['owner']::public.clinic_role[]) or private.is_platform_admin()
  );
