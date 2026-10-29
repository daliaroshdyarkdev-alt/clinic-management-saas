# ADR 0004 — Public booking through service-role-only SQL functions

**Status:** accepted.

## Context
Patients request appointments and answer alternative proposals without an account (APT-001..003). The `anon` role has no privileges at all (enforced by `tests/db/meta.test.ts`), and opening tables or functions to `anon` would expose the Data API to anyone with the publishable key.

## Decision
- Four SECURITY DEFINER functions (`public_booking_options`, `public_submit_booking_request`, `public_get_offer`, `public_respond_to_offer`) are executable **only by `service_role`**. Each validates its input, enforces clinic state and limits, and returns minimal data (no patient data, no ids beyond what the page needs).
- The Next.js server calls them through `lib/supabase/service.ts` (secret key from `SUPABASE_SECRET_KEY`, server-only). Only `modules/public-booking/service.ts` may use that client and it may only call `public_*` functions; `tests/unit/service-client-usage.test.ts` enforces this.
- Offer links carry a random 256-bit token; only its SHA-256 hash is stored and the hash column is not readable by staff.
- Online requests are off per clinic until the owner turns them on.

## Consequences
- The service-role key bypasses RLS if misused; the static test and code review are the controls. Keep the module small.
- Anti-bot challenges and per-IP rate limits are still OPEN (OD-B04); a per-phone limit (3 open requests per clinic) is the only abuse guard today. Add edge rate limiting before production.

## Amendment (Milestone 5 — WhatsApp)
- `modules/messaging/webhook-service.ts` may also use the service client, and only to call `process_whatsapp_webhook` (idempotent per provider event id), after the route has verified Meta's `X-Hub-Signature-256` HMAC. The static test enforces the per-file function allow-list.
- The background worker (`worker/index.ts`) runs outside Next.js with its own service-role client restricted in code to `worker_*` functions. Those functions are executable only by `service_role`.
- To send the patient their offer link, the raw offer token is kept in the outbox row (`message_intents.variables`). That column is excluded from every client grant (OD-E12).

## Amendment (Milestone 6 — SaaS billing)
- `modules/billing/webhook-service.ts` may use the service client only to call `process_payment_webhook`, after the gateway adapter has verified the callback signature. The function is idempotent per provider event id and per payment, and checks the amount against the server-computed price.
- Prices are always computed in SQL from the plan version; the client never submits an amount.
