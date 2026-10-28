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
| OD-E05 | Hosting topology | Next.js standalone container + worker container in same region as DB | Depends on OD-L02. |
