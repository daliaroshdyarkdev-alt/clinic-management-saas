"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { localeFrom } from "@/lib/locale-input";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/telemetry/logger";
import { toDomainError, type DomainErrorCode } from "@/modules/shared/db-errors";
import { setActiveClinicCookie } from "@/modules/tenancy/cookie";
import { getWorkspace } from "@/modules/tenancy/workspace";
import { withinRateLimit } from "@/modules/public-booking/service";
import { validateLicenseFile } from "./file-validation";

export type FormState = {
  error: DomainErrorCode | "signup_failed" | "weak_password" | null;
  notice?: "confirm_email" | "uploaded";
};

// Mirrors supabase/config.toml [auth] password policy.
const passwordSchema = z.string().min(10).max(200).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);

const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.email().max(320),
  password: z.string().max(200),
  next: z.string().max(500).optional(),
});

/** ONB-001 / STA-002: create a personal account (owner or invited employee). */
export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const locale = localeFrom(formData);
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "invalid_input" };
  if (!passwordSchema.safeParse(parsed.data.password).success) return { error: "weak_password" };
  if (!(await withinRateLimit("sign_up", 5, 3600))) return { error: "rate_limited" };

  const next = parsed.data.next ? safeNextPath(parsed.data.next, locale) : "/app/clinics/new";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, locale },
      emailRedirectTo: `${siteUrl()}/${locale}/login?next=${encodeURIComponent(`/${locale}${next}`)}`,
    },
  });
  if (error) {
    logger.warn({ event: "auth.sign_up_failed", errorCode: error.code ?? "unknown" });
    return { error: "signup_failed" };
  }
  // With email confirmation enabled there is no session until the link is used.
  if (!data.session) return { error: null, notice: "confirm_email" };
  redirect(`/${locale}${next}`);
}

const registerClinicSchema = z.object({
  name: z.string().trim().min(2).max(200),
  disclaimerVersionId: z.uuid(),
  acceptDisclaimer: z.literal("on"),
});

/** ONB-001 / ONB-007: the signed-in user registers a clinic and becomes its owner. */
export async function registerClinic(_prev: FormState, formData: FormData): Promise<FormState> {
  const locale = localeFrom(formData);
  const parsed = registerClinicSchema.safeParse({
    name: formData.get("name"),
    disclaimerVersionId: formData.get("disclaimerVersionId"),
    acceptDisclaimer: formData.get("acceptDisclaimer"),
  });
  if (!parsed.success) return { error: "invalid_input" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_clinic", {
    p_name: parsed.data.name,
    p_disclaimer_version_id: parsed.data.disclaimerVersionId,
  });
  if (error) return { error: toDomainError(error) };

  await setActiveClinicCookie(z.uuid().parse(data));
  redirect(`/${locale}/app/onboarding`);
}

const licenseTypeSchema = z.enum(["clinic_operating", "doctor_professional"]);

/**
 * ONB-002: upload a licence for the *active* clinic (derived from server
 * state, never from the form). The file is identified by content, stored in
 * the private bucket under the clinic's folder, then registered in SQL, which
 * re-checks ownership, clinic state, path and size.
 */
export async function uploadLicense(_prev: FormState, formData: FormData): Promise<FormState> {
  const locale = localeFrom(formData);
  const workspace = await getWorkspace();
  const clinic = workspace?.active;
  if (!clinic || clinic.role !== "owner") return { error: "forbidden" };

  const licenseType = licenseTypeSchema.safeParse(formData.get("licenseType"));
  const file = formData.get("file");
  if (!licenseType.success || !(file instanceof File)) return { error: "invalid_input" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = validateLicenseFile(bytes);
  if (!kind) return { error: "invalid_file" };

  const path = `${clinic.clinicId}/${licenseType.data}/${randomUUID()}.${kind.ext}`;
  const supabase = await createSupabaseServerClient();
  const upload = await supabase.storage.from("licenses").upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (upload.error) {
    logger.error({ event: "license.upload_failed", clinicId: clinic.clinicId, errorName: upload.error.name });
    return { error: "unexpected" };
  }

  const { error } = await supabase.rpc("submit_clinic_license", {
    p_clinic_id: clinic.clinicId,
    p_license_type: licenseType.data,
    p_storage_path: path,
    p_mime_type: kind.mime,
    p_size_bytes: bytes.length,
  });
  if (error) return { error: toDomainError(error) };

  revalidatePath(`/${locale}/app/onboarding`);
  return { error: null, notice: "uploaded" };
}
