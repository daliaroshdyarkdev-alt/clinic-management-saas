"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setActiveClinicCookie } from "./cookie";

export type SwitchClinicResult = { ok: boolean };

/**
 * Selects the active clinic for this browser. The membership is re-verified
 * through RLS here and again on every request (SRS §2.1 invariants 2-3); the
 * cookie never grants access by itself.
 */
export async function switchClinic(clinicId: string): Promise<SwitchClinicResult> {
  const parsed = z.uuid().safeParse(clinicId);
  if (!parsed.success) return { ok: false };

  const user = await getCurrentUser();
  if (!user) return { ok: false };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_memberships")
    .select("clinic_id")
    .eq("user_id", user.id)
    .eq("clinic_id", parsed.data)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) return { ok: false };

  await setActiveClinicCookie(parsed.data);
  return { ok: true };
}
