import "server-only";
import type { PaymentEvent } from "@/lib/billing/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Records verified gateway callbacks through the service-role-only
 * `process_payment_webhook`, idempotent per event and per payment
 * (docs/adr/0004-public-booking-service-role.md).
 */
export async function processPaymentEvents(provider: string, events: PaymentEvent[]): Promise<string[]> {
  const client = createSupabaseServiceClient();
  const outcomes: string[] = [];
  for (const e of events) {
    const { data, error } = await client.rpc("process_payment_webhook", {
      p_provider: provider,
      p_event_id: e.eventId,
      p_provider_ref: e.providerRef,
      p_status: e.status,
      p_amount_minor: e.amountMinor,
    });
    if (error) throw new Error("payment_webhook_failed");
    outcomes.push(String(data));
  }
  return outcomes;
}
