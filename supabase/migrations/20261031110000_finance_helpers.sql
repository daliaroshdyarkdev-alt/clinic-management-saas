-- Milestone 4: narrow read helpers for finance staff, who cannot read staff
-- profiles or the patient registry directly.

-- Handover recipients: active owners and finance approvers of the clinic.
create function public.finance_handover_recipients(p_clinic_id uuid)
returns table (user_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.require_finance(p_clinic_id, 'finance.collect');
  return query
    select m.user_id, p.full_name
    from public.clinic_memberships m
    join public.user_profiles p on p.user_id = m.user_id
    where m.clinic_id = p_clinic_id and m.status = 'active' and m.user_id <> auth.uid()
      and (m.role = 'owner' or exists (
        select 1 from public.clinic_role_permissions rp
        where rp.clinic_id = m.clinic_id and rp.role = m.role and rp.capability = 'finance.approve' and rp.allowed
      ))
    order by p.full_name;
end;
$$;

-- Patient lookup by chart number for payment entry (name only).
create function public.finance_find_patient(p_clinic_id uuid, p_chart_number integer)
returns table (clinic_patient_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.require_finance(p_clinic_id, 'finance.collect');
  return query
    select cp.id, pi.full_name
    from public.clinic_patients cp join public.patient_identities pi on pi.id = cp.patient_identity_id
    where cp.clinic_id = p_clinic_id and cp.chart_number = p_chart_number;
end;
$$;

-- FIN-011: internal receipt data for a posted payment or refund the caller may see.
create function public.finance_receipt(p_transaction_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.financial_transactions%rowtype;
begin
  perform private.require_user();
  select * into t from public.financial_transactions where id = p_transaction_id;
  if not found or t.kind not in ('payment', 'refund') or not (
    private.has_finance(t.clinic_id, 'finance.reports') or private.has_finance(t.clinic_id, 'finance.approve')
    or (t.posted_by = auth.uid() and private.has_finance(t.clinic_id, 'finance.collect'))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'amount_minor', t.amount_minor, 'method', t.method, 'reference', t.reference,
    'posted_at', t.posted_at,
    'clinic_name', (select name from public.clinics where id = t.clinic_id),
    'patient_name', (select pi.full_name from public.clinic_patients cp
                     join public.patient_identities pi on pi.id = cp.patient_identity_id where cp.id = t.clinic_patient_id),
    'chart_number', (select chart_number from public.clinic_patients where id = t.clinic_patient_id),
    'reversed', exists (select 1 from public.financial_transactions r where r.reverses_transaction_id = t.id)
  );
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.finance_handover_recipients(uuid)', 'public.finance_find_patient(uuid, integer)', 'public.finance_receipt(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;
