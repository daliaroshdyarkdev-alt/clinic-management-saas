"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/auth/redirect";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { log } from "@/lib/telemetry/logger";

export type SignInState = {
  error: "auth_unavailable" | "invalid_input" | "invalid_credentials";
  /** Echoed back so the form keeps the email after React resets it (never the password). */
  email?: string;
} | null;

const signInSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

function localeFrom(formData: FormData): Locale {
  const value = formData.get("locale");
  return isLocale(value) ? value : defaultLocale;
}

/**
 * Milestone 0 sign-in plumbing (email + password placeholder, OD-03). Errors
 * are generic so the form does not reveal whether an account exists.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const locale = localeFrom(formData);
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.slice(0, 254) : undefined;
  const parsed = signInSchema.safeParse({ email: rawEmail, password: formData.get("password") });
  if (!parsed.success) return { error: "invalid_input", email };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "auth_unavailable", email };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    log("warn", "auth.sign_in_failed", { code: error.code ?? "unknown" });
    return { error: "invalid_credentials", email };
  }
  redirect(safeNextPath(formData.get("next"), locale));
}
