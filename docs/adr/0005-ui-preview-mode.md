# ADR-0005: Static UI preview with synthetic data

- **Status:** Accepted (Milestone 0)
- **Context:** Milestone 0 must show the shell, clinic switcher and role-aware navigation before identity tables exist (Milestone 1). Real protected routes must never be bypassed.
- **Decision:** `/[lang]/preview/…` renders the same shell components with synthetic fixtures from `lib/demo`. It contains no patient data, no medical content and no database access. It returns 404 unless `UI_PREVIEW_ENABLED=true`, and env validation **rejects** that flag when `APP_ENV=production`. Real routes (`/[lang]/c/…`, `/[lang]/admin`) always require authentication.
- **Consequences:** The preview may be removed or restricted once staging has seeded synthetic data (M1).
