/**
 * SaaS payment gateway adapter (SUB-006). The gateway is OPEN (OD-P02), so
 * only a mock provider exists; a real adapter implements this interface.
 */
export type CheckoutRequest = {
  paymentId: string;
  amountMinor: number;
  description: string;
  returnUrl: string;
};

export type PaymentEvent = {
  eventId: string;
  providerRef: string;
  status: "paid" | "failed";
  amountMinor: number;
};

export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<{ providerRef: string; checkoutUrl: string }>;
  /** Verifies the callback's authenticity and normalises it; null if invalid. */
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent[] | null;
}
