-- Milestone 4: owner-controlled finance capabilities (FIN-010). Separate
-- migration so later functions can use the new enum values.
alter type public.clinic_capability add value if not exists 'finance.collect';
alter type public.clinic_capability add value if not exists 'finance.approve';
alter type public.clinic_capability add value if not exists 'finance.reports';
alter type public.clinic_capability add value if not exists 'finance.accounts';
