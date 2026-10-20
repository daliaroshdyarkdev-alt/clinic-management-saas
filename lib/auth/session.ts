import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";

import type { Locale } from "@/lib/i18n/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Narrow user shape handed to UI. Never pass raw sessions or tokens to components. */
export type CurrentUser = {
  id: string;
  email: string | null;
};

/**
 * The authenticated user for this request, verified with Supabase Auth
 * (`getUser`, not the unverified cookie session). Null when signed out or when
 * Supabase is not configured.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Always evaluate per request, even when Supabase is not configured, so a
  // protected page can never be prerendered with a build-time auth decision.
  await connection();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Use at the top of every protected Server Component, Server Action and Route Handler. */
export async function requireUser(locale: Locale, nextPath: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}
