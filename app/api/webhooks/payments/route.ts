import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/telemetry/logger";
import { paymentProvider } from "@/modules/billing/provider";
import { processPaymentEvents } from "@/modules/billing/webhook-service";

const MAX_BODY_BYTES = 100_000;

/** SUB-006 / scenario 12: signed gateway callbacks; replays are no-ops. */
export async function POST(request: NextRequest) {
  const provider = paymentProvider("ar");
  if (!provider) return new NextResponse(null, { status: 404 });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const events = provider.parseWebhook(raw, request.headers);
  if (!events) {
    logger.warn({ event: "billing.webhook_rejected", route: "/api/webhooks/payments" });
    return new NextResponse(null, { status: 401 });
  }
  try {
    await processPaymentEvents(provider.name, events);
  } catch {
    logger.error({ event: "billing.webhook_failed", route: "/api/webhooks/payments" });
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}
