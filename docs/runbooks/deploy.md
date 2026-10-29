# Runbook — Deploy

> Development status: **not production-ready.** Hosting location is OPEN (OD-L02, Law 151/2020). Do not deploy with real patient data until the go-live checklist is signed off.

## Components
| Component | Image / source | Needs |
|---|---|---|
| Web (Next.js) | `Dockerfile` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (build + run), `SUPABASE_SECRET_KEY`, `SITE_URL`, `RATE_LIMIT_SALT`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, optional `BILLING_*` (run time, from the secret store) |
| Worker | `Dockerfile.worker` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SITE_URL`, `WHATSAPP_PROVIDER=meta`, `WHATSAPP_TOKEN__<REF>` per connection |
| Database | Supabase project (Postgres, Auth, Storage) | Migrations in `supabase/migrations/` |

The web app and worker must run in the same region as the database (OD-E05). Run exactly **one** worker per environment at first; the outbox is safe with more (`FOR UPDATE SKIP LOCKED`, leases), but one is simpler to observe.

## Release steps
1. CI must be green on the release commit:
   - format, typecheck and lint;
   - unit and DB tests;
   - smoke e2e, authenticated e2e and secret scan.
2. **Back up** the target database (see `backup-restore.md`) and note the backup id.
3. Apply migrations: `supabase db push --linked` (or `psql -f` in filename order).
   - Migrations are forward-only. Never edit an applied migration; add a new one.
   - Never run `supabase db reset` against a shared environment: it erases data.
4. Deploy the web image, then the worker image. The worker tolerates a newer schema; the web app must not run ahead of the database.
5. Smoke-check:
   - `GET /ar` returns 200 with a `Content-Security-Policy` header;
   - sign in as a synthetic staging user;
   - the worker logs `whatsapp.send` or idles without `worker.loop_failed`.
6. Record the release: commit SHA, migration list and backup id.

## Rollback
- Web/worker: redeploy the previous image.
- Database: migrations are not reversed automatically. Write a corrective forward migration. Restore from backup only for data corruption, following `backup-restore.md`, with sign-off from the product owner. A restore loses writes made after the backup, including finance postings.

## Secrets
- Store secrets only in the hosting secret store. Never use `NEXT_PUBLIC_*` for secrets; `tests/unit/service-client-usage.test.ts` checks this.
- Rotate `SUPABASE_SECRET_KEY` and WhatsApp tokens after any suspected exposure (see `incident-response.md`).
