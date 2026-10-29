import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { refreshSession } from "@/lib/supabase/proxy";

const intl = createIntlMiddleware(routing);
const PROTECTED = /^\/(ar|en)\/(app|admin)(\/|$)/;

export default async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  // Next.js reads the nonce from the request's CSP header while rendering.
  request.headers.set("content-security-policy", csp);
  request.headers.set("x-nonce", nonce);

  const response = intl(request);
  response.headers.set("Content-Security-Policy", csp);
  // Locale redirects (e.g. "/" -> "/ar") are returned as-is.
  if (response.headers.has("location")) return response;

  const userId = await refreshSession(request, response);

  const match = request.nextUrl.pathname.match(PROTECTED);
  if (match && !userId) {
    const login = new URL(`/${match[1]}/login`, request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    const redirect = NextResponse.redirect(login);
    redirect.headers.set("Content-Security-Policy", csp);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
