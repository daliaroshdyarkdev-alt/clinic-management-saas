# Milestone 3 — Evidence Report

**Scope:** patient identity review, consultations, consent (MED, PAT).

**Built:** `supabase/migrations/20261030100000_clinical_records.sql` — unexposed `clinical` schema (templates, consultations, corrections, cross-clinic grants, access log) reachable only through treating-doctor gateway functions; duplicate-candidate flagging. UI: consultation page (form from the doctor's template, draft/complete, archived fields, corrections, consent and external records), view-only external records page, template editor, consultation buttons on the doctor queue, reassignment on the front desk, duplicate review on Patients.

**Results:** typecheck, lint, format, build pass · unit 48 · DB **157** (16 new) · e2e 32.

**Security evidence:** owner, reception, cashier, manager, other doctors and platform admins are denied every consultation function; no API role (incl. `service_role`) has USAGE on `clinical`; completed records are locked by trigger for every role; corrections and grants are append-only; consent needs in-person identity evidence and matching details; access ends on completion, withdrawal or reassignment; access log and audit contain no medical content (asserted). Mutations: removing the treating-doctor check fails 5 tests; removing grant revocation fails 2 (this exposed and fixed a bug: consent could not be given again after a withdrawal).

**Gaps:** OTP / WhatsApp-link consent methods (M5); clinical attachments, template catalog, emergency access (OPEN); intra-clinic sharing between doctors (OD-B14, default deny); signed-in browser tests still pending.
