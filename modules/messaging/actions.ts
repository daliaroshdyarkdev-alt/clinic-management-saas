"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localeFrom } from "@/lib/locale-input";
import { parseEgpToMinor } from "@/lib/money";
import type { ActionState } from "@/modules/shared/form-state";
import { callRpc } from "@/modules/shared/rpc";
import { getWorkspace } from "@/modules/tenancy/workspace";

const EVENTS = [
  "request_received",
  "request_decision",
  "alternative_proposal",
  "reminder",
  "cancellation",
  "session_cancellation",
  "no_show",
] as const;

async function clinicId() {
  return (await getWorkspace())?.active?.clinicId ?? null;
}

function done(locale: string, path: string): ActionState {
  revalidatePath(`/${locale}${path}`);
  return { error: null, done: true };
}

/** WAP-002/003/005 (owner). */
export async function saveNotificationSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const events = formData.getAll("events").map(String);
  const offsets = String(formData.get("offsets") ?? "")
    .split(/[,،\s]+/)
    .filter(Boolean)
    .map(Number);
  const parsed = z
    .object({
      events: z.array(z.enum(EVENTS)),
      offsets: z.array(z.number().int().min(15).max(10080)).max(5),
      language: z.enum(["ar", "en"]),
    })
    .safeParse({ events, offsets, language: formData.get("language") });
  if (!id || !parsed.success) return { error: "invalid_input" };
  const result = await callRpc("set_notification_settings", {
    p_clinic_id: id,
    p_enabled_events: parsed.data.events,
    p_reminder_offsets_minutes: parsed.data.offsets,
    p_default_language: parsed.data.language,
  });
  return result.error ? { error: result.error } : done(locale, "/app/whatsapp");
}

/** WAP-001: clinic-owned number (the token is stored by operations, not here). */
export async function configureConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const parsed = z
    .object({
      phoneNumberId: z
        .string()
        .trim()
        .regex(/^\d{5,30}$/),
      displayPhone: z.string().trim().max(30).optional(),
      credentialRef: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_]{3,64}$/),
    })
    .safeParse({
      phoneNumberId: formData.get("phoneNumberId"),
      displayPhone: formData.get("displayPhone") || undefined,
      credentialRef: formData.get("credentialRef"),
    });
  if (!id || !parsed.success) return { error: "invalid_input" };
  const result = await callRpc("configure_whatsapp_connection", {
    p_clinic_id: id,
    p_mode: "clinic_owned",
    p_phone_number_id: parsed.data.phoneNumberId,
    p_display_phone: parsed.data.displayPhone ?? null,
    p_credential_ref: parsed.data.credentialRef,
  });
  return result.error ? { error: result.error } : done(locale, "/app/whatsapp");
}

/** WAP-013: spending ceiling for billable overage. */
export async function setCeiling(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const amount = parseEgpToMinor(String(formData.get("amount") ?? ""));
  if (!id || amount === null) return { error: "invalid_amount" };
  const result = await callRpc("set_messaging_ceiling", { p_clinic_id: id, p_ceiling_minor: amount });
  return result.error ? { error: result.error } : done(locale, "/app/whatsapp");
}

/** WAP-014: owner grants messaging permissions. */
export async function setMessagingPermission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const parsed = z
    .object({
      role: z.enum(["manager", "receptionist"]),
      capability: z.enum(["messaging.send", "messaging.budget"]),
      allowed: z.enum(["true", "false"]),
    })
    .safeParse({
      role: formData.get("role"),
      capability: formData.get("capability"),
      allowed: formData.get("allowed"),
    });
  if (!id || !parsed.success) return { error: "invalid_input" };
  const result = await callRpc("set_role_permission", {
    p_clinic_id: id,
    p_role: parsed.data.role,
    p_capability: parsed.data.capability,
    p_allowed: parsed.data.allowed === "true",
  });
  return result.error ? { error: result.error } : done(locale, "/app/whatsapp");
}

/** WAP-008/009: consent captured or withdrawn by reception. */
export async function recordConsent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({ patientId: z.uuid(), granted: z.enum(["true", "false"]) })
    .safeParse({ patientId: formData.get("patientId"), granted: formData.get("granted") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("record_messaging_consent", {
    p_clinic_patient_id: parsed.data.patientId,
    p_granted: parsed.data.granted === "true",
    p_source: "receptionist",
  });
  return result.error ? { error: result.error } : done(locale, "/app/patients");
}

/** WAP-007: manual send of an approved appointment template. */
export async function sendManualMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      appointmentId: z.uuid(),
      template: z.enum(["reminder", "cancellation", "no_show", "session_cancellation"]),
    })
    .safeParse({ appointmentId: formData.get("appointmentId"), template: formData.get("template") });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("send_manual_message", {
    p_appointment_id: parsed.data.appointmentId,
    p_template_key: parsed.data.template,
  });
  return result.error ? { error: result.error } : done(locale, "/app/whatsapp");
}

export async function acknowledgeAlert(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const alertId = z.uuid().safeParse(formData.get("alertId"));
  if (!alertId.success) return { error: "invalid_input" };
  const result = await callRpc("acknowledge_messaging_alert", { p_alert_id: alertId.data });
  return result.error ? { error: result.error } : done(locale, "/app/whatsapp");
}

/** WAP-004: clinic-specific template wording, used only after platform approval. */
export async function requestTemplateOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const id = await clinicId();
  const parsed = z
    .object({
      catalogId: z.uuid(),
      name: z
        .string()
        .trim()
        .regex(/^[a-z0-9_]{1,250}$/),
      body: z.string().trim().min(1).max(1024),
    })
    .safeParse({ catalogId: formData.get("catalogId"), name: formData.get("name"), body: formData.get("body") });
  if (!id || !parsed.success) return { error: "invalid_input" };
  const result = await callRpc("request_template_override", {
    p_clinic_id: id,
    p_catalog_id: parsed.data.catalogId,
    p_provider_template_name: parsed.data.name,
    p_body_preview: parsed.data.body,
  });
  return result.error ? { error: result.error } : done(locale, "/app/whatsapp");
}

// --- Platform administration ------------------------------------------------

export async function reviewTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      catalogId: z.uuid().optional(),
      overrideId: z.uuid().optional(),
      approved: z.enum(["true", "false"]),
    })
    .refine((v) => Boolean(v.catalogId) !== Boolean(v.overrideId))
    .safeParse({
      catalogId: formData.get("catalogId") || undefined,
      overrideId: formData.get("overrideId") || undefined,
      approved: formData.get("approved"),
    });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("admin_review_template", {
    p_catalog_id: parsed.data.catalogId ?? null,
    p_override_id: parsed.data.overrideId ?? null,
    p_approved: parsed.data.approved === "true",
  });
  return result.error ? { error: result.error } : done(locale, "/admin/messaging");
}

/** OD-B05: allowance and overage price are platform data, not code. */
export async function savePlatformMessagingSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const allowance = z.coerce.number().int().min(0).max(1_000_000).safeParse(formData.get("allowance"));
  const unitRaw = String(formData.get("unit") ?? "").trim();
  const unit = unitRaw === "" ? null : parseEgpToMinor(unitRaw);
  if (!allowance.success || (unitRaw !== "" && unit === null)) return { error: "invalid_input" };
  const first = await callRpc("admin_set_platform_setting", {
    p_key: "messaging.default_allowance",
    p_value: allowance.data,
  });
  if (first.error) return { error: first.error };
  const second = await callRpc("admin_set_platform_setting", { p_key: "messaging.overage_unit_minor", p_value: unit });
  return second.error ? { error: second.error } : done(locale, "/admin/messaging");
}

export async function configurePlatformNumber(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = z
    .object({
      clinicId: z.uuid(),
      phoneNumberId: z
        .string()
        .trim()
        .regex(/^\d{5,30}$/),
      displayPhone: z.string().trim().max(30).optional(),
      credentialRef: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_]{3,64}$/),
    })
    .safeParse({
      clinicId: formData.get("clinicId"),
      phoneNumberId: formData.get("phoneNumberId"),
      displayPhone: formData.get("displayPhone") || undefined,
      credentialRef: formData.get("credentialRef"),
    });
  if (!parsed.success) return { error: "invalid_input" };
  const result = await callRpc("admin_configure_platform_number", {
    p_clinic_id: parsed.data.clinicId,
    p_phone_number_id: parsed.data.phoneNumberId,
    p_display_phone: parsed.data.displayPhone ?? null,
    p_credential_ref: parsed.data.credentialRef,
  });
  return result.error ? { error: result.error } : done(locale, "/admin/messaging");
}
