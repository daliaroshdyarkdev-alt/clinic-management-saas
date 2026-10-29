import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "./types.ts";

/** Verifies Meta's X-Hub-Signature-256 header over the raw request body. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

const str = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;

/**
 * Normalises a Cloud API webhook payload. Unknown shapes are skipped; message
 * text is never extracted (replies are routed to reception as alerts only).
 */
export function parseWebhook(payload: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return events;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      const phoneNumberId = str((value?.metadata as { phone_number_id?: unknown })?.phone_number_id, 30);
      if (!value || !phoneNumberId) continue;

      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        const status = str(s?.status, 20);
        const id = str(s?.id);
        if (!id || !status || !STATUSES.has(status)) continue;
        const billable = s?.pricing?.billable;
        const code = Array.isArray(s?.errors) ? s.errors[0]?.code : undefined;
        events.push({
          eventId: `status:${id}:${status}`,
          phoneNumberId,
          kind: "status",
          providerMessageId: id,
          status: status as WebhookEvent["status"],
          billable: typeof billable === "boolean" ? billable : null,
          errorCode: code !== undefined ? `meta_${String(code).slice(0, 20)}` : null,
          replyId: null,
        });
      }

      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        const id = str(m?.id);
        if (!id) continue;
        const replyId = str(m?.button?.payload, 100) ?? str(m?.interactive?.button_reply?.id, 100) ?? "free_text";
        events.push({
          eventId: `message:${id}`,
          phoneNumberId,
          kind: "reply",
          providerMessageId: null,
          status: null,
          billable: null,
          errorCode: null,
          replyId,
        });
      }
    }
  }
  return events;
}
