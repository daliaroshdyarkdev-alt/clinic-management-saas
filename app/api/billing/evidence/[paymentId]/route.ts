import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/telemetry/logger";

/** Platform admins open manual-payment evidence through an audited SQL function (60-second signed URL). */
export async function GET(_request: Request, ctx: RouteContext<"/api/billing/evidence/[paymentId]">) {
  const { paymentId } = await ctx.params;
  if (!z.uuid().safeParse(paymentId).success) return new NextResponse(null, { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });
  const { data, error } = await supabase.rpc("admin_record_payment_evidence_access", { p_payment_id: paymentId });
  if (error || typeof data !== "string") return new NextResponse(null, { status: 404 });
  const signed = await supabase.storage.from("billing-evidence").createSignedUrl(data, 60);
  if (signed.error || !signed.data) {
    logger.error({ event: "billing.evidence_sign_failed", errorName: signed.error?.name ?? "unknown" });
    return new NextResponse(null, { status: 404 });
  }
  const response = NextResponse.redirect(signed.data.signedUrl, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
