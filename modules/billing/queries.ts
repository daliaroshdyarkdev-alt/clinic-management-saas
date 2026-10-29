import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const statusSchema = z.object({
  state: z.enum(["none", "trial", "active", "grace", "restricted"]),
  trial_ends_at: z.string().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  plan_version_id: z.uuid().nullable(),
  doctor_capacity: z.number(),
  active_doctors: z.number(),
  next_period_start: z.string().nullable(),
  next_plan_version_id: z.uuid().nullable(),
  grace_days: z.number(),
});

export type BillingStatus = z.infer<typeof statusSchema>;

/** Any active member may read the entitlement state (for banners). */
export async function getBillingStatus(clinicId: string): Promise<BillingStatus | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("clinic_billing_status", { p_clinic_id: clinicId }).maybeSingle();
  if (error || !data) return null;
  return statusSchema.parse(data);
}

const versionSchema = z.object({
  id: z.uuid(),
  plan_id: z.uuid(),
  version: z.number(),
  doctor_limit: z.number(),
  monthly_price_minor: z.number().nullable(),
  annual_price_minor: z.number().nullable(),
  extra_doctor_monthly_minor: z.number().nullable(),
  extra_doctor_annual_minor: z.number().nullable(),
  messaging_allowance: z.number(),
  messaging_overage_unit_minor: z.number().nullable(),
  published_at: z.string(),
  plan: z.object({ code: z.string(), name_ar: z.string(), name_en: z.string(), is_public: z.boolean() }),
});

export type PlanVersion = z.infer<typeof versionSchema>;

const VERSION_SELECT =
  "id, plan_id, version, doctor_limit, monthly_price_minor, annual_price_minor, extra_doctor_monthly_minor, extra_doctor_annual_minor, messaging_allowance, messaging_overage_unit_minor, published_at, plan:platform_plans!inner(code, name_ar, name_en, is_public)";

/** All visible versions; `current` holds the latest version per plan. */
export async function getPlanCatalog(): Promise<{ all: PlanVersion[]; current: PlanVersion[] }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plan_versions")
    .select(VERSION_SELECT)
    .order("version", { ascending: false });
  if (error) throw new Error("Failed to load plans");
  const all = z.array(versionSchema).parse(data);
  const seen = new Set<string>();
  const current = all.filter((v) => v.plan.is_public && !seen.has(v.plan_id) && seen.add(v.plan_id));
  return { all, current };
}

const paymentSchema = z.object({
  id: z.uuid(),
  clinic_id: z.uuid(),
  plan_version_id: z.uuid(),
  billing_period: z.enum(["monthly", "annual"]),
  extra_doctor_slots: z.number(),
  amount_minor: z.number(),
  source: z.enum(["gateway", "instapay", "bank_transfer"]),
  status: z.enum(["awaiting_gateway", "pending_verification", "paid", "rejected", "failed", "cancelled"]),
  payer_reference: z.string().nullable(),
  decision_reason: z.string().nullable(),
  created_at: z.string(),
});

export type SubscriptionPayment = z.infer<typeof paymentSchema>;

const PAYMENT_SELECT =
  "id, clinic_id, plan_version_id, billing_period, extra_doctor_slots, amount_minor, source, status, payer_reference, decision_reason, created_at";

export async function getPayments(clinicId: string): Promise<SubscriptionPayment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscription_payments")
    .select(PAYMENT_SELECT)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Failed to load payments");
  return z.array(paymentSchema).parse(data);
}

/** Platform admin: manual payments awaiting verification. */
export async function getPendingManualPayments(): Promise<SubscriptionPayment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscription_payments")
    .select(PAYMENT_SELECT)
    .eq("status", "pending_verification")
    .order("created_at")
    .limit(100);
  if (error) throw new Error("Failed to load payments");
  return z.array(paymentSchema).parse(data);
}

const receiptSchema = z.object({
  id: z.uuid(),
  payment_id: z.uuid(),
  receipt_number: z.number(),
  amount_minor: z.number(),
  issued_at: z.string(),
});

export async function getReceipts(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscription_receipts")
    .select("id, payment_id, receipt_number, amount_minor, issued_at")
    .eq("clinic_id", clinicId)
    .order("issued_at", { ascending: false });
  if (error) throw new Error("Failed to load receipts");
  return z.array(receiptSchema).parse(data);
}

export async function getReceipt(receiptId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscription_receipts")
    .select("id, payment_id, receipt_number, amount_minor, issued_at")
    .eq("id", receiptId)
    .maybeSingle();
  if (error || !data) return null;
  return receiptSchema.parse(data);
}

export async function getReverificationRequests(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("license_reverification_requests")
    .select("id, license_type, reason, created_at")
    .eq("clinic_id", clinicId)
    .is("fulfilled_at", null);
  if (error) return [];
  return data ?? [];
}

export async function getTrialExtensions(clinicId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trial_extensions")
    .select("id, days, new_trial_ends_at, reason, created_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}
