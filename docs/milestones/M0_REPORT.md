# Milestone 0 — Evidence Report

**Date:** 2026-10-28 · **Branch:** `claude/great-bardeen-pbvaqb`

## What actually runs

- Next.js 16.4 app (TypeScript strict) with Arabic RTL (`/ar`, default) and English LTR (`/en`), IBM Plex Sans Arabic, responsive layout.
- Public landing and login pages; server-side validated sign-in through Supabase Auth; sign-out.
- Protected `/[locale]/app` area: the proxy redirects signed-out visitors to login, and the layout re-checks the session on the server.
- App shell: active-clinic switcher (re-verified through RLS, cookie is only a hint), role-aware navigation (unbuilt modules shown disabled with their milestone), clinic status notices for pending/suspended clinics, "no active clinic" state.
- Database foundation with RLS: `user_profiles`, `clinics`, `clinic_memberships`, append-only `audit_events`; helper functions in an unexposed `private` schema.
- Synthetic seed (7 personas across 3 clinics, including a multi-clinic doctor, a suspended employee and a pending clinic).
- Allow-list log redaction; Africa/Cairo time helpers (DST-aware).
- CI workflow: format, typecheck, lint, unit, DB, build, e2e, gitleaks.

## Commands and results (local, 2026-10-28)

| Command | Result |
|---|---|
| `pnpm format:check` | pass |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass, 0 warnings |
| `pnpm test` | 5 files, **27 passed** |
| `pnpm test:db` (PostgreSQL 16.15 + shim) | 4 files, **34 passed** |
| `pnpm build` | pass; `/[locale]/app` and `/[locale]/login` are dynamic, no tenant data prerendered |
| `CI=1 pnpm test:e2e` | **18 passed** (9 tests × desktop + mobile Chromium) |

Mutation check: removing the `status = 'active'` condition from the membership helper failed 2 DB tests; removing RLS from `clinics` failed 6. Both restored.

## Security tests in place (SRS references)

- Cross-tenant reads by guessed UUID / forged filter return nothing (§8 scenario 1, tenancy tables).
- Suspended and deactivated members see no clinic data with a still-valid session (§8 scenario 4, STA-003).
- Multi-clinic user sees each clinic only through its own active membership (STA-004).
- No client writes to clinics or memberships; no self-escalation; no self-unsuspend.
- `clinic_id` immutable; deactivation permanent; one active owner per clinic; activation time set once (ONB-004 groundwork).
- Audit events reject UPDATE/DELETE/TRUNCATE for every role including the table owner; clients cannot read, insert or call the write helper (STA-007).
- Guard rails for all future migrations: RLS enabled on every `public` table; `anon` holds no privileges; `authenticated` never holds DELETE/TRUNCATE; SECURITY DEFINER functions pin `search_path`.
- Open-redirect protection on `?next=`; security headers; log redaction.

## Not done / known gaps

1. **No authenticated end-to-end test yet.** Docker registries were rate-limited in the build sandbox, so the full `supabase start` stack (Auth, PostgREST) could not run here. Sign-in, the switcher and the shell were verified by typecheck, build and unit tests, not by a browser session against real Supabase. First task of M1: run `pnpm dev:all` + `pnpm db:reset` and add Playwright login/switcher/isolation tests.
2. **Seed and migrations untested on real Supabase** (verified on PostgreSQL 16 with the shim — ADR 0003).
3. shadcn/ui registry was unreachable from the sandbox; the four primitives used (button, input, label, card) were written in the standard shadcn form and `components.json` added so `shadcn add` works normally.
4. No generated DB types yet (`pnpm db:types` needs the local stack); query results are validated with Zod at the boundary meanwhile.
5. No Content-Security-Policy header yet (M7 hardening).
6. CI workflow has not run on GitHub yet; the gitleaks step was not executed locally.

## Open decisions affecting the next milestone

OD-S01 (Q97, no support access — default deny kept), OD-L01 (disclaimer text, placeholder only), OD-L02 (hosting — synthetic data only), OD-S03 (MFA policy).

## Next: Milestone 1

Clinic self-registration, private licence upload, platform-admin review/activation with trial start, invitations, owner-only permission editor, staff suspend/deactivate with session revocation, and authenticated e2e tests — per `docs/M0_M1_PLAN.md`.
