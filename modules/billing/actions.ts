"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signMockPayload, MOCK_SIGNATURE_HEADER } from "@/lib/billing/mock";
import { localeFrom } from "@/lib/locale-input";
import { parseEgpToMinor } from "@/lib/money";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/telemetry/logger";
import { validateLicenseFile } from "@/modules/onboarding/file-validation";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { paymentProvider } from "./provider";
import { processPaymentEvents } from "./webhook-service";

async function ownerClinic() {
  const clinic = (await getWorkspace())?.active;
  return clinic?.role === "owner" ? clinic.clinicId : null;
}

const choiceSchema = z.object({
  versionId: z.uuid(),
  period: z.enum(["monthly", "annual"]),
  extra: z.coerce.number().int().min(0).max(100),
});

const choiceFrom = (formData: FormData) =>
  choiceSchema.safeParse({
    versionId: formData.get("versionId"),
    period: formData.get("period"),
    extra: formData.get("extra") || 0,
  });

/** SUB-006 online: the price comes from SQL; the gateway only confirms it. */
export async function startOnlinePayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicId = await ownerClinic();
  const choice = choiceFrom(formData);
  if (!clinicId) return { error: "forbidden" };
  if (!choice.success) return { error: "invalid_input" };
  const provider = paymentProvider(locale);
  if (!provider) return { error: "plan_not_available" };

  const started = await callRpc<{ payment_id: string; amount_minor: number }[]>("start_gateway_payment", {
    p_clinic_id: clinicId,
    p_plan_version_id: choice.data.versionId,
    p_billing_period: choice.data.period,
    p_extra_doctor_slots: choice.data.extra,
    p_provider: provider.name,
  });
  if (started.error) return { error: started.error };
  const payment = started.data[0];
  const checkout = await provider.createCheckout({
    paymentId: payment.payment_id,
    amountMinor: Number(payment.amount_minor),
    description: "Clinic subscription",
    returnUrl: `${siteUrl()}/${locale}/app/subscription`,
  });
  const attached = await callRpc("attach_gateway_reference", {
    p_payment_id: payment.payment_id,
    p_provider_ref: checkout.providerRef,
  });
  if (attached.error) return { error: attached.error };
  redirect(checkout.checkoutUrl);
}

/** SUB-006 manual: evidence goes to the private bucket; activation waits for an admin. */
export async function submitManualPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicId = await ownerClinic();
  const choice = choiceFrom(formData);
  const source = z.enum(["instapay", "bank_transfer"]).safeParse(formData.get("source"));
  const reference = z.string().trim().min(1).max(200).safeParse(formData.get("reference"));
  const file = formData.get("file");
  if (!clinicId) return { error: "forbidden" };
  if (!choice.success || !source.success || !reference.success || !(file instanceof File)) {
    return { error: "invalid_input" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = validateLicenseFile(bytes);
  if (!kind) return { error: "invalid_file" };

  const path = `${clinicId}/${randomUUID()}.${kind.ext}`;
  const supabase = await createSupabaseServerClient();
  const upload = await supabase.storage
    .from("billing-evidence")
    .upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (upload.error) {
    logger.error({ event: "billing.evidence_upload_failed", clinicId, errorName: upload.error.name });
    return { error: "unexpected" };
  }
  const result = await callRpc("submit_manual_payment", {
    p_clinic_id: clinicId,
    p_plan_version_id: choice.data.versionId,
    p_billing_period: choice.data.period,
    p_extra_doctor_slots: choice.data.extra,
    p_source: source.data,
    p_payer_reference: reference.data,
    p_storage_path: path,
    p_mime_type: kind.mime,
    p_size_bytes: bytes.length,
  });
  if (result.error) return { error: result.error };
  revalidatePath(`/${locale}/app/subscription`);
  return { error: null, done: true };
}

/**
 * Development only: plays the mock gateway's signed callback through the
 * same verification and processing path as the webhook route.
 */
export async function simulateMockPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const provider = paymentProvider(locale);
  const parsed = z
    .object({
      ref: z.string().regex(/^mock_[0-9a-f-]{36}$/),
      amount: z.coerce.number().int().min(0),
      status: z.enum(["paid", "failed"]),
    })
    .safeParse({ ref: formData.get("ref"), amount: formData.get("amount"), status: formData.get("status") });
  if (!provider || !(await ownerClinic())) return { error: "forbidden" };
  if (!parsed.success) return { error: "invalid_input" };
  const raw = JSON.stringify({
    id: randomUUID(),
    ref: parsed.data.ref,
    status: parsed.data.status,
    amount_minor: parsed.data.amount,
  });
  const headers = new Headers({
    [MOCK_SIGNATURE_HEADER]: signMockPayload(raw, process.env.BILLING_WEBHOOK_SECRET ?? ""),
  });
  const events = provider.parseWebhook(raw, headers);
  if (!events) return { error: "unexpected" };
  await processPaymentEvents(provider.name, events);
  redirect(`/${locale}/app/subscription`);
}

// --- Platform administration (ADM-002, ONB-006) ------------------------------

function adminDone(locale: string, path = "/admin/billing"): ActionState {
  revalidatePath(`/${locale}${path}`);
  return { error: null, done: true };
}

export async function createPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{1,40}$/),
      nameAr: z.string().trim().min(1).max(100),
      nameEn: z.string().trim().min(1).max(100),
    })
    .safeParse({ code: formData.get("code"), nameAr: formData.get("nameAr"), nameEn: formData.get("nameEn") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("admin_create_plan", {
    p_code: parsed.data.code,
    p_name_ar: parsed.data.nameAr,
    p_name_en: parsed.data.nameEn,
  });
  return result.error ? { error: result.error } : adminDone(locale);
}

const optionalMoney = (formData: FormData, name: string): number | null | undefined => {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;
  return parseEgpToMinor(raw) ?? undefined;
};

export async function publishPlanVersion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const planId = z.uuid().safeParse(formData.get("planId"));
  const limit = z.coerce.number().int().min(1).max(1000).safeParse(formData.get("doctorLimit"));
  const allowance = z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .safeParse(formData.get("allowance") || 0);
  const money = ["monthly", "annual", "extraMonthly", "extraAnnual", "overage"].map((n) => optionalMoney(formData, n));
  if (!planId.success || !limit.success || !allowance.success || money.some((m) => m === undefined)) {
    return { error: "invalid_input" };
  }
  const [monthly, annual, extraMonthly, extraAnnual, overage] = money;
  const result = await callRpc("admin_publish_plan_version", {
    p_plan_id: planId.data,
    p_doctor_limit: limit.data,
    p_monthly_price_minor: monthly,
    p_annual_price_minor: annual,
    p_extra_doctor_monthly_minor: extraMonthly,
    p_extra_doctor_annual_minor: extraAnnual,
    p_messaging_allowance: allowance.data,
    p_messaging_overage_unit_minor: overage,
    p_features: {},
  });
  return result.error ? { error: result.error } : adminDone(locale);
}

export async function setPlanVisibility(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const planId = z.uuid().safeParse(formData.get("planId"));
  const visible = z.enum(["true", "false"]).safeParse(formData.get("visible"));
  if (!planId.success || !visible.success) return { error: "invalid_input" };
  const result = await callRpc("admin_set_plan_visibility", {
    p_plan_id: planId.data,
    p_is_public: visible.data === "true",
  });
  return result.error ? { error: result.error } : adminDone(locale);
}

export async function decideManualPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const paymentId = z.uuid().safeParse(formData.get("paymentId"));
  const approve = z.enum(["true", "false"]).safeParse(formData.get("approve"));
  if (!paymentId.success || !approve.success) return { error: "invalid_input" };
  const result = await callRpc("admin_decide_manual_payment", {
    p_payment_id: paymentId.data,
    p_approve: approve.data === "true",
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  return result.error ? { error: result.error } : adminDone(locale);
}

export async function saveBillingSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const grace = z.coerce.number().int().min(0).max(90).safeParse(formData.get("graceDays"));
  const trialDoctors = z.coerce.number().int().min(1).max(100).safeParse(formData.get("trialDoctors"));
  if (!grace.success || !trialDoctors.success) return { error: "invalid_input" };
  for (const [key, value] of [
    ["billing.grace_days", grace.data],
    ["billing.trial_doctor_limit", trialDoctors.data],
  ] as const) {
    const result = await callRpc("admin_set_platform_setting", { p_key: key, p_value: value });
    if (result.error) return { error: result.error };
  }
  return adminDone(locale);
}

export async function extendTrial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicId = z.uuid().safeParse(formData.get("clinicId"));
  const days = z.coerce.number().int().min(1).max(60).safeParse(formData.get("days"));
  if (!clinicId.success || !days.success) return { error: "invalid_input" };
  const result = await callRpc("admin_extend_trial", {
    p_clinic_id: clinicId.data,
    p_days: days.data,
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  return result.error ? { error: result.error } : adminDone(locale, `/admin/clinics/${clinicId.data}`);
}

export async function requestReverification(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const clinicId = z.uuid().safeParse(formData.get("clinicId"));
  const type = z.enum(["clinic_operating", "doctor_professional"]).safeParse(formData.get("licenseType"));
  if (!clinicId.success || !type.success) return { error: "invalid_input" };
  const result = await callRpc("admin_request_license_reverification", {
    p_clinic_id: clinicId.data,
    p_license_type: type.data,
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  return result.error ? { error: result.error } : adminDone(locale, `/admin/clinics/${clinicId.data}`);
}
