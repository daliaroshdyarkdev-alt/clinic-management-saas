"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { logger } from "@/lib/telemetry/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_CLINIC_COOKIE } from "@/lib/tenancy/active-clinic";
import { safeNextPath } from "./safe-next-path";

const signInSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
  locale: z.enum(routing.locales),
  next: z.string().max(500).optional(),
});

export type SignInState = { error: "invalid" | "failed" | null };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Same message for unknown user and wrong password.
    logger.warn({ event: "auth.sign_in_failed", errorCode: error.code ?? "unknown" });
    return { error: "failed" };
  }

  redirect(`/${parsed.data.locale}${safeNextPath(parsed.data.next, parsed.data.locale)}`);
}

export async function signOut(formData: FormData): Promise<void> {
  const locale = z.enum(routing.locales).catch(routing.defaultLocale).parse(formData.get("locale"));
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_CLINIC_COOKIE);
  redirect(`/${locale}/login`);
}
