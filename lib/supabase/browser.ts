"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "@/lib/env/public";

/**
 * Browser client: publishable key only, every query subject to RLS. Returns
 * null when Supabase is not configured (UI preview / local dev without DB).
 */
export function createSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.publishableKey);
}
