-- Milestone 2: owner-grantable capability for managers to run appointments
-- (permission matrix ✱, docs/M0_M1_PLAN.md §4). Kept in its own migration
-- because a new enum value cannot be used in the transaction that adds it.
alter type public.clinic_capability add value if not exists 'appointments.manage';
