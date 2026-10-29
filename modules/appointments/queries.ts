import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const appointmentSchema = z.object({
  id: z.uuid(),
  session_id: z.uuid(),
  clinic_doctor_id: z.uuid(),
  method: z.enum(["timed", "queue"]),
  starts_at: z.string().nullable(),
  reservation_number: z.number().nullable(),
  waiting_number: z.number().nullable(),
  queue_rank: z.coerce.number().nullable(),
  placement_open: z.boolean(),
  status: z.enum([
    "awaiting_approval",
    "booked",
    "checked_in",
    "called",
    "absent",
    "completed",
    "cancelled",
    "no_show",
  ]),
  is_overbooked: z.boolean(),
  source: z.enum(["reception", "walk_in", "online_request"]),
  patient: z.object({
    chart_number: z.number(),
    identity: z.object({ full_name: z.string(), phone_e164: z.string() }),
  }),
});

export type AppointmentRow = z.infer<typeof appointmentSchema>;

const SELECT =
  "id, session_id, clinic_doctor_id, method, starts_at, reservation_number, waiting_number, queue_rank, placement_open, status, is_overbooked, source, patient:clinic_patients!inner(chart_number, identity:patient_identities!inner(full_name, phone_e164))";

/** Appointments of the given sessions visible to the caller (RLS). */
export async function getAppointmentsForSessions(sessionIds: string[]): Promise<AppointmentRow[]> {
  if (sessionIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("appointments").select(SELECT).in("session_id", sessionIds);
  if (error) throw new Error("Failed to load appointments");
  return z.array(appointmentSchema).parse(data);
}

const ACTIVE_ORDER = [
  "called",
  "checked_in",
  "absent",
  "awaiting_approval",
  "booked",
  "completed",
  "no_show",
  "cancelled",
];

/** Display order inside a session: queue order for those waiting, then bookings. */
export function sortForQueue(rows: AppointmentRow[]): AppointmentRow[] {
  return [...rows].sort((a, b) => {
    const s = ACTIVE_ORDER.indexOf(a.status) - ACTIVE_ORDER.indexOf(b.status);
    if (s !== 0) return s;
    if (a.status === "checked_in") return (a.queue_rank ?? 0) - (b.queue_rank ?? 0);
    if (a.method === "timed") return (a.starts_at ?? "").localeCompare(b.starts_at ?? "");
    return (a.reservation_number ?? 0) - (b.reservation_number ?? 0);
  });
}
