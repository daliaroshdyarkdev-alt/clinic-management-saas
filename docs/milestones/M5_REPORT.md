# Milestone 5 — Evidence Report

**Scope:** WhatsApp transactional messaging (WAP-001..014, WAP-016; acceptance scenarios 8, 9, 10). WAP-015 excluded; WAP-017 blocked (OD-P01, OD-B05).

**Built:**
- Migrations `20261101090000_messaging_capabilities.sql` and `20261101100000_messaging.sql`:
  - Outbox (`message_intents`) filled by domain triggers on request intake/decision, alternative proposals, cancellations, no-shows and session cancellations, plus scheduled reminders. Every event is off until the owner enables it.
  - Append-only messaging consent, separate from medical consent; the online booking checkbox (unticked by default) becomes consent when reception links the request to a patient.
  - Service-role worker functions. The claim (`FOR UPDATE SKIP LOCKED` with leases) re-checks at send time: obsolete appointment state, current consent, event switch, connection health, approved template, and an atomic budget reservation (allowance, then overage within the clinic's ceiling).
  - Retries with exponential back-off, at most 5 attempts.
  - Idempotent webhooks: statuses only move forward, a failed or non-billable receipt releases the charge, and offer buttons accept or decline exactly once. All other replies become reception alerts.
  - Connections store only a credential reference; tokens live in the worker's environment.
  - Template catalogue with platform approval and clinic-specific wording.
  - Owner-granted `messaging.send` and `messaging.budget`.
- `lib/messaging/`:
  - Provider interface, Meta Cloud API adapter (named parameters, quick-reply payloads, retry classification) and a mock provider.
  - HMAC verification, webhook parser that never extracts message text, and template rendering in Cairo time.
  - Worker core.
- `worker/index.ts` (`pnpm worker`).
- `app/api/webhooks/whatsapp` (verify-token handshake, signed POST, 1 MB limit).
- UI:
  - `/app/whatsapp`: alerts, connection, notification settings, budget and ceiling, permissions, templates, message log.
  - Consent capture and withdrawal on Patients; manual reminder on the board.
  - `/admin/messaging`: messaging terms, template approval, platform-managed numbers.
  - Online consent checkbox on the public booking form.

**Results:** typecheck, lint, format and build pass · unit **63** (12 new) · DB **199** (23 new) · e2e **36** (2 new tests × 2 viewports).

**Evidence:**
- Consent withdrawn before dispatch cancels queued messages, and a withdrawal recorded by any other path is still caught at send time (scenario 10).
- Six parallel claims against 1 included message plus a 250-piaster ceiling at 100 per message: exactly 3 sent, 200 spent, and each threshold alert fires exactly once (scenario 9). An interleaved two-transaction test proves a second worker waits for the first worker's reservation.
- Replaying the same webhook is a no-op; an out-of-order `sent` after `delivered` does not regress the status; a replayed or second button press on an offer books exactly once (scenario 8).
- Another clinic's offer id cannot be triggered through this clinic's number.
- Worker and webhook functions are denied to anon and authenticated users. The log's `variables` column is not readable; other clinics and cashiers see nothing.
- Mutation: disabling the send-time consent check fails 3 tests.
- Bugs found by tests:
  - a webhook `failed` receipt with `billable=false` released the charge twice;
  - the claim function's output columns clashed with table columns;
  - first connection raised a false "restored" alert.
- Also fixed: the workspace permission parser accepted only two capabilities, so a staff member holding any finance grant would have failed to load the app (M4 defect, now tolerant and covered by type checks).

**Gaps / blocked:**
- No real Meta sends: production use requires Meta onboarding, template approval and number ownership decisions (OD-P01). Prices and allowances are OPEN (OD-B05/OD-B20).
- Reschedule notices are not emitted (OD-B19).
- The worker has not been run against a live Supabase stack here; signed-in browser tests are still pending.
