import type { SendResult, TemplateMessage, WhatsAppProvider } from "./types.ts";

// Meta error codes worth retrying: throttling and temporary service errors.
const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** WhatsApp Business Cloud API adapter. */
export class MetaCloudProvider implements WhatsAppProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { graphVersion?: string; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = `https://graph.facebook.com/${options.graphVersion ?? "v21.0"}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendTemplate(message: TemplateMessage): Promise<SendResult> {
    const components: unknown[] = [
      {
        type: "body",
        parameters: Object.entries(message.parameters).map(([name, text]) => ({
          type: "text",
          parameter_name: name,
          text,
        })),
      },
      ...message.buttonPayloads.map((payload, index) => ({
        type: "button",
        sub_type: "quick_reply",
        index: String(index),
        parameters: [{ type: "payload", payload }],
      })),
    ];
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${encodeURIComponent(message.phoneNumberId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${message.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: message.to.replace(/^\+/, ""),
          type: "template",
          template: { name: message.templateName, language: { code: message.language }, components },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { ok: false, errorCode: "network_error", retryable: true };
    }
    const body = (await response.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { code?: number };
    } | null;
    const id = body?.messages?.[0]?.id;
    if (response.ok && id) return { ok: true, providerMessageId: id };
    const code = body?.error?.code;
    return {
      ok: false,
      errorCode: code ? `meta_${code}` : `http_${response.status}`,
      retryable:
        response.status >= 500 || response.status === 429 || (code !== undefined && RETRYABLE_META_CODES.has(code)),
    };
  }

  async checkHealth(phoneNumberId: string, accessToken: string): Promise<{ ok: boolean; errorCode?: string }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/${encodeURIComponent(phoneNumberId)}?fields=id`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok ? { ok: true } : { ok: false, errorCode: `http_${response.status}` };
    } catch {
      return { ok: false, errorCode: "network_error" };
    }
  }
}
