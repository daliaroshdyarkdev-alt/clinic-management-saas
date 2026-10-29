import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const patientSchema = z.object({
  id: z.uuid(),
  chart_number: z.number(),
  address: z.string(),
  identity: z.object({
    full_name: z.string(),
    phone_e164: z.string(),
    date_of_birth: z.string(),
    gender: z.enum(["male", "female"]),
  }),
});

export type ClinicPatient = z.infer<typeof patientSchema>;

const SELECT =
  "id, chart_number, address, identity:patient_identities!inner(full_name, phone_e164, date_of_birth, gender)";

/** Demographic search (RLS: appointment managers of the clinic). */
export async function searchPatients(clinicId: string, term: string): Promise<ClinicPatient[]> {
  const supabase = await createSupabaseServerClient();
  const q = term.trim();
  let query = supabase
    .from("clinic_patients")
    .select(SELECT)
    .eq("clinic_id", clinicId)
    .order("chart_number", { ascending: false })
    .limit(50);
  if (/^\d{1,9}$/.test(q)) {
    query = query.eq("chart_number", Number(q));
  } else if (/^\+?\d{6,15}$/.test(q)) {
    query = query.ilike("identity.phone_e164", `%${q.replace(/^\+/, "")}%`);
  } else if (q.length >= 2) {
    // Escape LIKE wildcards in user input.
    query = query.ilike("identity.full_name", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error("Failed to search patients");
  return z.array(patientSchema).parse(data);
}

/** Resolves a chart number typed by reception into the clinic patient id. */
export async function patientIdByChart(clinicId: string, chartNumber: number): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("chart_number", chartNumber)
    .maybeSingle();
  if (error) throw new Error("Failed to load patient");
  return data?.id ?? null;
}

const duplicateSchema = z.object({
  id: z.uuid(),
  reasons: z.array(z.enum(["phone", "date_of_birth", "name", "identification"])),
  a: z.object({ chart_number: z.number() }),
  b: z.object({ chart_number: z.number() }),
});

/** PAT-002: open duplicate candidates (flag only; records are never merged). */
export async function getOpenDuplicates(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("duplicate_candidates")
    .select(
      "id, reasons, a:clinic_patients!duplicate_candidates_clinic_id_clinic_patient_id_fkey(chart_number), b:clinic_patients!duplicate_candidates_clinic_id_candidate_clinic_patient_id_fkey(chart_number)",
    )
    .eq("clinic_id", clinicId)
    .eq("status", "open")
    .limit(50);
  if (error) throw new Error("Failed to load duplicates");
  return z
    .array(duplicateSchema)
    .parse(data)
    .map((d) => ({ id: d.id, reasons: d.reasons, chartA: d.a.chart_number, chartB: d.b.chart_number }));
}
