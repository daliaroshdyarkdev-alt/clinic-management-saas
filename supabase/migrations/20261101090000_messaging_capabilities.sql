-- Milestone 5: owner-assigned WhatsApp permissions (WAP-013, WAP-014).
alter type public.clinic_capability add value if not exists 'messaging.send';
alter type public.clinic_capability add value if not exists 'messaging.budget';
