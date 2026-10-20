import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "@/lib/env/public";

export type SessionCheck =
  | { status: "unconfigured"; response: NextResponse }
  | { status: "anonymous" | "authenticated"; response: NextResponse };

/**
 * Refreshes the Supabase session cookies for this request and reports whether
 * a user is signed in. The proxy uses this only for redirects. Pages and
 * actions re-verify the user themselves (lib/auth/session.ts).
 */
export async function refreshSession(request: NextRequest): Promise<SessionCheck> {
  let response = NextResponse.next({ request });
  const config = getSupabasePublicConfig();
  if (!config) return { status: "unconfigured", response };

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // getUser() validates the token with Supabase Auth instead of trusting the cookie.
  const { data, error } = await supabase.auth.getUser();
  return { status: !error && data.user ? "authenticated" : "anonymous", response };
}
