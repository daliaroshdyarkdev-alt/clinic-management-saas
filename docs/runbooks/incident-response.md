# Runbook — Incident response

## Severity
| Level | Examples | Response |
|---|---|---|
| SEV1 | Cross-tenant data exposure, medical record visible to a non-treating user, finance records altered, secret key leaked | Immediate. Page the on-call engineer and the product owner. |
| SEV2 | Clinics cannot book or collect payments; WhatsApp sending stopped for all clinics; payment webhooks failing | Within 1 hour |
| SEV3 | Single clinic issue, degraded performance | Next business day |

## First 30 minutes (SEV1/SEV2)
1. Open an incident record with the time, reporter and symptoms. Do not paste patient data into chat tools.
2. **Contain:**
   - Data exposure: disable the affected route or feature flag, or suspend the affected clinic (`admin_set_clinic_state`). Do not delete data.
   - Leaked key: rotate it in Supabase (secret key) or Meta (WhatsApp token), then update the secret store and redeploy.
   - Runaway messaging: stop the worker. Queued intents are kept and re-checked on restart.
3. **Preserve evidence:**
   - export the relevant `audit_events`, `clinical_access_events` and application logs. Logs are allow-listed and contain no patient data by design.
   - Never edit audit tables.
4. Assess scope: which clinics, which records, which time window.

## Notification
Personal-data breaches may require notification to the Personal Data Protection Center and to affected clinics within the legal deadline (Law 151/2020). The exact process is OPEN (OD-L02/L05): involve legal counsel at the start of any SEV1.

## Afterwards
- Write a blameless post-mortem within 5 working days, covering the timeline, root cause and fixes.
- Add a regression test (DB policy, race or e2e) reproducing the failure before closing the incident.
