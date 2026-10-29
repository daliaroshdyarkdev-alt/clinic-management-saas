# Egyptian Clinic Management SaaS

Multi-tenant clinic management web app (Arabic-first, English-capable): appointments and queues, patient records with visit-level medical privacy, operational finance, WhatsApp appointment messaging, staff roles, SaaS billing and platform administration.

> **Status: Milestone 6 (subscriptions and platform billing, mock gateway) — awaiting authenticated end-to-end verification.** Development build with synthetic data only. Not approved for real patient data: see the legal and hosting blockers in [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md).

## Documents

| Document | Purpose |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Engineering rules (read first) |
| [`docs/SRS.md`](docs/SRS.md) | Authoritative requirements (Q1–Q96 confirmed, Q97 open) |
| [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) | Recommended architecture |
| [`database/DATA_MODEL_BLUEPRINT.md`](database/DATA_MODEL_BLUEPRINT.md) | Logical data model |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Milestones and gates |
| [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) | Requirement → module / table / API / test map and status |
| [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) | Blockers and safe defaults |
| [`docs/M0_M1_PLAN.md`](docs/M0_M1_PLAN.md) | Data model, permission matrix, RLS threat model for M0/M1 |
| [`docs/adr/`](docs/adr) | Architecture decision records |
| [`docs/milestones/`](docs/milestones) | Milestone evidence reports |

## Local development

Requirements: Node.js 22+, pnpm 10, Docker (for the local Supabase stack), PostgreSQL 15+ for database tests.

```bash
pnpm install
cp .env.example .env.local      # then paste the publishable key from `pnpm exec supabase status`
pnpm dev:all                    # starts local Supabase, then Next.js on http://localhost:3000
pnpm db:reset                   # re-applies migrations and loads synthetic seed data
```

The WhatsApp worker runs separately: `pnpm worker` (mock provider by default; see `.env.example`).

Seeded users (local only, password `Synthetic-Pass-2026`) are listed at the top of [`supabase/seed.sql`](supabase/seed.sql).

## Checks

| Command | What it runs |
|---|---|
| `pnpm typecheck` | Next.js route type generation + `tsc --noEmit` (strict) |
| `pnpm lint` | ESLint (Next.js core-web-vitals + TypeScript) |
| `pnpm format:check` | Prettier |
| `pnpm test` | Unit tests |
| `pnpm test:db` | RLS / grant / invariant tests against a throw-away PostgreSQL database (`TEST_DB_ADMIN_URL`) |
| `pnpm test:e2e` | Builds the app and runs Playwright smoke tests (desktop + mobile Chromium) |
| `pnpm check` | typecheck, lint, unit, DB tests and build |

CI (`.github/workflows/ci.yml`) runs all of the above plus a gitleaks secret scan.

## Repository layout

```
app/[locale]/        Next.js routes (ar, en)
components/          UI (shadcn/ui primitives in components/ui)
i18n/, messages/     next-intl routing and translations
lib/                 auth, tenancy, Supabase clients, telemetry, time helpers
supabase/            config, SQL migrations, seed, test shim
tests/               unit, db (security), e2e
docs/                requirements, decisions, plans, reports
```
