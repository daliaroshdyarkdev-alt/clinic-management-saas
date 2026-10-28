import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const memberSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  role: z.enum(["owner", "manager", "receptionist", "cashier", "doctor"]),
  status: z.enum(["active", "suspended", "deactivated"]),
  status_changed_at: z.string(),
});

const profileSchema = z.object({ user_id: z.uuid(), full_name: z.string(), email: z.string().nullable() });

export type StaffMember = z.infer<typeof memberSchema> & { fullName: string; email: string | null };

const ROLE_ORDER = ["owner", "manager", "doctor", "receptionist", "cashier"] as const;
const STATUS_ORDER = ["active", "suspended", "deactivated"] as const;

/** Staff of a clinic. RLS returns rows only to the owner and to holders of staff.manage. */
export async function getStaff(clinicId: string): Promise<StaffMember[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_memberships")
    .select("id, user_id, role, status, status_changed_at")
    .eq("clinic_id", clinicId);
  if (error) throw new Error("Failed to load staff");
  const members = z.array(memberSchema).parse(data);
  if (members.length === 0) return [];

  const profiles = await supabase
    .from("user_profiles")
    .select("user_id, full_name, email")
    .in(
      "user_id",
      members.map((m) => m.user_id),
    );
  if (profiles.error) throw new Error("Failed to load staff profiles");
  const byUser = new Map(
    z
      .array(profileSchema)
      .parse(profiles.data)
      .map((p) => [p.user_id, p]),
  );

  return members
    .map((m) => ({
      ...m,
      fullName: byUser.get(m.user_id)?.full_name ?? "",
      email: byUser.get(m.user_id)?.email ?? null,
    }))
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        a.fullName.localeCompare(b.fullName),
    );
}

const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(["manager", "receptionist", "cashier", "doctor"]),
  expires_at: z.string(),
  created_at: z.string(),
});

export type OpenInvitation = z.infer<typeof invitationSchema>;

export async function getOpenInvitations(clinicId: string): Promise<OpenInvitation[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_invitations")
    .select("id, email, role, expires_at, created_at")
    .eq("clinic_id", clinicId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new Error("Failed to load invitations");
  return z.array(invitationSchema).parse(data);
}

export async function getManagerCanManageStaff(clinicId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_role_permissions")
    .select("allowed")
    .eq("clinic_id", clinicId)
    .eq("role", "manager")
    .eq("capability", "staff.manage")
    .maybeSingle();
  if (error) throw new Error("Failed to load permissions");
  return data?.allowed === true;
}

const previewSchema = z.object({
  status: z.enum(["valid", "invalid", "used", "revoked", "expired", "email_mismatch"]),
  clinic_name: z.string().nullable(),
  role: z.enum(["manager", "receptionist", "cashier", "doctor"]).nullable(),
  expires_at: z.string().nullable(),
});

export type InvitationPreview = z.infer<typeof previewSchema>;

export async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_invitation_preview", { p_token: token }).single();
  if (error) throw new Error("Failed to load invitation");
  return previewSchema.parse(data);
}
