/**
 * WhatsApp provider adapter (CLAUDE.md: adapter interfaces with mock
 * providers for local tests). Kept free of Next.js and path aliases so the
 * background worker can run it directly with Node.
 */
export type TemplateKey =
  | "request_received"
  | "request_approved"
  | "request_rejected"
  | "alternative_proposal"
  | "reminder"
  | "cancellation"
  | "session_cancellation"
  | "no_show";

export type TemplateMessage = {
  phoneNumberId: string;
  /** Access token resolved from the worker's secret store, never from the database. */
  accessToken: string;
  to: string;
  templateName: string;
  language: "ar" | "en";
  /** Named body parameters. Display data only, never medical content. */
  parameters: Record<string, string>;
  /** Quick-reply button payloads in button order. */
  buttonPayloads: string[];
};

export type SendResult = { ok: true; providerMessageId: string } | { ok: false; errorCode: string; retryable: boolean };

export interface WhatsAppProvider {
  sendTemplate(message: TemplateMessage): Promise<SendResult>;
  checkHealth(phoneNumberId: string, accessToken: string): Promise<{ ok: boolean; errorCode?: string }>;
}

/** A provider callback normalised for `process_whatsapp_webhook`. */
export type WebhookEvent = {
  eventId: string;
  phoneNumberId: string;
  kind: "status" | "reply";
  providerMessageId: string | null;
  status: "sent" | "delivered" | "read" | "failed" | null;
  billable: boolean | null;
  errorCode: string | null;
  replyId: string | null;
};
