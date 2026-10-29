# Open Decisions and Blockers

Decisions that engineering **must not invent**. Each item states what it blocks and the safe default the code uses until the decision is made.

**Blocking levels**
- **Blocks production**: development continues with the safe default; production launch with real patients/payments is blocked.
- **Blocks feature**: the specific behaviour is not built (or ships in its safest mode only) until decided.
- **Non-blocking**: engineering choice, recorded for review; can be changed later without data loss.

Owner column: **PO** = product owner, **Legal** = Egyptian legal counsel, **Acct** = accountant/tax adviser, **Eng** = engineering.

## Security and access

| ID | Decision | SRS ref | Blocks | Safe default in code | Owner |
|---|---|---|---|---|---|
| OD-S01 | **Q97 — privileged technical-support access / impersonation** into clinic workspaces | ADM-004 | Feature | **Not built.** Platform admins have no RLS path into clinic tables; a test asserts no such path exists. Support works from redacted operational metadata only. | PO + Legal |
| OD-S02 | Emergency / break-glass clinical access (owner or platform) | MED-011, SRS §7.9 | Feature | Not built. Only the assigned treating doctor reads medical content. | PO + Legal |
| OD-S03 | MFA requirement for platform admins and clinic owners | SRS §5 (recommended) | Production | MFA support wired in M1 when Supabase Auth config allows; enforcement policy awaits PO. | PO + Eng |

## Legal and compliance

| ID | Decision | SRS ref | Blocks | Safe default in code | Owner |
|---|---|---|---|---|---|
| OD-L01 | Legal disclaimer text (Arabic + English) | ONB-007 | Production | Placeholder text clearly marked "DRAFT — pending legal review"; acceptance recorded with version. | Legal |
| OD-L02 | **Data hosting location and cross-border transfer** under Law 151/2020 and its executive regulations (issued Nov 2025; enforcement expected from ~1 Nov 2026). Health data is a special category; controller/processor licences from the PDPC may be required. Supabase cloud currently has no Egypt/Middle-East region. | SRS §5 | Production (any real patient data) | Synthetic data only. Architecture kept portable: plain SQL migrations, RLS in Postgres, containerised Next.js + worker, no vendor-only runtime in core logic, so self-hosted Supabase/Postgres in Egypt remains possible. | Legal + PO |
| OD-L03 | Medical and financial record retention periods; legally authorised custodian export on clinic exit | MED-009, MED-011, FIN-014 | Feature (export/erasure) | Never delete medical/financial records automatically; archive only. | Legal |
| OD-L04 | Egyptian Tax Authority e-invoice / e-receipt obligations for (a) clinic patient receipts, (b) platform SaaS billing to clinics | FIN-011, SUB-009, SUB-011 | Production billing | Receipts labelled as internal records, not tax documents. | Acct + Legal |
| OD-L06 | Malware scanning of uploaded documents (SRS §5 "secure document upload scanning") — needs a scanning service and data-processing approval | ONB-002 | Production | Files are identified by content (magic bytes: PDF/JPEG/PNG only), size-capped at 10 MB, stored privately, never served inline from the app origin (60-second signed Storage URLs). No antivirus scan yet. | Eng + Legal |
| OD-L05 | Patient consent wording (WhatsApp messaging consent, cross-clinic record consent), privacy policy | WAP-008, MED-006 | Production | Consent records store version + method; texts are drafts. | Legal |

## Business rules

| ID | Decision | SRS ref | Blocks | Safe default in code | Owner |
|---|---|---|---|---|---|
| OD-B01 | Exact clinic account-state transitions and closure sequence | ONB-005, ADM-005 | Feature (closure) | Pending→active, active↔suspended implemented; closure archives without deletion. | PO |
| OD-B02 | Patient ID document types, validation, demographic correction/merge workflow | PAT-001, PAT-006 | Feature | ID stored as optional typed free text; no merge ever. | PO + Legal |
| OD-B03 | Medical template field catalog, attachment support, lawful exceptions | MED-001, MED-011 | Feature | Generic field types (text, number, date, select); no attachments. | PO + clinical advisor |
| OD-B04 | Thresholds: late arrival, auto no-show, hybrid queue formula, offer expiry, public-booking anti-abuse limits | APT-007/008/014/017 | Feature (automatic modes) | Only manual/receptionist-controlled modes and FCFS/priority ordering; offers have no auto-expiry. | PO |
| OD-B05 | Plan tier matrix, EGP prices, doctor caps, WhatsApp allowance and overage tariff, grace-period permitted operations, auto-renew cancellation policy | SUB-001/004/011, WAP-013 | Production billing | Plans are admin-configurable data; seed uses obviously fake prices. Grace = read-only. | PO |
| OD-B06 | Partial refunds, tax treatment, settlement status taxonomy | FIN-016 | Feature | Full refunds only, linked payout. | Acct |
| OD-B08 | May managers invite or suspend other managers? | STA-005 | Non-blocking | No: managers with `staff.manage` handle receptionists, cashiers and doctors only; managers are invited and managed by the owner. | PO |
| OD-B09 | Can a permanently deactivated employee ever rejoin the same clinic? | STA-003 | Non-blocking | No: re-invitation is refused (`membership_deactivated`). | PO |
| OD-B10 | Clinic ownership transfer | STA-005 | Feature | Not built; the owner role cannot be assigned or removed. | PO + Legal |
| OD-B11 | Delivery channel for staff invitations (email provider, WhatsApp) | STA-002 | Non-blocking | The invitation link is shown once to the inviter to send personally. | PO |
| OD-B12 | Should online booking requests be on by default for new clinics? | APT-001 | Non-blocking | Off until the owner turns it on. | PO |
| OD-B13 | Minimal patient registry delivered with Milestone 2 (needed for booking) before duplicate detection (M3) | PAT-001/002 | Non-blocking | Every registration creates its own identity; nothing is linked or merged automatically. | PO |
| OD-B14 | May doctors of the same clinic see each other's consultations for a shared patient? | MED-005 | Feature | No: each doctor sees only the visits assigned to them. | PO + clinical advisor |
| OD-B15 | Matching rule for a patient's records in other clinics (after consent) | PAT-004, MED-006 | Production | Same mobile and birth date, plus same ID when both records have one; the treated patient must match too. | PO + Legal |
| OD-B16 | Default finance approval rules before the owner saves any | FIN-005..008, FIN-012 | Non-blocking | Most restrictive: every expense/transfer/refund needs approval, discrepancies need approval, daily close needs approval. | PO |
| OD-B17 | Should discrepancies post an adjusting entry to the ledger? | FIN-005 | Feature | No: counts and differences are recorded on the session only (needs accountant input). | Acct |
| OD-B07 | Platform admin sub-roles, reviewer delegation, incident escalation | ADM-005 | Non-blocking | Single `platform_admin` role. | PO |

## Providers

| ID | Decision | SRS ref | Blocks | Safe default in code | Owner |
|---|---|---|---|---|---|
| OD-P01 | Meta WhatsApp: Tech Provider vs BSP, clinic-owned vs platform-managed numbers, template approvals, billing pass-through | WAP-001, WAP-017 | Production messaging | `MessagingProvider` interface + mock adapter. No real sends. | PO + Eng |
| OD-P02 | Payment gateway (Paymob / Fawry / other), recurring-billing certification | SUB-006/007 | Production billing | `PaymentProvider` interface + mock adapter. | PO + Acct |

## Engineering (non-blocking, recorded for review)

| ID | Decision | Current choice | Notes |
|---|---|---|---|
| OD-E01 | Background job library and worker hosting | Proposed: pg-boss in an always-on Node worker over a direct (session-mode) Postgres connection | Validate with a PoC in M2 before first use; alternatives Supabase Queues (pgmq) or Inngest. No Redis/Kafka. |
| OD-E02 | Owner who is also a practising doctor | One membership row per (clinic, user) with one role; clinical capability comes from a separate `clinic_doctors` row (M2) | Matches blueprint (`clinic_doctors` distinct from membership). An owner-doctor still sees medical content only for their own assigned visits. |
| OD-E03 | Local DB test harness | Plain PostgreSQL 16 + `supabase/tests/shim/supabase_shim.sql` emulating Supabase roles, default privileges and `auth.uid()`/`auth.jwt()` | Chosen because the build sandbox cannot pull Supabase Docker images. Same migrations run unmodified on `supabase start`. Add a CI job against the real Supabase CLI stack when available. |
| OD-E04 | URL locale strategy | `/ar/...` (default) and `/en/...` via next-intl | Arabic-first; `dir` set from locale. |
| OD-E06 | Abuse guard on clinic self-registration | At most 3 pending clinics per owner account | Engineering default; revisit with OD-B04 anti-abuse limits. |
| OD-E07 | "Revoke active sessions" on suspension (STA-003) | Revocation is per clinic: every RLS policy and SQL function re-checks `membership.status = 'active'` on each request, so a suspended employee loses that clinic immediately while keeping access to other clinics they belong to | Global sign-out would wrongly cut access to other clinics; Supabase refresh tokens are not revoked. |
| OD-E08 | Invitation lifetime | 7 days, single-use, bound to the invited email, which must be confirmed | |
| OD-E09 | Abuse guard on public booking requests | At most 3 open requests per phone number per clinic | Captcha and per-IP rate limiting remain OPEN (OD-B04); add edge rate limiting before production. |
| OD-E10 | Session generation | Sessions are materialised on demand (staff screens, public page) for up to 62 days; schedule/policy changes regenerate future sessions without bookings | Revisit with the background worker (OD-E01). |
| OD-E05 | Hosting topology | Next.js standalone container + worker container in same region as DB | Depends on OD-L02. |
