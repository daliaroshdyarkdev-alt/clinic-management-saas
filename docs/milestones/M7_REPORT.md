# Milestone 7 — Hardening and Phase 1 close-out

**Scope:** security hardening, operability and release readiness for the Phase 1 build. This milestone adds no product features.

**Built:**
- **Content Security Policy:**
  - Per-request nonce CSP with `strict-dynamic`, set in `proxy.ts` via `lib/security/csp.ts`.
  - `frame-ancestors 'none'`, `object-src 'none'` and `form-action 'self'`.
  - HSTS in production, on top of the existing security headers.
  - Every page now renders per request so Next.js can apply the nonce (consistent with ADR 0002).
- **Rate limiting:**
  - Database-backed limits shared by all instances (`20261103100000_rate_limits.sql`). Only salted SHA-256 hashes of client addresses are stored.
  - Applied to public booking requests (10/h), offer views (60/h), offer responses (20/h), sign-in (10/15 min) and sign-up (5/h).
  - The check fails open with an error log if the limiter itself fails.
- **Error pages:**
  - Localized route error boundary that shows no error details, only the digest reference.
  - Localized not-found page for unknown paths, and a bilingual global error page.
- **Accessibility:**
  - axe-core WCAG 2.1 A/AA checks on all public pages in Arabic and English.
  - Fixed links inside text that were distinguishable by colour only.
- **Authenticated Playwright journeys** (`tests/e2e-auth`, `playwright.auth.config.ts`), run in a new CI job `e2e-authenticated` against `supabase start` with the synthetic seed:
  - role access for owner, receptionist, suspended employee and platform admin;
  - a forged active-clinic cookie (INV-2);
  - clinic switching (INV-3);
  - Arabic RTL when signed in.
- **Deployment:**
  - `Dockerfile` (web) and `Dockerfile.worker` (worker), both running as a non-root user with no secrets in the image, plus `.dockerignore`.
  - Runbooks: `docs/runbooks/deploy.md`, `backup-restore.md`, `incident-response.md` and `go-live-checklist.md`.

**Results here:**
- typecheck, lint, format and build pass;
- unit **68**, DB **223**, e2e smoke/hardening **60** (30 tests × desktop + mobile).

**Evidence:**
- **CSP:**
  - The CSP header is present on pages.
  - Every `<script>` carries the request's nonce.
  - The nonce differs between requests.
- **Rate limits:**
  - 6 concurrent hits against a limit of 3 allow exactly 3.
  - Raw addresses are rejected.
  - The limiter is service-role only.

**Not verified in this sandbox:**
- **Authenticated journeys:** they compile and list 14 tests, but this sandbox cannot run the Supabase Docker stack. They run only in CI. Treat them as unverified until the first green `e2e-authenticated` run.
- **Docker images:** not built here, because container registries are unreachable.

---

## Phase 1 summary (M0–M7)

| Milestone | Delivered |
|---|---|
| M0 | Stack, tenancy foundation, RLS harness, redacting logger, CI |
| M1 | Onboarding, licences, platform review/activation, staff, invitations, permissions |
| M2 | Doctors, schedules, sessions, timed/queue booking with race-safe numbering, walk-ins, queues, online requests and alternatives |
| M3 | Patient registry and duplicate review, doctor-only consultations, corrections, per-visit cross-clinic consent |
| M4 | Double-entry clinic finance, cashier sessions, approvals, reversals/refunds, handovers, daily close, reports/export |
| M5 | WhatsApp outbox, consent, budget, webhooks, worker, Meta adapter (mock by default) |
| M6 | Versioned plans, paid periods, gateway (mock) and manual payments, receipts, trials, capacity, grace/restricted mode, licence re-verification |
| M7 | CSP, rate limits, error pages, accessibility checks, authenticated CI journeys, Docker, runbooks |

## Unresolved risks and blockers

**This build is not production-ready.** See `docs/runbooks/go-live-checklist.md`.

1. **Legal:**
   - hosting location and cross-border transfer (OD-L02);
   - disclaimer (OD-L01);
   - consent texts (OD-L05);
   - retention (OD-L03);
   - tax e-invoicing (OD-L04);
   - upload malware scanning (OD-L06).
2. **Providers:**
   - Meta WhatsApp onboarding (OD-P01);
   - payment gateway and auto-renewal (OD-P02).
3. **Commercial terms:**
   - tiers and prices (OD-B05);
   - messaging terms (OD-B20);
   - grace length and restricted-mode scope (OD-B21).
4. **Verification gaps:**
   - Signed-in browser flows have so far been verified only through server-side DB tests here; the authenticated suite still needs its first CI run.
   - No load test, penetration test or signed-in accessibility review yet.
   - The worker has not run against a live Supabase stack.
5. **Deliberately not built:**
   - support impersonation (Q97 / OD-S01);
   - break-glass clinical access (OD-S02);
   - deferred Phase 2 features.
