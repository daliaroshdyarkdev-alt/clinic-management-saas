-- Synthetic development data. Loaded by `supabase db reset` (local only).
-- Every person and clinic here is fictional; never add real patient or staff
-- data. All users share the local-only password below.
--
--   Password for every seeded user: Synthetic-Pass-2026
--
--   owner.a@example.test      owner of Clinic A
--   reception.a@example.test  receptionist at Clinic A
--   cashier.a@example.test    cashier at Clinic A
--   doctor.shared@example.test doctor at Clinic A and Clinic B (multi-clinic)
--   suspended.a@example.test  suspended receptionist at Clinic A
--   owner.b@example.test      owner of Clinic B
--   owner.c@example.test      owner of Clinic C (pending verification)
--   admin@example.test        platform administrator (no clinic membership)
--
-- Patients are seeded from Milestone 3, when the patient tables exist.

do $$
declare
  v_users constant jsonb := '[
    {"id": "11111111-1111-4111-8111-000000000001", "email": "owner.a@example.test",       "name": "مالك العيادة أ (تجريبي)",   "locale": "ar"},
    {"id": "11111111-1111-4111-8111-000000000002", "email": "reception.a@example.test",   "name": "استقبال العيادة أ (تجريبي)", "locale": "ar"},
    {"id": "11111111-1111-4111-8111-000000000003", "email": "cashier.a@example.test",     "name": "صراف العيادة أ (تجريبي)",   "locale": "ar"},
    {"id": "11111111-1111-4111-8111-000000000004", "email": "doctor.shared@example.test", "name": "Synthetic Shared Doctor",   "locale": "en"},
    {"id": "11111111-1111-4111-8111-000000000005", "email": "suspended.a@example.test",   "name": "موظف موقوف (تجريبي)",       "locale": "ar"},
    {"id": "11111111-1111-4111-8111-000000000006", "email": "owner.b@example.test",       "name": "Synthetic Owner B",         "locale": "en"},
    {"id": "11111111-1111-4111-8111-000000000007", "email": "owner.c@example.test",       "name": "مالك العيادة ج (تجريبي)",   "locale": "ar"},
    {"id": "11111111-1111-4111-8111-000000000008", "email": "admin@example.test",         "name": "Synthetic Platform Admin",  "locale": "en"}
  ]';
  v_user jsonb;
begin
  for v_user in select * from jsonb_array_elements(v_users) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      (v_user ->> 'id')::uuid,
      'authenticated', 'authenticated',
      v_user ->> 'email',
      extensions.crypt('Synthetic-Pass-2026', extensions.gen_salt('bf')),
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('full_name', v_user ->> 'name', 'locale', v_user ->> 'locale'),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(),
      v_user ->> 'id',
      (v_user ->> 'id')::uuid,
      jsonb_build_object('sub', v_user ->> 'id', 'email', v_user ->> 'email', 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;
end
$$;

insert into public.clinics (id, name, account_state, activated_at) values
  ('22222222-2222-4222-8222-00000000000a', 'عيادة النور التجريبية', 'active', now() - interval '3 days'),
  ('22222222-2222-4222-8222-00000000000b', 'Synthetic Smile Dental', 'active', now() - interval '20 days'),
  ('22222222-2222-4222-8222-00000000000c', 'عيادة قيد المراجعة (تجريبية)', 'pending', null);

insert into public.clinic_memberships (clinic_id, user_id, role, status) values
  ('22222222-2222-4222-8222-00000000000a', '11111111-1111-4111-8111-000000000001', 'owner', 'active'),
  ('22222222-2222-4222-8222-00000000000a', '11111111-1111-4111-8111-000000000002', 'receptionist', 'active'),
  ('22222222-2222-4222-8222-00000000000a', '11111111-1111-4111-8111-000000000003', 'cashier', 'active'),
  ('22222222-2222-4222-8222-00000000000a', '11111111-1111-4111-8111-000000000004', 'doctor', 'active'),
  ('22222222-2222-4222-8222-00000000000a', '11111111-1111-4111-8111-000000000005', 'receptionist', 'suspended'),
  ('22222222-2222-4222-8222-00000000000b', '11111111-1111-4111-8111-000000000006', 'owner', 'active'),
  ('22222222-2222-4222-8222-00000000000b', '11111111-1111-4111-8111-000000000004', 'doctor', 'active'),
  ('22222222-2222-4222-8222-00000000000c', '11111111-1111-4111-8111-000000000007', 'owner', 'active');

insert into public.platform_admins (user_id) values ('11111111-1111-4111-8111-000000000008');

-- Activated clinics have a trial that started at activation (ONB-004, SUB-003).
insert into public.clinic_subscriptions (clinic_id, trial_started_at, trial_ends_at)
select id, activated_at, activated_at + interval '14 days' from public.clinics
where id in ('22222222-2222-4222-8222-00000000000a', '22222222-2222-4222-8222-00000000000b');
