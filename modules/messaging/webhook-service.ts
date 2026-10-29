import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { WebhookEvent } from "@/lib/messaging/types";

/**
 * Records verified provider callbacks. Calls only the service-role-only
 * `process_whatsapp_webhook`, which is idempotent per provider event id
 * (docs/adr/0004-public-booking-service-role.md).
 */
export async function processWebhookEvents(events: WebhookEvent[]): Promise<void> {
  const client = createSupabaseServiceClient();
  for (const e of events) {
    const { error } = await client.rpc("process_whatsapp_webhook", {
      p_event_id: e.eventId,
      p_phone_number_id: e.phoneNumberId,
      p_kind: e.kind,
      p_provider_message_id: e.providerMessageId,
      p_status: e.status,
      p_billable: e.billable,
      p_error_code: e.errorCode,
      p_reply_id: e.replyId,
    });
    if (error) throw new Error("webhook_processing_failed");
  }
}
