# Requirement Traceability Matrix

Maps every SRS requirement ID to the planned module, database entities, server API, UI surface, tests and milestone.
This is a **plan**, not a statement of what exists. The `Status` column is the source of truth for progress:

- `planned` — not started.
- `foundation` — the underlying security primitives exist (tables, RLS, tests) but the feature itself is not built.
- `done` — implemented with passing tests listed in the `Tests` column.
- `blocked` — waiting on an entry in `docs/OPEN_DECISIONS.md`.
- `excluded` — Phase 1 exclusion; must not be built.

Conventions used below:
- **Module** = folder under `modules/`.
- **API** = server action (`action:`), route handler (`route:`) or Postgres function called through a server-side client (`rpc:`). Browser code never calls privileged RPCs directly.
- **Tests**: `db:` = Postgres policy/integration tests (`tests/db`), `unit:` = Vitest unit tests, `e2e:` = Playwright, `sec:` = adversarial security suite, `race:` = concurrency tests.

## Cross-cutting invariants (SRS §2.1)

| ID | Invariant | Mechanism | Tests | Milestone | Status |
|---|---|---|---|---|---|
| INV-1 | Immutable `clinic_id`, tenant-scoped permissions | `private.forbid_clinic_id_change()` trigger on every clinic-owned table; RLS on `clinic_id` | `db: tenancy.clinic-id-immutable`, `db: meta.rls-enabled-on-all-public-tables` | M0 | foundation |
| INV-2 | Membership derived from authenticated server state | RLS uses `auth.uid()` + `clinic_memberships` (status `active`); active-clinic cookie is a view hint, re-verified on each request | `db: tenancy.cross-tenant-denied`, `unit: active-clinic.resolve` | M0 | foundation |
| INV-3 | Clinic switch invalidates cached clinic data | Switch = server action → cookie → `router.refresh()`; clinic shell keyed by `clinicId` so client state remounts; query keys prefixed by `clinicId` | `e2e: clinic-switch.isolation` (M1) | M0/M1 | foundation |
| INV-4 | Medical content only for assigned open visit | Separate `clinical` schema, visit-scoped policy functions | `sec: medical.non-treating-denied` | M3 | planned |
| INV-5 | Cross-clinic access per clinic + visit, view-only, expiring | `cross_clinic_access_grants` checked on every read | `sec: medical.cross-clinic-*` | M3 | planned |
| INV-6 | Finance append-only | No UPDATE/DELETE grants + triggers on posted tables | `db: finance.posted-immutable` | M4 | planned |
| INV-7 | No clinical/financial data in telemetry | Redacting logger (`lib/telemetry`), Sentry `beforeSend` scrubber | `unit: telemetry.redaction` | M0 (logger) / M7 | foundation |
| INV-8 | Idempotent background tasks | Outbox + idempotency keys, unique constraints | `race: worker.duplicate-delivery` | M2/M5 | planned |

## 3.1 Registration and clinic lifecycle (ONB)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| ONB-001 | onboarding | `clinics`, `clinic_memberships`, `user_profiles` | `action: registerClinic` → `rpc: register_clinic` | `(public)/register` | `db: onboarding.register-creates-owner`, `e2e: register` | M1 | planned |
| ONB-002 | onboarding | `clinic_licenses`, storage bucket `licenses` (private) | `action: uploadLicense` (signed upload) | onboarding/licenses | `db: storage.licenses-cross-tenant-denied` | M1 | planned |
| ONB-003 | platform-admin | `clinic_licenses`, `clinic_review_decisions`, `audit_events` | `rpc: admin_review_clinic` | `(platform-admin)/clinics/pending` | `db: admin.review-logged`, `sec: admin.non-admin-denied` | M1 | planned |
| ONB-004 | onboarding, billing | `clinics.activated_at`, `clinic_subscriptions` (trial) | `rpc: admin_activate_clinic` | admin + clinic status banner | `db: onboarding.trial-starts-once`, `db: onboarding.pending-clinic-cannot-operate` | M1 | planned |
| ONB-005 | onboarding | `clinics.account_state`, `clinic_state_events` | `rpc: admin_set_clinic_state` | admin clinic detail | `db: onboarding.state-transitions` | M1 | planned |
| ONB-006 | onboarding | `clinic_licenses` revisions | `action: replaceLicense` | onboarding/licenses | `db: onboarding.reverification` | M6 | planned |
| ONB-007 | onboarding | `legal_disclaimer_versions`, `disclaimer_acceptances` | `action: acceptDisclaimer` | register + shell banner | `e2e: disclaimer-shown` | M1 | blocked (OD-L01 text) — placeholder only |
| ONB-008 | billing, appointments | `clinic_doctors`, subscription capacity | `rpc: activate_clinic_doctor` | doctors page | `race: capacity.doctor-activation` | M2/M6 | planned |

## 3.2 Patient registry and identity (PAT)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| PAT-001 | patients | `patient_identities`, `clinic_patients` | `action: registerPatient` | patients/new | `db: patients.cross-tenant-denied` | M3 | blocked (ID type, OD-B02) — other fields can proceed |
| PAT-002 | patients | `duplicate_candidates` | `rpc: detect_duplicate_candidates` | patients/duplicates | `db: patients.no-auto-merge` | M3 | planned |
| PAT-003 | patients | `patient_identities` ↔ `clinic_patients` | — | — | `sec: patients.other-clinic-chart-hidden` | M3 | planned |
| PAT-004 | patients, consent | `cross_clinic_access_grants` | — | — | `sec: medical.identity-match-no-access` | M3 | planned |
| PAT-005 | patients, audit | masking views | `lib/privacy/mask` | all patient lists | `unit: mask`, `db: audit.no-pii-payload` | M3 | planned |
| PAT-006 | — | — | — | — | — | — | blocked (OD-B02) |

## 3.3 Doctors, schedule, booking and queue (APT)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| APT-001 | appointments | `appointments`, `appointment_requests` | `action: createAppointment`, `route: public booking` | appointments, `(public)/book/[clinic]` | `db: appointments.receptionist-create`, `sec: public-request-not-final` | M2 | planned |
| APT-002 | appointments | `appointment_requests`, `alternative_offers` | `rpc: review_booking_request` | requests inbox | `db: requests.state-machine` | M2 | planned |
| APT-003 | appointments | `alternative_offers` (no hold) | `rpc: accept_alternative_offer` | patient link | `race: offers.last-slot-accept` | M2 | planned |
| APT-004 | appointments | `doctor_scheduling_policies.method` | `action: updateSchedulingPolicy` | doctor settings | `unit: policy.schema` | M2 | planned |
| APT-005 | appointments | `doctor_weekly_schedules`, `doctor_schedule_exceptions`, `doctor_sessions` | `rpc: materialize_sessions` | schedule editor | `unit: schedule.recurrence (Africa/Cairo)` | M2 | planned |
| APT-006 | queue | `queue_reservations`, `queue_checkins` | `rpc: confirm_queue_reservation`, `rpc: check_in` | check-in queue | `race: queue.numbers-unique` | M2 | planned |
| APT-007 | queue | policy JSON | `modules/queue/ordering` | queue view | `unit: queue.ordering` | M2 | blocked (hybrid formula, OD-B04) — FCFS & priority proceed |
| APT-008 | queue | policy JSON | `rpc: apply_late_arrival` | queue view | `unit: late-arrival` | M2 | blocked (thresholds, OD-B04) — receptionist-control mode proceeds |
| APT-009 | queue | policy JSON | `rpc: add_walk_in` | queue view | `race: queue.walk-in` | M2 | planned |
| APT-010 | queue | policy JSON | `rpc: mark_absent_when_called` | queue view | `unit: absent-policy` | M2 | planned |
| APT-011 | appointments | `overbooking_approvals` | `rpc: request_overbooking` | appointments | `sec: overbooking.no-bypass` | M2 | planned |
| APT-012 | appointments | `doctor_sessions.status`, events | `rpc: cancel_doctor_session` | schedule | `db: session-cancel.affected` | M2 | planned |
| APT-013 | appointments | policy JSON | `rpc: patient_cancel_or_reschedule` | patient link | `db: patient-cancel.policy` | M2 | planned |
| APT-014 | appointments | policy JSON, `appointment_events` | `rpc: mark_no_show` | appointments | `unit: no-show` | M2 | blocked (auto thresholds, OD-B04) — manual mode proceeds |
| APT-015 | appointments, permissions | permission grants | — | — | `sec: receptionist.no-medical` | M2/M3 | planned |
| APT-016 | appointments | exclusion constraints / row locks, `appointment_events` | all booking RPCs | — | `race: booking.*` | M2 | planned |
| APT-017 | — | — | — | — | — | — | blocked (OD-B04) |

## 3.4 Clinical consultations and records (MED)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| MED-001 | clinical | `clinical.medical_template_versions` | `action: saveTemplate` | doctor template builder | `db: templates.owner-doctor-only` | M3 | blocked (field catalog, OD-B03) — generic field types proceed |
| MED-002 | clinical | template versions + `archived_fields` | — | consultation view | `unit: template.archived-fields` | M3 | planned |
| MED-003 | clinical | `clinical.consultations.status`, `clinical.medical_entries.locked_at` | `rpc: complete_consultation` | consultation | `sec: medical.completed-immutable` | M3 | planned |
| MED-004 | clinical | `clinical.medical_corrections` | `rpc: add_correction` | consultation | `db: corrections.append-only` | M3 | planned |
| MED-005 | clinical | visit-scoped RLS | — | — | `sec: medical.owner/receptionist/admin/other-doctor-denied` | M3 | planned |
| MED-006 | consent | `cross_clinic_access_grants`, `consent_evidence` | `route: consent link`, `rpc: grant_cross_clinic_access` | consent page | `sec: medical.cross-clinic-requires-consent` | M3 | planned (WhatsApp delivery M5) |
| MED-007 | consent | grants `revoked_at`, completion trigger | `rpc: revoke_cross_clinic_access` | — | `sec: medical.revoked-on-completion/reassignment` | M3 | planned |
| MED-008 | consent | read-only gateway function | `rpc: read_external_record` | external record viewer (no export) | `sec: external.no-export-endpoint` | M3 | planned |
| MED-009 | clinical, onboarding | membership deactivation | — | — | `sec: departed-doctor-denied` | M3 | planned (custodian export blocked OD-L03) |
| MED-010 | clinical | storage policies, access log | — | — | `sec: medical.forged-url-denied` | M3 | planned |
| MED-011 | — | — | — | — | — | — | blocked (OD-B03, OD-L03) |

## 3.5 Operational finance (FIN)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| FIN-001 | finance | `finance.payments`, `finance.financial_transactions` | `rpc: post_payment` | cashier | `db: payments.recorded` | M4 | planned |
| FIN-002 | finance | `finance.financial_accounts`, `finance.journal_entries` | `rpc: post_transfer` | accounts | `db: transfer-not-revenue` | M4 | planned |
| FIN-003 | finance | `finance.opening_balance_requests` | `rpc: approve_opening_balance` | accounts | `sec: opening-balance.owner-only` | M4 | planned |
| FIN-004 | finance | `finance.cashier_sessions`, `finance.cashier_handovers` | `rpc: open/close_cashier_session`, `rpc: acknowledge_handover` | cashier shift | `race: handover.concurrent` | M4 | planned |
| FIN-005 | finance | session discrepancy fields, policy | `rpc: close_cashier_session` | cashier shift | `db: discrepancy.preserved` | M4 | planned |
| FIN-006 | finance | `finance.expenses`, approvals | `rpc: submit/approve_expense` | expenses | `db: expense.policy` | M4 | planned |
| FIN-007 | finance | `finance.transfers`, approvals | `rpc: submit/approve_transfer` | transfers | `db: transfer.policy` | M4 | planned |
| FIN-008 | finance | `finance.refund_requests`, `finance.refunds` | `rpc: request/approve_refund` | refunds | `db: refund.linked-payout` | M4 | planned |
| FIN-009 | finance | `finance.financial_reversals` | `rpc: reverse_transaction` | transaction detail | `db: reversal.reconciles` | M4 | planned |
| FIN-010 | finance, permissions | permission grants | — | permissions page | `sec: finance.non-granted-denied`, `sec: admin.no-finance` | M4 | planned |
| FIN-011 | finance | `finance.receipts` | `route: receipt pdf` | receipt | `e2e: receipt` | M4 | planned (tax claim blocked OD-L04) |
| FIN-012 | finance | `finance.daily_financial_closings` | `rpc: submit/approve_daily_close` | daily close | `db: closing.policy` | M4 | planned |
| FIN-013 | finance | reporting views over posted journal | `action: report queries` | reports | `db: reports.reconcile-with-journal` | M4 | planned |
| FIN-014 | finance, onboarding | export jobs | `rpc: request_finance_export` | settings/export | `db: export.audited` | M4/M6 | planned (retention blocked OD-L03) |
| FIN-015 | finance | integer `amount_minor`, balanced journal check | — | — | `unit: money`, `db: journal.balanced` | M4 | planned |
| FIN-016 | — | — | — | — | — | — | blocked (OD-B06) |

## 3.6 WhatsApp transactional communication (WAP)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| WAP-001 | messaging | `whatsapp_connections` | `MessagingProvider` adapter | WhatsApp settings | `unit: provider.mock` | M5 | blocked for real provider (OD-P01); mock proceeds |
| WAP-002 | messaging | `clinic_notification_settings` | `action: updateNotificationSettings` | WhatsApp settings | `db: settings.owner-or-granted` | M5 | planned |
| WAP-003 | messaging | reminder rules | worker `schedule-reminders` | WhatsApp settings | `unit: reminder-times (Cairo)` | M5 | planned |
| WAP-004 | messaging | `whatsapp_template_catalog`, `clinic_message_templates` | `action: customizeTemplate` | templates | `db: templates.approved-only` | M5 | planned |
| WAP-005 | messaging | `clinic_patients.preferred_language` | — | — | `unit: language-fallback` | M5 | planned |
| WAP-006 | messaging, appointments | `message_webhooks` | `route: /api/webhooks/whatsapp` | — | `race: webhook.replay-no-duplicate-action` | M5 | planned |
| WAP-007 | messaging | `message_intents` | `action: sendTemplateManually` | appointment detail | `db: manual-send.permission` | M5 | planned |
| WAP-008 | messaging | `messaging_consents` | `action: recordConsent` | patient detail | `db: consent.separate-from-medical` | M5 | planned |
| WAP-009 | messaging | `messaging_consents.revoked_at` | `action: recordWithdrawal` | patient detail | `race: withdrawal-before-dispatch` | M5 | planned |
| WAP-010 | messaging | `message_attempts`, dead-letter | worker | alerts | `unit: retry-classification` | M5 | planned |
| WAP-011 | messaging | connection health | worker `connection-monitor` | alerts | `db: resume-only-relevant` | M5 | planned |
| WAP-012 | messaging | `message_intents`, `message_attempts` | `action: searchMessageLog` | message log | `db: log.clinic-scoped` | M5 | planned |
| WAP-013 | messaging, billing | `messaging_usage_ledger`, `messaging_budgets` | `rpc: reserve_message_budget` | WhatsApp budget | `race: budget.cap-under-concurrency`, `db: threshold-alert-once` | M5 | blocked (prices, OD-B05) — mechanism proceeds |
| WAP-014 | permissions | permission grants | — | permissions page | `sec: whatsapp.non-granted-denied` | M5 | planned |
| WAP-015 | — | — | — | — | — | — | excluded |
| WAP-016 | messaging | outbox, idempotency keys | webhook signature verify | — | `unit: hmac`, `race: webhook.replay` | M5 | planned |
| WAP-017 | — | — | — | — | — | — | blocked (OD-P01, OD-B05) |

## 3.7 Staff and audit (STA)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| STA-001 | tenancy, permissions | `clinic_memberships.role`, `clinic_role_permissions` | `rpc: set_role_permission` (owner only) | permissions page | `sec: permissions.owner-only`, `db: permissions.non-overrideable-medical` | M0 (roles) / M1 (grants) | foundation |
| STA-002 | tenancy | `clinic_invitations` (token hash) | `action: inviteStaff`, `route: invite accept` | staff, `(auth)/invite/[token]` | `db: invite.single-use`, `db: invite.expired` | M1 | planned |
| STA-003 | tenancy | `clinic_memberships.status` | `rpc: set_membership_status` | staff | `sec: suspended-session-denied` | M0 (status enforced in RLS) / M1 (UI) | foundation |
| STA-004 | tenancy | memberships per clinic | `action: switchClinic` | clinic switcher | `db: multi-clinic.isolated`, `e2e: switcher` | M0 | foundation |
| STA-005 | tenancy | `clinic_role_permissions` (`staff.manage`) | `rpc: set_membership_status` | staff | `sec: manager-cannot-change-roles`, `sec: owner-not-lockable` | M1 | planned |
| STA-006 | appointments, permissions | — | — | — | see APT-015 | M2 | planned |
| STA-007 | audit | `audit_events` (append-only) | `private.write_audit_event` | audit log (M1) | `db: audit.append-only`, `db: audit.no-client-insert` | M0 | foundation |
| STA-008 | — | — | — | — | — | — | excluded (attendance/shifts) |

## 3.8 SaaS plans, billing and trials (SUB)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| SUB-001 | billing | `platform_plans`, `plan_versions` | `rpc: admin_publish_plan_version` | admin plans | `db: plan.versioned` | M6 | planned (prices blocked OD-B05) |
| SUB-002 | billing | `clinic_doctors.status` | `rpc: activate_clinic_doctor` | doctors | `race: capacity` | M6 | planned |
| SUB-003 | billing | `clinic_subscriptions` trial fields, `trial_extensions` | `rpc: admin_extend_trial` | admin | `db: trial.once`, `db: extension.admin-only` | M1 (start) / M6 | planned |
| SUB-004 | billing | grace config | entitlement check `private.clinic_entitlement()` | banner | `db: grace.no-erasure` | M6 | blocked (grace operations, OD-B05) |
| SUB-005 | billing | plan_versions periods | — | pricing | `unit: period-dates` | M6 | planned |
| SUB-006 | billing | `subscription_payments` | `PaymentProvider` adapter, `rpc: admin_verify_manual_payment` | billing, admin | `sec: manual-evidence-no-entitlement`, `race: payment-webhook.replay` | M6 | blocked for real gateway (OD-P02); mock proceeds |
| SUB-007 | billing | `subscription_renewal_authorizations` | provider adapter | billing | `unit: renewal` | M6 | blocked (OD-P02) |
| SUB-008 | billing | `plan_change_requests.effective_renewal` | `rpc: request_plan_change` | billing | `db: plan-change.not-early` | M6 | planned |
| SUB-009 | billing | `subscription_receipts` | `route: receipt` | billing | `e2e: receipt-download` | M6 | planned (tax invoice blocked OD-L04) |
| SUB-010 | billing | plan versions + clinic snapshots | admin RPCs | admin plans | `db: snapshot-stable-on-catalog-change` | M6 | planned |
| SUB-011 | — | — | — | — | — | — | blocked (OD-B05, OD-P02, OD-L04) |

## 3.9 Platform administration and support (ADM)

| ID | Module | DB entities | API | UI | Tests | MS | Status |
|---|---|---|---|---|---|---|---|
| ADM-001 | platform-admin | `platform_admins`, `clinic_licenses`, `clinic_state_events` | admin RPCs | `(platform-admin)/*` | `sec: admin.non-admin-denied` | M1 / M6 | planned |
| ADM-002 | platform-admin, billing | trial extensions, payments, plan versions | admin RPCs | admin | `db: admin.actions-audited` | M6 | planned |
| ADM-003 | platform-admin | no admin RLS path into clinic data | — | — | `sec: admin.no-clinic-data` (M0 for tenancy tables, extended each milestone) | M0+ | foundation |
| ADM-004 | — | — | — | — | default deny, test asserts no impersonation path | — | blocked (Q97 / OD-S01) |
| ADM-005 | — | — | — | — | — | — | blocked (OD-B07) |

## Delivery acceptance scenarios (SRS §8)

| # | Scenario | Test | MS |
|---|---|---|---|
| 1 | Clinic A receptionist cannot read clinic B data | `db: tenancy.cross-tenant-denied` (M0, tenancy tables) → extended per domain | M0+ |
| 2 | Multi-clinic doctor cannot cross-read without consent | `sec: medical.cross-clinic-*` | M3 |
| 3 | Concurrent last-slot acceptances | `race: offers.last-slot-accept` | M2 |
| 4 | Suspended employee's old session denied | `db: tenancy.suspended-member-denied` (M0) + session revocation (M1) | M0/M1 |
| 5 | Completed consultation immutable | `sec: medical.completed-immutable` | M3 |
| 6 | Refund/reversal reconciles | `db: reversal.reconciles` | M4 |
| 7 | Handover acknowledgement | `race: handover.concurrent` | M4 |
| 8 | Webhook replay/out-of-order | `race: webhook.replay` | M5 |
| 9 | Spend cap under concurrent workers | `race: budget.cap-under-concurrency` | M5 |
| 10 | Opt-out before dispatch stops send | `race: withdrawal-before-dispatch` | M5 |
| 11 | Trial after activation; plan changes not early | `db: onboarding.trial-starts-once`, `db: plan-change.not-early` | M1/M6 |
| 12 | Payment webhook replay / manual approval | `race: payment-webhook.replay`, `sec: manual-evidence-no-entitlement` | M6 |
| 13 | Exited clinic archive retained | `db: archive.retained` | M6 |
| 14 | Admin tools cannot expose medical/finance | `sec: admin.no-clinic-data` | M0+ |
