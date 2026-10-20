# Clinic SaaS — Egyptian multi-tenant clinic management

Arabic-first (English-capable), responsive web application for Egyptian clinics. Product scope lives in the documents below. **Current status: Milestone 0 (foundation) complete. Milestone 1 not started.**

| Document | Purpose |
|---|---|
| `CLAUDE.md` | Engineering rules for this repository |
| `docs/SRS.md` | Authoritative requirements (Q1–Q96 decided, Q97 open) |
| `docs/TECHNICAL_ARCHITECTURE.md` | Recommended stack |
| `database/DATA_MODEL_BLUEPRINT.md` | Logical data model (not executable) |
| `docs/IMPLEMENTATION_PLAN.md` | Milestones 0–7 and quality gates |
| `docs/REQUIREMENTS_REVIEW.md` | Consistency review of the above (M0) |
| `docs/TRACEABILITY.md` | Requirement → module / DB / API / UI / test map |
| `docs/OPEN_DECISIONS.md` | Unresolved decisions, blocking vs non-blocking |
| `docs/MILESTONE_PLAN.md` | M0 deliverables and the concrete M1 plan |
| `docs/adr/` | Architecture decision records |

## Quick start

Requirements: Node.js 22+, npm. Optional: Docker (local Supabase), PostgreSQL 16 (DB tests).

```bash
npm install
cp .env.example .env.local   # placeholders only; UI preview enabled
npm run dev                  # http://localhost:3000 → redirects to /ar
```

- `/ar` and `/en`: public site. `/ar/preview`: the full application shell with **synthetic data** (no database needed).
- Protected areas (`/<locale>/workspaces`, `/<locale>/c/<clinicId>`, `/<locale>/admin`) redirect to login. Until Supabase is configured and Milestone 1 adds memberships, nobody can enter them (deny by default).

### With local Supabase (requires Docker)

```bash
npm run dev:full             # supabase start && next dev
npx supabase status          # copy API URL + publishable key into .env.local
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run typecheck` | Route type generation + `tsc --noEmit` (strict) |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Vitest: unit tests, plus DB tests when `TEST_DATABASE_URL` is set |
| `npm run test:db` | Only the DB/RLS tests (needs a **disposable** PostgreSQL) |
| `npm run test:e2e` | Playwright against a production build (preview enabled, no Supabase) |
| `npm run check` | format + lint + typecheck + tests + build |

DB tests create and drop their own databases. Example: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:db`.

## Structure

```
app/[lang]/            locale root (ar | en) → <html lang dir>
  (public)/            landing, login, register (placeholder)
  workspaces/          post-login clinic picker            (protected)
  c/[clinicId]/        clinic workspace                    (protected, membership-checked)
  admin/               platform administration             (protected, admin-checked)
  preview/             synthetic UI preview                (only if UI_PREVIEW_ENABLED)
app/api/auth/sign-out  sign-out endpoint (full page reload)
components/ui          shadcn/ui components (local, Radix-based)
components/shell       app shell, navigation, clinic switcher, locale switcher
modules/permissions    roles, capabilities, locked medical/role boundaries, navigation
modules/tenancy        active-clinic resolver, membership types, repository boundary
lib/                   env, i18n, supabase clients, auth, time (Cairo), money (EGP), privacy, telemetry
supabase/              config + SQL migrations (only schema source)
tests/db               migration / grant / RLS tests     tests/e2e  Playwright
```

## Security posture (Milestone 0)

- Database: default-deny privileges for `anon` and `authenticated`; a standing test fails if any `public` table lacks RLS.
- Tenancy: the clinic id in the URL is a view hint only and is re-resolved against server-loaded memberships. Clinic switch and sign-out are full page loads, so no client state carries over.
- Medical and role-assignment capabilities are locked to `doctor` and `owner`, and owners cannot grant them. No support-impersonation capability exists (Q97).
- No secrets in the repository. `.env.example` has placeholders only. CI runs gitleaks.

**Not production-ready.** Egyptian legal, tax, payment-provider and Meta onboarding gates must be signed off first (see `docs/OPEN_DECISIONS.md` §C).
