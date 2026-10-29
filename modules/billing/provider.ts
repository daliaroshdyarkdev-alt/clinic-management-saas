import "server-only";
import { MockPaymentProvider } from "@/lib/billing/mock";
import type { PaymentProvider } from "@/lib/billing/types";
import { siteUrl } from "@/lib/site-url";

/**
 * The configured SaaS payment provider, or null when online payment is not
 * available (no gateway chosen yet, OD-P02). The mock provider is refused in
 * production.
 */
export function paymentProvider(locale: string): PaymentProvider | null {
  if (process.env.BILLING_PROVIDER !== "mock" || process.env.NODE_ENV === "production") return null;
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) return null;
  return new MockPaymentProvider(secret, `${siteUrl()}/${locale}/app/subscription/mock-checkout`);
}
