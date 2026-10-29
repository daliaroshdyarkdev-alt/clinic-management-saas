-- Milestone 4: operational clinic finance.
-- SRS: FIN-001..015, invariant 6, acceptance scenarios 6 and 7.
--
-- Ledger model: every posted financial_transaction has balanced
-- journal_entries (sum of debits = sum of credits, checked at commit by a
-- deferred constraint trigger). Real accounts (cash drawers, safe, bank,
-- POS, wallets) are asset lines; revenue, expense, refunds and opening
-- equity are nominal lines. Transfers and opening balances therefore never
-- count as revenue (FIN-002/003). Amounts are integer piasters (EGP minor
-- units). Posted rows are immutable for every role; a correction is a linked
-- reversal plus a new transaction (FIN-009). Approval workflows live in
-- request tables, separate from posted records (FIN-015).
--
-- Partial refunds, tax treatment and settlement taxonomy are OPEN (FIN-016,
-- OD-B06): refunds are full-amount only.

create type public.account_type as enum ('cash_drawer', 'safe', 'bank', 'pos', 'wallet');
create type public.payment_method as enum ('cash', 'pos', 'instapay', 'bank_transfer');
create type public.approval_policy as enum ('direct', 'all_approval', 'threshold');
create type public.discrepancy_policy as enum ('warning', 'explanation_required', 'approval_required');
create type public.daily_closing_policy as enum ('sessions_only', 'daily_close_required', 'daily_close_approval');
create type public.txn_kind as enum ('opening_balance', 'payment', 'refund', 'expense', 'transfer', 'reversal');
create type public.request_status as enum ('submitted', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- Permissions (FIN-010). Owners hold everything; cashiers collect by default;
-- everything else is granted by the owner.
-- ---------------------------------------------------------------------------
create function private.has_finance(p_clinic_id uuid, p_capability public.clinic_capability) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_memberships m
    where m.clinic_id = p_clinic_id and m.user_id = (select auth.uid()) and m.status = 'active'
      and (
        m.role = 'owner'
        or (m.role = 'cashier' and p_capability = 'finance.collect')
        or exists (
          select 1 from public.clinic_role_permissions p
          where p.clinic_id = m.clinic_id and p.role = m.role and p.capability = p_capability and p.allowed
        )
      )
  );
$$;

create function private.has_any_finance(p_clinic_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_finance(p_clinic_id, 'finance.collect') or private.has_finance(p_clinic_id, 'finance.approve')
      or private.has_finance(p_clinic_id, 'finance.reports') or private.has_finance(p_clinic_id, 'finance.accounts');
$$;

create function private.require_finance(p_clinic_id uuid, p_capability public.clinic_capability) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_finance(p_clinic_id, p_capability) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
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
  -- Owner-grantable combinations (permission matrix, docs/M0_M1_PLAN.md §4).
  if not (
    (p_role = 'manager' and p_capability in ('staff.manage', 'appointments.manage', 'finance.collect',
                                             'finance.approve', 'finance.reports', 'finance.accounts'))
    or (p_role = 'receptionist' and p_capability = 'finance.collect')
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

-- ---------------------------------------------------------------------------
-- Policies (FIN-005..008, FIN-012). Without a saved row the most
-- restrictive options apply.
-- ---------------------------------------------------------------------------
create table public.finance_policies (
  clinic_id uuid primary key references public.clinics (id) on delete restrict,
  expense_policy public.approval_policy not null,
  expense_threshold_minor bigint check (expense_threshold_minor >= 0),
  transfer_policy public.approval_policy not null,
  transfer_threshold_minor bigint check (transfer_threshold_minor >= 0),
  refund_policy public.approval_policy not null,
  refund_threshold_minor bigint check (refund_threshold_minor >= 0),
  discrepancy_policy public.discrepancy_policy not null,
  daily_closing_policy public.daily_closing_policy not null,
  updated_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (expense_policy <> 'threshold' or expense_threshold_minor is not null),
  check (transfer_policy <> 'threshold' or transfer_threshold_minor is not null),
  check (refund_policy <> 'threshold' or refund_threshold_minor is not null)
);

create function private.finance_policy(p_clinic_id uuid) returns public.finance_policies
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.finance_policies%rowtype;
begin
  select * into v from public.finance_policies where clinic_id = p_clinic_id;
  if not found then
    v.clinic_id := p_clinic_id;
    v.expense_policy := 'all_approval';
    v.transfer_policy := 'all_approval';
    v.refund_policy := 'all_approval';
    v.discrepancy_policy := 'approval_required';
    v.daily_closing_policy := 'daily_close_approval';
  end if;
  return v;
end;
$$;

create function private.needs_approval(p_policy public.approval_policy, p_threshold bigint, p_amount bigint) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_policy when 'direct' then false when 'all_approval' then true else p_amount > p_threshold end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts and ledger
-- ---------------------------------------------------------------------------
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 100),
  account_type public.account_type not null,
  status text not null default 'pending_opening' check (status in ('pending_opening', 'active', 'closed')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, name),
  unique (clinic_id, id)
);

create trigger financial_accounts_clinic_id_immutable before update on public.financial_accounts
  for each row execute function private.forbid_clinic_id_change();

create table public.opening_balance_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  account_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  status public.request_status not null default 'submitted',
  submitted_by uuid not null references auth.users (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  transaction_id uuid,
  foreign key (clinic_id, account_id) references public.financial_accounts (clinic_id, id) on delete restrict
);

create unique index opening_balance_one_open on public.opening_balance_requests (account_id) where status = 'submitted';

create table public.cashier_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  cashier_user_id uuid not null references auth.users (id) on delete restrict,
  cash_account_id uuid not null,
  status text not null default 'open' check (status in ('open', 'pending_approval', 'closed')),
  opened_at timestamptz not null default now(),
  opening_count_minor bigint not null check (opening_count_minor >= 0),
  closed_at timestamptz,
  counted_minor bigint check (counted_minor >= 0),
  expected_minor bigint,
  discrepancy_minor bigint,
  explanation text check (char_length(explanation) <= 1000),
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  business_date date not null,
  foreign key (clinic_id, cash_account_id) references public.financial_accounts (clinic_id, id) on delete restrict,
  unique (clinic_id, id)
);

create unique index cashier_sessions_one_open_per_cashier on public.cashier_sessions (clinic_id, cashier_user_id) where status = 'open';
create unique index cashier_sessions_one_open_per_drawer on public.cashier_sessions (cash_account_id) where status = 'open';

-- FIN-005 / acceptance 7: once counted, the count and discrepancy never change.
create function private.guard_cashier_session() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'cashier sessions cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status <> 'open' and (
       new.counted_minor is distinct from old.counted_minor or new.expected_minor is distinct from old.expected_minor
       or new.discrepancy_minor is distinct from old.discrepancy_minor or new.explanation is distinct from old.explanation
       or new.opening_count_minor is distinct from old.opening_count_minor or new.closed_at is distinct from old.closed_at) then
    raise exception 'closed cashier counts are immutable' using errcode = 'P0001';
  end if;
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'closed cashier counts are immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger cashier_sessions_guard before update or delete on public.cashier_sessions
  for each row execute function private.guard_cashier_session();

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  kind public.txn_kind not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  method public.payment_method,
  reference text check (char_length(reference) <= 200),
  description text check (char_length(description) <= 500),
  category text check (char_length(category) <= 100),
  clinic_patient_id uuid,
  appointment_id uuid references public.appointments (id) on delete restrict,
  clinic_doctor_id uuid,
  cashier_session_id uuid,
  reverses_transaction_id uuid unique references public.financial_transactions (id) on delete restrict,
  corrects_transaction_id uuid unique references public.financial_transactions (id) on delete restrict,
  refund_of_transaction_id uuid unique references public.financial_transactions (id) on delete restrict,
  posted_by uuid references auth.users (id) on delete restrict,
  posted_at timestamptz not null default now(),
  business_date date not null,
  foreign key (clinic_id, clinic_patient_id) references public.clinic_patients (clinic_id, id) on delete restrict,
  foreign key (clinic_id, clinic_doctor_id) references public.clinic_doctors (clinic_id, id) on delete restrict,
  foreign key (clinic_id, cashier_session_id) references public.cashier_sessions (clinic_id, id) on delete restrict,
  unique (clinic_id, id),
  check (kind <> 'payment' or method is not null),
  check ((kind = 'reversal') = (reverses_transaction_id is not null))
);

create index financial_transactions_clinic_date_idx on public.financial_transactions (clinic_id, business_date);

create table public.journal_entries (
  id bigint generated always as identity primary key,
  clinic_id uuid not null,
  transaction_id uuid not null,
  financial_account_id uuid,
  nominal text check (nominal in ('revenue', 'expense', 'refunds', 'opening_equity')),
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  foreign key (clinic_id, transaction_id) references public.financial_transactions (clinic_id, id) on delete restrict,
  foreign key (clinic_id, financial_account_id) references public.financial_accounts (clinic_id, id) on delete restrict,
  check ((financial_account_id is null) <> (nominal is null)),
  check ((debit_minor > 0) <> (credit_minor > 0))
);

create index journal_entries_account_idx on public.journal_entries (financial_account_id);
create index journal_entries_txn_idx on public.journal_entries (transaction_id);

-- Invariant 6: posted records are append-only for every role.
create trigger financial_transactions_append_only before update or delete on public.financial_transactions
  for each row execute function private.forbid_mutation();
create trigger financial_transactions_no_truncate before truncate on public.financial_transactions
  for each statement execute function private.forbid_mutation();
create trigger journal_entries_append_only before update or delete on public.journal_entries
  for each row execute function private.forbid_mutation();
create trigger journal_entries_no_truncate before truncate on public.journal_entries
  for each statement execute function private.forbid_mutation();

-- Balanced double entry, checked at commit.
-- SECURITY DEFINER: the check runs at commit as the calling role, whose RLS
-- view of the journal may be partial; the invariant must see every line.
create function private.check_transaction_balanced() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fires for both tables; journal rows carry transaction_id, transactions their own id.
  v_txn uuid := coalesce((to_jsonb(new) ->> 'transaction_id')::uuid, (to_jsonb(new) ->> 'id')::uuid);
  v_debit bigint;
  v_credit bigint;
  v_amount bigint;
begin
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) into v_debit, v_credit
    from public.journal_entries where transaction_id = v_txn;
  select amount_minor into v_amount from public.financial_transactions where id = v_txn;
  if v_debit <> v_credit or v_debit <> v_amount then
    raise exception 'unbalanced journal for transaction %', v_txn using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create constraint trigger journal_entries_balanced after insert on public.journal_entries
  deferrable initially deferred for each row execute function private.check_transaction_balanced();
create constraint trigger financial_transactions_balanced after insert on public.financial_transactions
  deferrable initially deferred for each row execute function private.check_transaction_balanced();

create function private.account_balance(p_account_id uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(debit_minor - credit_minor), 0)::bigint from public.journal_entries where financial_account_id = p_account_id;
$$;

-- Locks and returns an active account of the clinic.
create function private.active_account(p_clinic_id uuid, p_account_id uuid) returns public.financial_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.financial_accounts%rowtype;
begin
  select * into v from public.financial_accounts where id = p_account_id and clinic_id = p_clinic_id for update;
  if not found or v.status <> 'active' then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create function private.method_fits_account(p_method public.payment_method, p_type public.account_type) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_method
    when 'cash' then p_type in ('cash_drawer', 'safe')
    when 'pos' then p_type = 'pos'
    when 'instapay' then p_type in ('wallet', 'bank')
    when 'bank_transfer' then p_type = 'bank'
  end;
$$;

-- Inserts a transaction and its two journal lines (debit side, credit side).
create function private.post(
  p_clinic_id uuid,
  p_kind public.txn_kind,
  p_amount bigint,
  p_debit_account uuid,
  p_debit_nominal text,
  p_credit_account uuid,
  p_credit_nominal text,
  p_fields jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  insert into public.financial_transactions (
    clinic_id, kind, amount_minor, method, reference, description, category, clinic_patient_id, appointment_id,
    clinic_doctor_id, cashier_session_id, corrects_transaction_id, refund_of_transaction_id, posted_by, business_date
  ) values (
    p_clinic_id, p_kind, p_amount, (p_fields ->> 'method')::public.payment_method, p_fields ->> 'reference',
    p_fields ->> 'description', p_fields ->> 'category', (p_fields ->> 'clinic_patient_id')::uuid,
    (p_fields ->> 'appointment_id')::uuid, (p_fields ->> 'clinic_doctor_id')::uuid,
    (p_fields ->> 'cashier_session_id')::uuid, (p_fields ->> 'corrects_transaction_id')::uuid,
    (p_fields ->> 'refund_of_transaction_id')::uuid, auth.uid(), private.clinic_today(p_clinic_id)
  ) returning id into v_id;

  insert into public.journal_entries (clinic_id, transaction_id, financial_account_id, nominal, debit_minor)
  values (p_clinic_id, v_id, p_debit_account, p_debit_nominal, p_amount);
  insert into public.journal_entries (clinic_id, transaction_id, financial_account_id, nominal, credit_minor)
  values (p_clinic_id, v_id, p_credit_account, p_credit_nominal, p_amount);

  perform private.write_audit_event('finance', 'transaction.posted', 'success', p_clinic_id, 'financial_transaction',
    v_id::text, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Requests (approval state separate from posted records)
-- ---------------------------------------------------------------------------
create table public.finance_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  kind text not null check (kind in ('expense', 'transfer', 'refund')),
  amount_minor bigint not null check (amount_minor > 0),
  from_account_id uuid,
  to_account_id uuid,
  original_transaction_id uuid references public.financial_transactions (id) on delete restrict,
  category text check (char_length(category) <= 100),
  description text check (char_length(description) <= 500),
  status public.request_status not null default 'submitted',
  submitted_by uuid not null references auth.users (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (char_length(decision_reason) <= 500),
  transaction_id uuid references public.financial_transactions (id) on delete restrict,
  foreign key (clinic_id, from_account_id) references public.financial_accounts (clinic_id, id) on delete restrict,
  foreign key (clinic_id, to_account_id) references public.financial_accounts (clinic_id, id) on delete restrict
);

create unique index finance_requests_one_open_refund on public.finance_requests (original_transaction_id)
  where kind = 'refund' and status = 'submitted';

create table public.cash_handovers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  cashier_session_id uuid not null,
  from_user_id uuid not null references auth.users (id) on delete restrict,
  to_user_id uuid not null references auth.users (id) on delete restrict,
  to_account_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  transaction_id uuid references public.financial_transactions (id) on delete restrict,
  foreign key (clinic_id, cashier_session_id) references public.cashier_sessions (clinic_id, id) on delete restrict,
  foreign key (clinic_id, to_account_id) references public.financial_accounts (clinic_id, id) on delete restrict,
  check (from_user_id <> to_user_id)
);

create table public.daily_financial_closings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  business_date date not null,
  totals jsonb not null,
  status text not null check (status in ('submitted', 'approved')),
  submitted_by uuid not null references auth.users (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  unique (clinic_id, business_date)
);

-- ---------------------------------------------------------------------------
-- Functions: configuration and accounts
-- ---------------------------------------------------------------------------
create function public.set_finance_policies(
  p_clinic_id uuid,
  p_expense_policy public.approval_policy,
  p_expense_threshold_minor bigint,
  p_transfer_policy public.approval_policy,
  p_transfer_threshold_minor bigint,
  p_refund_policy public.approval_policy,
  p_refund_threshold_minor bigint,
  p_discrepancy_policy public.discrepancy_policy,
  p_daily_closing_policy public.daily_closing_policy
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
  begin
    insert into public.finance_policies (
      clinic_id, expense_policy, expense_threshold_minor, transfer_policy, transfer_threshold_minor,
      refund_policy, refund_threshold_minor, discrepancy_policy, daily_closing_policy, updated_by
    ) values (
      p_clinic_id, p_expense_policy, p_expense_threshold_minor, p_transfer_policy, p_transfer_threshold_minor,
      p_refund_policy, p_refund_threshold_minor, p_discrepancy_policy, p_daily_closing_policy, v_uid
    )
    on conflict (clinic_id) do update set
      expense_policy = excluded.expense_policy, expense_threshold_minor = excluded.expense_threshold_minor,
      transfer_policy = excluded.transfer_policy, transfer_threshold_minor = excluded.transfer_threshold_minor,
      refund_policy = excluded.refund_policy, refund_threshold_minor = excluded.refund_threshold_minor,
      discrepancy_policy = excluded.discrepancy_policy, daily_closing_policy = excluded.daily_closing_policy,
      updated_by = excluded.updated_by, updated_at = now();
  exception when check_violation or not_null_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  end;
  perform private.write_audit_event('finance', 'policies.changed', 'success', p_clinic_id, 'clinic', p_clinic_id::text);
end;
$$;

create function public.create_financial_account(p_clinic_id uuid, p_name text, p_type public.account_type) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_id uuid;
begin
  perform private.require_finance(p_clinic_id, 'finance.accounts');
  begin
    insert into public.financial_accounts (clinic_id, name, account_type, created_by)
    values (p_clinic_id, btrim(p_name), p_type, v_uid) returning id into v_id;
  exception when unique_violation then
    raise exception 'account_name_taken' using errcode = 'P0001';
  when check_violation then
    raise exception 'invalid_name' using errcode = 'P0001';
  end;
  perform private.write_audit_event('finance', 'account.created', 'success', p_clinic_id, 'financial_account', v_id::text);
  return v_id;
end;
$$;

-- FIN-003: staff enter an opening balance; only the owner approves it.
create function public.submit_opening_balance(p_account_id uuid, p_amount_minor bigint) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_account public.financial_accounts%rowtype;
  v_id uuid;
begin
  select * into v_account from public.financial_accounts where id = p_account_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_finance(v_account.clinic_id, 'finance.accounts');
  if v_account.status <> 'pending_opening' or p_amount_minor is null or p_amount_minor < 0 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  begin
    insert into public.opening_balance_requests (clinic_id, account_id, amount_minor, submitted_by)
    values (v_account.clinic_id, p_account_id, p_amount_minor, v_uid) returning id into v_id;
  exception when unique_violation then
    raise exception 'request_pending' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

create function public.decide_opening_balance(p_request_id uuid, p_approve boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_req public.opening_balance_requests%rowtype;
  v_txn uuid;
begin
  select * into v_req from public.opening_balance_requests where id = p_request_id for update;
  if not found or not private.has_clinic_role(v_req.clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_req.status <> 'submitted' then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;
  if p_approve then
    perform 1 from public.financial_accounts where id = v_req.account_id for update;
    if v_req.amount_minor > 0 then
      v_txn := private.post(v_req.clinic_id, 'opening_balance', v_req.amount_minor, v_req.account_id, null, null, 'opening_equity',
                            jsonb_build_object('description', 'Opening balance'));
    end if;
    update public.financial_accounts set status = 'active' where id = v_req.account_id;
  end if;
  update public.opening_balance_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         decided_by = v_uid, decided_at = now(), transaction_id = v_txn
   where id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cashier sessions (FIN-004/005)
-- ---------------------------------------------------------------------------
create function public.open_cashier_session(p_account_id uuid, p_opening_count_minor bigint) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_account public.financial_accounts%rowtype;
  v_id uuid;
begin
  select * into v_account from public.financial_accounts where id = p_account_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_finance(v_account.clinic_id, 'finance.collect');
  perform private.require_operational(v_account.clinic_id);
  v_account := private.active_account(v_account.clinic_id, p_account_id);
  if v_account.account_type <> 'cash_drawer' or p_opening_count_minor is null or p_opening_count_minor < 0 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  begin
    insert into public.cashier_sessions (clinic_id, cashier_user_id, cash_account_id, opening_count_minor, business_date)
    values (v_account.clinic_id, v_uid, p_account_id, p_opening_count_minor, private.clinic_today(v_account.clinic_id))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'session_already_open' using errcode = 'P0001';
  end;
  perform private.write_audit_event('finance', 'cashier_session.opened', 'success', v_account.clinic_id, 'cashier_session', v_id::text);
  return v_id;
end;
$$;

create function private.my_open_session(p_clinic_id uuid) returns public.cashier_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cashier_sessions%rowtype;
begin
  select * into v from public.cashier_sessions
   where clinic_id = p_clinic_id and cashier_user_id = auth.uid() and status = 'open' for update;
  if not found then
    raise exception 'no_open_session' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create function private.session_expected(p_session public.cashier_sessions) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p_session.opening_count_minor + coalesce((
    select sum(j.debit_minor - j.credit_minor)
    from public.journal_entries j
    join public.financial_transactions t on t.id = j.transaction_id
    where j.financial_account_id = p_session.cash_account_id
      and t.cashier_session_id = p_session.id
  ), 0)::bigint;
$$;

create function public.close_cashier_session(p_counted_minor bigint, p_explanation text, p_clinic_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cashier_sessions%rowtype;
  v_policy public.finance_policies%rowtype;
  v_expected bigint;
  v_discrepancy bigint;
  v_explanation text := nullif(btrim(coalesce(p_explanation, '')), '');
  v_status text := 'closed';
begin
  perform private.require_user();
  perform private.require_finance(p_clinic_id, 'finance.collect');
  v := private.my_open_session(p_clinic_id);
  if p_counted_minor is null or p_counted_minor < 0 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  perform 1 from public.financial_accounts where id = v.cash_account_id for update;
  v_expected := private.session_expected(v);
  v_discrepancy := p_counted_minor - v_expected;
  v_policy := private.finance_policy(p_clinic_id);
  if v_discrepancy <> 0 then
    if v_policy.discrepancy_policy in ('explanation_required', 'approval_required') and v_explanation is null then
      raise exception 'explanation_required' using errcode = 'P0001';
    end if;
    if v_policy.discrepancy_policy = 'approval_required' then
      v_status := 'pending_approval';
    end if;
  end if;
  update public.cashier_sessions
     set status = v_status, closed_at = now(), counted_minor = p_counted_minor, expected_minor = v_expected,
         discrepancy_minor = v_discrepancy, explanation = v_explanation
   where id = v.id;
  perform private.write_audit_event('finance', 'cashier_session.closed', 'success', p_clinic_id, 'cashier_session', v.id::text,
    jsonb_build_object('discrepancy_minor', v_discrepancy, 'status', v_status));
  return jsonb_build_object('expected_minor', v_expected, 'discrepancy_minor', v_discrepancy, 'status', v_status);
end;
$$;

create function public.approve_cashier_session(p_session_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v public.cashier_sessions%rowtype;
begin
  select * into v from public.cashier_sessions where id = p_session_id for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_finance(v.clinic_id, 'finance.approve');
  if v.status <> 'pending_approval' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if v.cashier_user_id = v_uid then
    raise exception 'cannot_approve_own' using errcode = 'P0001';
  end if;
  update public.cashier_sessions set status = 'closed', approved_by = v_uid, approved_at = now() where id = p_session_id;
  perform private.write_audit_event('finance', 'cashier_session.approved', 'success', v.clinic_id, 'cashier_session', p_session_id::text);
end;
$$;

-- FIN-004: formal handover; posted only when the recipient acknowledges.
create function public.create_cash_handover(p_session_id uuid, p_to_user_id uuid, p_to_account_id uuid, p_amount_minor bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v public.cashier_sessions%rowtype;
  v_id uuid;
begin
  select * into v from public.cashier_sessions where id = p_session_id for update;
  if not found or v.cashier_user_id <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_finance(v.clinic_id, 'finance.collect');
  if v.status = 'open' then
    raise exception 'close_session_first' using errcode = 'P0001';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_to_user_id = v_uid
     or not exists (select 1 from public.clinic_memberships m
                    where m.clinic_id = v.clinic_id and m.user_id = p_to_user_id and m.status = 'active')
     or not exists (select 1 from public.financial_accounts a
                    where a.id = p_to_account_id and a.clinic_id = v.clinic_id and a.status = 'active'
                      and a.account_type in ('safe', 'bank', 'cash_drawer') and a.id <> v.cash_account_id) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  insert into public.cash_handovers (clinic_id, cashier_session_id, from_user_id, to_user_id, to_account_id, amount_minor)
  values (v.clinic_id, v.id, v_uid, p_to_user_id, p_to_account_id, p_amount_minor) returning id into v_id;
  perform private.write_audit_event('finance', 'handover.created', 'success', v.clinic_id, 'cash_handover', v_id::text);
  return v_id;
end;
$$;

create function public.acknowledge_cash_handover(p_handover_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  h public.cash_handovers%rowtype;
  v_from uuid;
  v_txn uuid;
begin
  select * into h from public.cash_handovers where id = p_handover_id for update;
  if not found or h.to_user_id <> v_uid
     or not exists (select 1 from public.clinic_memberships m
                    where m.clinic_id = h.clinic_id and m.user_id = v_uid and m.status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if h.acknowledged_at is not null then
    raise exception 'already_acknowledged' using errcode = 'P0001';
  end if;
  select cash_account_id into v_from from public.cashier_sessions where id = h.cashier_session_id;
  perform 1 from public.financial_accounts where id in (v_from, h.to_account_id) order by id for update;
  v_txn := private.post(h.clinic_id, 'transfer', h.amount_minor, h.to_account_id, null, v_from, null,
                        jsonb_build_object('description', 'Cash handover'));
  update public.cash_handovers set acknowledged_at = now(), transaction_id = v_txn where id = p_handover_id;
  return v_txn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments, expenses, transfers, refunds, reversals
-- ---------------------------------------------------------------------------

-- FIN-001: manual payment entry within the cashier's open session.
create function public.record_payment(
  p_clinic_id uuid,
  p_account_id uuid,
  p_amount_minor bigint,
  p_method public.payment_method,
  p_reference text,
  p_clinic_patient_id uuid,
  p_appointment_id uuid,
  p_corrects_transaction_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cashier_sessions%rowtype;
  v_account public.financial_accounts%rowtype;
  v_doctor uuid;
begin
  perform private.require_user();
  perform private.require_finance(p_clinic_id, 'finance.collect');
  perform private.require_operational(p_clinic_id);
  v_session := private.my_open_session(p_clinic_id);
  v_account := private.active_account(p_clinic_id, p_account_id);
  if not private.method_fits_account(p_method, v_account.account_type)
     or (p_method = 'cash' and p_account_id <> v_session.cash_account_id) then
    raise exception 'method_account_mismatch' using errcode = 'P0001';
  end if;
  if p_method <> 'cash' and nullif(btrim(coalesce(p_reference, '')), '') is null then
    raise exception 'reference_required' using errcode = 'P0001';
  end if;
  if p_clinic_patient_id is not null and not exists (
    select 1 from public.clinic_patients where id = p_clinic_patient_id and clinic_id = p_clinic_id
  ) then
    raise exception 'patient_not_found' using errcode = 'P0001';
  end if;
  if p_appointment_id is not null then
    select clinic_doctor_id into v_doctor from public.appointments
     where id = p_appointment_id and clinic_id = p_clinic_id
       and (p_clinic_patient_id is null or clinic_patient_id = p_clinic_patient_id);
    if not found then
      raise exception 'appointment_not_found' using errcode = 'P0001';
    end if;
  end if;
  if p_corrects_transaction_id is not null and not exists (
    select 1 from public.financial_transactions o
    where o.id = p_corrects_transaction_id and o.clinic_id = p_clinic_id and o.kind = 'payment'
      and exists (select 1 from public.financial_transactions r where r.reverses_transaction_id = o.id)
  ) then
    raise exception 'correct_requires_reversal' using errcode = 'P0001';
  end if;

  return private.post(p_clinic_id, 'payment', p_amount_minor, p_account_id, null, null, 'revenue', jsonb_build_object(
    'method', p_method, 'reference', nullif(btrim(coalesce(p_reference, '')), ''),
    'clinic_patient_id', p_clinic_patient_id, 'appointment_id', p_appointment_id, 'clinic_doctor_id', v_doctor,
    'cashier_session_id', v_session.id, 'corrects_transaction_id', p_corrects_transaction_id
  ));
end;
$$;

create function private.execute_request(p_request public.finance_requests) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_original public.financial_transactions%rowtype;
begin
  if p_request.kind = 'expense' then
    perform private.active_account(p_request.clinic_id, p_request.from_account_id);
    select id into v_session from public.cashier_sessions s
     where s.cash_account_id = p_request.from_account_id and s.status = 'open';
    return private.post(p_request.clinic_id, 'expense', p_request.amount_minor, null, 'expense', p_request.from_account_id, null,
      jsonb_build_object('category', p_request.category, 'description', p_request.description, 'cashier_session_id', v_session));
  elsif p_request.kind = 'transfer' then
    perform 1 from public.financial_accounts where id in (p_request.from_account_id, p_request.to_account_id) order by id for update;
    perform private.active_account(p_request.clinic_id, p_request.from_account_id);
    perform private.active_account(p_request.clinic_id, p_request.to_account_id);
    return private.post(p_request.clinic_id, 'transfer', p_request.amount_minor, p_request.to_account_id, null,
      p_request.from_account_id, null, jsonb_build_object('description', p_request.description));
  else
    select * into v_original from public.financial_transactions where id = p_request.original_transaction_id for update;
    if exists (select 1 from public.financial_transactions t
               where t.refund_of_transaction_id = v_original.id or t.reverses_transaction_id = v_original.id) then
      raise exception 'already_refunded_or_reversed' using errcode = 'P0001';
    end if;
    perform private.active_account(p_request.clinic_id, p_request.from_account_id);
    select id into v_session from public.cashier_sessions s
     where s.cash_account_id = p_request.from_account_id and s.status = 'open';
    return private.post(p_request.clinic_id, 'refund', p_request.amount_minor, null, 'refunds', p_request.from_account_id, null,
      jsonb_build_object('refund_of_transaction_id', v_original.id, 'description', p_request.description,
                         'clinic_patient_id', v_original.clinic_patient_id, 'clinic_doctor_id', v_original.clinic_doctor_id,
                         'cashier_session_id', v_session));
  end if;
end;
$$;

-- FIN-006/007/008: expense, transfer or refund; posted directly or after
-- approval according to the clinic's policy.
create function public.submit_finance_request(
  p_clinic_id uuid,
  p_kind text,
  p_amount_minor bigint,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_original_transaction_id uuid,
  p_category text,
  p_description text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_policy public.finance_policies%rowtype;
  v_req public.finance_requests%rowtype;
  v_original public.financial_transactions%rowtype;
  v_needs boolean;
  v_txn uuid;
begin
  perform private.require_finance(p_clinic_id, 'finance.collect');
  perform private.require_operational(p_clinic_id);
  v_policy := private.finance_policy(p_clinic_id);

  if p_kind = 'refund' then
    select * into v_original from public.financial_transactions
     where id = p_original_transaction_id and clinic_id = p_clinic_id and kind = 'payment';
    if not found then
      raise exception 'payment_not_found' using errcode = 'P0001';
    end if;
    -- Full refunds only until partial refunds are decided (FIN-016).
    if p_amount_minor is distinct from v_original.amount_minor then
      raise exception 'full_refund_only' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.financial_transactions t
               where t.refund_of_transaction_id = v_original.id or t.reverses_transaction_id = v_original.id) then
      raise exception 'already_refunded_or_reversed' using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(p_description, '')), '') is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_needs := private.needs_approval(v_policy.refund_policy, v_policy.refund_threshold_minor, p_amount_minor);
  elsif p_kind = 'expense' then
    if nullif(btrim(coalesce(p_category, '')), '') is null then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    v_needs := private.needs_approval(v_policy.expense_policy, v_policy.expense_threshold_minor, p_amount_minor);
  elsif p_kind = 'transfer' then
    if p_from_account_id = p_to_account_id then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    v_needs := private.needs_approval(v_policy.transfer_policy, v_policy.transfer_threshold_minor, p_amount_minor);
  else
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;

  begin
    insert into public.finance_requests (clinic_id, kind, amount_minor, from_account_id, to_account_id, original_transaction_id,
                                         category, description, submitted_by)
    values (p_clinic_id, p_kind, p_amount_minor, p_from_account_id,
            case when p_kind = 'transfer' then p_to_account_id end,
            case when p_kind = 'refund' then p_original_transaction_id end,
            nullif(btrim(coalesce(p_category, '')), ''), nullif(btrim(coalesce(p_description, '')), ''), v_uid)
    returning * into v_req;
  exception when check_violation or foreign_key_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
  when unique_violation then
    raise exception 'request_pending' using errcode = 'P0001';
  end;

  if not v_needs then
    v_txn := private.execute_request(v_req);
    update public.finance_requests set status = 'approved', decided_by = v_uid, decided_at = now(), transaction_id = v_txn
     where id = v_req.id;
  end if;
  return jsonb_build_object('request_id', v_req.id, 'transaction_id', v_txn, 'needs_approval', v_needs);
end;
$$;

create function public.decide_finance_request(p_request_id uuid, p_approve boolean, p_reason text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_req public.finance_requests%rowtype;
  v_txn uuid;
begin
  select * into v_req from public.finance_requests where id = p_request_id for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_finance(v_req.clinic_id, 'finance.approve');
  if v_req.status <> 'submitted' then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;
  if v_req.submitted_by = v_uid and not private.has_clinic_role(v_req.clinic_id, array['owner']::public.clinic_role[]) then
    raise exception 'cannot_approve_own' using errcode = 'P0001';
  end if;
  if p_approve then
    v_txn := private.execute_request(v_req);
  end if;
  update public.finance_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         decided_by = v_uid, decided_at = now(), decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         transaction_id = v_txn
   where id = p_request_id;
  perform private.write_audit_event('finance', 'request.decided', 'success', v_req.clinic_id, 'finance_request',
    p_request_id::text, jsonb_build_object('approved', p_approve, 'kind', v_req.kind));
  return v_txn;
end;
$$;

-- FIN-009: a linked reversal with mirrored journal lines.
create function public.reverse_transaction(p_transaction_id uuid, p_reason text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.financial_transactions%rowtype;
  v_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.require_user();
  select * into v_original from public.financial_transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_finance(v_original.clinic_id, 'finance.approve');
  if v_original.kind = 'reversal' then
    raise exception 'cannot_reverse_reversal' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.financial_transactions t
             where t.reverses_transaction_id = v_original.id or t.refund_of_transaction_id = v_original.id) then
    raise exception 'already_refunded_or_reversed' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  perform 1 from public.financial_accounts a
   where a.id in (select financial_account_id from public.journal_entries where transaction_id = v_original.id)
   order by a.id for update;

  insert into public.financial_transactions (
    clinic_id, kind, amount_minor, method, description, clinic_patient_id, appointment_id, clinic_doctor_id,
    cashier_session_id, reverses_transaction_id, posted_by, business_date
  ) values (
    v_original.clinic_id, 'reversal', v_original.amount_minor, v_original.method, v_reason, v_original.clinic_patient_id,
    v_original.appointment_id, v_original.clinic_doctor_id,
    -- Keeps the drawer's expected count right while the original session is open.
    (select s.id from public.cashier_sessions s where s.id = v_original.cashier_session_id and s.status = 'open'),
    v_original.id, auth.uid(), private.clinic_today(v_original.clinic_id)
  ) returning id into v_id;

  insert into public.journal_entries (clinic_id, transaction_id, financial_account_id, nominal, debit_minor, credit_minor)
  select clinic_id, v_id, financial_account_id, nominal, credit_minor, debit_minor
  from public.journal_entries where transaction_id = v_original.id;

  perform private.write_audit_event('finance', 'transaction.reversed', 'success', v_original.clinic_id, 'financial_transaction',
    v_id::text, jsonb_build_object('reverses', v_original.id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily closing (FIN-012) and reports (FIN-013)
-- ---------------------------------------------------------------------------
create function private.day_totals(p_clinic_id uuid, p_date date) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'collections_minor', coalesce(sum(j.credit_minor) filter (where j.nominal = 'revenue'), 0)
                       - coalesce(sum(j.debit_minor) filter (where j.nominal = 'revenue'), 0),
    'refunds_minor', coalesce(sum(j.debit_minor) filter (where j.nominal = 'refunds'), 0)
                   - coalesce(sum(j.credit_minor) filter (where j.nominal = 'refunds'), 0),
    'expenses_minor', coalesce(sum(j.debit_minor) filter (where j.nominal = 'expense'), 0)
                    - coalesce(sum(j.credit_minor) filter (where j.nominal = 'expense'), 0),
    'transactions', count(distinct t.id)
  )
  from public.financial_transactions t
  join public.journal_entries j on j.transaction_id = t.id
  where t.clinic_id = p_clinic_id and t.business_date = p_date;
$$;

create function public.submit_daily_close(p_clinic_id uuid, p_date date) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_policy public.finance_policies%rowtype;
  v_status text;
begin
  perform private.require_finance(p_clinic_id, 'finance.collect');
  v_policy := private.finance_policy(p_clinic_id);
  if v_policy.daily_closing_policy = 'sessions_only' then
    raise exception 'daily_close_not_used' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cashier_sessions s
             where s.clinic_id = p_clinic_id and s.business_date = p_date and s.status <> 'closed') then
    raise exception 'sessions_not_closed' using errcode = 'P0001';
  end if;
  v_status := case when v_policy.daily_closing_policy = 'daily_close_approval' then 'submitted' else 'approved' end;
  begin
    insert into public.daily_financial_closings (clinic_id, business_date, totals, status, submitted_by, approved_by, approved_at)
    values (p_clinic_id, p_date, private.day_totals(p_clinic_id, p_date), v_status, v_uid,
            case when v_status = 'approved' then v_uid end, case when v_status = 'approved' then now() end);
  exception when unique_violation then
    raise exception 'already_closed' using errcode = 'P0001';
  end;
  perform private.write_audit_event('finance', 'daily_close.submitted', 'success', p_clinic_id, 'clinic', p_clinic_id::text,
    jsonb_build_object('date', p_date, 'status', v_status));
  return v_status;
end;
$$;

create function public.approve_daily_close(p_clinic_id uuid, p_date date) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  perform private.require_finance(p_clinic_id, 'finance.approve');
  update public.daily_financial_closings set status = 'approved', approved_by = v_uid, approved_at = now()
   where clinic_id = p_clinic_id and business_date = p_date and status = 'submitted';
  if not found then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;
end;
$$;

create function public.finance_report(p_clinic_id uuid, p_from date, p_to date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.require_finance(p_clinic_id, 'finance.reports');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'totals', private.day_totals(p_clinic_id, d)) order by d), '[]')
      from (select distinct business_date d from public.financial_transactions
            where clinic_id = p_clinic_id and business_date between p_from and p_to) x
    ),
    'by_method', (
      select coalesce(jsonb_object_agg(method, total), '{}') from (
        select t.method, sum(case when t.kind = 'payment' then t.amount_minor
                                  when t.kind = 'reversal' and o.kind = 'payment' then -t.amount_minor else 0 end) total
        from public.financial_transactions t
        left join public.financial_transactions o on o.id = t.reverses_transaction_id
        where t.clinic_id = p_clinic_id and t.business_date between p_from and p_to and t.method is not null
        group by t.method
      ) m
    ),
    'by_doctor', (
      select coalesce(jsonb_agg(jsonb_build_object('doctor', d.display_name, 'collections_minor', s.total)), '[]') from (
        select t.clinic_doctor_id, sum(case when t.kind = 'payment' then t.amount_minor
                                            when t.kind in ('refund', 'reversal') then -t.amount_minor else 0 end) total
        from public.financial_transactions t
        where t.clinic_id = p_clinic_id and t.business_date between p_from and p_to and t.clinic_doctor_id is not null
          and (t.kind <> 'reversal' or exists (select 1 from public.financial_transactions o
                                               where o.id = t.reverses_transaction_id and o.kind = 'payment'))
        group by t.clinic_doctor_id
      ) s join public.clinic_doctors d on d.id = s.clinic_doctor_id
    ),
    'expenses_by_category', (
      select coalesce(jsonb_object_agg(category, total), '{}') from (
        select t.category, sum(t.amount_minor) total from public.financial_transactions t
        where t.clinic_id = p_clinic_id and t.kind = 'expense' and t.business_date between p_from and p_to
          and not exists (select 1 from public.financial_transactions r where r.reverses_transaction_id = t.id)
        group by t.category
      ) e
    ),
    'balances', (
      select coalesce(jsonb_agg(jsonb_build_object('account', a.name, 'type', a.account_type, 'status', a.status,
                                                   'balance_minor', private.account_balance(a.id)) order by a.name), '[]')
      from public.financial_accounts a where a.clinic_id = p_clinic_id
    ),
    'cashier_sessions', (
      select coalesce(jsonb_agg(jsonb_build_object('opened_at', s.opened_at, 'status', s.status, 'expected_minor', s.expected_minor,
                                                   'counted_minor', s.counted_minor, 'discrepancy_minor', s.discrepancy_minor,
                                                   'cashier', p.full_name) order by s.opened_at), '[]')
      from public.cashier_sessions s left join public.user_profiles p on p.user_id = s.cashier_user_id
      where s.clinic_id = p_clinic_id and s.business_date between p_from and p_to
    ),
    'employee_activity', (
      select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'transactions', a.n)), '[]') from (
        select posted_by, count(*) n from public.financial_transactions
        where clinic_id = p_clinic_id and business_date between p_from and p_to group by posted_by
      ) a left join public.user_profiles p on p.user_id = a.posted_by
    ),
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'totals', tot) order by m), '[]') from (
        select to_char(business_date, 'YYYY-MM') m,
               jsonb_build_object('collections_minor', sum(case when kind = 'payment' then amount_minor else 0 end)) tot
        from public.financial_transactions
        where clinic_id = p_clinic_id and business_date between p_from and p_to group by 1
      ) x
    )
  );
end;
$$;

-- FIN-014: full export of posted records with their journal lines.
create function public.finance_export(p_clinic_id uuid, p_from date, p_to date)
returns table (
  transaction_id uuid, business_date date, posted_at timestamptz, kind public.txn_kind, amount_minor bigint,
  method public.payment_method, reference text, category text, description text, account text, nominal text,
  debit_minor bigint, credit_minor bigint, reverses_transaction_id uuid, refund_of_transaction_id uuid,
  corrects_transaction_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.require_finance(p_clinic_id, 'finance.reports');
  perform private.write_audit_event('finance', 'export.requested', 'success', p_clinic_id, 'clinic', p_clinic_id::text,
    jsonb_build_object('from', p_from, 'to', p_to));
  return query
    select t.id, t.business_date, t.posted_at, t.kind, t.amount_minor, t.method, t.reference, t.category, t.description,
           a.name, j.nominal, j.debit_minor, j.credit_minor, t.reverses_transaction_id, t.refund_of_transaction_id,
           t.corrects_transaction_id
    from public.financial_transactions t
    join public.journal_entries j on j.transaction_id = t.id
    left join public.financial_accounts a on a.id = j.financial_account_id
    where t.clinic_id = p_clinic_id and t.business_date between p_from and p_to
    order by t.posted_at, t.id, j.id;
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
    'private.has_finance(uuid, public.clinic_capability)', 'private.has_any_finance(uuid)',
    'private.require_finance(uuid, public.clinic_capability)', 'private.finance_policy(uuid)',
    'private.needs_approval(public.approval_policy, bigint, bigint)', 'private.guard_cashier_session()',
    'private.check_transaction_balanced()', 'private.account_balance(uuid)', 'private.active_account(uuid, uuid)',
    'private.method_fits_account(public.payment_method, public.account_type)',
    'private.post(uuid, public.txn_kind, bigint, uuid, text, uuid, text, jsonb)', 'private.my_open_session(uuid)',
    'private.session_expected(public.cashier_sessions)', 'private.execute_request(public.finance_requests)',
    'private.day_totals(uuid, date)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
  end loop;
  grant execute on function private.has_finance(uuid, public.clinic_capability) to authenticated;
  grant execute on function private.has_any_finance(uuid) to authenticated;

  foreach v_fn in array array[
    'public.set_finance_policies(uuid, public.approval_policy, bigint, public.approval_policy, bigint, public.approval_policy, bigint, public.discrepancy_policy, public.daily_closing_policy)',
    'public.create_financial_account(uuid, text, public.account_type)',
    'public.submit_opening_balance(uuid, bigint)', 'public.decide_opening_balance(uuid, boolean)',
    'public.open_cashier_session(uuid, bigint)', 'public.close_cashier_session(bigint, text, uuid)',
    'public.approve_cashier_session(uuid)', 'public.create_cash_handover(uuid, uuid, uuid, bigint)',
    'public.acknowledge_cash_handover(uuid)',
    'public.record_payment(uuid, uuid, bigint, public.payment_method, text, uuid, uuid, uuid)',
    'public.submit_finance_request(uuid, text, bigint, uuid, uuid, uuid, text, text)',
    'public.decide_finance_request(uuid, boolean, text)', 'public.reverse_transaction(uuid, text)',
    'public.submit_daily_close(uuid, date)', 'public.approve_daily_close(uuid, date)',
    'public.finance_report(uuid, date, date)', 'public.finance_export(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;

alter table public.finance_policies enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.opening_balance_requests enable row level security;
alter table public.cashier_sessions enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.journal_entries enable row level security;
alter table public.finance_requests enable row level security;
alter table public.cash_handovers enable row level security;
alter table public.daily_financial_closings enable row level security;

revoke all on table
  public.finance_policies, public.financial_accounts, public.opening_balance_requests, public.cashier_sessions,
  public.financial_transactions, public.journal_entries, public.finance_requests, public.cash_handovers,
  public.daily_financial_closings
from anon, authenticated;
revoke update, delete, truncate on table public.financial_transactions, public.journal_entries from service_role;

grant select on table
  public.finance_policies, public.financial_accounts, public.opening_balance_requests, public.cashier_sessions,
  public.financial_transactions, public.journal_entries, public.finance_requests, public.cash_handovers,
  public.daily_financial_closings
to authenticated;

-- Configuration and accounts: anyone with a finance capability in the clinic.
create policy finance_policies_select on public.finance_policies
  for select to authenticated using (private.has_any_finance(clinic_id));
create policy financial_accounts_select on public.financial_accounts
  for select to authenticated using (private.has_any_finance(clinic_id));
create policy opening_balance_requests_select on public.opening_balance_requests
  for select to authenticated using (private.has_finance(clinic_id, 'finance.accounts') or private.has_finance(clinic_id, 'finance.approve'));

-- Posted records: reports/approvers see all; collectors see what they posted.
create policy financial_transactions_select on public.financial_transactions
  for select to authenticated using (
    private.has_finance(clinic_id, 'finance.reports') or private.has_finance(clinic_id, 'finance.approve')
    or (posted_by = (select auth.uid()) and private.has_finance(clinic_id, 'finance.collect'))
  );
create policy journal_entries_select on public.journal_entries
  for select to authenticated using (
    private.has_finance(clinic_id, 'finance.reports') or private.has_finance(clinic_id, 'finance.approve')
  );
create policy cashier_sessions_select on public.cashier_sessions
  for select to authenticated using (
    (cashier_user_id = (select auth.uid()) and private.is_active_member(clinic_id))
    or private.has_finance(clinic_id, 'finance.approve') or private.has_finance(clinic_id, 'finance.reports')
  );
create policy finance_requests_select on public.finance_requests
  for select to authenticated using (
    (submitted_by = (select auth.uid()) and private.is_active_member(clinic_id)) or private.has_finance(clinic_id, 'finance.approve')
  );
create policy cash_handovers_select on public.cash_handovers
  for select to authenticated using (
    ((from_user_id = (select auth.uid()) or to_user_id = (select auth.uid())) and private.is_active_member(clinic_id))
    or private.has_finance(clinic_id, 'finance.approve')
  );
create policy daily_financial_closings_select on public.daily_financial_closings
  for select to authenticated using (private.has_any_finance(clinic_id));
