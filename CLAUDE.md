# Project Instructions — Egyptian Clinic Management SaaS

## Mandatory reading order
1. `docs/SRS.md` — authoritative product feature scope and decisions.
2. `docs/TECHNICAL_ARCHITECTURE.md` — proposed implementation stack and architecture.
3. `database/DATA_MODEL_BLUEPRINT.md` — initial relational modeling map.
4. `docs/IMPLEMENTATION_PLAN.md` — delivery phases and quality gates.

## Hard rules
- Treat product items labeled CONFIRMED as requirements. Items labeled OPEN cannot be made into irreversible product policy by assumption; record blockers in `docs/OPEN_DECISIONS.md` with safe default deny for sensitive features.
- Build Phase 1 only; do not add deferred features to create a more impressive demo.
- Implement tenant boundaries, doctor/visit-specific protected records, and immutable posted finance records before building broad CRUD pages.
- Never trust user-submitted clinic_id, role, price, doctor capacity, approval or consent claims. Authorize using authenticated server state and least-privilege database policies.
- Use server-side transactions for bookings, financial posting, plan entitlement changes and WhatsApp budget reservation.
- Do not permit platform admins unrestricted clinic finance or clinical data; do not implement support impersonation (Q97 OPEN).
- Do not expose service-role or secret keys in browser/build logs. Do not commit secrets. Do not include real patient data in fixtures/screenshots.
- Every new exposed table must have explicit grants and Row Level Security policies plus cross-tenant denial tests.
- Validate medical/financial workflows using negative/security tests and race-condition tests. No UI-only security.
- Read existing code before editing; use small, reviewable commits. Do not reset migrations or erase data without authorization.

## Stack and conventions
- Use TypeScript strict mode, Next.js App Router, React, Tailwind, shadcn/ui, Supabase Auth/PostgreSQL/Storage, Zod schemas, Vitest and Playwright.
- Use SQL migrations under `supabase/migrations/`, with code-generated types. Do not introduce Prisma and a second migration source automatically.
- Separate domain logic in `modules/`; never put financial or medical authorization exclusively in React client components.
- Use `Africa/Cairo` local clinic times; store UTC timestamps; use EGP integer minor units for financial math.
- Use adapter interfaces for Meta WhatsApp and SaaS payment gateways; mock providers for local tests.
- Implement durable, replay-safe background jobs for reminders and webhooks; worker deployment and queue library to be validated during bootstrap.
- Ensure Arabic RTL and English LTR support in all key views, with responsive layouts.

## Workflow
1. Before coding, inspect repository, package versions and current DB; produce requirement traceability and exact milestone plan.
2. Build foundation and secure permissions first; stop if tenant or medical access cannot be proven safe.
3. Implement one vertical feature slice at a time (migration, domain policy, API, UI, tests).
4. Run `typecheck`, `lint`, unit/integration/security tests and build; record exact commands/results.
5. Provide short release notes: changed files, requirement IDs, test outcomes, unresolved risks.
6. Never declare production-ready until local Egyptian legal/compliance, payment provider and Meta onboarding gates are signed off.
