import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { refreshSession } from "@/lib/supabase/proxy";

const intl = createIntlMiddleware(routing);
const PROTECTED = /^\/(ar|en)\/app(\/|$)/;

export default async function proxy(request: NextRequest) {
  const response = intl(request);
  // Locale redirects (e.g. "/" -> "/ar") are returned as-is.
  if (response.headers.has("location")) return response;

  const userId = await refreshSession(request, response);

  const match = request.nextUrl.pathname.match(PROTECTED);
  if (match && !userId) {
    const login = new URL(`/${match[1]}/login`, request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
