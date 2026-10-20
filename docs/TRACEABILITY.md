# Requirement Traceability Matrix

Maps every SRS requirement ID to its planned milestone, module (`modules/…`), database entities, server surface, UI and tests. **Status** is the current implementation state: `M0 ✔` = delivered foundation, `Planned` = not started, `Excluded` = out of Phase 1, `OPEN` = blocked on a decision in `OPEN_DECISIONS.md`.

Abbreviations: SA = Next.js Server Action, RH = Route Handler, RPC = Postgres function called in a transaction, SEC = security/RLS test suite (`tests/db`), E2E = Playwright.

## Cross-cutting invariants (SRS §2.1)

| ID | Requirement | Milestone | Implementation | Tests | Status |
|---|---|---|---|---|---|
| INV-1 | Immutable `clinic_id` on clinic-owned rows | M1+ | Composite FK `(clinic_id, id)`; trigger rejects `clinic_id` UPDATE | SEC: update clinic_id denied | Planned |
| INV-2 | Membership derived on the server, client clinic id untrusted | M0 → M1 | M0: `modules/tenancy/active-clinic.ts` resolves the clinic only from verified memberships; the URL clinic id is a view hint. M1: RLS `private.is_active_member(clinic_id)` | Unit: `active-clinic.test.ts` (forged id, inactive membership). SEC in M1 | **M0 ✔** (domain), M1 DB |
| INV-3 | Clinic switch invalidates clinic-scoped caches | M0 → M1 | Clinic id in URL path (`/[lang]/c/[clinicId]`); clinic switch and sign-out are **full document loads**, so routes Next.js keeps hidden in the DOM are discarded; `lib/cache/clinic-scope.ts` key prefixing; ADR-0002 forbids `use cache` for tenant data | Unit: `clinic-scope.test.ts`; E2E: after switching, nothing from the previous clinic remains in the DOM | **M0 ✔** (architecture) |
| INV-4 | Medical content only for assigned doctor on open visit | M3 | `clinical` schema, policy fn `clinical.can_read_entry()`; non-grantable capability list | Unit: `capabilities.test.ts` (non-doctor never granted). SEC M3 | M0 ✔ (capability guard), M3 |
| INV-5 | Cross-clinic access per clinic + visit, view-only, expires | M3 | `cross_clinic_access_grants` | SEC + race tests | Planned |
| INV-6 | Finance append-only | M4 | `finance` schema; no UPDATE/DELETE grants; reversal RPC | SEC + invariant tests | Planned |
| INV-7 | No cross-tenant clinical/financial data in telemetry/logs | M0 → all | `lib/telemetry/redact.ts` + `logger.ts` (redacting structured logger) | Unit: `redact.test.ts` | **M0 ✔** |
| INV-8 | Idempotent background tasks | M5 | Outbox + idempotency keys (OD-20) | Replay tests | Planned |

## ONB — Registration and clinic lifecycle

| ID | P | Milestone | Module | DB entities | Server | UI | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| ONB-001 | P0 | M1 | onboarding, identity | clinics, user_profiles, clinic_memberships | SA `registerClinic` (RPC, transactional) | `/[lang]/register` | E2E register; SEC | M0: route + placeholder UI |
| ONB-002 | P0 | M1 | onboarding | clinic_licenses; private bucket `licenses` | SA upload → signed upload URL | onboarding wizard | SEC storage denial cross-clinic | Planned (OD-05) |
| ONB-003 | P0 | M1 | platform-admin, audit | clinic_licenses, audit_events | SA `reviewLicense` | admin verification queue | SEC non-admin denied; audit row | M0: admin shell preview |
| ONB-004 | P0 | M1 | onboarding, billing | clinics.activated_at, clinic_subscriptions (trial) | RPC `activate_clinic` (sets trial once) | status banner | Unit + SEC trial-once | Planned |
| ONB-005 | P0 | M1 | onboarding | clinics.account_state + state history | RPC state transitions | admin lifecycle | Unit state machine | Planned (OD-06) |
| ONB-006 | P1 | M1/M6 | onboarding | clinic_licenses revisions | SA | license panel | E2E | Planned |
| ONB-007 | P0 | M0/M1 | onboarding | — | — | Disclaimer component | E2E visible | **M0 ✔** placeholder text (OD-22) |
| ONB-008 | P0 | M1/M6 | onboarding, billing | clinic_doctors | RPC capacity check | doctors page | Race test capacity | Planned (OD-02) |

## PAT — Patient registry

| ID | P | Milestone | Module | DB entities | Server | UI | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| PAT-001 | P0 | M3 | patients | patient_identities, clinic_patients | SA + Zod schema | patient form | Unit schema | Planned (OD-11) |
| PAT-002 | P0 | M3 | patients | duplicate_candidates | RPC detect | review queue | Unit, no auto-merge | Planned (OD-24) |
| PAT-003 | P0 | M3 | patients | clinic_patients | RLS | registry | SEC cross-clinic | Planned |
| PAT-004 | P0 | M3 | consent | cross_clinic_access_grants | gateway RH | external record view | SEC | Planned |
| PAT-005 | P0 | M0 → M3 | lib/telemetry, patients | — | masking helpers | masked display | Unit `mask.test.ts` | **M0 ✔** (helpers) |
| PAT-006 | OPEN | — | — | — | — | — | — | OPEN |

## APT — Doctors, schedules, booking and queue (Milestone 2)

| ID | P | Module | DB entities | Server | UI | Tests | Status |
|---|---|---|---|---|---|---|---|
| APT-001 | P0 | appointments | appointments, appointment_requests | SA create; public RH request (throttled) | appointments, public booking | E2E, SEC anon | Planned |
| APT-002 | P0 | appointments | appointment_requests, alternative_offers | SA approve/reject/propose | request inbox | Unit state machine | Planned |
| APT-003 | P0 | appointments | alternative_offers | RPC `accept_offer` (row lock, recheck) | patient link | **Race test** | Planned |
| APT-004 | P0 | appointments | doctor_scheduling_policies | SA | doctor settings | Unit | Planned |
| APT-005 | P0 | appointments | doctor_weekly_schedules, doctor_schedule_exceptions | SA | schedule editor | Unit recurrence (Cairo tz) | Planned |
| APT-006 | P0 | queue | queue_reservations, queue_checkins | RPC atomic numbers | check-in queue | Race test | Planned |
| APT-007…APT-014 | P0 | queue, appointments | doctor_scheduling_policies (validated JSON, versioned) | RPCs per policy | per-doctor settings | Unit per policy option | Planned (OD-13 values) |
| APT-015 | P0 | appointments, permissions | RLS | — | receptionist views | SEC: receptionist no medical | M0: capability guard ✔ |
| APT-016 | P0 | appointments | appointment_events | RPC locking | — | Race tests | Planned |
| APT-017 | OPEN | — | — | — | — | — | OPEN (OD-07, OD-13) |

## MED — Clinical consultations and records (Milestone 3)

| ID | P | Module | DB entities | Server | UI | Tests | Status |
|---|---|---|---|---|---|---|---|
| MED-001 | P0 | clinical | medical_template_versions | SA | template builder | Unit | Planned |
| MED-002 | P0 | clinical | template versions, archived fields | render fn | "Archived information" section | Unit | Planned |
| MED-003 | P0 | clinical | consultations, medical_entries.locked_at | RPC `complete_consultation` | consultation | SEC edit after lock denied | Planned |
| MED-004 | P0 | clinical | medical_corrections | SA append | correction note | SEC original unchanged | Planned |
| MED-005 | P0 | clinical, permissions | RLS policy fn | — | — | SEC non-assigned denied | M0: non-grantable guard ✔ |
| MED-006 | P0 | consent | cross_clinic_access_grants, consent_evidence | consent RH | consent flow | SEC | Planned (OD-23) |
| MED-007 | P0 | consent | grants.revoked_at | trigger on completion/reassign | — | SEC revocation | Planned |
| MED-008 | P0 | consent | — | view-only gateway, no export | external view | E2E no download | Planned |
| MED-009 | P0 | clinical, identity | memberships | RLS | — | SEC departed doctor | Planned (OD-01) |
| MED-010 | P0 | clinical, audit | clinical_access_events | short-lived signed URLs | — | SEC forged URL | Planned |
| MED-011 | OPEN | — | — | — | — | — | OPEN (OD-12) |

## FIN — Operational finance (Milestone 4)

| ID | P | Module | DB entities | Server | UI | Tests | Status |
|---|---|---|---|---|---|---|---|
| FIN-001 | P0 | finance | payments, financial_transactions | RPC post payment | payment entry | Unit + SEC | M0: `lib/money` minor units ✔ |
| FIN-002 | P0 | finance | financial_accounts, transfers, journal_entries | RPC | accounts | Invariant tests | Planned |
| FIN-003 | P0 | finance | opening_balance_requests | RPC approve | accounts | SEC owner-only | Planned |
| FIN-004 | P0 | finance | cashier_sessions, cashier_handovers | RPC | cashier shift | Race test | Planned |
| FIN-005 | P0 | finance | clinic finance policy | RPC | closing | Unit | Planned |
| FIN-006 | P0 | finance | expenses, expense_approvals | RPC | expenses | Unit thresholds | Planned |
| FIN-007 | P0 | finance | transfers, transfer_approvals | RPC | transfers | Unit | Planned |
| FIN-008 | P0 | finance | refund_requests, refunds | RPC | refunds | Unit | Planned (OD-16) |
| FIN-009 | P0 | finance | financial_reversals | RPC reversal | — | SEC no UPDATE/DELETE | Planned |
| FIN-010 | P0 | permissions | permission_grants | — | — | SEC admin denied | M0: capability model ✔ |
| FIN-011 | P1 | finance | receipts | RH | receipt | E2E | Planned |
| FIN-012 | P0 | finance | daily_financial_closings | RPC | closing | Unit | Planned |
| FIN-013 | P1 | finance | reporting views | SA | reports | Reconciliation tests | Planned |
| FIN-014 | P0 | finance, audit | export jobs | RH | export | SEC | Planned (OD-17) |
| FIN-015 | P0 | finance | journal_entries | — | — | Invariant tests | M0: integer minor-unit helper ✔ |
| FIN-016 | OPEN | — | — | — | — | — | OPEN (OD-16) |

## WAP — WhatsApp (Milestone 5)

| ID | P | Module | DB entities | Server | UI | Tests | Status |
|---|---|---|---|---|---|---|---|
| WAP-001 | P0 | messaging | whatsapp_connections | `MessagingProvider` adapter | connection settings | Contract tests (mock) | Planned (OD-14) |
| WAP-002…WAP-005 | P0 | messaging | templates, settings | worker | WhatsApp settings | Unit | Planned |
| WAP-006 | P0 | messaging | message_webhooks | webhook RH (signature) | — | Replay tests | Planned |
| WAP-007 | P0 | messaging | messages | SA manual send | appointment page | SEC | Planned |
| WAP-008, WAP-009 | P0 | messaging | messaging_consents | SA | patient page | Send-time consent test | Planned |
| WAP-010, WAP-011 | P0 | messaging | message_attempts | worker | alerts | Retry tests | Planned |
| WAP-012 | P0 | messaging | messages | SA search | message log | E2E | Planned |
| WAP-013 | P0 | messaging, billing | messaging_usage_ledger | RPC atomic reservation | budget page | **Concurrency test** | Planned |
| WAP-014 | P0 | permissions | permission_grants | — | — | SEC | M0: capability ✔ |
| WAP-015 | P2 | — | — | — | — | — | **Excluded** |
| WAP-016 | P0 | messaging | outbox | HMAC verify | — | Replay | Planned |
| WAP-017 | OPEN | — | — | — | — | — | OPEN (OD-14) |

## STA — Staff and audit

| ID | P | Milestone | Module | DB entities | Server | UI | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| STA-001 | P0 | M0 → M1 | permissions | roles, permission_grants | policy service | role-aware nav | Unit `capabilities.test.ts`, `navigation.test.ts` | **M0 ✔** (model + nav), M1 DB |
| STA-002 | P0 | M1 | identity | clinic_invitations (token hash, single use) | SA invite/accept | invitation accept | SEC replay | Planned (OD-03) |
| STA-003 | P0 | M1 | identity | memberships.status | RPC + session revocation | staff page | §8 #4 test | Planned |
| STA-004 | P0 | M0 → M1 | tenancy | memberships | — | **clinic switcher** | Unit + E2E | **M0 ✔** (UI + resolver) |
| STA-005 | P0 | M1 | permissions | grants | RPC owner-only | staff page | Unit `capabilities.test.ts` (manager cannot assign roles); SEC M1 | M0 ✔ (rule), M1 |
| STA-006 | P0 | M2 | permissions | RLS | — | — | SEC | Planned |
| STA-007 | P0 | M1+ | audit | audit_events (append-only) | `audit.record()` | — | SEC no UPDATE/DELETE | Planned |
| STA-008 | P0 | — | — | — | — | — | — | **Excluded** (attendance) |

## SUB — SaaS plans and billing (Milestone 6)

| ID | P | Module | DB entities | Status |
|---|---|---|---|---|
| SUB-001 | P0 | billing | platform_plans, plan_versions | Planned (OD-15) |
| SUB-002 | P0 | billing, onboarding | clinic_doctors | Planned (OD-02) |
| SUB-003 | P0 | billing | clinic_subscriptions | Planned (OD-09) |
| SUB-004 | P0 | billing | subscription grace config | Planned |
| SUB-005 | P0 | billing | plan_versions.period | Planned |
| SUB-006 | P0 | billing | subscription_payments (`SubscriptionPaymentProvider` mock) | Planned |
| SUB-007 | P1 | billing | subscription_renewal_authorizations | Planned |
| SUB-008 | P0 | billing | plan_change_requests | Planned |
| SUB-009 | P1 | billing | subscription_receipts | Planned |
| SUB-010 | P0 | billing, platform-admin | plan_versions | Planned |
| SUB-011 | OPEN | — | — | OPEN (OD-15) |

All SUB items: tests per §8 scenarios 11–12 (webhook replay, manual payment never activates before approval).

## ADM — Platform administration

| ID | P | Milestone | Implementation | Tests | Status |
|---|---|---|---|---|---|
| ADM-001 | P0 | M1/M6 | `/[lang]/admin` shell; verification queue | SEC non-admin denied | **M0 ✔** shell + preview, M1 data |
| ADM-002 | P0 | M6 | trials, manual payments, plans | SEC | Planned |
| ADM-003 | P0 | M0 → all | Admin nav has no clinic finance/medical entries; `platform_admin` capability set excludes them (non-grantable) | Unit `capabilities.test.ts`, `navigation.test.ts` | **M0 ✔** (model) |
| ADM-004 | OPEN | — | **Not built** (Q97) | Unit: no impersonation capability exists | OPEN (OD-10) |
| ADM-005 | OPEN | — | — | — | OPEN (OD-08) |

## NFR / §5 security gates delivered in M0

| Item | Implementation | Verification |
|---|---|---|
| Arabic RTL / English LTR | `/[lang]` root segment, `<html lang dir>`, logical CSS properties, typed dictionaries with parity check | Unit `dictionaries.test.ts`; E2E `dir=rtl/ltr` |
| Responsive | Sidebar on desktop, sheet navigation on mobile | E2E mobile viewport |
| Secrets server-only | `lib/env` (Zod), `.env.example` without values, `server-only` imports, gitleaks in CI | CI secret scan |
| Default-deny DB grants | Migration `20261020000000_security_baseline.sql` | `tests/db/baseline.test.ts` |
| Security headers | `next.config.ts` headers (CSP frame-ancestors, nosniff, referrer, permissions) | E2E header check |
| Cairo time / UTC storage | `lib/time/cairo.ts` | Unit |
| EGP integer minor units | `lib/money/egp.ts` | Unit |
