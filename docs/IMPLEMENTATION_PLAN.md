# Claude Code Delivery Plan — incremental, testable, no one-shot platform generation

## Milestone 0 — Discovery-to-build safeguards
- Read SRS/architecture/data blueprint. Produce `docs/TRACEABILITY.md` for each requirement ID and `docs/OPEN_DECISIONS.md` with blockers (Q97 support access specifically OPEN).
- Initialize Next.js TypeScript strict, formatting, tests, CI, staging config, local Supabase, seed synthetic clinics/doctors/patients.
- Implement app shell with Arabic RTL/English layout, protected routes, clinic switcher and role-aware navigation.
**Gate:** one command starts app+local services and builds/test pass; no real secrets in repository.

## Milestone 1 — Identity, tenancy and clinic onboarding
- Auth, clinic membership, invitation acceptance, permission model, owner-only role grants, suspend/deactivate, multi-clinic switch with explicit cache isolation.
- Clinic registration, private license uploads, admin approve/reject, trial activation after approval.
- RLS and denial tests for every table, including forged tenant IDs and inactive memberships.
**Gate:** adversarial test suite shows no cross-clinic access, no suspended-user access.

## Milestone 2 — Doctor schedules, requests and queues
- Per-doctor schedule recurrence and exceptions; timed/queue booking policies; public request intake, receptionist approve/reject/alternative; no-hold proposals with acceptance recheck.
- Check-in and distinct numbers, configurable queue state transitions, no-show and overbooking approvals.
- Concurrency tests on last slot/session place and sequence allocation.
**Gate:** booking invariant tests pass under parallel requests; no unintended overbooking.

## Milestone 3 — Patient identity, consultation and consent
- Patient demographic registration and duplicate candidate queue, no auto-merge.
- Doctor-configured template versions, consultation draft/lock/correction, treating-doctor authorization and access logs.
- Per-visit consent and external records view, immediate revocation tests.
**Gate:** non-treating doctor/owner/admin denied protected records; finished visit read access revoked; no medical content in logs.

## Milestone 4 — Clinic finance
- Financial accounts, opening balance approval, posted journal, payments/expenses/transfers/refunds, cashiers and acknowledged handovers, closing policies.
- Clinic owner granular finance rights and operational reports; receipts and export.
- Race tests, immutable postings/reversal and accounting reconciliation tests.
**Gate:** no write destroys posted financial event; reported balances reconcile with journal entries.

## Milestone 5 — WhatsApp workflows
- Provider abstraction, clinic connection management, approved templates and languages, consent/withdrawal, scheduled reminders, manual sending and interactive replies.
- Replay-safe status callbacks, retries, connection recovery, spend allowance and atomic overage ceilings, threshold alerts, full filtered message log.
- Keep SMS fallback and full shared inbox out of scope.
**Gate:** duplicated webhooks cannot duplicate messaging expense or booking changes; consent/budget checked before send.

## Milestone 6 — SaaS billing / platform operations
- Plans and version snapshots, 14-day trial, optional admin extension, paid doctor capacity, future-effective plan changes, grace/restriction policies.
- Online gateway adapter plus manual transfer verification, billing history/receipts, optional recurring if provider qualifies.
- License re-verification and clinic lifecycle/safe archival.
**Gate:** unpaid or unverified subscription cannot grant entitlements; duplicate webhooks do not credit twice; archived data persists.

## Milestone 7 — Hardening and launch readiness
- End-to-end Arabic/English flows, accessibility, mobile performance, security penetration review, rate limiting, backup/restore rehearsal, monitoring/alerts, privacy review.
- Verify Egyptian regulatory requirements and selected provider contracts; publish privacy policy, lawful data processing consents, tax billing processes.
- Go/no-go checklist with known open decisions and incident/runbook readiness.

## Working agreement with Claude Code
Finish each milestone with a working app, migration, tests, and an evidence report. Do not start the next milestone if a P0 authorization/integrity invariant fails. Prioritize secure, useful vertical slices over a visually complete but unsafe mock platform.
