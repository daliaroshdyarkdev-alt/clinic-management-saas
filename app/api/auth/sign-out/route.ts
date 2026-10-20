import { NextResponse, type NextRequest } from "next/server";

import { defaultLocale, isLocale } from "@/lib/i18n/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign-out endpoint. A native form POST answered with 303 makes the browser
 * load a fresh document, so no client state (preserved routes, caches) of the
 * signed-out session survives in the tab.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse(null, { status: 403 });

  const form = await request.formData().catch(() => null);
  const value = form?.get("locale");
  const locale = isLocale(value) ? value : defaultLocale;

  const supabase = await createSupabaseServerClient();
  // scope "local" ends this browser's session. Membership suspension (STA-003)
  // will revoke all sessions server-side in Milestone 1.
  await supabase?.auth.signOut({ scope: "local" });

  const response = NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * Rejects cross-site requests (defence in depth on top of SameSite cookies).
 * Compares the Origin host with the host the browser addressed, because the
 * server's own URL may differ (bind address, reverse proxy).
 */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser clients and same-origin navigations may omit it.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
