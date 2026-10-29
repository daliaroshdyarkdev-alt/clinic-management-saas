# Runbook — Backup and restore

Medical and financial records must never be lost or silently altered (SRS invariants 4–6). Retention periods are OPEN (OD-L03): until decided, **nothing is deleted**.

## Backups
- Enable Supabase point-in-time recovery (PITR) on production. Daily backups alone are not enough for finance.
- Take an extra logical backup before every migration:
  ```bash
  pg_dump --format=custom --no-owner --file "backup-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
  ```
- Storage buckets (`licenses`, `billing-evidence`) are not included in database backups. Replicate them with the storage provider's versioning or a scheduled copy to a second private bucket in the same jurisdiction (OD-L02).
- Encrypt backups at rest. Restrict access to the platform operations role. Never copy backups to personal devices.

## Restore drill (quarterly, on a scratch project)
1. Restore the latest backup into a **new** project:
   ```bash
   pg_restore --no-owner --dbname "$SCRATCH_URL" backup.dump
   ```
2. Run the invariant checks:
   - every `financial_transactions` row has balanced `journal_entries`, i.e. `sum(debit) = sum(credit)` per transaction;
   - row counts for `clinical.consultations`, `financial_transactions` and `subscription_periods` match the source at backup time;
   - `pnpm test:db` passes against the restored schema. Point `TEST_DB_ADMIN_URL` at the scratch server; the tests create their own throw-away database.
3. Record the duration (RTO) and the data-loss window (RPO) in the operations log.

## Production restore (data corruption only)
1. Declare an incident (`incident-response.md`) and stop the worker to avoid sending stale messages.
2. Restore into a new project with PITR, to the moment before the corruption.
3. Compare finance and clinical counts between the old and restored projects. Export any legitimate writes made after the restore point for manual re-entry by the clinics affected.
4. Switch the app to the restored project. Restart the worker only after reminders that are now obsolete have been checked: the claim re-checks appointment state, so stale reminders become `obsolete`.
