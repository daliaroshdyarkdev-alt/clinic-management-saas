import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, type Locale } from "./routing";

/** Validates the `[locale]` segment and enables static rendering for it. */
export function enterRouteLocale(value: string): Locale {
  if (!hasLocale(routing.locales, value)) notFound();
  setRequestLocale(value);
  return value;
}
