"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toDomainError, type DomainErrorCode } from "@/modules/shared/db-errors";

export type AdminFormState = { error: DomainErrorCode | null; done?: boolean };

function refresh(locale: string, clinicId: string) {
  revalidatePath(`/${locale}/admin`);
  revalidatePath(`/${locale}/admin/clinics/${clinicId}`);
}

/** ONB-003 */
export async function reviewLicense(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      clinicId: z.uuid(),
      licenseId: z.uuid(),
      decision: z.enum(["approved", "rejected", "replacement_requested"]),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse({
      clinicId: formData.get("clinicId"),
      licenseId: formData.get("licenseId"),
      decision: formData.get("decision"),
      reason: formData.get("reason") ?? undefined,
    });
  if (!parsed.success) return { error: "invalid_input" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_review_license", {
    p_license_id: parsed.data.licenseId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason ?? "",
  });
  if (error) return { error: toDomainError(error) };
  refresh(locale, parsed.data.clinicId);
  return { error: null, done: true };
}

/** ONB-004 */
export async function activateClinic(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const locale = localeFrom(formData);
  const clinicId = z.uuid().safeParse(formData.get("clinicId"));
  if (!clinicId.success) return { error: "invalid_input" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_activate_clinic", { p_clinic_id: clinicId.data });
  if (error) return { error: toDomainError(error) };
  refresh(locale, clinicId.data);
  return { error: null, done: true };
}

/** ONB-005 */
export async function setClinicState(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      clinicId: z.uuid(),
      toState: z.enum(["active", "suspended", "closed"]),
      reason: z.string().trim().max(1000),
    })
    .safeParse({
      clinicId: formData.get("clinicId"),
      toState: formData.get("toState"),
      reason: formData.get("reason"),
    });
  if (!parsed.success) return { error: "invalid_input" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_clinic_state", {
    p_clinic_id: parsed.data.clinicId,
    p_to_state: parsed.data.toState,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: toDomainError(error) };
  refresh(locale, parsed.data.clinicId);
  return { error: null, done: true };
}
