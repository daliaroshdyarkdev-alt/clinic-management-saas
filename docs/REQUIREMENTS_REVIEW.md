# Requirements Consistency Review (Milestone 0)

**Inputs reviewed in full:** `CLAUDE.md`, `docs/SRS.md` v1.0, `docs/TECHNICAL_ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `database/DATA_MODEL_BLUEPRINT.md`.
**Date:** 2026-10-20. **Result:** Overall consistent, with **no blocking contradiction for Milestone 0**. Six findings need a product-owner decision before Milestone 1 or later milestones. Each one is tracked in `docs/OPEN_DECISIONS.md`.

Severity legend: **Conflict** = two statements cannot both be implemented literally. **Gap** = a confirmed feature needs a rule the documents do not give. **Clarification** = wording is ambiguous, and a safe default is applied until confirmed.

## 1. Findings

| # | Type | Statements involved | Finding | Safe default applied now | Needed by | Decision ID |
|---|---|---|---|---|---|---|
| R1 | Conflict | SRS §2.1 invariant 4 vs MED-004, MED-009 | Invariant 4 ties doctor access to an *open* consultation. MED-004 (append-only corrections after completion) and MED-009 (a *departing* doctor loses access) imply the treating doctor keeps reading their own completed records. The documents also do not say whether a doctor may see the same patient's earlier visits with *other doctors in the same clinic*. | Strictest reading: no medical access after completion except the correction path. Decided in M3 design; nothing medical is built before then. | M3 | OD-01 |
| R2 | Gap | §2 actors, STA-001, blueprint `clinic_memberships.role_id` (single role) | Egyptian clinics are often owned by a practising doctor. The model gives one role per membership, but the owner role has *no* medical access (invariant 4). Can one membership hold `owner` **and** `doctor`? Does an owner-doctor count toward the paid doctor capacity (ONB-008, SUB-002)? | The M1 schema will allow several roles per membership, and medical access will come only from the `doctor` role (never from `owner`). Whether that combination is allowed, and how capacity is counted, needs confirmation. | **M1 (blocking schema)** | OD-02 |
| R3 | Gap | STA-002, ONB-001, SRS §5 | The sign-in identifier is not specified: email + password, phone + OTP, or both. Phone OTP needs an SMS provider. Automatic SMS is excluded from Phase 1 *messaging*, but that exclusion is not about authentication. | The M0 login screen is an architecture placeholder (email + password, the Supabase default). It is not wired to production users. | **M1 (blocking)** | OD-03 |
| R4 | Clarification | §2 receptionist "cannot read confidential consultation notes **by default**" vs STA-001 "non-overrideable medical/privacy boundaries" and MED-005 | "By default" could suggest an owner may grant receptionists access to notes. That contradicts STA-001 and MED-005. | Treated as **never grantable**. `modules/permissions` marks medical-content capabilities as non-grantable to any non-doctor role, and unit tests cover this. | M1 | OD-04 |
| R5 | Gap | ONB-002, ONB-008, SUB-002 | ONB-002 requires "doctor professional license" at registration. It does not say whether every additional doctor must upload a licence, or must pass admin verification before activation. | No additional-doctor activation flow is built before M1. | M1 | OD-05 |
| R6 | Gap | ONB-003, ONB-005 | The lifecycle list (pending, active, suspended, closed/archived) leaves out `rejected` and `documents_requested`, which ONB-003 implies. | The proposed M1 state machine adds both as *engineering* states. Confirmation needed. | M1 | OD-06 |
| R7 | Clarification | §6 "use Africa/Cairo" vs APT-017 "time-zone/DST policy OPEN" | These do not conflict. The IANA zone `Africa/Cairo` (DST rules included, Egypt reinstated DST in 2023) is the storage/display rule. *Business* handling of sessions that cross a DST change is still open. | `lib/time` formats with `Africa/Cairo` and stores UTC. DST edge rules are deferred to M2. | M2 | OD-07 |
| R8 | Gap | ADM-005, §5 MFA "strongly recommended" | How platform administrators are provisioned is not specified. | Platform admins can **never** self-register. M1 will provision them only through a server-side/CLI path. MFA is proposed and needs confirmation. | M1 | OD-08 |
| R9 | Clarification | SUB-003 "14-day **core-feature** trial" | "Core features" are not enumerated, for example whether WhatsApp sends are included during the trial. | No entitlement logic before M6. | M6 | OD-09 |

## 2. Statements verified as consistent

- **Tenancy:** invariants 1–3, STA-004 and architecture item 9 agree. The active clinic is a *view context*, and every request re-derives membership on the server. M0 follows this: the clinic id appears in the URL path, and the URL is never treated as authority.
- **Platform admin limits:** §2, ADM-003, FIN-010, §8 scenario 14 and Q97/ADM-004 agree. No default medical or finance access, and no impersonation. M0 adds **no** support-access feature.
- **Finance immutability:** invariant 6, FIN-009, FIN-015 and architecture item 5 agree (integer minor units, reversal + replacement).
- **Booking no-hold rule:** APT-003 and APT-017 explicitly lock it as final.
- **Messaging exclusions:** §1, WAP-015 and IMPLEMENTATION_PLAN M5 agree (no inbox, no SMS fallback, no queue-progress messages).
- **Plan changes at renewal:** SUB-008, SUB-010 and §8 scenario 11 agree.
- **Stack:** CLAUDE.md, the architecture doc and the user instruction agree (Next.js App Router, TypeScript strict, Tailwind, shadcn/ui, Supabase, RLS, Zod, Vitest, Playwright). The documents leave one choice open: the job worker queue library (`pg-boss` vs Supabase Queues). It is not needed before M5 (OD-20).

## 3. Implementation-environment notes (not requirement issues)

- **Next.js 16.4** is current and differs from earlier versions. `middleware.ts` is now `proxy.ts`, and Cache Components (`cacheComponents`) is on. ADR-0002 records how tenant data is kept out of shared caches.
- The shadcn/ui registry is unreachable from the build container, so components were written locally against the same Radix primitives (`radix-ui`). `components.json` is included so `npx shadcn add` works on a developer machine.
- No Docker daemon runs in the build container, so the Supabase CLI stack could not start here. Migrations are verified against a plain PostgreSQL 16 database with a small Supabase-compatibility shim (`supabase/tests/shim/supabase_shim.sql`). CI uses the same approach.
