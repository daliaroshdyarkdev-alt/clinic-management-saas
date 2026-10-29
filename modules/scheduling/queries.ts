import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const doctorSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  display_name: z.string(),
  specialty: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
});

const policySchema = z.object({
  clinic_doctor_id: z.uuid(),
  method: z.enum(["timed", "queue"]),
  slot_minutes: z.number().nullable(),
  overbooking: z.enum(["disallow", "receptionist_override", "doctor_or_owner_approval"]),
  queue_ordering: z.enum(["fcfs", "reservation_priority"]),
  walk_in: z.enum(["auto_append", "receptionist_placement"]),
  absent_when_called: z.enum(["move_to_end", "skip_and_prioritize", "receptionist_assignment"]),
  patient_cancellation: z.enum(["receptionist_only", "patient_self_service", "patient_request_approval"]),
});

export type ClinicDoctor = z.infer<typeof doctorSchema> & { policy: z.infer<typeof policySchema> | null };
export type SchedulingPolicy = z.infer<typeof policySchema>;

export async function getClinicDoctors(clinicId: string): Promise<ClinicDoctor[]> {
  const supabase = await createSupabaseServerClient();
  const [doctors, policies] = await Promise.all([
    supabase
      .from("clinic_doctors")
      .select("id, user_id, display_name, specialty, status")
      .eq("clinic_id", clinicId)
      .order("display_name"),
    supabase
      .from("doctor_scheduling_policies")
      .select(
        "clinic_doctor_id, method, slot_minutes, overbooking, queue_ordering, walk_in, absent_when_called, patient_cancellation",
      )
      .eq("clinic_id", clinicId),
  ]);
  if (doctors.error || policies.error) throw new Error("Failed to load doctors");
  const byDoctor = new Map(
    z
      .array(policySchema)
      .parse(policies.data)
      .map((p) => [p.clinic_doctor_id, p]),
  );
  return z
    .array(doctorSchema)
    .parse(doctors.data)
    .map((d) => ({ ...d, policy: byDoctor.get(d.id) ?? null }));
}

const weeklySchema = z.object({
  id: z.uuid(),
  weekday: z.number(),
  start_time: z.string(),
  end_time: z.string(),
  capacity: z.number().nullable(),
});

export async function getWeeklySchedule(clinicDoctorId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("doctor_weekly_schedules")
    .select("id, weekday, start_time, end_time, capacity")
    .eq("clinic_doctor_id", clinicDoctorId)
    .order("weekday")
    .order("start_time");
  if (error) throw new Error("Failed to load schedule");
  return z.array(weeklySchema).parse(data);
}

const exceptionSchema = z.object({
  id: z.uuid(),
  exception_date: z.string(),
  kind: z.enum(["day_off", "extra_session"]),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  reason: z.string().nullable(),
});

export async function getUpcomingExceptions(clinicDoctorId: string, fromDate: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("doctor_schedule_exceptions")
    .select("id, exception_date, kind, start_time, end_time, reason")
    .eq("clinic_doctor_id", clinicDoctorId)
    .gte("exception_date", fromDate)
    .order("exception_date");
  if (error) throw new Error("Failed to load exceptions");
  return z.array(exceptionSchema).parse(data);
}

const sessionSchema = z.object({
  id: z.uuid(),
  clinic_doctor_id: z.uuid(),
  session_date: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  method: z.enum(["timed", "queue"]),
  capacity: z.number().nullable(),
  slot_minutes: z.number().nullable(),
  status: z.enum(["scheduled", "cancelled"]),
  cancelled_reason: z.string().nullable(),
});

export type DoctorSession = z.infer<typeof sessionSchema>;

/** Sessions in a date range; generates missing ones from the schedules first. */
export async function getSessions(
  clinicId: string,
  from: string,
  to: string,
  doctorId?: string,
): Promise<DoctorSession[]> {
  const supabase = await createSupabaseServerClient();
  const ensure = await supabase.rpc("ensure_sessions", { p_clinic_id: clinicId, p_from: from, p_to: to });
  if (ensure.error) throw new Error("Failed to prepare sessions");
  let query = supabase
    .from("doctor_sessions")
    .select(
      "id, clinic_doctor_id, session_date, starts_at, ends_at, method, capacity, slot_minutes, status, cancelled_reason",
    )
    .eq("clinic_id", clinicId)
    .gte("session_date", from)
    .lte("session_date", to)
    .order("starts_at");
  if (doctorId) query = query.eq("clinic_doctor_id", doctorId);
  const { data, error } = await query;
  if (error) throw new Error("Failed to load sessions");
  return z.array(sessionSchema).parse(data);
}

const availabilitySchema = z.object({ remaining: z.number().nullable(), free_slots: z.array(z.string()) });

export async function getSessionAvailability(sessionId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_session_availability", { p_session_id: sessionId }).single();
  if (error) throw new Error("Failed to load availability");
  return availabilitySchema.parse(data);
}

/** Members eligible to be added as doctors (active doctor or owner memberships). Owner only via RLS. */
export async function getDoctorCandidates(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_memberships")
    .select("id, user_id, role")
    .eq("clinic_id", clinicId)
    .eq("status", "active")
    .in("role", ["doctor", "owner"]);
  if (error) throw new Error("Failed to load members");
  const members = z.array(z.object({ id: z.uuid(), user_id: z.uuid(), role: z.string() })).parse(data);
  if (members.length === 0) return [];
  const profiles = await supabase
    .from("user_profiles")
    .select("user_id, full_name")
    .in(
      "user_id",
      members.map((m) => m.user_id),
    );
  if (profiles.error) throw new Error("Failed to load profiles");
  const names = new Map((profiles.data ?? []).map((p) => [p.user_id as string, p.full_name as string]));
  return members.map((m) => ({ membershipId: m.id, userId: m.user_id, name: names.get(m.user_id) ?? "" }));
}

export async function getOnlineBookingEnabled(clinicId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinics")
    .select("online_booking_enabled")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw new Error("Failed to load clinic");
  return data?.online_booking_enabled === true;
}
