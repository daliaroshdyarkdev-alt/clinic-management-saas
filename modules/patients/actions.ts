"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getWorkspace } from "@/modules/tenancy/workspace";

const schema = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/),
  dateOfBirth: z.iso.date(),
  gender: z.enum(["male", "female"]),
  address: z.string().trim().min(2).max(500),
  identification: z.string().trim().max(100).optional(),
  preferredLanguage: z.enum(["ar", "en"]),
});

/** PAT-001 (minimal registration for booking). Returns the chart number in the link field. */
export async function registerPatient(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicId = (await getWorkspace())?.active?.clinicId;
  if (!clinicId) return { error: "forbidden" };
  const parsed = schema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    dateOfBirth: formData.get("dateOfBirth"),
    gender: formData.get("gender"),
    address: formData.get("address"),
    identification: formData.get("identification") || undefined,
    preferredLanguage: formData.get("preferredLanguage"),
  });
  if (!parsed.success) return { error: "invalid_patient" };
  const d = parsed.data;
  const result = await callRpc<string>("register_clinic_patient", {
    p_clinic_id: clinicId,
    p_full_name: d.fullName,
    p_phone_e164: d.phone,
    p_date_of_birth: d.dateOfBirth,
    p_gender: d.gender,
    p_address: d.address,
    p_identification: d.identification ?? null,
    p_preferred_language: d.preferredLanguage,
  });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app/patients`);
  return { error: null, done: true };
}
