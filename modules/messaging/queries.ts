import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Reads for the WhatsApp page. RLS decides what each caller sees. */
const settingsSchema = z.object({
  enabled_events: z.array(z.string()),
  reminder_offsets_minutes: z.array(z.number()),
  default_language: z.enum(["ar", "en"]),
});

const connectionSchema = z.object({
  ownership_mode: z.enum(["clinic_owned", "platform_managed"]),
  phone_number_id: z.string(),
  display_phone: z.string().nullable(),
  credential_ref: z.string(),
  status: z.enum(["connected", "disconnected", "error"]),
  last_checked_at: z.string().nullable(),
});

const intentSchema = z.object({
  id: z.uuid(),
  template_key: z.string(),
  status: z.string(),
  recipient_phone_e164: z.string(),
  scheduled_for: z.string(),
  attempts: z.number(),
  last_error_code: z.string().nullable(),
  billing_kind: z.string().nullable(),
  manual: z.boolean(),
});

const alertSchema = z.object({ id: z.uuid(), kind: z.string(), created_at: z.string() });

const budgetSchema = z.object({
  period_month: z.string(),
  allowance_count: z.number(),
  used_count: z.number(),
  overage_unit_minor: z.number().nullable(),
  overage_spent_minor: z.number(),
});

const templateSchema = z.object({
  id: z.uuid(),
  template_key: z.string(),
  language: z.enum(["ar", "en"]),
  provider_template_name: z.string(),
  body_preview: z.string(),
  approved: z.boolean(),
});

const overrideSchema = z.object({
  id: z.uuid(),
  clinic_id: z.uuid(),
  catalog_id: z.uuid(),
  provider_template_name: z.string(),
  body_preview: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
});

export type MessageIntentRow = z.infer<typeof intentSchema>;
export type TemplateRow = z.infer<typeof templateSchema>;
export type OverrideRow = z.infer<typeof overrideSchema>;

export async function getMessagingOverview(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const [settings, connection, intents, alerts, budget, ceiling] = await Promise.all([
    supabase
      .from("clinic_notification_settings")
      .select("enabled_events, reminder_offsets_minutes, default_language")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase
      .from("whatsapp_connections")
      .select("ownership_mode, phone_number_id, display_phone, credential_ref, status, last_checked_at")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase
      .from("message_intents")
      .select(
        "id, template_key, status, recipient_phone_e164, scheduled_for, attempts, last_error_code, billing_kind, manual",
      )
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("messaging_alerts")
      .select("id, kind, created_at")
      .eq("clinic_id", clinicId)
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("messaging_budgets")
      .select("period_month, allowance_count, used_count, overage_unit_minor, overage_spent_minor")
      .eq("clinic_id", clinicId)
      .order("period_month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("messaging_spend_limits").select("ceiling_minor").eq("clinic_id", clinicId).maybeSingle(),
  ]);
  for (const r of [settings, connection, intents, alerts, budget, ceiling]) {
    if (r.error) throw new Error("Failed to load messaging data");
  }
  return {
    settings: settings.data ? settingsSchema.parse(settings.data) : null,
    connection: connection.data ? connectionSchema.parse(connection.data) : null,
    intents: z.array(intentSchema).parse(intents.data),
    alerts: z.array(alertSchema).parse(alerts.data),
    budget: budget.data ? budgetSchema.parse(budget.data) : null,
    ceilingMinor: ceiling.data ? Number(ceiling.data.ceiling_minor) : null,
  };
}

export async function getTemplates(): Promise<TemplateRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("whatsapp_template_catalog")
    .select("id, template_key, language, provider_template_name, body_preview, approved")
    .order("template_key")
    .order("language");
  if (error) throw new Error("Failed to load templates");
  return z.array(templateSchema).parse(data);
}

/** Owners see their clinic's requests; platform admins see all pending ones. */
export async function getOverrides(clinicId: string | null): Promise<OverrideRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("clinic_template_overrides")
    .select("id, clinic_id, catalog_id, provider_template_name, body_preview, status")
    .order("created_at", { ascending: false })
    .limit(100);
  query = clinicId ? query.eq("clinic_id", clinicId) : query.eq("status", "pending");
  const { data, error } = await query;
  if (error) throw new Error("Failed to load template requests");
  return z.array(overrideSchema).parse(data);
}

export async function getPlatformSettings(): Promise<{ key: string; value: unknown }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("platform_settings").select("key, value").order("key");
  if (error) throw new Error("Failed to load platform settings");
  return data ?? [];
}

/** Latest messaging consent per patient (true, false or null = never asked). */
export async function getConsents(clinicId: string, patientIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (patientIds.length === 0) return map;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messaging_consents")
    .select("clinic_patient_id, granted, recorded_at")
    .eq("clinic_id", clinicId)
    .in("clinic_patient_id", patientIds)
    .order("recorded_at", { ascending: true });
  if (error) return map; // Callers without messaging access simply see no status.
  for (const row of data ?? []) map.set(row.clinic_patient_id as string, row.granted as boolean);
  return map;
}
