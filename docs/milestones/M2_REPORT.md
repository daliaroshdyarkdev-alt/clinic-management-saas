# Milestone 2 — Evidence Report

**Date:** 2026-10-29 · **Branch:** `claude/great-bardeen-pbvaqb`
**Scope:** doctor schedules, booking requests and queues (`docs/IMPLEMENTATION_PLAN.md` Milestone 2).

## What was built

**Database** (3 migrations)
- `20261029090000_appointment_capability.sql`: owner-grantable `appointments.manage` for managers.
- `20261029100000_scheduling_and_appointments.sql`:
  - `clinic_doctors` (owner adds from doctor/owner memberships; owner-doctor supported), per-doctor `doctor_scheduling_policies` (timed/queue, slot length, overbooking, queue ordering, walk-ins, absent-when-called, patient cancellation), `doctor_weekly_schedules`, `doctor_schedule_exceptions` (day off / extra session), `doctor_sessions` generated in the clinic's time zone (DST-safe), never overlapping (GiST exclusion).
  - Minimal patient registry `patient_identities` + `clinic_patients` (chart numbers per clinic) — needed to book; duplicates/linking are Milestone 3 (OD-B13).
  - `appointments` + append-only `appointment_events`. Booking runs under a per-session row lock; timed appointments additionally protected by a GiST exclusion constraint; reservation and waiting numbers are separate unique sequences per session.
  - Functions: booking, overbooking decision, cancellation, check-in, walk-in, call next, complete, absent/return per policy, queue placement, manual no-show, session cancellation, availability.
- `20261029110000_booking_requests.sql`: `appointment_requests`, `alternative_offers` (hashed single-use tokens), reception approve / reject / propose; public functions executable by `service_role` only (ADR 0004).

**Application**
- `/app/doctors`, `/app/doctors/[id]`: add doctors, booking rules, weekly schedule editor, exceptions, online-request switch (owner).
- `/app/appointments` (any day, per doctor), `/app/queue` (today, front desk), `/app/my-queue` (doctor's own sessions).
- `/app/patients`: search and minimal registration.
- `/app/requests`: approve (by chart number), propose alternative (link shown once), reject.
- Public `/book/[clinicId]` (request, never a booking) and `/offer/[token]` (accept/decline; availability re-checked on acceptance).
- Navigation now driven by role, capability and doctor status; managers see front-desk screens only when granted.

## Commands and results (local)

| Command | Result |
|---|---|
| `pnpm format:check` | pass |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass, 0 warnings |
| `pnpm test` | 10 files, **47 passed** |
| `pnpm test:db` (PostgreSQL 16.15 + shim) | 12 files, **141 passed** (56 new) |
| `pnpm build` | pass; every authenticated and public-flow route dynamic |
| `CI=1 pnpm test:e2e` | **32 passed** (16 tests × desktop + mobile Chromium) |

**Concurrency (acceptance scenario 3)** — `tests/db/booking-race.test.ts`, separate connections committing in parallel:
- 8 bookings racing for the last queue place → exactly 1 succeeds, the rest get `session_full`; reservation numbers 1..3, no duplicates.
- 8 bookings of the same timed slot → exactly 1 succeeds.
- 8 parallel check-ins → waiting numbers 1..8, no gaps or duplicates.
- Two patients accepting alternatives for the last place → one `confirmed`, one `unavailable` with reception alerted.

**Mutation check:** removing the session row lock from `private.book` made 3 of the 4 race tests fail on every run; restored.

**Bug caught by the tests:** the `patient_identities` RLS policy referenced an unqualified `id` inside a subquery (resolved to `clinic_patients.id`), hiding identities from everyone. Fixed before commit.

## Adversarial coverage added (highlights)

- Reception cannot bypass a doctor's overbooking policy; approval-required overbookings can be decided only by that doctor or the owner.
- Patients of another clinic cannot be booked by forged id; staff of another clinic cannot see sessions, requests or generate sessions.
- Doctors see only their own appointments and those patients' demographics; cashiers and ungranted managers see none.
- Pending clinics cannot register patients or book (ONB-004).
- Public functions are not executable by `anon` or signed-in users; offer tokens are hashed and unreadable; a proposal holds no capacity.
- Static test: only the public booking module may use the service-role client, and only for `public_*` functions.

## Not done / known gaps

1. **Still no authenticated browser test** (same sandbox limits as M0/M1). Every rule is proven in SQL tests; the screens build and render but have not been clicked through against real Supabase. This gap now spans three milestones — recommended next step: add a CI job with `supabase start` and Playwright journeys.
2. Automatic late-arrival, automatic/suspected no-show, hybrid queue order and offer expiry are not built (thresholds OPEN, OD-B04); manual modes cover them.
3. Patient self-service cancellation (APT-013) needs patient links, which arrive with WhatsApp in Milestone 5; the policy is stored.
4. Public booking has a per-phone limit only; captcha and per-IP limits are OPEN (OD-B04, OD-E09).
5. Doctor capacity by subscription (ONB-008/SUB-002) is Milestone 6.
6. Patient search uses `ilike`; add trigram indexes when volumes grow.

## Decisions recorded

OD-B12 (online requests off by default), OD-B13 (minimal patient registry ahead of M3), OD-E09 (per-phone request limit), OD-E10 (on-demand session generation). ADR 0004 (public booking via service-role-only functions).
