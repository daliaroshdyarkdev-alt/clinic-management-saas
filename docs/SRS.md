# Software Requirements Specification (SRS)
## Multi-Tenant Egyptian Clinic Management SaaS
**Version:** 1.0 — discovery baseline | **Date:** 2026-10-19 | **Status:** Product decisions Q1–Q96 consolidated; Q97 pending
**Audience:** Product owner, engineering team, Claude Code, QA, security reviewers

> **Governance:** Sections labeled **CONFIRMED** preserve decisions made in discovery. Sections labeled **PROPOSED ENGINEERING** are suggested implementation mechanisms, not extra product decisions. **OPEN** means Claude Code must not invent a final business policy. This SRS is an engineering starting point, not legal certification or clinical validation.

## 1. Objectives and boundaries
Build a secure, responsive Arabic-first (English-capable) multi-tenant clinic management web application for Egyptian clinics, supporting (a) clinic onboarding and licensing review, (b) appointment and queue management, (c) patient identities and doctor-controlled medical records, (d) cash-focused operational finance, (e) WhatsApp transactional communication, (f) staff accounts and roles, (g) SaaS billing, and (h) platform administration.

**Phase 1 exclusions:** general HR attendance/shifts, payroll, doctor revenue shares, receivables/debt ledger, supplier payables, advanced accounting/general ledger, automated bank/POS reconciliation, WhatsApp full inbox, automatic SMS fallback, WhatsApp queue progress/called-number notifications, unlimited access to other clinics' records, automatic patient-identity merging. Do not silently implement these as included features.

## 2. Actors and tenancy
- Platform administrator: controls onboarding review, clinic account lifecycle, verification, plans, manual platform payment approval, trial extensions. **No default access to confidential clinic medical or financial records.**
- Clinic owner: owns clinic staff role assignments/permissions, may delegate staff administration, oversees subscriptions, financial permissions, WhatsApp budget.
- Clinic manager: operates only specifically delegated functions; may invite/suspend/deactivate employees when owner grants; may change WhatsApp spend limits only if expressly authorized; never grants/changing roles or permissions (owner only).
- Receptionist: authorized to manage appointments for all doctors inside their clinic, check-in and patient workflow; cannot read confidential consultation notes by default.
- Cashier: payment entry, cashier sessions, count/handover within authorized scope.
- Doctor: scheduling preferences and visit-specific consultations/medical records; no blanket access to all medical records.
- Patient: no full portal decided for Phase 1; can submit online booking requests, supply consent, and use secure WhatsApp buttons/links.
- Background worker: privileged, audited machine principal processing scheduled messages, expiry, retries, outbox, and recurring policies.
- One human employee account can be invited into multiple clinics; clinic-specific memberships/permissions and active clinic switcher remain isolated.

### 2.1 Mandatory invariants
1. Every clinic-owned business entity has immutable `clinic_id` and tenant-scoped permissions.
2. Requests must derive effective clinic membership from authenticated server-side context; never trust the client-supplied clinic ID without authorization.
3. Switching clinic context must invalidate/refresh cached clinic-specific queries, role grants and subscriptions; never expose data from previous workspace.
4. Doctor access to medical content requires authorization tied to an assigned, open consultation/visit plus applicable patient permission. Other staff, owners and platform admins have no implicit medical-content access.
5. Cross-clinic medical access requires patient approval for **each clinic and each visit**, is view-only, and expires immediately on consultation completion or verified revocation.
6. Financial transaction records are append-only: correction = linked reversal + new corrected entry. Never UPDATE/DELETE settled transaction amounts.
7. Cross-tenant financial and clinical data must not be sent to generic telemetry, browser logs, or support consoles.
8. Background tasks must be idempotent; processing duplicates must not create duplicate appointments, charges or notifications.

## 3. Functional requirements
Requirement IDs allow traceability into tests and implementation tasks. **Priority P0** = launch-critical; **P1** = Phase 1 supported but may be delivered after foundation; **P2** = later phase.

### 3.1 Registration and clinic lifecycle (ONB)
- **ONB-001 P0 CONFIRMED:** Self-registration of clinic with owner account.
- **ONB-002 P0 CONFIRMED:** Upload clinic operating license and doctor professional license; hold clinic pending verification. Store files privately.
- **ONB-003 P0 CONFIRMED:** Platform admin review, accept/reject, request replacement documents; log reason, actor and time.
- **ONB-004 P0 CONFIRMED:** Clinic operates only following approval/activation; 14-day free trial begins after activation, not initial registration.
- **ONB-005 P0 CONFIRMED:** Clinic account lifecycle includes pending, active, suspended, closed/archived; reactivate through controlled admin workflow.
- **ONB-006 P1 CONFIRMED:** Support updates and re-verification of licensing documents.
- **ONB-007 P0 CONFIRMED:** Display legal disclaimer; legal counsel must review text; disclaimer does not substitute for medical/privacy compliance.
- **ONB-008 P0 CONFIRMED:** Multiple doctors per clinic, subject to licensed/paid doctor capacity.

**Acceptance:** Unapproved clinics cannot create live appointments/consultations or send clinic patient messages. Admin approval is logged. Trial starts exactly once at first approved activation unless explicit extension is granted.

### 3.2 Patient registry and identity (PAT)
- **PAT-001 P0 CONFIRMED:** Required patient fields: name, phone, DOB, gender, address, additional identification data; exact ID type and validation **OPEN**.
- **PAT-002 P0 CONFIRMED:** Detect potential duplicate patient profiles by combination of name, mobile, birthdate, identification; flag for authorized receptionist review; no automatic merge.
- **PAT-003 P0 CONFIRMED:** Shared patient identity across clinics; membership/visibility limited to each clinic's authorized operational data.
- **PAT-004 P0 CONFIRMED:** Cross-clinic records are never automatically displayed because identity matched; require explicit consent for the particular treating visit.
- **PAT-005 P0 PROPOSED ENGINEERING:** Mask patient IDs and personal details in UI and audit logs according to minimum necessary access.
- **PAT-006 OPEN:** Patient demographic correction/identity merge workflow, validated ID types, and consent for patient-initiated self-service beyond existing booking flows.

### 3.3 Doctors, schedule, booking and queue (APT)
- **APT-001 P0 CONFIRMED:** Receptionist creates appointments directly; public patients submit requests that are not final until approved by receptionist.
- **APT-002 P0 CONFIRMED:** Receptionist approves, rejects or proposes alternative. Alternative requires patient acceptance.
- **APT-003 P0 CONFIRMED:** Alternative proposal does not hold or reserve capacity. At acceptance, availability is rechecked transactionally; confirm only if still available, else notify patient and reception.
- **APT-004 P0 CONFIRMED:** Doctor chooses `TIMED` appointments (consultation duration) or `QUEUE` number reservations (session maximum capacity).
- **APT-005 P0 CONFIRMED:** Per-doctor weekly recurring availability; date-specific exceptions, cancellations and extra sessions.
- **APT-006 P0 CONFIRMED:** Distinct queue **reservation number** at confirmation and **waiting number** on check-in.
- **APT-007 P0 CONFIRMED:** Per-doctor queue ordering option: FCFS, reservation priority or hybrid.
- **APT-008 P0 CONFIRMED:** Per-doctor late arrivals: automatic rule or receptionist control.
- **APT-009 P0 CONFIRMED:** Per-doctor walk-ins: auto append or receptionist-selected placement.
- **APT-010 P0 CONFIRMED:** Per-doctor absent-when-called: move end, temporarily skip/prioritize on return, or receptionist assignment.
- **APT-011 P0 CONFIRMED:** Per-doctor overbooking policy: disallow, receptionist override, or doctor/owner approval.
- **APT-012 P0 CONFIRMED:** Doctor session cancellation: receptionist can cancel affected bookings, individually reschedule or propose alternatives.
- **APT-013 P0 CONFIRMED:** Per-doctor patient cancellation/reschedule: receptionist-only, patient self-service, or patient request for receptionist approval.
- **APT-014 P0 CONFIRMED:** Per-doctor no-show: manual, automatic, or suspected-no-show requiring receptionist review.
- **APT-015 P0 CONFIRMED:** Authorized receptionists have all-doctor appointment management within own clinic, without medical-content access.
- **APT-016 P0 PROPOSED ENGINEERING:** Transactional slot/capacity locking to prevent simultaneous confirmations from exceeding allowed capacity. Store event history of state changes and actor.
- **APT-017 OPEN:** Exact threshold values, queue hybrid weight/order formula, time-zone/DST policy, appointment offer expiry, public booking anti-abuse limits. No-hold alternative rule is final and must not be changed.

**State models (engineering proposal; business actions remain binding):**
- Booking request: `submitted -> approved/confirmed | rejected | alternative_proposed -> patient_accepted -> confirmed (if available) | unavailable -> new_proposal`, with cancellation/no-show/reschedule events and audit records.
- Timed appointment capacity uses unique/locked slot rules; queue capacity uses atomic increment/counter or transactional availability query; overrides require appropriately authorized actor.
- Queue number assignment check-in is atomic per clinic/doctor/session and separate from reservation sequence; no collisions.

**Acceptance:** Two patients concurrently accepting the last available proposal cannot both receive an invalid confirmation. Receptionist edits cannot bypass per-doctor overbooking approval. Queue reservation and check-in numbers differ and remain stable/auditable.

### 3.4 Clinical consultations and records (MED)
- **MED-001 P0 CONFIRMED:** Each doctor independently configures medical form sections/fields for their consultation records.
- **MED-002 P0 CONFIRMED:** Template changes affect historical presentation. Removed fields are retained in read-only `Archived Information`, never destroyed.
- **MED-003 P0 CONFIRMED:** Consultation interrupted/in progress stays editable draft. Explicit completion locks original record against editing/deletion.
- **MED-004 P0 CONFIRMED:** Corrections after completion are append-only linked notes, preserving original.
- **MED-005 P0 CONFIRMED:** Within clinic, protected medical content available only to assigned treating doctor for their authorized visit, subject to necessary lawful exceptions not invented here.
- **MED-006 P0 CONFIRMED:** Cross-clinic view requires fresh, explicit patient consent per new clinic/per visit, using secure WhatsApp link, OTP, or documented in-person ID verification.
- **MED-007 P0 CONFIRMED:** Cross-clinic access revoked immediately on consultation completion, verified consent withdrawal, or treating doctor reassignment. New doctor requires new patient authorization.
- **MED-008 P0 CONFIRMED:** External records are view-only; no platform import, copy or download. Acknowledge screenshots/copy outside platform cannot be technically ruled out entirely.
- **MED-009 P0 CONFIRMED:** Departing doctor loses previous clinic records; clinic retains records and controlled legal custodian archive/export on exit.
- **MED-010 P0 PROPOSED ENGINEERING:** Enforce access server side for every record read, including API, download, storage URLs and realtime; short-lived access tokens plus access reevaluation; record access log contains metadata only.
- **MED-011 OPEN:** Medical template field catalog, attachment support, precise retention periods, lawful emergency access exceptions, patient data subject rights and legally authorized custodian process.

**Acceptance:** Owner, receptionist, platform admin, or a doctor not assigned to visit cannot fetch medical content even by forged URL/API requests. Completion/revocation prevents subsequent reads. Correcting completed record never alters original payload.

### 3.5 Operational finance (FIN)
- **FIN-001 P0 CONFIRMED:** Manually enter patient payments with amount, method (`cash`,`POS`,`InstaPay`,`bank_transfer`), reference, optional evidence, actor/time; no automatic settlement verification Phase 1.
- **FIN-002 P0 CONFIRMED:** Multiple clinic financial accounts (cash draws/safe/bank/POS etc.); transfers are not revenue; POS settlement not double-counted.
- **FIN-003 P0 CONFIRMED:** Authorized staff enter account opening balances; clinic owner approves before activation; opening balance is not revenue.
- **FIN-004 P0 CONFIRMED:** Each cashier opens shift/session, records transactions, cash count, formal handover and recipient acknowledgement.
- **FIN-005 P0 CONFIRMED:** Per-clinic discrepancies policy: warning, explanation mandatory, or manager/owner approval; original cash count and discrepancy preserved.
- **FIN-006 P0 CONFIRMED:** Per-clinic expense policy: direct, all approvals or threshold-based approval.
- **FIN-007 P0 CONFIRMED:** Per-clinic transfer policy: direct, all approvals or threshold-based; physical handovers acknowledged.
- **FIN-008 P0 CONFIRMED:** Per-clinic refund policy: direct, all approvals or threshold-based; separate linked payout transaction with reason. Payment execution manual/outside platform.
- **FIN-009 P0 CONFIRMED:** Recorded financial transactions immutable; correction creates reversal and correctly entered new transaction, with preserved links/audit.
- **FIN-010 P0 CONFIRMED:** Financial permissions set per clinic by owner; platform admin no default financial access.
- **FIN-011 P1 CONFIRMED:** Clinic-configurable receipt output print/download/WhatsApp; internal payment/receipt history maintained regardless. Do not claim these satisfy Egyptian tax e-receipt obligations without review.
- **FIN-012 P0 CONFIRMED:** Per-clinic daily closing: cashier sessions only, required clinic daily close, or daily close requiring owner/manager approval.
- **FIN-013 P1 CONFIRMED:** Reports: collections by day/week/month, expenses, payment method, account balances, cashier closings, doctor-linked collections (not doctor share calculations), refunds, discrepancies, employee activity, monthly trends.
- **FIN-014 P0 CONFIRMED:** Secure archive and authorized full financial export (including transactions and audit trail) on clinic exit; exact legal retention length **OPEN**.
- **FIN-015 P0 PROPOSED ENGINEERING:** Use balanced transfer journal/ledger entries, transaction-scoped writes, integer piasters/minor units or NUMERIC precision, never floats; reconciliation invariant tests; approval state separate from immutable posted records.
- **FIN-016 OPEN:** Fee/refund workflows for partial refund, tax treatment, accountable accounts and settlement status taxonomy; accountant validation required.

**Acceptance:** Concurrent cash handovers don't overwrite each other. Reversal and replacement reconcile to correct final balances without destroying records. No financial operation is possible by a non-granted clinic user; admin service credentials do not expose finance API by default.

### 3.6 WhatsApp transactional communication (WAP)
- **WAP-001 P0 CONFIRMED:** Support clinic-owned and platform-managed WhatsApp numbers subject to Meta/provider eligibility and technical feasibility; preserve clinic-specific account and data separation.
- **WAP-002 P0 CONFIRMED:** Each clinic enables/disables supported appointment notification events: request received, approval/rejection, alternative proposal, reminder, reschedule, cancellation, doctor session cancellation, no-show.
- **WAP-003 P0 CONFIRMED:** Clinic sets number and timing of reminders. Timed based on appointment time; queue based on scheduled session.
- **WAP-004 P0 CONFIRMED:** Predefined Arabic/English approved template library plus clinic-specific customization, subject to Meta approval.
- **WAP-005 P0 CONFIRMED:** Patient preferred language, fallback to clinic default.
- **WAP-006 P0 CONFIRMED:** Interactive replies: automatically complete previously authorized actions (accept valid proposal) but route new scheduling decisions to receptionist; no full inbox Phase 1.
- **WAP-007 P0 CONFIRMED:** Receptionists can manually send approved appointment templates.
- **WAP-008 P0 CONFIRMED:** WhatsApp consent captured by receptionist, online checkbox or secure link; store source/time/clinic. Consent separate from medical cross-clinic authorization and marketing opt-in.
- **WAP-009 P0 CONFIRMED:** No dedicated patient opt-out interface in Phase 1; patients may block number independently; receptionist must be able to record withdrawal and disable future sends. Blocking is not guaranteed detectable by API.
- **WAP-010 P0 CONFIRMED:** Automatic retry of transient failures; alert receptionist on exhausted retries, non-retryable errors and spend-limit blocks. Never send obsolete/duplicate notifications.
- **WAP-011 P0 CONFIRMED:** Auto-monitor connectivity, alert authorized users, resume only relevant pending messages after recovery.
- **WAP-012 P0 CONFIRMED:** Searchable clinic message log and per-appointment history: timestamps, API/delivery status, retries, button replies.
- **WAP-013 P0 CONFIRMED:** SaaS plan contains message allowance; overage billed separately up to clinic-defined spending ceiling; stop additional billable sends at cap, with predefined ~80%/100% alerts. Owner/explicitly authorized manager may modify ceiling.
- **WAP-014 P0 CONFIRMED:** Owner assigns operational WhatsApp employee permissions.
- **WAP-015 P2 CONFIRMED EXCLUSION:** Full receptionist inbox, automatic SMS fallback, queue-turn progress or called-number WhatsApp messages not in Phase 1.
- **WAP-016 P0 PROPOSED ENGINEERING:** Template category/charge measured from provider receipts, outbox with idempotency key, webhook HMAC/signature verification, at-least-once handling, rate limits and masked delivery logs.
- **WAP-017 OPEN:** Official provider/payment arrangement feasibility, template languages/category approvals, exact included allowance/prices and outgoing message expiry/retry policy.

**Acceptance:** Spending limit is enforced under concurrency (atomic reservations/reconciliation); insufficient budget cannot charge or send beyond capped balance. Failed messages are not displayed as delivered. Recipient consent checked at sending time, not merely scheduling time. Webhook replay does not duplicate appointment actions.

### 3.7 Staff and audit (STA)
- **STA-001 P0 CONFIRMED:** Predefined `owner`,`manager`,`receptionist`,`cashier`,`doctor` roles with owner-adjusted permissions subject to non-overrideable medical/privacy boundaries.
- **STA-002 P0 CONFIRMED:** Clinic owner invitation; employee completes own secure registration.
- **STA-003 P0 CONFIRMED:** Separate temporary `suspended` and permanent `deactivated` clinic membership states; revoke active sessions/access and preserve activity history.
- **STA-004 P0 CONFIRMED:** One employee can join multiple clinics by independent invitations, roles and permissions; in-app workspace switcher without logout.
- **STA-005 P0 CONFIRMED:** Owner may authorize manager to invite/suspend/deactivate staff; role assignment/permission modification owner only; owner account protected from self-lockout or subordinate revocation.
- **STA-006 P0 CONFIRMED:** Authorized receptionists can manage all doctors' appointment operations in their clinic; cannot read protected consultation content.
- **STA-007 P0 CONFIRMED:** Comprehensive immutable audit events across operational, financial, administrative and sensitive-record access. Do not include medical contents in access logs.
- **STA-008 P0 CONFIRMED:** General employee time attendance and work-shift planning excluded; cashier financial sessions remain.

### 3.8 SaaS plans, billing and trials (SUB)
- **SUB-001 P0 CONFIRMED:** Multiple subscription tiers with plan doctor caps and paid doctor capacity upgrades; configurable plan feature and WhatsApp allowances.
- **SUB-002 P0 CONFIRMED:** Additional doctors can register as inactive pending accounts; cannot activate while capacity unavailable.
- **SUB-003 P0 CONFIRMED:** 14-day core-feature trial after admin clinic activation; platform administrator can authorize extension.
- **SUB-004 P0 CONFIRMED:** Platform-configured trial/subscription expiry grace and allowed restricted operations; never automatically erase medical or financial archives.
- **SUB-005 P0 CONFIRMED:** Monthly and annual subscription periods, optional annual discount.
- **SUB-006 P0 CONFIRMED:** Integrated online payment and manual InstaPay/bank transfer with evidence, admin verification for manual transactions.
- **SUB-007 P1 CONFIRMED:** Optional auto-renewal when supported/consented by payment provider; otherwise manual renewal.
- **SUB-008 P0 CONFIRMED:** Upgrade/downgrade takes effect **only at next renewal**, including doctor capacity; not immediate.
- **SUB-009 P1 CONFIRMED:** Subscription payment history and downloadable receipts; formal invoices and more complex billing deferred except legally mandatory tax invoicing.
- **SUB-010 P0 CONFIRMED:** Platform admin configures plans, features, prices, doctor caps, discounts and WhatsApp allowances with versioning. Preserve paid plan terms until renewal or authorized migration.
- **SUB-011 OPEN:** Exact tier matrix, actual EGP prices, overage tariff, payment gateway, tax invoice legality, plan change notice, automatic-renewal cancellation policy.

**Acceptance:** Manual bank transfer evidence never creates a paid entitlement before approval. Payment webhook retries do not double-credit. Upgrade requests do not increase doctor capacity before next renewal. Existing paid period plan snapshot remains stable when global catalog prices change.

### 3.9 Platform administration and support (ADM)
- **ADM-001 P0 CONFIRMED:** Admin dashboard for pending licenses, clinic approvals/rejections, account status, license updates/re-verification, account suspension/reactivation/controlled closure and audit reasons.
- **ADM-002 P0 CONFIRMED:** Manage trial extensions, manual SaaS payment approvals, pricing/plan versions, relevant billing exceptions.
- **ADM-003 P0 CONFIRMED:** Admin cannot read clinic medical records or clinic finance by default; platform metrics must use safe aggregated/operational data as authorized.
- **ADM-004 OPEN Q97:** Support workspace impersonation/temporary access was **not decided**. Do not build privileged support impersonation unless explicitly authorized by product owner and privacy/legal review.
- **ADM-005 OPEN:** Platform admin operational roles, reviewer delegation, incident escalation, exact closure sequence.

## 4. Proposed screens and navigation (PROPOSED ENGINEERING)
These derive from agreed features; presentation design remains flexible.
- Public: landing/pricing, registration, login/invitation accept, online booking request, secure patient approval/consent interactions.
- Clinic onboarding: company profile, license uploads, verification status, doctor setup, activation/trial status.
- Clinic shell: active clinic switcher, clinic overview, doctors, schedule, appointments list/calendar, request inbox, check-in queue, patient registry, doctor consultation, financial dashboard, cashier shifts, accounts/expenses/transfers/refunds, reports, WhatsApp dashboard, employees/permissions, subscription and settings.
- Doctor: own session schedule, patient queue, assigned consultation draft/completion, configured medical template, authorized external record view.
- Platform admin: pending clinic verification, license review, status/closure, trials, subscriptions, plan version management, manual payment approval, support diagnostics read-only (workspace support access OPEN).

## 5. Security, privacy and compliance (non-negotiable design gates)
- Authenticate human users; session tokens short-lived and revocable; MFA for platform admins/clinic owners strongly recommended (PROPOSED ENGINEERING).
- Postgres Row Level Security and narrow grants on all exposed tenant tables; explicit allow/deny tests per role. Backend must also authorize domain operations, not rely only on hidden UI.
- Store secrets only server-side (payment secret, service credentials, Meta tokens, encryption material). Never commit credentials to repository.
- Clinic medical and finance should reside in separate protected schemas and service boundaries where feasible; medical content never included in email, WhatsApp template, support traces or analytics.
- Signed/private storage and auditable short-lived views for licensing, evidence and clinical attachments. Encryption in transit and at rest; evaluate application-level encryption for sensitive clinical payloads.
- Consent records have scope, method, version, timestamps, actor/evidence and revocation; deny external access immediately after scope termination.
- Background jobs should be replay-safe and have poison queues/dead-letter handling; distinguish sent/accepted/delivered/read/failed status.
- Financial records and core audit events append-only, protect against privileged accidental mutation. Backups need restore drills and separately backed-up stored files.
- Apply least privilege, injection/XSS/CSRF defenses, secure document upload scanning, rate limits, abuse protection on public booking and OTP, database indexes and query limits.
- **Legal/regulatory gates before production:** Egyptian personal data protection law and health data; healthcare licensing and medical-record retention; clinician verification and patient consents; Egyptian Tax Authority invoices/e-receipts obligations; Meta WhatsApp policies and approvals; data hosting/cross-border transfer restrictions and contracts. Obtain Egyptian legal/accounting review; this SRS does not assert specific compliance period or license status.

## 6. Non-functional requirements (PROPOSED ENGINEERING targets, validate during load testing)
- Responsive web for desktop/tablet/mobile, Arabic RTL and English LTR; WCAG 2.2 AA-oriented accessibility.
- p95 typical authenticated page/navigation under 2.5 seconds and p95 standard read API under 500 ms at agreed load; adjust after baselines and internet/device tests in Egypt.
- Transactional correctness more important than speed for finance/booking; strong server-side validation and concurrency control.
- Target 99.9% service availability excluding maintenance (business target subject to paid provider plans and SLA).
- Automated nightly backups or provider backups plus continuous/pitr where suitable; encrypted independent storage object backups; quarterly restore test recommended.
- Tenant-aware tracing, structured redacted logs, error monitoring, alerts for failed sends/payments, explicit audit for privileged operations.
- Use Egyptian time zone `Africa/Cairo`, store event timestamps in UTC with offset/display conversion; all appointment/session calculations explicit to avoid DST errors.
- Test across Chromium, Safari, Firefox and representative iOS/Android browsers.

## 7. Open business decisions and integration dependencies (DO NOT AUTOFILL)
1. Q97 privileged technical support workspace access model remains undecided; default deny.
2. Exact Egyptian ID documents/types, patient identity verification and legal consent templates.
3. Doctor medical template field catalog, attachments, lawful exceptions, sensitive record retention/export specifics.
4. Exact rules/timeouts: late arrivals/no-show, queue hybrid priority, appointment proposal expiry and patient notifications.
5. Plan tier/prices, included doctor counts, WhatsApp message allowance, overage unit costs, trial grace operations and provider expense pass-through.
6. Egyptian gateway selection and recurring-payments certification; exact VAT/e-invoicing strategy.
7. Meta solution-provider policy and clinic-owned/platform-managed number onboarding and billing feasibility.
8. Design for legally authorized custodian export, retention periods and data sovereignty/hosting approval.
9. Whether platform has owner-level emergency-access or break-glass clinical exception: **not authorized**, do not implement by assumption.

## 8. Delivery acceptance: must-pass adversarial test scenarios
1. Receptionist at Clinic A cannot read Clinic B financials or any protected clinical note via UI/API/SQL policy, even with guessed UUID.
2. Doctor with memberships in A and B cannot read A patient consult from B unless patient explicitly authorizes that B visit and doctor, and access ends on completion.
3. Two concurrent online acceptances for last timed slot/queue capacity yield no unintended overbooking.
4. Clinic owner suspends employee; old session can no longer perform protected writes/reads.
5. Completed consultation cannot be edited by doctor/admin; linked correction remains readable, original unchanged.
6. Refund/reversal links preserve original and all balances/report totals remain consistent.
7. Cashier handover needs recipient acknowledgement and preserves immutable counted/discrepancy values.
8. Meta webhook repeated/out-of-order never duplicates accepted response processing, message billing, reminders or appointment confirmation.
9. Clinic overage messages stop at spend cap even under multiple concurrent workers; alerts at threshold fire once per crossing.
10. WhatsApp patient opt-out recorded after scheduling but before dispatch stops the send.
11. Trial countdown begins after admin activation, not before; plan changes do not apply early.
12. Payment webhook replay cannot activate duplicate entitlement or invoices. Manual payment upload without approval never activates subscription.
13. Deleted/archived or exited clinic retains mandatory record archive; authorized export remains controlled and audited.
14. Admin troubleshooting tools cannot expose private medical content or finance data by default.

## 9. Acceptance artifacts required from Claude Code
- Traceability table requirements -> components/APIs/DB tables/tests.
- Versioned SQL migrations and reproducible seed fixtures (synthetic patients only).
- OpenAPI/Zod schemas or equivalent checked API contracts.
- RLS policy suite with explicit denied-access tests, API authorization tests.
- Appointment concurrency tests; medical access/revocation tests; finance accounting invariant tests; messaging replay/idempotency tests.
- Architecture decision records, deploy runbook, rollback/backups/restore plan, environment template with no secrets, CI pipeline.
- Separate admin, clinic and limited public browser paths; responsive/RTL testing and accessibility.

## 10. Provenance
Requirements represent product discovery choices Q1–Q96 made by the product owner in the preceding conversation. Q97 was presented but was not decided; not part of confirmed scope. Engineering recommendations in this file are not disguised as confirmed user decisions.
