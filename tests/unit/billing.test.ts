import { describe, expect, it } from "vitest";
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider, signMockPayload } from "@/lib/billing/mock";

const SECRET = "synthetic-billing-secret";
const provider = new MockPaymentProvider(SECRET, "https://example.test/en/app/subscription/mock-checkout");
const signed = (body: string, secret = SECRET) =>
  new Headers({ [MOCK_SIGNATURE_HEADER]: signMockPayload(body, secret) });

describe("mock payment provider (SUB-006)", () => {
  it("creates a checkout reference bound to the payment", async () => {
    const r = await provider.createCheckout({
      paymentId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      amountMinor: 100000,
      description: "x",
      returnUrl: "https://example.test",
    });
    expect(r.providerRef).toBe("mock_7c9e6679-7425-40de-944b-e07fc1f90ae7");
    expect(new URL(r.checkoutUrl).searchParams.get("amount")).toBe("100000");
  });

  it("accepts only correctly signed, well-formed callbacks", () => {
    const body = JSON.stringify({ id: "evt_1", ref: "mock_x", status: "paid", amount_minor: 100 });
    expect(provider.parseWebhook(body, signed(body))).toEqual([
      { eventId: "evt_1", providerRef: "mock_x", status: "paid", amountMinor: 100 },
    ]);
    expect(provider.parseWebhook(body, signed(body, "other-secret-value"))).toBeNull();
    expect(provider.parseWebhook(body, new Headers())).toBeNull();
    expect(provider.parseWebhook(body.replace("100", "1"), signed(body))).toBeNull();
    const bad = JSON.stringify({ id: "evt_2", ref: "mock_x", status: "refunded", amount_minor: 1 });
    expect(provider.parseWebhook(bad, signed(bad))).toBeNull();
    const fractional = JSON.stringify({ id: "evt_3", ref: "mock_x", status: "paid", amount_minor: 1.5 });
    expect(provider.parseWebhook(fractional, signed(fractional))).toBeNull();
  });

  it("an empty secret never verifies", () => {
    const open = new MockPaymentProvider("", "https://example.test");
    const body = "{}";
    expect(open.parseWebhook(body, signed(body, ""))).toBeNull();
  });
});
