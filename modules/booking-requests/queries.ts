import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  id: z.uuid(),
  clinic_doctor_id: z.uuid(),
  session_id: z.uuid(),
  requested_starts_at: z.string().nullable(),
  requester_name: z.string(),
  requester_phone_e164: z.string(),
  status: z.enum([
    "submitted",
    "confirmed",
    "rejected",
    "alternative_proposed",
    "alternative_declined",
    "unavailable",
    "cancelled",
  ]),
  needs_attention: z.boolean(),
  decision_reason: z.string().nullable(),
  created_at: z.string(),
});

export type BookingRequest = z.infer<typeof requestSchema>;

/** Requests that still need reception (RLS: appointment managers). */
export async function getOpenRequests(clinicId: string): Promise<BookingRequest[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("appointment_requests")
    .select(
      "id, clinic_doctor_id, session_id, requested_starts_at, requester_name, requester_phone_e164, status, needs_attention, decision_reason, created_at",
    )
    .eq("clinic_id", clinicId)
    .in("status", ["submitted", "alternative_proposed", "alternative_declined", "unavailable"])
    .order("needs_attention", { ascending: false })
    .order("created_at");
  if (error) throw new Error("Failed to load requests");
  return z.array(requestSchema).parse(data);
}
