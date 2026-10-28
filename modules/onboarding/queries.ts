import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const disclaimerSchema = z.object({
  id: z.uuid(),
  version: z.string(),
  body_ar: z.string(),
  body_en: z.string(),
  is_draft: z.boolean(),
});

export type Disclaimer = z.infer<typeof disclaimerSchema>;

export async function getCurrentDisclaimer(): Promise<Disclaimer | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("legal_disclaimer_versions")
    .select("id, version, body_ar, body_en, is_draft")
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error("Failed to load disclaimer");
  return data ? disclaimerSchema.parse(data) : null;
}

const licenseSchema = z.object({
  id: z.uuid(),
  license_type: z.enum(["clinic_operating", "doctor_professional"]),
  revision: z.number(),
  review_status: z.enum(["submitted", "approved", "rejected", "replacement_requested", "superseded"]),
  review_reason: z.string().nullable(),
  uploaded_at: z.string(),
  reviewed_at: z.string().nullable(),
});

export type LicenseRecord = z.infer<typeof licenseSchema>;

/** All licence revisions of a clinic, newest first. RLS: owner or platform admin. */
export async function getClinicLicenses(clinicId: string): Promise<LicenseRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_licenses")
    .select("id, license_type, revision, review_status, review_reason, uploaded_at, reviewed_at")
    .eq("clinic_id", clinicId)
    .order("revision", { ascending: false });
  if (error) throw new Error("Failed to load licences");
  return z.array(licenseSchema).parse(data);
}

const trialSchema = z.object({ trial_started_at: z.string(), trial_ends_at: z.string() });

/** Trial dates (owner or platform admin); null before activation. */
export async function getClinicTrial(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clinic_subscriptions")
    .select("trial_started_at, trial_ends_at")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error("Failed to load trial");
  return data ? trialSchema.parse(data) : null;
}
