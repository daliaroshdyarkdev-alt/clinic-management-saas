# Milestone 0 / 1 Implementation Plan

Scope: repository foundation (M0) and identity, tenancy and clinic onboarding (M1).
Requirement IDs refer to `docs/SRS.md`; blockers refer to `docs/OPEN_DECISIONS.md`.

## 1. Verified environment and versions (2026-10-28)

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x | `engines` pinned to `>=22` |
| pnpm | 10.x | package manager |
| Next.js | 16.4 (App Router) | `proxy.ts` replaces `middleware.ts`; Cache Components disabled (ADR 0002) |
| React | 19.x | |
| Tailwind CSS | 4.x | logical properties (`ms-`, `pe-`) for RTL |
| next-intl | 4.x | `/ar` default, `/en` |
| @supabase/ssr / supabase-js | 0.x / 2.x | cookie-based server sessions |
| Zod | 4.6 | |
| Vitest | 5.0 | unit + DB tests |
| Playwright | preinstalled Chromium | e2e smoke |
| PostgreSQL | 16 (local tests), Supabase uses 15/17 | migrations written for PG ≥ 15 |

Exact resolved versions are in `pnpm-lock.yaml`.

## 2. Milestone 0 deliverables

1. Next.js strict-TypeScript app, ESLint, Prettier, Vitest, Playwright, GitHub Actions CI (lint, typecheck, unit, DB tests, build, e2e smoke, secret scan).
2. Supabase project config (`supabase/config.toml`), first migrations, synthetic seed.
3. Tenancy core schema with RLS + adversarial tests (needed by the shell's clinic switcher):
   `user_profiles`, `clinics`, `clinic_memberships`, `audit_events`.
4. App shell: Arabic RTL / English LTR, locale switch, protected `/[locale]/app/*` routes, active-clinic switcher, role-aware navigation (links only — feature pages arrive in later milestones).
5. Redacting logger (`lib/telemetry`) so no PII/clinical/financial fields reach logs.
6. `.env.example` with no secrets; `pnpm dev:all` starts Supabase + app.

**M0 gate:** one command starts app + local services; `typecheck`, `lint`, unit, DB, build and e2e pass; no secrets committed.

## 3. Data model (M0 + M1)

All tables in `public` (exposed through PostgREST) have RLS **enabled**, Supabase default grants **revoked**, and explicit minimal grants. Helper functions live in schema `private`, which is not exposed.

### M0
| Table | Key columns | Notes |
|---|---|---|
| `user_profiles` | `user_id` PK → `auth.users`, `full_name`, `phone_e164`, `locale` (`ar`/`en`) | Created by trigger on `auth.users` insert. |
| `clinics` | `id`, `name`, `account_state` (`pending`/`active`/`suspended`/`closed`), `timezone` default `Africa/Cairo`, `activated_at`, `created_at` | `activated_at` set once (M1). |
| `clinic_memberships` | `id`, `clinic_id`, `user_id`, `role` (`owner`/`manager`/`receptionist`/`cashier`/`doctor`), `status` (`active`/`suspended`/`deactivated`), timestamps | Unique `(clinic_id, user_id)`. Exactly one active owner per clinic (partial unique index). |
| `audit_events` | `id`, `occurred_at`, `actor_user_id`, `clinic_id` nullable, `category`, `action`, `resource_type`, `resource_id`, `outcome`, `request_id`, `metadata` (redacted jsonb) | Append-only: UPDATE/DELETE/TRUNCATE rejected by trigger for every role. Written only by `private.write_audit_event()`. |

### M1 additions
| Table | Notes |
|---|---|
| `platform_admins` | `user_id`. Grants access to admin RPCs only — **no** RLS path into clinic tables (ADM-003, OD-S01). |
| `clinic_role_permissions` | `(clinic_id, role, capability, allowed)`; owner-only writes via RPC. Capabilities are an allow-list enum in code + DB check. Clinical-content access is **not** a capability (non-overridable). |
| `clinic_invitations` | `token_hash` (SHA-256), `email`/`phone`, `role`, `expires_at`, `accepted_at`, `revoked_at`. Single-use. Raw token only in the invitation link. |
| `clinic_licenses` | `license_type` (`clinic_operating`/`doctor_professional`), `storage_path`, `review_status`, `revision`, reviewer fields. Files in private bucket `licenses` with path prefix `clinic_id/`. |
| `clinic_review_decisions` | admin decision log: decision, reason, actor, time (ONB-003). |
| `clinic_subscriptions` (trial subset) | `trial_started_at`, `trial_ends_at` — set exactly once at first activation (ONB-004, SUB-003). Full billing in M6. |
| `legal_disclaimer_versions`, `disclaimer_acceptances` | Draft text until OD-L01. |

## 4. Permission matrix (defaults; owner may adjust where marked ✱)

| Capability | owner | manager | receptionist | cashier | doctor | platform admin |
|---|---|---|---|---|---|---|
| View clinic workspace | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Assign roles / change permissions | ✓ (only) | ✗ (never) | ✗ | ✗ | ✗ | ✗ |
| Invite / suspend / deactivate staff | ✓ | ✱ (off by default) | ✗ | ✗ | ✗ | ✗ |
| Suspend/deactivate the owner | ✗ (nobody, incl. self-lockout) | ✗ | ✗ | ✗ | ✗ | ✗ (clinic-level suspension only) |
| Manage appointments, all doctors (M2) | ✓ | ✱ | ✓ | ✗ | own schedule | ✗ |
| Read protected medical content (M3) | own assigned visits only if also a doctor | ✗ | ✗ | ✗ | assigned open visit only | ✗ |
| Finance operations (M4) | ✓ | ✱ | ✗ | ✱ (cashier ops) | ✗ | ✗ |
| WhatsApp budget ceiling (M5) | ✓ | ✱ (explicit) | ✗ | ✗ | ✗ | ✗ |
| Review clinic licences, activate, suspend clinic | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

## 5. RLS threat model

| Threat | Control | Test |
|---|---|---|
| Forged `clinic_id` in request body / URL / cookie | Every policy derives membership from `auth.uid()` and `clinic_memberships`; cookie only selects among already-authorised clinics | `tenancy.cross-tenant-denied`, `active-clinic.resolve` |
| Guessed UUIDs | Same; SELECT returns zero rows, writes fail RLS | `tenancy.cross-tenant-denied` |
| Suspended / deactivated member with a still-valid JWT | Policies require `status = 'active'` on every query (no reliance on token expiry) | `tenancy.suspended-member-denied` |
| Supabase default grants exposing new tables to `anon` | Migrations revoke defaults; meta-test fails if any `public` table lacks RLS or grants anything to `anon` | `meta.rls-enabled`, `meta.no-anon-grants` |
| Client writing membership rows to escalate role | No INSERT/UPDATE/DELETE grant on `clinic_memberships`; changes only via owner-checked RPCs (M1) | `tenancy.no-direct-membership-write` |
| Moving a row between tenants | `forbid_clinic_id_change` trigger | `tenancy.clinic-id-immutable` |
| Tampering with audit history | Append-only trigger for all roles incl. `service_role`; no client INSERT | `audit.append-only` |
| `SECURITY DEFINER` helper misuse | Helpers in unexposed `private` schema, `search_path` pinned, read only the caller's own rows | `meta.private-not-exposed` |
| Service-role key leakage | Only read in `lib/supabase/admin.ts`, guarded by `server-only`; never `NEXT_PUBLIC_` | lint rule + build check |
| Platform admin reading clinic data | No admin branch in clinic policies | `admin.no-clinic-data` |
| Stale data after clinic switch | Cookie change + `router.refresh()`; shell keyed on clinic id | e2e (M1, needs auth server) |

## 6. Screens

M0: `/[locale]` landing, `/[locale]/login`, `/[locale]/app` shell (header with clinic switcher, locale switch, sign-out; role-aware side nav), `/[locale]/app/no-clinic` (signed-in user without active membership).

M1: register clinic, onboarding status + licence upload, staff list / invite / suspend, invitation accept, permission editor (owner), platform admin: pending clinics, clinic detail/review, state changes.

## 7. Tests (M0)

- `tests/db/tenancy.test.ts`: cross-tenant SELECT denied; suspended and deactivated members denied; multi-clinic user sees each clinic only through its own membership; anon sees nothing; no direct writes to memberships/clinics; clinic_id immutable.
- `tests/db/audit.test.ts`: append-only for authenticated and service_role; client cannot insert.
- `tests/db/meta.test.ts`: every `public` table has RLS enabled + forced and no `anon` privileges; `private` schema not granted to API roles.
- `tests/unit/*`: locale/direction, active-clinic resolution, log redaction, Cairo time helpers.
- `tests/e2e/smoke.spec.ts`: `/ar` is RTL, `/en` is LTR, `/ar/app` redirects to login when signed out.
