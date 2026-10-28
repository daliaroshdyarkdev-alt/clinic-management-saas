# Milestone 1 — Evidence Report

**Date:** 2026-10-28 · **Branch:** `claude/great-bardeen-pbvaqb`
**Scope:** identity, tenancy and clinic onboarding (`docs/IMPLEMENTATION_PLAN.md`, `docs/M0_M1_PLAN.md`).

## What was built

**Database** (`supabase/migrations/20261028120000_onboarding_and_staff.sql`)
- New tables, all with RLS and SELECT-only client grants: `platform_admins`, `clinic_role_permissions`, `clinic_invitations` (token stored as SHA-256 only, hash column not readable), `clinic_licenses` (revisioned, never deleted), `clinic_review_decisions` and `clinic_state_events` (append-only), `clinic_subscriptions` (trial subset; start time immutable), `legal_disclaimer_versions` (DRAFT text), `disclaimer_acceptances` (append-only).
- Private storage bucket `licenses` (10 MB, PDF/JPEG/PNG): upload only by the clinic owner into `<clinic_id>/…` while the clinic is pending or active; read only by that owner and platform admins; no client update/delete.
- 13 SECURITY DEFINER functions, each re-checking caller, role/capability and clinic state, validating the transition and writing an audit event in the same transaction: `register_clinic`, `submit_clinic_license`, `admin_review_license`, `admin_activate_clinic`, `admin_set_clinic_state`, `admin_record_license_access`, `invite_staff`, `revoke_invitation`, `get_invitation_preview`, `accept_invitation`, `set_membership_status`, `change_member_role`, `set_role_permission`.
- `private.clinic_is_operational()` gate for Milestone 2+ (unapproved clinics cannot run live operations, ONB-004).

**Application**
- Account sign-up (`/register`), clinic registration with legal notice acceptance (`/app/clinics/new`).
- Owner licence page (`/app/onboarding`): upload (content-sniffed, never trusting file name or browser MIME type), status, reviewer notes, revision history, file view via 60-second signed URL.
- Staff page (`/app/staff`): invite with one-time link, open invitations with revoke, suspend / reactivate / permanently deactivate with reason, owner-only role change, owner-only "managers may manage staff" permission.
- Invitation page (`/invite/[token]`): sign-in/sign-up hand-off preserving the link; clinic details shown only to the invited account; accept → membership + switch to that clinic.
- Platform admin area (`/admin`, 404 for non-admins): clinics by status, clinic detail with owner contact, per-licence approve / request replacement / reject, activation (starts 14-day trial), suspend / reactivate / close with reason, history. Every licence file opened by an admin is audited.
- Domain code moved to `modules/` (`tenancy`, `onboarding`, `staff`, `platform-admin`, `shared`).

## Commands and results (local)

| Command | Result |
|---|---|
| `pnpm format:check` | pass |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass, 0 warnings |
| `pnpm test` | 7 files, **37 passed** |
| `pnpm test:db` (PostgreSQL 16.15 + shim) | 8 files, **85 passed** |
| `pnpm build` (no Supabase env) | pass; all authenticated routes dynamic (ƒ) |
| `CI=1 pnpm test:e2e` | **26 passed** (13 tests × desktop + mobile Chromium) |

**Mutation checks** (each change made temporarily, then restored):

| Mutation | Tests that failed |
|---|---|
| Accept invitation without email match | 1 (`cannot be accepted by a different account`) |
| Remove owner protection on suspension | 1 (`owner cannot be suspended`) |
| Storage upload without owner check | 2 (cross-clinic upload, non-owner upload) |
| Wrong column name in a query / wrong RPC argument name | 2 (API contract test) |
| Trial insert without `on conflict` | 0 — unreachable path (clinics never return to `pending`); trial start immutability is enforced and tested separately |

## Adversarial coverage added

- Clinic owner cannot review or activate their own clinic; non-admins cannot call admin functions.
- Licence paths must sit in the caller's clinic folder and reference an uploaded object; malformed paths are denied, not errored open.
- Invitation tokens: single-use, expiring, revocable, bound to the invited (confirmed) email; unknown tokens and wrong accounts learn nothing about the clinic; hashes unreadable even by the owner.
- Managers act on staff only when the owner grants `staff.manage`; revocation is immediate; managers cannot invite/suspend managers or themselves; nobody can suspend, demote or replace the owner.
- Suspension removes access to that clinic on the very next query while other clinic memberships keep working.
- Platform admins see clinic metadata, licences and the owner's profile only — not staff, not audit events, not other profiles (ADM-003).
- Audit events carry ids and enum values only (no names, emails, reasons).

## Not done / known gaps

1. **No authenticated browser test yet.** The sandbox cannot pull Supabase Docker images, and running Supabase Auth/PostgREST binaries was not permitted. All M1 rules are proven at the database level (85 tests) and the UI builds and renders, but sign-up → register → upload → admin approval → invite → accept has not been clicked through against real Supabase. **Needed before M2:** run `pnpm dev:all`, `pnpm db:reset`, and add those Playwright journeys (CI can use `supabase start`).
2. Migrations and storage policies are verified on PostgreSQL 16 with a Supabase shim, not yet on a real Supabase project (policies on `storage.objects`, triggers on `auth.users`, `extensions.digest`).
3. No malware scanning of uploads (OD-L06 — production blocker).
4. Invitation delivery is manual (link shown once to the inviter, OD-B11).
5. Generated DB types still pending; `tests/db/api-contract.test.ts` checks every `.rpc()` and `.select()` against the schema meanwhile.
6. An orphaned storage object remains if the SQL registration fails after upload (no client delete permission by design); add a cleanup job with the worker (OD-E01).
7. Licence re-verification for active clinics (ONB-006), trial extension (SUB-003), doctor capacity (ONB-008/SUB-002) are later milestones.

## Decisions recorded

New in `docs/OPEN_DECISIONS.md`: OD-L06 (upload scanning), OD-B08 (manager scope), OD-B09 (no rejoin after deactivation), OD-B10 (ownership transfer), OD-B11 (invite delivery), OD-E06 (3 pending clinics per owner), OD-E07 (per-clinic session revocation), OD-E08 (invitation lifetime).
