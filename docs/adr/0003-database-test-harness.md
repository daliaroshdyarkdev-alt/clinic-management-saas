# ADR 0003 — Database policy tests on plain PostgreSQL with a Supabase shim

**Status:** accepted; add a second CI job against the real Supabase CLI stack when Docker images are available to CI.

## Context
RLS and grants must be proven with adversarial tests (CLAUDE.md). The build sandbox cannot pull Supabase Docker images, and fast, deterministic policy tests are valuable in any case.

## Decision
`tests/db/global-setup.ts` creates a throw-away database, loads `supabase/tests/shim/supabase_shim.sql` and applies every migration. The shim emulates exactly what migrations depend on: the `anon`/`authenticated`/`service_role` roles (service role bypasses RLS), `auth.users`/`auth.identities` (column subset), `auth.uid()`/`auth.jwt()` reading `request.jwt.claims` the way PostgREST sets them, and Supabase's permissive default privileges on `public` — so tests prove our migrations close them.

Tests switch role with `set local role` + JWT claims inside a rolled-back transaction (`tests/db/helpers.ts`).

## Consequences
- Fast (≈1 s) and runnable anywhere PostgreSQL 15+ exists, including CI service containers.
- Risk: drift between the shim and real Supabase. Mitigation: keep the shim minimal, and run migrations with `supabase db reset` locally before merging schema changes.
