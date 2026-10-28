import { z } from "zod";
import { routing, type Locale } from "@/i18n/routing";

/** Locale submitted with a form; anything unexpected falls back to the default. */
export function localeFrom(formData: FormData): Locale {
  return z.enum(routing.locales).catch(routing.defaultLocale).parse(formData.get("locale"));
}
