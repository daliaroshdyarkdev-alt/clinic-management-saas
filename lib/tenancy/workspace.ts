import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_CLINIC_COOKIE, resolveActiveClinic, type WorkspaceClinic } from "./active-clinic";

const membershipRowSchema = z.object({
  role: z.enum(["owner", "manager", "receptionist", "cashier", "doctor"]),
  clinic: z.object({
    id: z.uuid(),
    name: z.string(),
    account_state: z.enum(["pending", "active", "suspended", "closed"]),
  }),
});

export type Workspace = {
  user: CurrentUser;
  clinics: WorkspaceClinic[];
  active: WorkspaceClinic | null;
};

/**
 * The caller's authorised clinics, read through RLS (only active memberships
 * of the authenticated user are visible), plus the active clinic chosen from
 * them. Returns null when nobody is signed in.
 */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_memberships")
    .select("role, clinic:clinics!inner(id, name, account_state)")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (error) throw new Error("Failed to load clinic memberships");

  const clinics: WorkspaceClinic[] = z
    .array(membershipRowSchema)
    .parse(data)
    .map((row) => ({
      clinicId: row.clinic.id,
      name: row.clinic.name,
      accountState: row.clinic.account_state,
      role: row.role,
    }));

  const requested = (await cookies()).get(ACTIVE_CLINIC_COOKIE)?.value;
  return { user, clinics, active: resolveActiveClinic(clinics, requested) };
});
