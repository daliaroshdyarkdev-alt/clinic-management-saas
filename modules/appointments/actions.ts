"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import { patientIdByChart } from "@/modules/patients/queries";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getWorkspace } from "@/modules/tenancy/workspace";

function refresh(locale: string) {
  revalidatePath(`/${locale}/app`, "layout");
}

async function chartToPatient(formData: FormData): Promise<string | null> {
  const clinicId = (await getWorkspace())?.active?.clinicId;
  const chart = z.coerce.number().int().positive().safeParse(formData.get("chartNumber"));
  if (!clinicId || !chart.success) return null;
  return patientIdByChart(clinicId, chart.data);
}

const overbookFields = (formData: FormData) => ({
  overbook: formData.get("overbook") === "on",
  reason: String(formData.get("reason") ?? "").trim() || null,
});

/** APT-001: reception books a patient (by chart number) into a session. */
export async function bookAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const sessionId = z.uuid().safeParse(formData.get("sessionId"));
  const startsAt = z.iso
    .datetime({ offset: true })
    .optional()
    .safeParse(formData.get("startsAt") || undefined);
  if (!sessionId.success || !startsAt.success) return { error: "invalid_input" };
  const patientId = await chartToPatient(formData);
  if (!patientId) return { error: "patient_not_found" };
  const { overbook, reason } = overbookFields(formData);
  const result = await callRpc("book_appointment", {
    p_session_id: sessionId.data,
    p_clinic_patient_id: patientId,
    p_starts_at: startsAt.data ?? null,
    p_overbook: overbook,
    p_reason: reason,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

/** APT-009: walk-in by chart number (queue sessions only). */
export async function registerWalkIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const sessionId = z.uuid().safeParse(formData.get("sessionId"));
  if (!sessionId.success) return { error: "invalid_input" };
  const patientId = await chartToPatient(formData);
  if (!patientId) return { error: "patient_not_found" };
  const { overbook, reason } = overbookFields(formData);
  const result = await callRpc("register_walk_in", {
    p_session_id: sessionId.data,
    p_clinic_patient_id: patientId,
    p_overbook: overbook,
    p_reason: reason,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

/** One-click transitions on an appointment (all rules enforced in SQL). */
export async function appointmentTransition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ appointmentId: z.uuid(), action: z.enum(["check_in", "complete", "absent", "return"]) })
    .safeParse({ appointmentId: formData.get("appointmentId"), action: formData.get("action") });
  if (!parsed.success) return { error: "invalid_input" };
  const args = { p_appointment_id: parsed.data.appointmentId };
  let result;
  switch (parsed.data.action) {
    case "check_in":
      result = await callRpc("check_in_appointment", { p_appointment_id: args.p_appointment_id });
      break;
    case "complete":
      result = await callRpc("complete_appointment", { p_appointment_id: args.p_appointment_id });
      break;
    case "absent":
      result = await callRpc("mark_absent", { p_appointment_id: args.p_appointment_id });
      break;
    case "return":
      result = await callRpc("return_from_absence", { p_appointment_id: args.p_appointment_id });
      break;
  }
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function cancelOrNoShow(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ appointmentId: z.uuid(), kind: z.enum(["cancel", "no_show"]), reason: z.string().trim().max(500) })
    .safeParse({
      appointmentId: formData.get("appointmentId"),
      kind: formData.get("kind"),
      reason: formData.get("reason") ?? "",
    });
  if (!parsed.success) return { error: "invalid_input" };
  const result =
    parsed.data.kind === "cancel"
      ? await callRpc("cancel_appointment", {
          p_appointment_id: parsed.data.appointmentId,
          p_reason: parsed.data.reason,
        })
      : await callRpc("mark_no_show", {
          p_appointment_id: parsed.data.appointmentId,
          p_reason: parsed.data.reason || null,
        });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function callNextPatient(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const sessionId = z.uuid().safeParse(formData.get("sessionId"));
  if (!sessionId.success) return { error: "invalid_input" };
  const result = await callRpc("call_next_patient", { p_session_id: sessionId.data });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function placeInQueue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ appointmentId: z.uuid(), beforeId: z.union([z.uuid(), z.literal("")]) })
    .safeParse({ appointmentId: formData.get("appointmentId"), beforeId: formData.get("beforeId") ?? "" });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("place_in_queue", {
    p_appointment_id: parsed.data.appointmentId,
    p_before_appointment_id: parsed.data.beforeId || null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

/** APT-011: the doctor or owner decides on an overbooking awaiting approval. */
export async function decideOverbooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ appointmentId: z.uuid(), approve: z.enum(["true", "false"]) })
    .safeParse({ appointmentId: formData.get("appointmentId"), approve: formData.get("approve") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("decide_overbooking", {
    p_appointment_id: parsed.data.appointmentId,
    p_approve: parsed.data.approve === "true",
    p_reason: null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}
