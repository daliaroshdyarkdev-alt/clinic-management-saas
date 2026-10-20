# ADR-0002: Tenant context in the URL; no shared caching of tenant data

- **Status:** Accepted (Milestone 0)
- **Context:** Invariants 2–3 require membership to be derived on the server and clinic switching to never show data from the previous workspace. Next.js 16 enables Cache Components (`use cache`) and router prefetching.
- **Decision:**
  1. Clinic-scoped pages live under `/[lang]/c/[clinicId]/…`. The `clinicId` segment is a **view hint only**. Every server render and action calls `resolveActiveClinic()` against memberships loaded for the authenticated user. An unknown, inactive or forged id gives a 404 (no existence disclosure).
  2. Because the clinic id is part of the URL, the client router cache is naturally keyed per clinic. **Switching clinic and signing out are full document loads** (plain `<a href>`, and a native form POST answered with 303). Next.js 16 keeps visited routes mounted but hidden (React `<Activity>`), and a client-side navigation would leave the previous clinic's rendered DOM and state in the tab.
  3. `use cache` / `use cache: remote` **must not** wrap tenant, medical, financial or membership data. Only static content (dictionaries, marketing) may be cached. Client-side query caches must build keys with `clinicScopedKey(clinicId, …)` and be cleared on sign-out.
  4. Session-dependent UI renders behind `<Suspense>`, as Cache Components requires.
- **Consequences:** Multiple tabs on different clinics work safely. A review checklist item: grep for `use cache` in every PR.
