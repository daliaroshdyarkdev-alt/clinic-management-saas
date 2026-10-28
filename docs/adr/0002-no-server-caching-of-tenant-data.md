# ADR 0002 — Cache Components disabled; no server caching of tenant data

**Status:** accepted.

## Context
Next.js 16 offers Cache Components (`cacheComponents: true`), which encourages caching rendered output and data with `use cache`. Every authenticated page in this product is specific to a user, a clinic and (later) a visit. A mis-keyed cache entry would be a cross-tenant or medical-confidentiality breach (SRS §2.1 invariants 2-4, 7).

## Decision
- `cacheComponents: false`. Authenticated routes are rendered dynamically per request (verified in the build output: `/[locale]/app` is `ƒ Dynamic`).
- No `use cache`, `unstable_cache` or `fetch` caching of clinic, patient, clinical or financial data. React `cache()` is used only for per-request deduplication.
- Public marketing pages may be static.

## Consequences
Slightly more database load per navigation; revisit only for public, non-tenant data, with a security review.
