"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import { siteUrl } from "@/lib/site-url";
import { patientIdByChart } from "@/modules/patients/queries";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getWorkspace } from "@/modules/tenancy/workspace";

async function patientFromChart(formData: FormData): Promise<string | null> {
  const clinicId = (await getWorkspace())?.active?.clinicId;
  const chart = z.coerce.number().int().positive().safeParse(formData.get("chartNumber"));
  if (!clinicId || !chart.success) return null;
  return patientIdByChart(clinicId, chart.data);
}

function refresh(locale: string) {
  revalidatePath(`/${locale}/app`, "layout");
}

/** APT-002: approve the requested time for a registered patient. */
export async function approveRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const requestId = z.uuid().safeParse(formData.get("requestId"));
  if (!requestId.success) return { error: "invalid_input" };
  const patientId = await patientFromChart(formData);
  if (!patientId) return { error: "patient_not_found" };
  const result = await callRpc("approve_booking_request", {
    p_request_id: requestId.data,
    p_clinic_patient_id: patientId,
    p_overbook: formData.get("overbook") === "on",
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function rejectRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ requestId: z.uuid(), reason: z.string().trim().max(500) })
    .safeParse({ requestId: formData.get("requestId"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("reject_booking_request", {
    p_request_id: parsed.data.requestId,
    p_reason: parsed.data.reason,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

/**
 * APT-002/003: propose another time. The patient link is returned once so
 * reception can send it (automatic WhatsApp delivery arrives in Milestone 5).
 * "slot" is "<sessionId>" or "<sessionId>|<ISO start>" for timed sessions.
 */
export async function proposeAlternative(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const requestId = z.uuid().safeParse(formData.get("requestId"));
  const [sessionPart, startPart] = String(formData.get("slot") ?? "").split("|");
  const sessionId = z.uuid().safeParse(sessionPart);
  const startsAt = z.iso
    .datetime({ offset: true })
    .optional()
    .safeParse(startPart || undefined);
  if (!requestId.success || !sessionId.success || !startsAt.success) return { error: "invalid_input" };
  const patientId = await patientFromChart(formData);
  if (!patientId) return { error: "patient_not_found" };

  const result = await callRpc<string>("propose_alternative", {
    p_request_id: requestId.data,
    p_clinic_patient_id: patientId,
    p_session_id: sessionId.data,
    p_starts_at: startsAt.data ?? null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true, link: `${siteUrl()}/${locale}/offer/${z.string().parse(result.data)}` };
}
