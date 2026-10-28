import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/telemetry/logger";

const SIGNED_URL_SECONDS = 60;

/**
 * Opens a licence file through a 60-second signed URL. Platform admins go
 * through an audited SQL function; clinic owners read their own record via
 * RLS. Storage policies independently restrict who can sign the object.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/licenses/[licenseId]">) {
  const { licenseId } = await ctx.params;
  if (!z.uuid().safeParse(licenseId).success) return new NextResponse(null, { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });

  const { data: admin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  let path: string | null = null;
  if (admin) {
    const { data, error } = await supabase.rpc("admin_record_license_access", { p_license_id: licenseId });
    if (!error) path = z.string().parse(data);
  } else {
    const { data } = await supabase.from("clinic_licenses").select("storage_path").eq("id", licenseId).maybeSingle();
    path = data?.storage_path ?? null;
  }
  if (!path) return new NextResponse(null, { status: 404 });

  const signed = await supabase.storage.from("licenses").createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data) {
    logger.error({ event: "license.sign_failed", errorName: signed.error?.name ?? "unknown" });
    return new NextResponse(null, { status: 404 });
  }

  const response = NextResponse.redirect(signed.data.signedUrl, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
