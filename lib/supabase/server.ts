import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicConfig } from "@/lib/env/public";

/**
 * Per-request server client acting AS THE SIGNED-IN USER (RLS applies). Create
 * a new client for every request and never share it between requests.
 *
 * A privileged (secret-key) client is intentionally absent in Milestone 0. When
 * it is added it must live in its own `server-only` module, be used only by
 * audited domain services, and never by request-scoped reads.
 */
export async function createSupabaseServerClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // proxy refreshes the session, so this can be ignored safely.
        }
      },
    },
  });
}
