# Milestone 6 — Evidence Report

**Scope:**
- SaaS subscriptions and platform billing: SUB-001..006, SUB-008..010.
- Admin billing operations: ADM-001/002.
- Licence re-verification: ONB-006.
- Acceptance scenarios 11, 12 and 13.
- Blocked: SUB-007 (OD-P02) and SUB-011 (OD-B05, OD-P02, OD-L04).

**Built:**
- Migration `20261102100000_billing.sql`:
  - Versioned plans whose published versions are immutable. Each paid period keeps a snapshot of its terms: doctor limit, extra slots, WhatsApp allowance and overage price.
  - Server-computed prices.
  - Gateway payments with idempotent webhooks, checked per event, per payment and by amount.
  - Manual InstaPay/bank evidence in a private bucket. Admin verification is audited, including evidence access.
  - One period and one receipt per payment.
  - Renewal-only plan and capacity changes: a period starts after the trial or the last period, and periods never overlap (exclusion constraint).
  - Trial extensions kept as append-only history.
  - Doctor capacity: extra doctors are added inactive, and activation is serialised.
  - Grace, then restricted mode. Restricted mode blocks new appointments and requests (triggers), WhatsApp claims and doctor activation, and never deletes anything.
  - Messaging terms now come from the paid period.
  - Re-verification requests for active clinics. The approved licence stays valid until a newer revision is approved.
- `lib/billing`: payment provider interface and mock provider with HMAC callbacks.
- `app/api/webhooks/payments`.
- Owner `/app/subscription`: status, plans, online or manual payment, history and receipts.
- Printable receipt page, and a development-only mock checkout.
- Admin pages:
  - `/admin/billing`: pending verifications, plans and versions, grace and trial settings.
  - Clinic detail: trial extension and re-verification.
- Expiry banner in the app shell.
- Seeded synthetic demo plan.

**Results:** typecheck, lint, format and build pass · unit **66** · DB **221** (22 new) · e2e **40**.

**Evidence:**
- **Scenario 12:**
  - A replayed event returns `duplicate`.
  - A different event for a paid payment returns `already_paid`.
  - Five concurrent deliveries apply exactly once.
  - A wrong amount, a failure or an unknown reference grants nothing.
  - Manual evidence leaves a restricted clinic restricted until an admin approves; a second approval is refused; rejection needs a reason.
- **Scenario 11:**
  - Paying during the trial starts the period exactly at the trial end.
  - An upgrade paid mid-period leaves the current plan and capacity unchanged until the next period starts.
  - Parallel renewals give back-to-back periods.
- **Scenario 13:**
  - Closing a clinic keeps patients and finance.
  - The owner's export still works and is audited.
  - Reception and platform admins cannot export.
- **SUB-002:** two concurrent activations cannot both take the last slot.
- **ADM-003:** staff never see SaaS payments, and admins cannot read the evidence path column.
- **Mutation tests:**
  - Removing the capacity lock fails the race test.
  - Removing the paid-state guards fails 3 webhook tests.

**Gaps / blocked:**
- No real gateway or auto-renewal (OD-P02).
- Tiers and prices are platform data with no real values (OD-B05).
- Receipts are not tax invoices (OD-L04).
- Restricted-mode scope and grace length are provisional (OD-B21).
- Signed-in browser tests are still pending.
