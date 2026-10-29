import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consultationSchema, templateFieldSchema, type Consultation } from "./types";

/** Null when the caller is not the treating doctor (the SQL function decides). */
export async function getConsultation(consultationId: string): Promise<Consultation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_consultation", { p_consultation_id: consultationId });
  if (error) return null;
  return consultationSchema.parse(data);
}

export async function getTemplate(clinicDoctorId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("get_medical_template", { p_clinic_doctor_id: clinicDoctorId })
    .maybeSingle();
  if (error) return null;
  return data ? z.object({ version: z.number(), fields: z.array(templateFieldSchema) }).parse(data) : null;
}

export async function getPatientHistory(clinicPatientId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_patient_consultations", { p_clinic_patient_id: clinicPatientId });
  if (error) throw new Error("Failed to load history");
  return z
    .array(
      z.object({
        id: z.uuid(),
        appointment_id: z.uuid(),
        status: z.enum(["draft", "completed"]),
        started_at: z.string(),
        completed_at: z.string().nullable(),
      }),
    )
    .parse(data);
}

export async function getExternalGrants(consultationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_external_grants", { p_consultation_id: consultationId });
  if (error) throw new Error("Failed to load grants");
  return z
    .array(
      z.object({
        grant_id: z.uuid(),
        source_clinic_name: z.string(),
        records: z.number(),
        granted_at: z.string(),
        revoked_at: z.string().nullable(),
        revoke_reason: z.enum(["consultation_completed", "doctor_reassigned", "patient_withdrew"]).nullable(),
      }),
    )
    .parse(data);
}

const externalSchema = z.object({
  source_clinic: z.string(),
  consultations: z.array(
    z.object({
      completed_at: z.string(),
      doctor: z.string(),
      fields: z.array(templateFieldSchema),
      values: z.record(z.string(), z.unknown()),
      corrections: z.array(z.object({ body: z.string(), created_at: z.string() })),
    }),
  ),
});

export async function readExternalRecords(grantId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("read_external_records", { p_grant_id: grantId });
  if (error) return null;
  return externalSchema.parse(data);
}

/** Consultation status per appointment (no content), for boards. */
export async function getConsultationStatuses(appointmentIds: string[]) {
  if (appointmentIds.length === 0) return new Map<string, { consultationId: string; status: "draft" | "completed" }>();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("consultation_status_for_appointments", {
    p_appointment_ids: appointmentIds,
  });
  if (error) throw new Error("Failed to load consultation status");
  const rows = z
    .array(z.object({ appointment_id: z.uuid(), consultation_id: z.uuid(), status: z.enum(["draft", "completed"]) }))
    .parse(data);
  return new Map(rows.map((r) => [r.appointment_id, { consultationId: r.consultation_id, status: r.status }]));
}

/** Clinic patient id of an appointment (RLS: treating doctor or reception). */
export async function patientOfAppointment(appointmentId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("appointments")
    .select("clinic_patient_id")
    .eq("id", appointmentId)
    .maybeSingle();
  return (data?.clinic_patient_id as string | undefined) ?? null;
}
