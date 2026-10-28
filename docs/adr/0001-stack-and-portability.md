# ADR 0001 — Stack and hosting portability

**Status:** accepted for development; hosting location pending OD-L02.

## Context
The SRS and `docs/TECHNICAL_ARCHITECTURE.md` recommend Next.js + Supabase (PostgreSQL, Auth, Storage). Egyptian personal-data rules (Law 151/2020 and its executive regulations) may restrict where health data is hosted or require a transfer licence; Supabase cloud has no Egypt or Middle East region today.

## Decision
- Next.js 16 App Router, TypeScript strict, Tailwind 4, shadcn/ui on Radix, next-intl (`/ar` default, `/en`).
- PostgreSQL via Supabase. All authorisation lives in **plain SQL** (RLS policies, grants, functions) under `supabase/migrations/`, so it runs unchanged on Supabase cloud, self-hosted Supabase, or any PostgreSQL ≥ 15 with an equivalent auth layer.
- No Supabase Edge Functions or other vendor-only runtime in core business logic. Background work will run in a Node container (OD-E01).
- The web app and worker are deployed as containers in the same region as the database once OD-L02 is decided.

## Consequences
Moving to an in-country host means redeploying containers and restoring the database; no rewrite of business rules.
