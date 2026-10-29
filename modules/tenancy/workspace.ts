import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ACTIVE_CLINIC_COOKIE,
  FINANCE_CAPABILITIES,
  resolveActiveClinic,
  type ClinicCapability,
  type WorkspaceClinic,
} from "./active-clinic";

const membershipRowSchema = z.object({
  role: z.enum(["owner", "manager", "receptionist", "cashier", "doctor"]),
  clinic: z.object({
    id: z.uuid(),
    name: z.string(),
    account_state: z.enum(["pending", "active", "suspended", "closed"]),
  }),
});

const permissionRowSchema = z.object({
  capability: z.enum(["staff.manage", "appointments.manage"]),
  allowed: z.boolean(),
});

export type Workspace = {
  user: CurrentUser;
  clinics: WorkspaceClinic[];
  active: WorkspaceClinic | null;
  /** Capabilities of the caller in the active clinic (owners hold all). Presentation only; SQL re-checks. */
  capabilities: ClinicCapability[];
  /** The caller's active doctor record in the active clinic, if any. */
  doctorId: string | null;
  isPlatformAdmin: boolean;
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
  const [memberships, admin] = await Promise.all([
    supabase
      .from("clinic_memberships")
      .select("role, clinic:clinics!inner(id, name, account_state)")
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (memberships.error || admin.error) throw new Error("Failed to load workspace");

  const clinics: WorkspaceClinic[] = z
    .array(membershipRowSchema)
    .parse(memberships.data)
    .map((row) => ({
      clinicId: row.clinic.id,
      name: row.clinic.name,
      accountState: row.clinic.account_state,
      role: row.role,
    }));

  const requested = (await cookies()).get(ACTIVE_CLINIC_COOKIE)?.value;
  const active = resolveActiveClinic(clinics, requested);

  let capabilities: ClinicCapability[] = [];
  if (active?.role === "owner") {
    capabilities = ["staff.manage", "appointments.manage", ...FINANCE_CAPABILITIES];
  } else if (active) {
    const { data, error } = await supabase
      .from("clinic_role_permissions")
      .select("capability, allowed")
      .eq("clinic_id", active.clinicId)
      .eq("role", active.role);
    if (error) throw new Error("Failed to load permissions");
    const granted = z
      .array(permissionRowSchema)
      .parse(data)
      .filter((p) => p.allowed)
      .map((p) => p.capability);
    // Implicit role capabilities, mirroring the SQL helpers.
    const implicit: ClinicCapability[] =
      active.role === "receptionist" ? ["appointments.manage"] : active.role === "cashier" ? ["finance.collect"] : [];
    capabilities = [...new Set([...implicit, ...granted])];
  }

  let doctorId: string | null = null;
  if (active) {
    const { data, error } = await supabase
      .from("clinic_doctors")
      .select("id")
      .eq("clinic_id", active.clinicId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw new Error("Failed to load doctor profile");
    doctorId = data?.id ?? null;
  }

  return { user, clinics, active, capabilities, doctorId, isPlatformAdmin: admin.data !== null };
});
