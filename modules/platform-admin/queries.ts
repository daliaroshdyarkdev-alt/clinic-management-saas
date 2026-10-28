import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const clinicSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  account_state: z.enum(["pending", "active", "suspended", "closed"]),
  created_at: z.string(),
  activated_at: z.string().nullable(),
});

export type AdminClinic = z.infer<typeof clinicSchema>;

/** Clinic directory for platform admins (operational metadata only, ADM-003). */
export async function listClinics(): Promise<AdminClinic[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, account_state, created_at, activated_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error("Failed to load clinics");
  return z.array(clinicSchema).parse(data);
}

export async function getAdminClinic(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const [clinic, owner, decisions, events] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, name, account_state, created_at, activated_at")
      .eq("id", clinicId)
      .maybeSingle(),
    supabase
      .from("clinic_memberships")
      .select("user_id")
      .eq("clinic_id", clinicId)
      .eq("role", "owner")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("clinic_review_decisions")
      .select("id, license_id, decision, reason, decided_at")
      .eq("clinic_id", clinicId)
      .order("decided_at", { ascending: false }),
    supabase
      .from("clinic_state_events")
      .select("id, from_state, to_state, reason, occurred_at")
      .eq("clinic_id", clinicId)
      .order("occurred_at", { ascending: false }),
  ]);
  if (clinic.error || owner.error || decisions.error || events.error) throw new Error("Failed to load clinic");
  if (!clinic.data) return null;

  let ownerProfile: { full_name: string; email: string | null; phone_e164: string | null } | null = null;
  if (owner.data) {
    const profile = await supabase
      .from("user_profiles")
      .select("full_name, email, phone_e164")
      .eq("user_id", owner.data.user_id)
      .maybeSingle();
    if (profile.error) throw new Error("Failed to load owner");
    ownerProfile = profile.data;
  }

  return {
    clinic: clinicSchema.parse(clinic.data),
    owner: ownerProfile,
    decisions: z
      .array(
        z.object({
          id: z.uuid(),
          license_id: z.uuid(),
          decision: z.enum(["approved", "rejected", "replacement_requested"]),
          reason: z.string().nullable(),
          decided_at: z.string(),
        }),
      )
      .parse(decisions.data),
    events: z
      .array(
        z.object({
          id: z.uuid(),
          from_state: z.enum(["pending", "active", "suspended", "closed"]).nullable(),
          to_state: z.enum(["pending", "active", "suspended", "closed"]),
          reason: z.string().nullable(),
          occurred_at: z.string(),
        }),
      )
      .parse(events.data),
  };
}
