# Go-live checklist

The product must **not** be declared production-ready until every item is signed off (CLAUDE.md, SRS §8). Engineering items marked ✅ are done in this repository; everything else is open.

## Legal and compliance (blocking)
- [ ] Hosting location and cross-border transfer approved under Law 151/2020 (OD-L02).
- [ ] Health-data processing licence/permits and DPO arrangements (OD-L02).
- [ ] Legal disclaimer text approved; replace draft version (OD-L01).
- [ ] Consent texts (WhatsApp, cross-clinic records) and privacy policy approved (OD-L05).
- [ ] Record retention and clinic-exit custodian export rules (OD-L03).
- [ ] Tax e-invoice/e-receipt obligations for clinic receipts and SaaS billing (OD-L04).
- [ ] Upload malware scanning service approved and integrated (OD-L06).

## Providers (blocking for those features)
- [ ] Meta WhatsApp onboarding: Tech Provider/BSP model, numbers, approved templates (OD-P01). Until then keep `WHATSAPP_PROVIDER=mock` or leave connections unconfigured.
- [ ] Payment gateway selected, contracted and certified (OD-P02). Until then only manual InstaPay/bank payments.
- [ ] Commercial terms: tiers, EGP prices, WhatsApp allowance/overage, grace length, restricted-mode scope (OD-B05, OD-B20, OD-B21).

## Product decisions
- [ ] Review every non-blocking OD-B default in `docs/OPEN_DECISIONS.md` and confirm or change it.
- [ ] Q97 support access stays **not built** unless approved (OD-S01).
- [ ] MFA policy for platform admins and owners (OD-S03).

## Engineering
- ✅ RLS on every exposed table, with cross-tenant denial tests (`tests/db`).
- ✅ Immutable finance records, balanced journals, race tests.
- ✅ Medical access limited to the treating doctor; cross-clinic grants per visit.
- ✅ Nonce CSP, security headers, rate limits on public endpoints and sign-in.
- ✅ Redacting logger; no patient data in logs or fixtures.
- [ ] Authenticated e2e journeys green in CI against `supabase start` (job `e2e-authenticated`).
- [ ] Load test of booking and queue functions at expected peak.
- [ ] Error monitoring with PII scrubbing selected (Sentry or similar, INV-7).
- [ ] Backups: PITR enabled and a restore drill completed (`backup-restore.md`).
- [ ] Penetration test by an independent party.
- [ ] Accessibility review of signed-in screens (automated checks cover public pages).
- [ ] Production secrets in the secret store; gitleaks clean; keys rotated after staging.
