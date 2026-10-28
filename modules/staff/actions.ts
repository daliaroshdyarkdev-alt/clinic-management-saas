"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toDomainError, type DomainErrorCode } from "@/modules/shared/db-errors";
import { setActiveClinicCookie } from "@/modules/tenancy/cookie";
import { getWorkspace } from "@/modules/tenancy/workspace";

export type StaffFormState = { error: DomainErrorCode | null; inviteLink?: string; done?: boolean };

const roleSchema = z.enum(["manager", "receptionist", "cashier", "doctor"]);

/** Active clinic from server state; the SQL functions re-check every permission. */
async function activeClinicId(): Promise<string | null> {
  return (await getWorkspace())?.active?.clinicId ?? null;
}

function refreshStaff(locale: string) {
  revalidatePath(`/${locale}/app/staff`);
}

/** STA-002: invitation link is returned once so the inviter can share it. */
export async function inviteStaff(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const locale = localeFrom(formData);
  const clinicId = await activeClinicId();
  if (!clinicId) return { error: "forbidden" };
  const parsed = z
    .object({ email: z.email().max(320), role: roleSchema })
    .safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: "invalid_input" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("invite_staff", { p_clinic_id: clinicId, p_email: parsed.data.email, p_role: parsed.data.role })
    .single();
  if (error) return { error: toDomainError(error) };
  const { token } = z.object({ token: z.string().min(20) }).parse(data);

  refreshStaff(locale);
  return { error: null, inviteLink: `${siteUrl()}/${locale}/invite/${token}` };
}

export async function revokeInvitation(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const locale = localeFrom(formData);
  const id = z.uuid().safeParse(formData.get("invitationId"));
  if (!id.success) return { error: "invalid_input" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: id.data });
  if (error) return { error: toDomainError(error) };
  refreshStaff(locale);
  return { error: null, done: true };
}

/** STA-003 / STA-005: suspend, reactivate or permanently deactivate. */
export async function setMembershipStatus(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      membershipId: z.uuid(),
      status: z.enum(["active", "suspended", "deactivated"]),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse({
      membershipId: formData.get("membershipId"),
      status: formData.get("status"),
      reason: formData.get("reason") ?? undefined,
    });
  if (!parsed.success) return { error: "invalid_input" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_membership_status", {
    p_membership_id: parsed.data.membershipId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? "",
  });
  if (error) return { error: toDomainError(error) };
  refreshStaff(locale);
  return { error: null, done: true };
}

/** STA-005: owner-only role assignment. */
export async function changeMemberRole(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ membershipId: z.uuid(), role: roleSchema })
    .safeParse({ membershipId: formData.get("membershipId"), role: formData.get("role") });
  if (!parsed.success) return { error: "invalid_input" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("change_member_role", {
    p_membership_id: parsed.data.membershipId,
    p_role: parsed.data.role,
  });
  if (error) return { error: toDomainError(error) };
  refreshStaff(locale);
  return { error: null, done: true };
}

/** STA-005: owner lets managers invite/suspend/deactivate operational staff. */
export async function setManagerStaffPermission(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const locale = localeFrom(formData);
  const clinicId = await activeClinicId();
  if (!clinicId) return { error: "forbidden" };
  const allowed = z.enum(["true", "false"]).safeParse(formData.get("allowed"));
  if (!allowed.success) return { error: "invalid_input" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_role_permission", {
    p_clinic_id: clinicId,
    p_role: "manager",
    p_capability: "staff.manage",
    p_allowed: allowed.data === "true",
  });
  if (error) return { error: toDomainError(error) };
  refreshStaff(locale);
  return { error: null, done: true };
}

/** STA-002: the invitee (signed in with the invited email) joins the clinic. */
export async function acceptInvitation(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const locale = localeFrom(formData);
  const token = z.string().min(20).max(100).safeParse(formData.get("token"));
  if (!token.success) return { error: "invitation_invalid" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token.data });
  if (error) return { error: toDomainError(error) };
  await setActiveClinicCookie(z.uuid().parse(data));
  redirect(`/${locale}/app`);
}
