# Open Decisions Register

Rules (from `CLAUDE.md`): items labelled OPEN are **not** turned into product policy by assumption. Sensitive features **default to deny** until a decision is recorded here with owner and date.

**Blocking** = the named milestone cannot start or finish that feature until the decision is made. **Non-blocking** = a safe default lets work continue, and the default can be reversed.

Status values: `OPEN`, `DECIDED (date, by)`, `DEFERRED`.

## A. Needed before Milestone 1 (identity, tenancy, onboarding)

| ID | Decision needed | Source | Blocking? | Safe default until decided | Status |
|---|---|---|---|---|---|
| OD-02 | Can one clinic membership hold several roles (e.g. `owner` + `doctor`)? Does an owner-doctor count toward paid doctor capacity? | Review R2; STA-001, ONB-008, SUB-002 | **Blocking M1 schema** | Schema supports many roles per membership. Medical access comes only from the `doctor` role. Capacity counting is not implemented before M6. | OPEN |
| OD-03 | Sign-in identifier: email + password, phone + OTP, or both? If OTP, which SMS/OTP provider? | Review R3; STA-002 | **Blocking M1 auth** | M0 login is a placeholder (email + password) and is not connected to production. | OPEN |
| OD-04 | Confirm that *no* role other than the assigned treating doctor can ever be granted medical-content access (the "by default" wording for receptionists). | Review R4; §2, STA-001, MED-005 | Non-blocking | Never grantable (enforced in `modules/permissions`). | OPEN (confirm) |
| OD-05 | Must every additional doctor upload a professional licence and pass admin verification before activation? | Review R5; ONB-002, ONB-008 | Blocking M1 doctor onboarding | Additional doctors remain inactive. | OPEN |
| OD-06 | Approve the clinic lifecycle states `pending_verification`, `documents_requested`, `rejected`, `active`, `suspended`, `closed` (archived). | Review R6; ONB-003, ONB-005 | Non-blocking (engineering proposal) | Use the proposed states; reversible before production. | OPEN (confirm) |
| OD-08 | How platform admins are provisioned, whether MFA is required for admins and owners, and admin sub-roles. | Review R8; ADM-005, §5 | Blocking M1 admin access | No self-registration; provisioning only server-side/CLI. MFA proposed. | OPEN |
| OD-21 | Default capability set for each predefined role (owner can adjust per clinic). The M0 navigation uses *proposed* defaults for display only. | STA-001, FIN-010, WAP-014 | Blocking M1 role templates | Least privilege. Finance, WhatsApp budget and staff administration are owner-only unless granted. | OPEN |
| OD-22 | Legal disclaimer text and where it appears (registration, footer, consent screens). | ONB-007 | Blocking production; non-blocking dev | Placeholder text, clearly marked "pending legal review". | OPEN |

## B. Later milestones

| ID | Decision needed | Source | Blocking milestone | Safe default | Status |
|---|---|---|---|---|---|
| OD-01 | Doctor access after consultation completion: own completed records? Same patient's earlier visits with other doctors in the same clinic? | Review R1; invariant 4, MED-004, MED-009 | **M3** | Deny, except the append-only correction path. | OPEN |
| OD-07 | Business handling of sessions/appointments that cross a DST transition. | Review R7; APT-017 | M2 | Store UTC, compute in `Africa/Cairo`, flag affected sessions for receptionist review. | OPEN |
| OD-09 | Which "core features" are included in the 14-day trial (e.g. WhatsApp sends, doctor count). | Review R9; SUB-003 | M6 | No entitlement beyond what is explicitly approved. | OPEN |
| OD-10 | **Q97:** support workspace impersonation / temporary access. | ADM-004, §7.1 | Any support tooling | **Not built. Default deny.** | OPEN |
| OD-11 | Egyptian patient ID document types, validation and verification rules. | PAT-001, PAT-006, §7.2 | M3 | ID stored as optional typed text, masked; no validation claims. | OPEN |
| OD-12 | Medical template field catalog, attachments, lawful emergency access, retention, data-subject rights, custodian process. | MED-011, §7.3 | M3 | No attachments; no emergency access. | OPEN |
| OD-13 | Queue thresholds, hybrid ordering formula, late/no-show timeouts, offer expiry, public booking anti-abuse limits. | APT-017, §7.4 | M2 | Receptionist-controlled options only; offers do not expire automatically until defined. | OPEN |
| OD-14 | Meta WhatsApp provider arrangement, template approvals/languages, allowance, prices, retry/expiry policy, clinic-owned vs platform-managed number onboarding. | WAP-001, WAP-017, §7.7 | M5 | Mock provider only; no real sends. | OPEN |
| OD-15 | Plan tiers, EGP prices, overage tariff, payment gateway, tax invoices, plan-change notice, auto-renew cancellation. | SUB-011, §7.5–7.6 | M6 | Mock gateway only; no real charges. | OPEN |
| OD-16 | Partial refunds, tax treatment, settlement status taxonomy (accountant validation). | FIN-016 | M4 | Full-amount refund only after approval. | OPEN |
| OD-17 | Legal retention periods for financial, medical and audit data; archive/export format. | FIN-014, MED-011, §7.8 | M4 / M6 | Never delete; archive only. | OPEN |
| OD-18 | Break-glass / emergency clinical access for platform or owner. | §7.9 | Any | **Not authorized. Not built.** | OPEN |
| OD-19 | Hosting region / data residency / cross-border transfer approval (Supabase region choice). | §5, §7.8 | **Production and staging with real data** | Local/synthetic data only. | OPEN |
| OD-20 | Job worker queue technology (`pg-boss` vs Supabase Queues/pgmq vs managed workflow), validated by a proof of concept. | Architecture caution | M5 (reminders) | None built. | OPEN |
| OD-23 | Cross-clinic consent method details: OTP provider, secure link lifetime, in-person ID verification evidence. | MED-006 | M3 | No cross-clinic access. | OPEN |
| OD-24 | Duplicate-patient detection thresholds and which fields are weighted. | PAT-002 | M3 | Flag on exact phone + DOB match only; never merge. | OPEN |

## C. Pre-production gates (never self-certified)

Egyptian personal-data and health-data law review; medical-record retention; Egyptian Tax Authority e-receipt/e-invoice obligations; Meta business verification and template approval; payment-provider contract; hosting/data-transfer contracts; penetration test; backup/restore drill. The system must not be declared production-ready until these are signed off (`CLAUDE.md` workflow step 6).
