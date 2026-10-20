import { NextResponse, type NextRequest } from "next/server";

import { isProtectedPath } from "@/lib/auth/protected-paths";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "@/lib/i18n/config";
import { refreshSession } from "@/lib/supabase/proxy";

/**
 * Request pre-processing:
 *  1. Adds a locale prefix (Arabic first) to paths without one.
 *  2. On protected paths, refreshes the Supabase session and redirects
 *     signed-out users to login. This is a convenience redirect only. Pages,
 *     actions and RLS remain the security boundary.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const [, firstSegment] = pathname.split("/");

  if (!isLocale(firstSegment)) {
    const locale = negotiateLocale(request.headers.get("accept-language"), request.cookies.get(LOCALE_COOKIE)?.value);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  if (!isProtectedPath(pathname)) {
    const response = NextResponse.next();
    response.cookies.set(LOCALE_COOKIE, firstSegment, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    return response;
  }

  const session = await refreshSession(request);
  session.response.headers.set("Cache-Control", "private, no-store");
  if (session.status === "authenticated") return session.response;

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = `/${firstSegment}/login`;
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  if (session.status === "unconfigured") loginUrl.searchParams.set("reason", "auth_unavailable");
  const redirect = NextResponse.redirect(loginUrl);
  redirect.headers.set("Cache-Control", "private, no-store");
  return redirect;
}

export const config = {
  matcher: [
    // Everything except Next internals, API routes and files with an extension.
    "/((?!api|_next/static|_next/image|_next/data|.*\\..*).*)",
  ],
};
