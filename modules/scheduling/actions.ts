"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getWorkspace } from "@/modules/tenancy/workspace";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function refresh(locale: string) {
  revalidatePath(`/${locale}/app`, "layout");
}

export async function addDoctor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      membershipId: z.uuid(),
      displayName: z.string().trim().min(2).max(200),
      specialty: z.string().trim().max(200),
    })
    .safeParse({
      membershipId: formData.get("membershipId"),
      displayName: formData.get("displayName"),
      specialty: formData.get("specialty") ?? "",
    });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("add_clinic_doctor", {
    p_membership_id: parsed.data.membershipId,
    p_display_name: parsed.data.displayName,
    p_specialty: parsed.data.specialty,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

const policySchema = z.object({
  clinicDoctorId: z.uuid(),
  method: z.enum(["timed", "queue"]),
  slotMinutes: z.coerce.number().int().min(5).max(240).optional(),
  overbooking: z.enum(["disallow", "receptionist_override", "doctor_or_owner_approval"]),
  queueOrdering: z.enum(["fcfs", "reservation_priority"]),
  walkIn: z.enum(["auto_append", "receptionist_placement"]),
  absentWhenCalled: z.enum(["move_to_end", "skip_and_prioritize", "receptionist_assignment"]),
  patientCancellation: z.enum(["receptionist_only", "patient_self_service", "patient_request_approval"]),
});

export async function saveSchedulingPolicy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = policySchema.safeParse({
    clinicDoctorId: formData.get("clinicDoctorId"),
    method: formData.get("method"),
    slotMinutes: formData.get("slotMinutes") || undefined,
    overbooking: formData.get("overbooking"),
    queueOrdering: formData.get("queueOrdering"),
    walkIn: formData.get("walkIn"),
    absentWhenCalled: formData.get("absentWhenCalled"),
    patientCancellation: formData.get("patientCancellation"),
  });
  if (!parsed.success) return { error: "invalid_input" };
  const d = parsed.data;
  const result = await callRpc("set_scheduling_policy", {
    p_clinic_doctor_id: d.clinicDoctorId,
    p_method: d.method,
    p_slot_minutes: d.slotMinutes ?? null,
    p_overbooking: d.overbooking,
    p_queue_ordering: d.queueOrdering,
    p_walk_in: d.walkIn,
    p_absent_when_called: d.absentWhenCalled,
    p_patient_cancellation: d.patientCancellation,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

const slotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(TIME),
  end: z.string().regex(TIME),
  capacity: z.number().int().min(1).max(500).nullable(),
});

export async function saveWeeklySchedule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicDoctorId = z.uuid().safeParse(formData.get("clinicDoctorId"));
  let slots: unknown;
  try {
    slots = JSON.parse(String(formData.get("slots") ?? "[]"));
  } catch {
    return { error: "invalid_input" };
  }
  const parsedSlots = z.array(slotSchema).max(50).safeParse(slots);
  if (!clinicDoctorId.success || !parsedSlots.success) return { error: "invalid_input" };
  if (parsedSlots.data.some((s) => s.end <= s.start)) return { error: "invalid_input" };

  const result = await callRpc("set_weekly_schedule", {
    p_clinic_doctor_id: clinicDoctorId.data,
    p_slots: parsedSlots.data,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function addScheduleException(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      clinicDoctorId: z.uuid(),
      date: z.iso.date(),
      kind: z.enum(["day_off", "extra_session"]),
      start: z.string().regex(TIME).optional(),
      end: z.string().regex(TIME).optional(),
      capacity: z.coerce.number().int().min(1).max(500).optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse({
      clinicDoctorId: formData.get("clinicDoctorId"),
      date: formData.get("date"),
      kind: formData.get("kind"),
      start: formData.get("start") || undefined,
      end: formData.get("end") || undefined,
      capacity: formData.get("capacity") || undefined,
      reason: formData.get("reason") || undefined,
    });
  if (!parsed.success) return { error: "invalid_input" };
  const d = parsed.data;
  const result = await callRpc("add_schedule_exception", {
    p_clinic_doctor_id: d.clinicDoctorId,
    p_date: d.date,
    p_kind: d.kind,
    p_start: d.start ?? null,
    p_end: d.end ?? null,
    p_capacity: d.capacity ?? null,
    p_reason: d.reason ?? null,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

export async function cancelSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ sessionId: z.uuid(), reason: z.string().trim().min(1).max(500) })
    .safeParse({ sessionId: formData.get("sessionId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: "reason_required" };
  const result = await callRpc("cancel_doctor_session", {
    p_session_id: parsed.data.sessionId,
    p_reason: parsed.data.reason,
  });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}

/** Owner switch for the public booking page (default off). */
export async function setOnlineBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicId = (await getWorkspace())?.active?.clinicId;
  const enabled = z.enum(["true", "false"]).safeParse(formData.get("enabled"));
  if (!clinicId || !enabled.success) return { error: "invalid_input" };
  const result = await callRpc("set_online_booking", { p_clinic_id: clinicId, p_enabled: enabled.data === "true" });
  if (result.error) return { error: result.error };
  refresh(locale);
  return { error: null, done: true };
}
