import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv } from "@/lib/env";

/**
 * Privileged client for the public (patient) booking flow only. It may call
 * just the `public_*` SQL functions that are granted to service_role, each of
 * which validates its input and returns minimal data. Never import this from
 * client components, and never use it to read tables directly.
 */
export function createSupabaseServiceClient() {
  const secret = z.string().min(20).safeParse(process.env.SUPABASE_SECRET_KEY);
  if (!secret.success) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret.data, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
