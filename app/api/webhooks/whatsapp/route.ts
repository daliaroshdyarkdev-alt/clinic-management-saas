import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { parseWebhook, verifySignature } from "@/lib/messaging/webhook";
import { logger } from "@/lib/telemetry/logger";
import { processWebhookEvents } from "@/modules/messaging/webhook-service";

const MAX_BODY_BYTES = 1_000_000;

function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Meta subscription handshake. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    sameSecret(params.get("hub.verify_token"), process.env.WHATSAPP_VERIFY_TOKEN)
  ) {
    return new NextResponse(params.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse(null, { status: 403 });
}

/** WAP-006/WAP-016: signed delivery receipts and replies; replays are no-ops. */
export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET ?? "")) {
    logger.warn({ event: "whatsapp.webhook_rejected", route: "/api/webhooks/whatsapp" });
    return new NextResponse(null, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  try {
    await processWebhookEvents(parseWebhook(payload));
  } catch {
    // The provider retries on non-2xx; processing is idempotent per event.
    logger.error({ event: "whatsapp.webhook_failed", route: "/api/webhooks/whatsapp" });
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}
