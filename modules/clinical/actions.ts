"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getConsultation } from "./queries";
import { payloadFromForm, templateFieldSchema } from "./types";

/** Opens (or reopens) the consultation for an appointment and navigates to it. */
export async function openConsultation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const appointmentId = z.uuid().safeParse(formData.get("appointmentId"));
  if (!appointmentId.success) return { error: "invalid_input" };
  const result = await callRpc<string>("start_consultation", { p_appointment_id: appointmentId.data });
  if (result.error) return { error: result.error };
  redirect(`/${locale}/app/consultations/${z.uuid().parse(result.data)}`);
}

async function saveDraft(formData: FormData): Promise<{ error: ActionState["error"]; consultationId?: string }> {
  const consultationId = z.uuid().safeParse(formData.get("consultationId"));
  if (!consultationId.success) return { error: "invalid_input" };
  const consultation = await getConsultation(consultationId.data);
  if (!consultation) return { error: "forbidden" };
  const payload = payloadFromForm(consultation.fields, formData);
  const result = await callRpc("save_consultation_draft", {
    p_consultation_id: consultationId.data,
    p_payload: payload,
  });
  return { error: result.error, consultationId: consultationId.data };
}

export async function saveConsultation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const saved = await saveDraft(formData);
  if (saved.error) return { error: saved.error };
  if (formData.get("intent") === "complete") {
    const result = await callRpc("complete_consultation", { p_consultation_id: saved.consultationId });
    if (result.error) return { error: result.error };
  }
  revalidatePath(`/${locale}/app/consultations/${saved.consultationId}`);
  return { error: null, done: true };
}

export async function addCorrection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ consultationId: z.uuid(), body: z.string().trim().min(1).max(5000) })
    .safeParse({ consultationId: formData.get("consultationId"), body: formData.get("body") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("add_medical_correction", {
    p_consultation_id: parsed.data.consultationId,
    p_body: parsed.data.body,
  });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app/consultations/${parsed.data.consultationId}`);
  return { error: null, done: true };
}

/** MED-006: records in-person verified consent for this visit. */
export async function recordConsent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      consultationId: z.uuid(),
      phone: z
        .string()
        .trim()
        .regex(/^\+[1-9]\d{6,14}$/),
      dateOfBirth: z.iso.date(),
      identification: z.string().trim().max(100).optional(),
      evidence: z.string().trim().min(3).max(1000),
    })
    .safeParse({
      consultationId: formData.get("consultationId"),
      phone: formData.get("phone"),
      dateOfBirth: formData.get("dateOfBirth"),
      identification: formData.get("identification") || undefined,
      evidence: formData.get("evidence"),
    });
  if (!parsed.success) return { error: "consent_evidence_required" };
  const d = parsed.data;
  const result = await callRpc<number>("grant_cross_clinic_access", {
    p_consultation_id: d.consultationId,
    p_phone_e164: d.phone,
    p_date_of_birth: d.dateOfBirth,
    p_identification: d.identification ?? null,
    p_method: "in_person_id_verification",
    p_evidence_note: d.evidence,
  });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app/consultations/${d.consultationId}`);
  return { error: null, done: true };
}

export async function withdrawConsent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const grantId = z.uuid().safeParse(formData.get("grantId"));
  const consultationId = z.uuid().safeParse(formData.get("consultationId"));
  if (!grantId.success || !consultationId.success) return { error: "invalid_input" };
  const result = await callRpc("revoke_cross_clinic_access", { p_grant_id: grantId.data });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app/consultations/${consultationId.data}`);
  return { error: null, done: true };
}

export async function saveTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicDoctorId = z.uuid().safeParse(formData.get("clinicDoctorId"));
  let fields: unknown;
  try {
    fields = JSON.parse(String(formData.get("fields") ?? "[]"));
  } catch {
    return { error: "invalid_template" };
  }
  const parsed = z.array(templateFieldSchema).min(1).max(60).safeParse(fields);
  if (!clinicDoctorId.success || !parsed.success) return { error: "invalid_template" };
  const result = await callRpc("save_medical_template", {
    p_clinic_doctor_id: clinicDoctorId.data,
    p_fields: parsed.data,
  });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app/doctors/${clinicDoctorId.data}/template`);
  return { error: null, done: true };
}

/** Reception hands an open consultation to another doctor (MED-007). */
export async function reassignConsultation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ consultationId: z.uuid(), clinicDoctorId: z.uuid() })
    .safeParse({ consultationId: formData.get("consultationId"), clinicDoctorId: formData.get("clinicDoctorId") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("reassign_consultation", {
    p_consultation_id: parsed.data.consultationId,
    p_clinic_doctor_id: parsed.data.clinicDoctorId,
  });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app`, "layout");
  return { error: null, done: true };
}

export async function reviewDuplicate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ candidateId: z.uuid(), status: z.enum(["not_duplicate", "confirmed_duplicate"]) })
    .safeParse({ candidateId: formData.get("candidateId"), status: formData.get("status") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("review_duplicate_candidate", {
    p_candidate_id: parsed.data.candidateId,
    p_status: parsed.data.status,
  });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app/patients`);
  return { error: null, done: true };
}
