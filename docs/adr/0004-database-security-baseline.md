# ADR-0004: Default-deny database privileges and RLS test harness

- **Status:** Accepted (Milestone 0)
- **Decision:**
  - The first migration revokes Supabase's default table, sequence and function privileges for `anon` and `authenticated` in `public`. Every future table therefore needs an explicit `GRANT`, plus RLS policies, to be reachable.
  - A non-exposed `private` schema holds helper functions and internal tables.
  - DB tests (`tests/db`, Vitest + `pg`) apply all migrations to a fresh database. On plain PostgreSQL a shim creates the Supabase roles and `auth.uid()`/`auth.jwt()`. Tests impersonate roles with `SET LOCAL ROLE` and `request.jwt.claims`. A standing test fails if any table in `public` lacks RLS.
- **Consequences:** Developers must add grants deliberately. When run against a real local Supabase (`supabase start`), the same tests run without the shim.
