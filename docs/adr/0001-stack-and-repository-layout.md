# ADR-0001: Stack and repository layout

- **Status:** Accepted (Milestone 0)
- **Context:** CLAUDE.md and TECHNICAL_ARCHITECTURE.md recommend Next.js App Router, TypeScript strict, Tailwind, shadcn/ui, Supabase (Auth, PostgreSQL, Storage), Zod, Vitest and Playwright. Versions checked on 2026-10-20: Next.js 16.4.2, React 19.3, Tailwind 4, TypeScript 5.9, Vitest 5, `@supabase/ssr` 0.12.
- **Decision:**
  - A single Next.js application at the repository root (no monorepo until a second deployable exists, e.g. the M5 worker).
  - Domain logic lives in `modules/<domain>`, independent of React. Shared infrastructure lives in `lib/`. UI lives in `components/`.
  - SQL migrations in `supabase/migrations` are the only schema source. No Prisma or Drizzle.
  - Playwright is pinned to 1.56.x to match the browser build pre-installed in the development container; CI installs the matching browser.
- **Consequences:** The M5 worker will be added as `worker/` with its own entry point. Splitting into a workspace will be reconsidered then.
