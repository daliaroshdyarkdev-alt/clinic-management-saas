import type { SendResult, TemplateMessage, WhatsAppProvider } from "./types.ts";

/** In-memory provider for local development and tests. Never contacts Meta. */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly sent: TemplateMessage[] = [];
  /** Queue of results to return before falling back to success. */
  readonly results: SendResult[] = [];
  healthy = true;
  private counter = 0;

  async sendTemplate(message: TemplateMessage): Promise<SendResult> {
    const next = this.results.shift();
    if (next && !next.ok) return next;
    this.sent.push(message);
    return next ?? { ok: true, providerMessageId: `wamid.mock.${++this.counter}` };
  }

  async checkHealth(): Promise<{ ok: boolean; errorCode?: string }> {
    return this.healthy ? { ok: true } : { ok: false, errorCode: "mock_unhealthy" };
  }
}
