import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutRequest, PaymentEvent, PaymentProvider } from "./types.ts";

export const MOCK_SIGNATURE_HEADER = "x-mockpay-signature";

export function signMockPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Development/test gateway. Checkout opens a local page that can simulate
 * the provider's signed callback. Never enabled in production.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mockpay";

  constructor(
    private readonly secret: string,
    private readonly checkoutBase: string,
  ) {}

  async createCheckout(request: CheckoutRequest) {
    const providerRef = `mock_${request.paymentId}`;
    const url = new URL(this.checkoutBase);
    url.searchParams.set("ref", providerRef);
    url.searchParams.set("amount", String(request.amountMinor));
    return { providerRef, checkoutUrl: url.toString() };
  }

  parseWebhook(rawBody: string, headers: Headers): PaymentEvent[] | null {
    const given = headers.get(MOCK_SIGNATURE_HEADER);
    if (!given || !this.secret) return null;
    const expected = Buffer.from(signMockPayload(rawBody, this.secret), "hex");
    const actual = Buffer.from(given, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const b = body as Record<string, unknown>;
    if (
      typeof b.id !== "string" ||
      typeof b.ref !== "string" ||
      (b.status !== "paid" && b.status !== "failed") ||
      typeof b.amount_minor !== "number" ||
      !Number.isSafeInteger(b.amount_minor)
    ) {
      return null;
    }
    return [
      { eventId: b.id.slice(0, 200), providerRef: b.ref.slice(0, 200), status: b.status, amountMinor: b.amount_minor },
    ];
  }
}
