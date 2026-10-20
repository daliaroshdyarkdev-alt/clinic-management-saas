# Milestone 0 and Milestone 1 — Concrete Plan

## Milestone 0 — Foundation (this delivery)

| Area | Deliverable | Location |
|---|---|---|
| Discovery | Consistency review, traceability, open decisions, this plan, ADRs | `docs/` |
| App | Next.js 16 App Router, TypeScript strict, Tailwind v4, shadcn/ui (local components on Radix) | `app/`, `components/ui/` |
| i18n | Arabic-first `/ar`, English `/en`; `<html lang dir>`; typed dictionaries with key parity; locale negotiation in `proxy.ts` | `lib/i18n/`, `proxy.ts` |
| Shell | Public landing, login, register placeholder, workspace picker, protected clinic shell `/[lang]/c/[clinicId]`, platform admin shell `/[lang]/admin`, clinic switcher, role-aware navigation, responsive sidebar/mobile sheet | `app/[lang]/`, `components/shell/` |
| Preview | Static UI preview with **synthetic** clinics and roles, only when `UI_PREVIEW_ENABLED=true` (refused when `APP_ENV=production`) | `app/[lang]/preview/`, `lib/demo/` |
| Auth architecture | Supabase SSR clients (browser/server/proxy), session refresh in proxy, server-side `getCurrentUser()` using `auth.getUser()`, protected-route guard in layouts, deny-by-default tenancy repository | `lib/supabase/`, `lib/auth/`, `modules/tenancy/` |
| Domain | Capability model with non-grantable medical/finance boundaries; active-clinic resolver; navigation builder | `modules/permissions/`, `modules/tenancy/` |
| Utilities | Env validation, Cairo time, EGP minor units, PII masking, redacting logger, clinic-scoped cache keys | `lib/` |
| Database | Supabase config, security-baseline migration (default-deny grants, `private` schema), Postgres test harness with Supabase shim | `supabase/`, `tests/db/` |
| Quality | ESLint, Prettier, `tsc --noEmit`, Vitest (unit + DB), Playwright (E2E), GitHub Actions CI with gitleaks | `package.json`, `.github/workflows/ci.yml` |

**Not in M0 (by design):** clinic, membership or patient tables; real login against a Supabase project; any medical, finance, messaging or billing behaviour.

**M0 gate (IMPLEMENTATION_PLAN):** "one command starts app+local services and builds/test pass; no real secrets". `npm run dev` starts the app (preview works without Supabase). `npm run dev:full` additionally runs `supabase start`, which needs Docker (not available in the build container, see the report).

---

## Milestone 1 — Identity, tenancy and onboarding (plan only, not started)

**Pre-conditions:** OD-02, OD-03, OD-05, OD-08 and OD-21 decided (see `OPEN_DECISIONS.md`).

### 1. Data model (first M1 migrations)

All tables are in `public` (exposed through PostgREST) unless noted. Every table: RLS enabled, explicit `GRANT`s, cross-tenant denial tests.

| Table | Key columns | Notes |
|---|---|---|
| `user_profiles` | `user_id PK → auth.users`, `display_name`, `phone_e164`, `locale` | Row readable/updatable by self only |
| `platform_admins` | `user_id PK`, `granted_by`, `granted_at`, `revoked_at` | No GRANT to `authenticated` for writes; provisioned via server/CLI (OD-08) |
| `clinics` | `id`, `name`, `account_state` enum, `timezone default 'Africa/Cairo'`, `activated_at`, `trial_started_at` | `trial_started_at` set once by RPC (ONB-004) |
| `clinic_state_events` | `clinic_id`, `from_state`, `to_state`, `actor_id`, `reason`, `created_at` | Append-only (ONB-003/005) |
| `clinic_licenses` | `clinic_id`, `license_type`, `storage_path`, `review_status`, `revision`, `reviewed_by`, `review_reason` | Private bucket `licenses/{clinic_id}/…` |
| `clinic_memberships` | `id`, `clinic_id`, `user_id`, `status` (`invited`/`active`/`suspended`/`deactivated`), unique `(clinic_id,user_id)` | Composite unique `(clinic_id,id)` |
| `membership_roles` | `clinic_id`, `membership_id`, `role` enum | Several roles per membership (OD-02) |
| `permission_grants` | `clinic_id`, `membership_id`, `capability`, `granted_by` | CHECK + trigger: non-grantable capabilities rejected |
| `clinic_invitations` | `clinic_id`, `invitee_contact`, `role`, `token_hash`, `expires_at`, `accepted_at`, `invited_by` | Single-use, hashed token |
| `audit_events` | `id`, `clinic_id null`, `actor_id`, `category`, `action`, `resource_type`, `resource_id`, `outcome`, `request_id`, `metadata_redacted jsonb`, `created_at` | INSERT only through RPC; no UPDATE/DELETE grants (STA-007) |

Helper functions in schema `private` (not exposed): `private.current_user_id()`, `private.is_active_member(clinic_id)`, `private.has_capability(clinic_id, capability)`, `private.is_platform_admin()`. These are `SECURITY DEFINER` with `search_path=''` and read only the caller's own rows. Each one gets bypass tests.

### 2. Permission matrix (proposed defaults, OD-21; owner may adjust except locked cells)

| Capability | owner | manager | receptionist | cashier | doctor | platform admin |
|---|---|---|---|---|---|---|
| `clinic.settings.manage` | ✔ | grant | – | – | – | – |
| `staff.invite` / `staff.suspend` | ✔ | grant (STA-005) | – | – | – | – |
| `staff.roles.assign` | ✔ 🔒 | 🔒 never | 🔒 never | 🔒 never | 🔒 never | 🔒 never |
| `appointments.manage` | ✔ | grant | ✔ | – | own | – |
| `patients.demographics` | ✔ | grant | ✔ | grant | assigned | – |
| `medical.content.read/write` | 🔒 never | 🔒 never | 🔒 never | 🔒 never | assigned visit only | 🔒 never |
| `finance.*` | ✔ | grant | – | session-scoped grant | – | 🔒 never |
| `whatsapp.budget.manage` | ✔ | explicit grant (WAP-013) | – | – | – | 🔒 never |
| `subscription.manage` | ✔ | – | – | – | – | – |
| `platform.clinics.review` | – | – | – | – | – | ✔ |
| `platform.support.impersonate` | **does not exist (Q97)** | | | | | |

🔒 = enforced in code (`modules/permissions/capabilities.ts`) and, from M1, by a DB trigger. It cannot be changed by grants.

### 3. RLS threat model (M1 scope)

| Threat | Attack | Control | Test |
|---|---|---|---|
| T1 Forged tenant | Client sends another `clinic_id` / guessed UUID | Policies use `private.is_active_member(clinic_id)`; never trust a payload `clinic_id` | SEC: user A selects/inserts with clinic B id → 0 rows / error |
| T2 Stale membership | Suspended user keeps a valid JWT | Policies check `status='active'` on every query; suspension RPC also revokes sessions | SEC: suspend → next query denied (§8 #4) |
| T3 Privilege escalation | Manager grants self `staff.roles.assign` or medical access | Trigger rejects non-grantable capabilities; role writes only via owner-checked RPC | SEC: manager role-assign → error |
| T4 Owner lockout | Subordinate revokes owner | RPC refuses changes targeting an owner membership by a non-owner | SEC |
| T5 Admin overreach | Platform admin reads clinic data | No policy branch for platform admins on clinic tables; admin data only through dedicated views of non-sensitive columns | SEC: admin JWT → 0 rows |
| T6 Anonymous access | `anon` key used directly | Baseline revokes all from `anon`; public intake only via server endpoints | SEC: anon select every table → permission denied |
| T7 Service key leak | Secret key bundled to browser | Secret only in `lib/env/server.ts` behind `server-only`; CI gitleaks; no `NEXT_PUBLIC_` prefix | Build check |
| T8 Invitation replay | Reuse invitation link | Hashed token, `accepted_at` set atomically, expiry | SEC: second accept fails |
| T9 Storage leak | Fetch another clinic's licence object | Storage policy on `licenses/{clinic_id}/…` + membership/admin-review check; short-lived signed URLs | SEC storage |
| T10 Default grants | New table created without policies | Baseline revokes default privileges; CI test asserts every public table has RLS enabled | `tests/db/baseline.test.ts` |
| T11 SECURITY DEFINER abuse | Helper called with another user's id | Helpers take no user-id parameter; use `auth.uid()`; `search_path=''` | SEC |

### 4. M1 screens

Register clinic (owner account + clinic profile + licence upload), verification status page, login, invitation accept, workspace picker, clinic switcher (live data), staff list (invite/suspend/deactivate), role/permission editor (owner only), platform admin verification queue + clinic detail + lifecycle actions with mandatory reason.

### 5. M1 tests

- Unit: state machine (clinic lifecycle), invitation token, capability resolution, Zod schemas.
- DB/SEC (`tests/db`): T1–T11 above, for every table and role, including forged tenant ids and inactive memberships.
- E2E: register → admin approve → trial starts once; invite → accept → switch clinic → no data from the previous clinic visible.
- **Gate:** adversarial suite shows no cross-clinic access and no suspended-user access.

### 6. M1 commit sequence

1. `user_profiles`, `platform_admins`, helpers + SEC tests
2. `clinics`, lifecycle, `clinic_state_events` + tests
3. memberships, roles, grants, non-grantable trigger + tests
4. invitations + tests
5. `audit_events` + tests
6. Auth wiring (login/logout/invite accept) + E2E
7. Onboarding UI + storage policies + tests
8. Admin verification UI + tests
